import fs from 'fs'
import path from 'path'
import { ipcMain, dialog, BrowserWindow } from 'electron'
import { getSetting } from '../config/settings'
import { setPreference } from '../db/repositories/preferences.repo'
import { APP_DEFAULTS } from '../config/defaults'
import { getDeviceId, isSyncConfigured, getEventLogPath } from '../sync/event-emitter'
import { restartSync } from '../sync/sync-watcher'
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
  //
  // When the event log path changes, we do two extra things:
  // 1. Create the file immediately (so the user can see it in their synced
  //    folder right away, instead of waiting for the first syncable action)
  // 2. Restart the sync watcher with the new path (so the user doesn't
  //    need to quit and relaunch the app)
  ipcMain.handle('sync:set-config', (_event, key: string, value: string) => {
    // Only allow sync-related keys to prevent injection
    const allowedKeys = ['sync.eventLogPath', 'sync.rootMappings', 'sync.deviceName']
    if (!allowedKeys.includes(key)) {
      appLog('warn', 'sync', `Rejected sync config update for disallowed key: ${key}`)
      return
    }
    setPreference(key, value)
    appLog('info', 'sync', `Updated ${key}`)

    // When event log path or root mappings change, reinitialize sync so
    // the watcher picks up the new config without an app restart.
    if (key === 'sync.eventLogPath' && value) {
      // Create the file immediately if it doesn't exist yet.
      // This gives the user instant visual confirmation in their Dropbox
      // folder that sync is configured, rather than waiting for the first
      // hide/stack action to create it.
      try {
        const dir = path.dirname(value)
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true })
        }
        if (!fs.existsSync(value)) {
          fs.writeFileSync(value, '', 'utf-8')
          appLog('info', 'sync', `Created empty event log: ${value}`)
        }
      } catch (err) {
        appLog('warn', 'sync', `Failed to create event log file: ${err}`)
      }

      restartSync()
    } else if (key === 'sync.rootMappings') {
      // Root mappings changed — restart so importer can resolve new paths
      restartSync()
    }
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
