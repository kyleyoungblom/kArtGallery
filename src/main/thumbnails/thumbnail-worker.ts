import { parentPort } from 'worker_threads'
import sharp from 'sharp'
import { execFileSync } from 'child_process'
import path from 'path'
import fs from 'fs'
import Psd from '@webtoon/psd'

// This file runs in a worker thread, NOT the main thread.
// It receives messages from the main thread (thumbnail jobs),
// processes them, and sends back results.
//
// Each message is a single thumbnail job: read an image file,
// resize it, and save the thumbnail to the cache directory.
// PSD files are decoded via @webtoon/psd → raw RGBA → sharp.

export interface ThumbnailJob {
  fileId: number
  sourcePath: string
  outputPath: string
  maxDimension: number
  quality: number
  filename: string // For error messages and status display
  sizeBytes: number
}

export interface ThumbnailResult {
  fileId: number
  outputPath: string
  width: number
  height: number
  success: boolean
  error?: string
  errorCategory?: string
  phash?: string // 256-bit dHash as 64-char hex string for duplicate detection
}

function categorizeError(msg: string): string {
  const lower = msg.toLowerCase()
  if (/enoent|eacces|eperm|no such file|permission denied/.test(lower)) return 'io_error'
  if (/out of memory|heap|exceeds pixel limit|too large|allocation/.test(lower)) return 'file_too_large'
  // Sharp and PSD decode failures
  if (/unsupported image|invalid|corrupt|bad header|unexpected end|cannot read/.test(lower)) return 'corrupt_file'
  return 'unknown'
}

function isPsdFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.psd')
}

// ── Perceptual Hashing (dHash) ──
//
// dHash (difference hash) produces a 256-bit fingerprint of an image's visual
// content. It works by resizing to a 17×16 grayscale grid, then comparing
// each pixel to its right neighbor. If the left pixel is brighter, that bit
// is 1; otherwise 0. This produces 16 rows × 16 comparisons = 256 bits.
//
// Why 256-bit instead of 64-bit? At 9×8 (64-bit), too much detail is lost —
// structurally different images with similar average brightness patterns produce
// colliding hashes (false positives). 17×16 captures enough spatial detail to
// distinguish images that merely share a color palette or general layout.
//
// Why this works for duplicate detection:
// - Resizing to 17×16 discards fine detail, so different resolutions match
// - Grayscale conversion ignores color space differences (sRGB vs Adobe RGB)
// - Relative brightness comparison (not absolute) handles brightness/contrast edits
// - The hash is rotation-sensitive by design — rotated images are NOT duplicates
//   in an art reference context

const DHASH_WIDTH = 17   // 17 pixels wide → 16 comparisons per row
const DHASH_HEIGHT = 16  // 16 rows
const DHASH_BITS = DHASH_WIDTH - 1  // comparisons per row
const DHASH_TOTAL_BITS = DHASH_BITS * DHASH_HEIGHT  // 256 bits total
const DHASH_HEX_LENGTH = DHASH_TOTAL_BITS / 4  // 64 hex characters

async function computeDHash(source: string | Buffer, rawOptions?: { width: number; height: number; channels: 1 | 2 | 3 | 4 }): Promise<string> {
  // Resize to 17 wide × 16 tall, grayscale, raw pixel buffer.
  // 17 wide because we compare adjacent pixels: 17 pixels → 16 comparisons per row.
  const pipeline = rawOptions
    ? sharp(source, { raw: { ...rawOptions } })
    : sharp(source, { failOn: 'none' })

  const buf = await pipeline
    .rotate()       // Apply EXIF rotation so orientation doesn't affect hash
    .greyscale()
    .resize(DHASH_WIDTH, DHASH_HEIGHT, { fit: 'fill' })
    .raw()
    .toBuffer()

  // buf is 17×16 = 272 bytes of grayscale pixel data.
  // Walk each row, compare pixel[col] vs pixel[col+1].
  // 256 bits = 32 bytes, stored as a 64-character hex string.
  const bytes = new Uint8Array(32)  // 256 bits
  let bitIndex = 0

  for (let row = 0; row < DHASH_HEIGHT; row++) {
    for (let col = 0; col < DHASH_BITS; col++) {
      const left = buf[row * DHASH_WIDTH + col]
      const right = buf[row * DHASH_WIDTH + col + 1]
      if (left > right) {
        bytes[bitIndex >> 3] |= 1 << (bitIndex & 7)
      }
      bitIndex++
    }
  }

  // Convert to 64-character hex string (zero-padded)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

// Compute dHash from a PSD's composited pixel data (already decoded as RGBA).
async function computeDHashFromRawRGBA(rgba: Uint8Array, width: number, height: number): Promise<string> {
  return computeDHash(Buffer.from(rgba), { width, height, channels: 4 })
}

// Return type for image processing functions. For PSD files processed via
// @webtoon/psd, we carry the raw RGBA composite so dHash can be computed
// from it directly (avoiding re-decoding the PSD).
interface ProcessResult {
  width: number
  height: number
  compositeRGBA?: Uint8Array
  compositeWidth?: number
  compositeHeight?: number
}

async function processPsdWithWebtoon(job: ThumbnailJob): Promise<ProcessResult> {
  // @webtoon/psd requires an ArrayBuffer. Read the file into a Node Buffer
  // then convert (zero-copy via .buffer slice).
  const fileBuffer = fs.readFileSync(job.sourcePath)
  const arrayBuffer = fileBuffer.buffer.slice(
    fileBuffer.byteOffset,
    fileBuffer.byteOffset + fileBuffer.byteLength
  )

  const psd = Psd.parse(arrayBuffer)
  const composite = await psd.composite()

  // composite() returns RGBA Uint8Array at full PSD resolution.
  // Feed it into sharp as raw pixel data, then resize → JPEG.
  await sharp(Buffer.from(composite), {
    raw: { width: psd.width, height: psd.height, channels: 4 }
  })
    .resize(job.maxDimension, job.maxDimension, {
      fit: 'inside',
      withoutEnlargement: true
    })
    .jpeg({ quality: job.quality })
    .toFile(job.outputPath)

  return {
    width: psd.width,
    height: psd.height,
    compositeRGBA: composite,
    compositeWidth: psd.width,
    compositeHeight: psd.height
  }
}

async function processPsdWithSharp(job: ThumbnailJob): Promise<ProcessResult> {
  // Fallback: sharp (via libvips) can decode many PSDs that @webtoon/psd can't,
  // including 16-bit, old Photoshop formats, and Procreate exports.
  const metadata = await sharp(job.sourcePath, { failOn: 'none' }).metadata()

  await sharp(job.sourcePath, { failOn: 'none' })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .resize(job.maxDimension, job.maxDimension, {
      fit: 'inside',
      withoutEnlargement: true
    })
    .jpeg({ quality: job.quality })
    .toFile(job.outputPath)

  return { width: metadata.width ?? 0, height: metadata.height ?? 0 }
}

async function processPsd(job: ThumbnailJob): Promise<ProcessResult> {
  try {
    return await processPsdWithWebtoon(job)
  } catch {
    // @webtoon/psd failed — try sharp (handles 16-bit, some old formats)
    try {
      return await processPsdWithSharp(job)
    } catch {
      // Both failed — try macOS sips as last resort
      return await processWithSips(job)
    }
  }
}

async function processWithSips(job: ThumbnailJob): Promise<ProcessResult> {
  // macOS `sips` can decode many formats that sharp/libvips cannot,
  // including old Photoshop PSDs, Procreate exports, and unusual BMPs.
  // Convert to a temp PNG first, then let sharp resize to JPEG thumbnail.
  const tempPng = job.outputPath + '.tmp.png'
  try {
    execFileSync('sips', [
      '-s', 'format', 'png',
      '--resampleHeightWidthMax', String(job.maxDimension),
      job.sourcePath,
      '--out', tempPng
    ], { timeout: 30000 })

    const metadata = await sharp(tempPng).metadata()
    await sharp(tempPng)
      .jpeg({ quality: job.quality })
      .toFile(job.outputPath)

    return { width: metadata.width ?? 0, height: metadata.height ?? 0 }
  } finally {
    try { fs.unlinkSync(tempPng) } catch { /* cleanup best-effort */ }
  }
}

async function processImage(job: ThumbnailJob): Promise<ProcessResult> {
  try {
    // failOn: 'none' — tolerate TIFF/BMP files with minor metadata issues
    // (null bytes in EXIF tags, tile warnings) that are otherwise decodable.
    const metadata = await sharp(job.sourcePath, { failOn: 'none' }).metadata()

    await sharp(job.sourcePath, { failOn: 'none' })
      .rotate()
      .resize(job.maxDimension, job.maxDimension, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .jpeg({ quality: job.quality })
      .toFile(job.outputPath)

    return { width: metadata.width ?? 0, height: metadata.height ?? 0 }
  } catch {
    // Sharp failed — try macOS sips as last resort (handles old BMP/TIFF variants)
    return await processWithSips(job)
  }
}

if (parentPort) {
  parentPort.on('message', async (job: ThumbnailJob) => {
    try {
      const dims = isPsdFile(job.sourcePath)
        ? await processPsd(job)
        : await processImage(job)

      // Compute perceptual hash for duplicate detection.
      // For PSD files that returned composite data, hash from the raw RGBA.
      // For regular images, hash from the source file (sharp handles decoding).
      let phash: string | undefined
      try {
        if (dims.compositeRGBA && dims.compositeWidth && dims.compositeHeight) {
          phash = await computeDHashFromRawRGBA(dims.compositeRGBA, dims.compositeWidth, dims.compositeHeight)
        } else {
          phash = await computeDHash(job.sourcePath)
        }
      } catch {
        // Hash computation failure is non-fatal — thumbnail still succeeds.
        // The file just won't participate in duplicate detection.
      }

      const response: ThumbnailResult = {
        fileId: job.fileId,
        outputPath: path.basename(job.outputPath),
        width: dims.width,
        height: dims.height,
        success: true,
        phash
      }

      parentPort!.postMessage(response)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      const response: ThumbnailResult = {
        fileId: job.fileId,
        outputPath: '',
        width: 0,
        height: 0,
        success: false,
        error: errorMsg,
        errorCategory: categorizeError(errorMsg)
      }

      parentPort!.postMessage(response)
    }
  })
}
