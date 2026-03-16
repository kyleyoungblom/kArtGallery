import { ipcMain } from 'electron'
import path from 'path'
import { getFileById } from '../db/repositories/files.repo'
import { getThumbnailCacheDir } from '../utils/paths'

// Thumbnail IPC is intentionally thin right now. For the MVP, we serve
// the original image file directly instead of generating thumbnails.
// Phase 3 will add the sharp-based thumbnail pipeline. This approach
// lets us get a working grid on screen quickly, then optimize.
//
// The renderer doesn't know whether it's getting a cached thumbnail or
// the original — it just gets a file path. This abstraction means we can
// swap in real thumbnails later without changing the renderer at all.

export function registerThumbnailHandlers(): void {
  ipcMain.handle('gallery:get-thumbnail', async (_event, fileId: number) => {
    const file = getFileById(fileId)
    if (!file) return null

    // If a cached thumbnail exists, serve it
    if (file.thumbnail_path) {
      const thumbPath = path.join(getThumbnailCacheDir(), file.thumbnail_path)
      return thumbPath
    }

    // Fallback: serve the original file path.
    // For the MVP this is fine — the renderer will load the full image.
    // This will be slow for large files, which is exactly why Phase 3 exists.
    return file.path
  })
}
