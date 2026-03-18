// Auto-update via electron-updater + GitHub Releases.
//
// On startup (production only), checks for a newer release on GitHub.
// If found, downloads it in the background and notifies the renderer
// so the Settings UI can show a "Restart to Update" button.
//
// The update flow:
// 1. App launches → delayed check (5s) so the window loads first
// 2. If a new version exists → auto-download in the background
// 3. Renderer shows "Update ready — Restart to Update"
// 4. User clicks → quitAndInstall() swaps the binary and relaunches
//
// IPC channels:
// - updater:check       → manually trigger a check (Settings button)
// - updater:install     → quit and install the downloaded update
// - updater:get-status  → return current status for UI initialization
// - updater:status-changed (main→renderer) → live status updates

import { app, ipcMain, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { appLog } from '../utils/app-logger'

// Status states the renderer can display
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'up-to-date'; version: string }
  | { state: 'error'; message: string }

let currentStatus: UpdateStatus = { state: 'idle' }

function setStatus(status: UpdateStatus): void {
  currentStatus = status
  // Broadcast to all renderer windows
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('updater:status-changed', status)
  }
}

export function initAutoUpdater(): void {
  // IPC handlers are registered unconditionally so the renderer always gets
  // a response. In dev mode, the handlers return meaningful feedback instead
  // of silently ignoring the call.

  const isDev = !app.isPackaged

  // ── IPC handlers (always registered) ──

  ipcMain.handle('updater:check', () => {
    if (isDev) {
      appLog('info', 'updater', 'Update check skipped (dev mode)')
      setStatus({ state: 'error', message: 'Updates are only available in the packaged app' })
      return
    }
    autoUpdater.checkForUpdates()
  })

  ipcMain.handle('updater:install', () => {
    if (isDev) return
    // quitAndInstall: closes the app, runs the new installer, relaunches.
    // The false, true args mean: don't force-close windows silently (false),
    // but do restart after install (true).
    autoUpdater.quitAndInstall(false, true)
  })

  ipcMain.handle('updater:get-status', () => {
    return currentStatus
  })

  // In dev mode, there's no installed app to update — skip autoUpdater setup.
  if (isDev) {
    appLog('info', 'updater', 'Skipping auto-update (not packaged)')
    return
  }

  // Auto-download updates so the user just needs to click "Restart"
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  // ── Event handlers (production only) ──

  autoUpdater.on('checking-for-update', () => {
    appLog('info', 'updater', 'Checking for updates...')
    setStatus({ state: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    appLog('info', 'updater', `Update available: v${info.version}`)
    setStatus({ state: 'available', version: info.version })
  })

  autoUpdater.on('update-not-available', (info) => {
    appLog('info', 'updater', `Up to date (v${info.version})`)
    setStatus({ state: 'up-to-date', version: info.version })
  })

  autoUpdater.on('download-progress', (progress) => {
    // Only update status if we know the version (set by update-available)
    const version = currentStatus.state === 'available' || currentStatus.state === 'downloading'
      ? (currentStatus as { version: string }).version
      : ''
    setStatus({ state: 'downloading', version, percent: Math.round(progress.percent) })
  })

  autoUpdater.on('update-downloaded', (info) => {
    appLog('info', 'updater', `Update downloaded: v${info.version}`)
    setStatus({ state: 'ready', version: info.version })
  })

  autoUpdater.on('error', (err) => {
    appLog('warn', 'updater', `Update error: ${err.message}`)
    setStatus({ state: 'error', message: err.message })
  })

  // Delayed startup check — let the window load first so the user
  // sees their gallery before any update notifications.
  setTimeout(() => {
    appLog('info', 'updater', 'Running startup update check')
    autoUpdater.checkForUpdates()
  }, 5000)
}
