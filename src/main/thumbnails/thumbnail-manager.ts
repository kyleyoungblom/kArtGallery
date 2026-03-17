import { Worker } from 'worker_threads'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { BrowserWindow } from 'electron'
import { getThumbnailCacheDir } from '../utils/paths'
import { getFilesNeedingThumbnails, updateThumbnail, markThumbnailFailed, resetFailedThumbnails, updateFileHash, resetFilesNeedingHashes } from '../db/repositories/files.repo'
import { isSharpSupported, isPsd } from '../utils/supported-formats'
import { appLog } from '../utils/app-logger'
import { APP_DEFAULTS } from '../config/defaults'
import { getSetting } from '../config/settings'
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

const WORKER_COUNT = Math.max(1, os.cpus().length - 1)

let workers: Worker[] = []
let jobQueue: ThumbnailJob[] = []
let activeJobs = 0
let totalJobs = 0
let completedJobs = 0
let skippedCount = 0
let isProcessing = false
let generationStartTime = 0

// Maps fileId → filename and fileId → sizeBytes for error messages and logging.
// We populate these when building the job queue so the worker result handler
// can log helpful messages including file size.
const fileNameMap = new Map<number, string>()
const fileSizeMap = new Map<number, number>()

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

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

function sendProgress(currentFile?: string): void {
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    win.webContents.send('thumbnails:progress', {
      generated: completedJobs,
      total: totalJobs,
      currentFile: currentFile ?? ''
    })
  }
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
    completedJobs++

    const filename = fileNameMap.get(result.fileId) ?? `file #${result.fileId}`

    if (result.success) {
      updateThumbnail(result.fileId, result.outputPath, result.width, result.height)

      // Save perceptual hash if the worker computed one
      if (result.phash) {
        updateFileHash(result.fileId, result.phash)
      }

      // Queue this file ID for batch notification to the renderer
      readyFileIds.push(result.fileId)
      scheduleFlush()
    } else {
      // Mark as "generated" so we don't retry on every scan.
      // Store the error for diagnosis via "View Failed Files" modal.
      const size = fileSizeMap.get(result.fileId) ?? 0
      const category = result.errorCategory ?? 'unknown'
      const errorForDb = `[${category}] ${result.error}`
      appLog('warn', 'thumbnails', `Failed: ${filename} (${formatBytes(size)}) — [${category}] ${result.error}`)
      markThumbnailFailed(result.fileId, errorForDb)
    }

    // Send overall progress with current filename
    const nextJob = jobQueue[0]
    sendProgress(nextJob?.filename)

    // Process next job in queue
    processNextJob(worker)
  })

  // If the worker thread itself crashes (not a job failure, but an unhandled
  // exception in the thread), replace it with a fresh one so the pool stays
  // at full capacity.
  worker.on('error', (err) => {
    appLog('error', 'thumbnails', `Worker thread crashed: ${err.message}`)
    activeJobs--

    // Replace the dead worker
    const index = workers.indexOf(worker)
    if (index !== -1) {
      workers[index] = createWorker()
      processNextJob(workers[index])
    }
  })

  return worker
}

function processNextJob(worker: Worker): void {
  if (jobQueue.length === 0) {
    // Check if all workers are idle — if so, processing is complete
    if (activeJobs === 0) {
      isProcessing = false
      const elapsed = ((Date.now() - generationStartTime) / 1000).toFixed(1)
      const skippedMsg = skippedCount > 0 ? ` (${skippedCount} skipped — unsupported format)` : ''

      // Calculate cache directory size
      let cacheSizeMB = '?'
      try {
        const cacheDir = getThumbnailCacheDir()
        const cacheFiles = fs.readdirSync(cacheDir)
        let totalBytes = 0
        for (const f of cacheFiles) {
          try { totalBytes += fs.statSync(path.join(cacheDir, f)).size } catch { /* skip */ }
        }
        cacheSizeMB = (totalBytes / (1024 * 1024)).toFixed(1)
      } catch { /* cache dir missing */ }

      appLog('info', 'thumbnails', `Thumbnail generation complete: ${completedJobs}/${totalJobs} processed${skippedMsg} in ${elapsed}s — cache size: ${cacheSizeMB} MB`)
      fileNameMap.clear()
      fileSizeMap.clear()
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

  // Re-queue files that were previously marked as failed (e.g., PSDs that were
  // skipped before PSD support was added). This is safe to call every time —
  // it only affects files with thumbnail_generated=1 and thumbnail_path=NULL.
  const requeued = resetFailedThumbnails()
  if (requeued > 0) {
    appLog('info', 'thumbnails', `Re-queued ${requeued} previously-failed files for thumbnail generation`)
  }

  // Backfill: re-queue files that have thumbnails but no perceptual hash.
  // This happens after the phash column is added (migration 3) — existing
  // thumbnailed files need to go through the pipeline again to get hashed.
  // The thumbnail JPEG gets overwritten with an identical file — harmless.
  const hashBackfill = resetFilesNeedingHashes()
  if (hashBackfill > 0) {
    appLog('info', 'thumbnails', `Re-queued ${hashBackfill} files for perceptual hash computation`)
  }

  const files = getFilesNeedingThumbnails()
  if (files.length === 0) return

  const cacheDir = getThumbnailCacheDir()
  const maxDimension = getSetting('thumbnail.maxDimension', APP_DEFAULTS.thumbnail.maxDimension)
  const quality = getSetting('thumbnail.jpegQuality', APP_DEFAULTS.thumbnail.jpegQuality)

  // Filter to formats we can generate thumbnails for:
  // - Sharp-supported: JPG, PNG, GIF, WEBP (direct sharp decode)
  // - PSD: decoded via @webtoon/psd → raw RGBA → sharp
  // SVG and other unsupported formats are skipped.
  const supportedFiles = []
  skippedCount = 0

  for (const file of files) {
    if (isSharpSupported(file.path) || isPsd(file.path)) {
      supportedFiles.push(file)
    } else {
      markThumbnailFailed(file.id, `[unsupported_format] ${file.extension} — not yet supported for thumbnails`)
      skippedCount++
      appLog('info', 'thumbnails', `Skipped: ${file.filename} (${formatBytes(file.size_bytes)}) — [unsupported_format] ${file.extension}`)
    }
  }

  if (supportedFiles.length === 0) {
    if (skippedCount > 0) {
      appLog('info', 'thumbnails', `All ${skippedCount} files skipped — no supported formats to process`)
    }
    return
  }

  isProcessing = true
  completedJobs = 0
  totalJobs = supportedFiles.length
  generationStartTime = Date.now()

  // Process smaller files first — they generate faster, so the UI fills in
  // quickly while larger PSDs process in the background.
  supportedFiles.sort((a, b) => a.size_bytes - b.size_bytes)

  appLog('info', 'thumbnails', `Starting thumbnail generation for ${supportedFiles.length} files (${WORKER_COUNT} workers)`)

  // Build filename and size maps for error messages
  fileNameMap.clear()
  fileSizeMap.clear()
  for (const file of supportedFiles) {
    fileNameMap.set(file.id, file.filename)
    fileSizeMap.set(file.id, file.size_bytes)
  }

  // Build the job queue
  jobQueue = supportedFiles.map((file) => ({
    fileId: file.id,
    sourcePath: file.path,
    outputPath: path.join(cacheDir, `${file.id}.jpg`),
    maxDimension,
    quality,
    filename: file.filename,
    sizeBytes: file.size_bytes
  }))

  // Create workers if they don't exist yet (we reuse them across scans)
  if (workers.length === 0) {
    for (let i = 0; i < WORKER_COUNT; i++) {
      workers.push(createWorker())
    }
  }

  // Send initial progress with first filename
  sendProgress(jobQueue[0]?.filename)

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
  fileNameMap.clear()
  fileSizeMap.clear()
}
