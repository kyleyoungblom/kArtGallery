import { Worker } from 'worker_threads'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { BrowserWindow } from 'electron'
import { getThumbnailCacheDir } from '../utils/paths'
import { getFilesNeedingThumbnails, updateThumbnail } from '../db/repositories/files.repo'
import type { ThumbnailJob, ThumbnailResult } from './thumbnail-worker'

// The thumbnail manager is a work queue with a pool of worker threads.
//
// Why a pool instead of one worker? Thumbnail generation is CPU-bound.
// A single worker processes one image at a time, leaving other CPU cores idle.
// With a pool of N workers (one per core minus one), we process N images
// concurrently. On a 4-core machine, that's roughly 4x faster.
//
// Why "minus one"? We leave one core free for the main process (UI, IPC,
// database queries). Saturating all cores would make the app feel sluggish
// even though thumbnails are generating faster.

const MAX_DIMENSION = 400
const WORKER_COUNT = Math.max(1, os.cpus().length - 1)

let workers: Worker[] = []
let jobQueue: ThumbnailJob[] = []
let activeJobs = 0
let totalJobs = 0
let completedJobs = 0
let isProcessing = false

// Batch notification: instead of sending one IPC event per thumbnail (which
// would flood the renderer with thousands of events), we accumulate ready
// file IDs and flush them in batches. This is a common pattern called
// "debounced batching" — it balances freshness against overhead.
let readyFileIds: number[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
const FLUSH_INTERVAL_MS = 300

function flushReadyNotifications(): void {
  if (readyFileIds.length === 0) return

  const batch = readyFileIds
  readyFileIds = []

  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    win.webContents.send('thumbnails:ready', batch)
  }
}

function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    flushReadyNotifications()
  }, FLUSH_INTERVAL_MS)
}

function getWorkerPath(): string {
  // In development, the worker is compiled by electron-vite to the out/ directory.
  // We need to resolve the path relative to the compiled main process file.
  return path.join(__dirname, 'thumbnail-worker.js')
}

function createWorker(): Worker {
  const worker = new Worker(getWorkerPath())

  worker.on('message', (result: ThumbnailResult) => {
    activeJobs--

    if (result.success) {
      updateThumbnail(result.fileId, result.outputPath, result.width, result.height)
      completedJobs++

      // Queue this file ID for batch notification to the renderer
      readyFileIds.push(result.fileId)
      scheduleFlush()

      // Also send overall progress
      const windows = BrowserWindow.getAllWindows()
      for (const win of windows) {
        win.webContents.send('thumbnails:progress', {
          generated: completedJobs,
          total: totalJobs
        })
      }
    }

    // Process next job in queue
    processNextJob(worker)
  })

  worker.on('error', (err) => {
    console.error('Thumbnail worker error:', err)
    activeJobs--
    // Try to process next job even if this one failed
    processNextJob(worker)
  })

  return worker
}

function processNextJob(worker: Worker): void {
  if (jobQueue.length === 0) {
    // Check if all workers are idle — if so, processing is complete
    if (activeJobs === 0) {
      isProcessing = false
      // Flush any remaining thumbnail-ready notifications
      if (flushTimer) {
        clearTimeout(flushTimer)
        flushTimer = null
      }
      flushReadyNotifications()
    }
    return
  }

  const job = jobQueue.shift()!
  activeJobs++
  worker.postMessage(job)
}

export function startThumbnailGeneration(): void {
  if (isProcessing) return

  const files = getFilesNeedingThumbnails()
  if (files.length === 0) return

  const cacheDir = getThumbnailCacheDir()
  isProcessing = true
  completedJobs = 0
  totalJobs = files.length

  // Build the job queue
  jobQueue = files.map((file) => ({
    fileId: file.id,
    sourcePath: file.path,
    outputPath: path.join(cacheDir, `${file.id}.jpg`),
    maxDimension: MAX_DIMENSION
  }))

  // Create workers if they don't exist yet (we reuse them across scans)
  if (workers.length === 0) {
    for (let i = 0; i < WORKER_COUNT; i++) {
      workers.push(createWorker())
    }
  }

  // Kick off processing — each worker grabs the next job from the queue
  for (const worker of workers) {
    processNextJob(worker)
  }
}

export function shutdownWorkers(): void {
  for (const worker of workers) {
    worker.terminate()
  }
  workers = []
  jobQueue = []
  isProcessing = false
}
