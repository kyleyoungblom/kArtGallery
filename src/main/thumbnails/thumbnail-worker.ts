import { parentPort } from 'worker_threads'
import sharp from 'sharp'
import path from 'path'

// This file runs in a worker thread, NOT the main thread.
// It receives messages from the main thread (thumbnail jobs),
// processes them, and sends back results.
//
// Each message is a single thumbnail job: read an image file,
// resize it, and save the thumbnail to the cache directory.

export interface ThumbnailJob {
  fileId: number
  sourcePath: string
  outputPath: string
  maxDimension: number
}

export interface ThumbnailResult {
  fileId: number
  outputPath: string
  width: number
  height: number
  success: boolean
  error?: string
}

if (parentPort) {
  parentPort.on('message', async (job: ThumbnailJob) => {
    try {
      // sharp reads the image, resizes it (preserving aspect ratio so the
      // longest side equals maxDimension), and writes a JPEG.
      //
      // Why JPEG for thumbnails? It's the best balance of file size vs quality
      // for photographic content. A 400px JPEG thumbnail is ~15-30KB vs ~200KB
      // for PNG. Over thousands of images, that's gigabytes of difference.
      const metadata = await sharp(job.sourcePath).metadata()

      const result = await sharp(job.sourcePath)
        .rotate() // Auto-rotate based on EXIF orientation
        .resize(job.maxDimension, job.maxDimension, {
          fit: 'inside', // Scale down to fit within the box, preserving aspect ratio
          withoutEnlargement: true // Don't upscale small images
        })
        .jpeg({ quality: 80 })
        .toFile(job.outputPath)

      const response: ThumbnailResult = {
        fileId: job.fileId,
        outputPath: path.basename(job.outputPath),
        width: metadata.width ?? result.width,
        height: metadata.height ?? result.height,
        success: true
      }

      parentPort!.postMessage(response)
    } catch (err) {
      const response: ThumbnailResult = {
        fileId: job.fileId,
        outputPath: '',
        width: 0,
        height: 0,
        success: false,
        error: err instanceof Error ? err.message : String(err)
      }

      parentPort!.postMessage(response)
    }
  })
}
