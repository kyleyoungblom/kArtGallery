import { ipcMain } from 'electron'
import path from 'path'
import fs from 'fs'
import { getFileById } from '../db/repositories/files.repo'
import { getThumbnailCacheDir } from '../utils/paths'

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

    // Fallback: serve the original file while thumbnail generates in background.
    return file.path
  })
}
