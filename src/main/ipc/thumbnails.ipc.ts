import { ipcMain } from 'electron'
import { execFileSync } from 'child_process'
import path from 'path'
import fs from 'fs'
import sharp from 'sharp'
import { getFileById } from '../db/repositories/files.repo'
import { getThumbnailCacheDir, getPreviewCacheDir } from '../utils/paths'
import { isBrowserRenderable } from '../utils/supported-formats'

export function registerThumbnailHandlers(): void {
  ipcMain.handle('gallery:get-thumbnail', async (_event, fileId: number) => {
    const file = getFileById(fileId)
    if (!file) return null

    // Serve cached thumbnail if it exists on disk.
    // We verify the file exists because the cache could have been cleared.
    if (file.thumbnail_path) {
      const thumbPath = path.join(getThumbnailCacheDir(), file.thumbnail_path)
      if (fs.existsSync(thumbPath)) {
        return thumbPath
      }
    }

    // Fallback: serve the original file ONLY if the browser can render it.
    // PSD, TIFF, and other non-browser formats would cause the <img> tag to
    // silently fail (onLoad never fires), leaving an invisible tile that
    // takes up grid space. Returning null shows a placeholder instead.
    if (isBrowserRenderable(file.path)) {
      return file.path
    }

    return null
  })

  // On-demand high-resolution preview for non-browser-renderable formats.
  // Uses macOS `sips` to render PSDs/TIFFs at up to 2048px for the lightbox.
  // Results are cached in a temp directory and cleaned up on app quit.
  ipcMain.handle('gallery:render-preview', async (_event, fileId: number, maxDimension = 2048) => {
    const file = getFileById(fileId)
    if (!file) return null

    // Browser-renderable files don't need a preview — use the original
    if (isBrowserRenderable(file.path)) return file.path

    const previewDir = getPreviewCacheDir()
    const outputPath = path.join(previewDir, `preview-${fileId}.jpg`)

    // Return cached preview if already rendered
    if (fs.existsSync(outputPath)) return outputPath

    // Render via sips (macOS native, proven reliable for PSDs)
    const tempPng = outputPath + '.tmp.png'
    try {
      execFileSync('sips', [
        '-s', 'format', 'png',
        '--resampleHeightWidthMax', String(maxDimension),
        file.path,
        '--out', tempPng
      ], { timeout: 60000 })

      await sharp(tempPng)
        .jpeg({ quality: 85 })
        .toFile(outputPath)

      return outputPath
    } catch {
      return null
    } finally {
      try { fs.unlinkSync(tempPng) } catch { /* best effort */ }
    }
  })
}
