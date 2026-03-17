import { ipcMain, dialog, BrowserWindow } from 'electron'
import { getSetting } from '../config/settings'
import { setPreference } from '../db/repositories/preferences.repo'
import { APP_DEFAULTS } from '../config/defaults'
import { getDeviceId, isSyncConfigured, getEventLogPath } from '../sync/event-emitter'
import { appLog } from '../utils/app-logger'

// IPC handlers for cross-device sync configuration.
//
// These let the renderer's Settings UI read/write sync preferences:
// - Event log file path (where the JSONL lives, e.g., in a Dropbox folder)
// - Root mappings (which local folders map to which sync aliases)
// - Device name (human-readable, shown in conflict messages)
// - Sync status (for the UI indicator)

export function registerSyncHandlers(): void {
  // Let the user pick a file path for the sync event log.
  // Uses Electron's save dialog so the user can navigate to their Dropbox folder.
  ipcMain.handle('sync:pick-event-log-path', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showSaveDialog(win!, {
      title: 'Choose sync event log location',
      defaultPath: 'events.jsonl',
      filters: [{ name: 'JSON Lines', extensions: ['jsonl'] }],
      properties: ['createDirectory']
    })

    if (result.canceled || !result.filePath) return null
    return result.filePath
  })

  // Let the user pick a local folder for a root mapping.
  ipcMain.handle('sync:pick-mapping-folder', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win!, {
      title: 'Choose local folder to sync',
      properties: ['openDirectory']
    })

    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // Get all sync-related settings as a single object for the UI.
  ipcMain.handle('sync:get-config', () => {
    return {
      eventLogPath: getSetting('sync.eventLogPath', APP_DEFAULTS.sync.eventLogPath),
      rootMappings: getSetting('sync.rootMappings', APP_DEFAULTS.sync.rootMappings),
      deviceName: getSetting('sync.deviceName', APP_DEFAULTS.sync.deviceName),
      deviceId: getDeviceId(),
      configured: isSyncConfigured()
    }
  })

  // Update a single sync setting.
  ipcMain.handle('sync:set-config', (_event, key: string, value: string) => {
    // Only allow sync-related keys to prevent injection
    const allowedKeys = ['sync.eventLogPath', 'sync.rootMappings', 'sync.deviceName']
    if (!allowedKeys.includes(key)) {
      appLog('warn', 'sync', `Rejected sync config update for disallowed key: ${key}`)
      return
    }
    setPreference(key, value)
    appLog('info', 'sync', `Updated ${key}`)
  })

  // Get current sync status for the UI indicator.
  ipcMain.handle('sync:get-status', () => {
    return {
      configured: isSyncConfigured(),
      eventLogPath: getEventLogPath(),
      deviceName: getSetting('sync.deviceName', APP_DEFAULTS.sync.deviceName),
      lastSyncAt: null, // Will be populated once import is wired up
      pendingConflicts: 0
    }
  })
}
