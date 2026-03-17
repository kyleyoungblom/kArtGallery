import fs from 'fs'
import { BrowserWindow } from 'electron'
import { importNewEvents } from './event-importer'
import { isSyncConfigured, getEventLogPath } from './event-emitter'
import { appLog } from '../utils/app-logger'

// Watches the sync event log file for changes (new events from other devices).
//
// Uses Node.js fs.watch() which is built-in and zero-dependency. When the file
// changes (because Dropbox downloaded new content from another machine), we
// debounce for 1 second (Dropbox may write in chunks) and then import new events.
//
// After import, we notify all renderer windows so the gallery can refresh if
// hidden states or stacks changed.

let watcher: fs.FSWatcher | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null

const DEBOUNCE_MS = 1000

/**
 * Start watching the sync event log for changes.
 * Call after DB is initialized and handlers are registered.
 */
export function startSyncWatcher(): void {
  if (!isSyncConfigured()) return

  const logPath = getEventLogPath()
  if (!logPath) return

  // Ensure the file exists before watching
  if (!fs.existsSync(logPath)) {
    // Create an empty file so fs.watch has something to watch
    try {
      fs.mkdirSync(require('path').dirname(logPath), { recursive: true })
      fs.writeFileSync(logPath, '', 'utf-8')
    } catch (err) {
      appLog('warn', 'sync', `Cannot create event log for watching: ${err}`)
      return
    }
  }

  try {
    watcher = fs.watch(logPath, (eventType) => {
      // We only care about content changes, not renames
      if (eventType !== 'change') return

      // Debounce: Dropbox may write the file in multiple chunks
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        handleFileChange()
      }, DEBOUNCE_MS)
    })

    appLog('info', 'sync', `Watching event log for changes: ${logPath}`)
  } catch (err) {
    appLog('warn', 'sync', `Failed to start sync watcher: ${err}`)
  }
}

/**
 * Stop watching the sync event log.
 * Call on app quit to clean up resources.
 */
export function stopSyncWatcher(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  if (watcher) {
    watcher.close()
    watcher = null
    appLog('info', 'sync', 'Stopped sync watcher')
  }
}

/**
 * Handle a detected change in the event log file.
 * Imports new events and notifies all renderer windows.
 */
function handleFileChange(): void {
  try {
    const result = importNewEvents()

    if (result.applied > 0 || result.conflicts.length > 0) {
      // Notify all renderer windows so they can refresh
      const windows = BrowserWindow.getAllWindows()
      for (const win of windows) {
        win.webContents.send('sync:events-imported', {
          count: result.applied,
          conflicts: result.conflicts.length
        })
      }
    }
  } catch (err) {
    appLog('warn', 'sync', `Error during live sync import: ${err}`)
  }
}

/**
 * Initialize sync: run initial import and start the file watcher.
 * Called once from main process startup after DB and handlers are ready.
 */
export function initSync(): void {
  if (!isSyncConfigured()) {
    appLog('info', 'sync', 'Sync not configured — skipping initialization')
    return
  }

  appLog('info', 'sync', 'Initializing sync...')

  // Import any events that arrived while the app was closed
  const result = importNewEvents()
  if (result.applied > 0) {
    appLog('info', 'sync', `Startup import: applied ${result.applied} event(s)`)
  }

  // Start watching for live changes
  startSyncWatcher()
}

/**
 * Shutdown sync: stop watching and clean up.
 * Called on app quit.
 */
export function shutdownSync(): void {
  stopSyncWatcher()
}
