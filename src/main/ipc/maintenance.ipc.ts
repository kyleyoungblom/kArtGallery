import { ipcMain, shell, app, BrowserWindow } from 'electron'
import fs from 'fs'
import { resetAllThumbnails, getFailedFiles } from '../db/repositories/files.repo'
import { getThumbnailCacheDir, getAppDataDir } from '../utils/paths'
import { startThumbnailGeneration, shutdownWorkers } from '../thumbnails/thumbnail-manager'
import { closeDb } from '../db/connection'
import { appLog } from '../utils/app-logger'

// Maintenance operations: reset thumbnails, open data folder, etc.
// These are "power user" actions exposed in the UI for debugging and recovery.

export function registerMaintenanceHandlers(): void {
  // Reset all thumbnails: clears DB state, deletes cached files, regenerates.
  ipcMain.handle('maintenance:reset-thumbnails', async () => {
    // 1. Reset DB records so all files are re-queued
    const count = resetAllThumbnails()

    // 2. Delete all cached thumbnail files from disk
    const cacheDir = getThumbnailCacheDir()
    const files = fs.readdirSync(cacheDir)
    for (const file of files) {
      try {
        fs.unlinkSync(`${cacheDir}/${file}`)
      } catch {
        // Skip files we can't delete
      }
    }

    appLog('info', 'maintenance', `Reset thumbnails for ${count} files, deleted ${files.length} cached files`)

    // 3. Kick off regeneration
    startThumbnailGeneration()

    return { resetCount: count, deletedFiles: files.length }
  })

  // Open the app data directory in Finder/Explorer — useful for debugging
  // or manually deleting the database.
  ipcMain.handle('maintenance:open-data-folder', () => {
    shell.openPath(getAppDataDir())
  })

  ipcMain.handle('maintenance:get-failed-files', () => {
    return getFailedFiles()
  })

  // Reveal a file in Finder/Explorer (highlights the file in its parent folder)
  ipcMain.handle('shell:show-item-in-folder', (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  // Open a folder in Finder/Explorer
  ipcMain.handle('shell:open-folder', (_event, folderPath: string) => {
    shell.openPath(folderPath)
  })

  // Return storage statistics: DB file size + thumbnail cache size.
  // Called once on app startup and displayed in the status bar so the user
  // has a sense of how much disk space the app is using.
  ipcMain.handle('maintenance:get-storage-stats', () => {
    const { getDbPath } = require('../utils/paths')
    let dbSize = 0
    let cacheSize = 0
    try {
      dbSize = fs.statSync(getDbPath()).size
    } catch { /* file may not exist yet */ }
    try {
      const cacheDir = getThumbnailCacheDir()
      const cacheFiles = fs.readdirSync(cacheDir)
      for (const f of cacheFiles) {
        try {
          cacheSize += fs.statSync(`${cacheDir}/${f}`).size
        } catch { /* skip */ }
      }
    } catch { /* dir may not exist */ }
    return { dbSize, cacheSize }
  })

  // Toggle fullscreen for the focused window.
  // On macOS this uses the native fullscreen animation (traffic lights reappear
  // on hover). On Windows this enters true fullscreen (hides the title bar).
  // Returning the new state lets the renderer update its UI indicator.
  ipcMain.handle('window:toggle-fullscreen', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    const isFullScreen = win.isFullScreen()
    win.setFullScreen(!isFullScreen)
    return !isFullScreen
  })

  // Get the current fullscreen state so the renderer can initialize correctly.
  ipcMain.handle('window:is-fullscreen', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win?.isFullScreen() ?? false
  })

  // Dev: restart the app (relaunch + quit). Useful for testing new builds
  // without manually closing and reopening from Finder.
  ipcMain.handle('maintenance:restart-app', () => {
    shutdownWorkers()
    closeDb()
    app.relaunch()
    app.exit(0)
  })
}
