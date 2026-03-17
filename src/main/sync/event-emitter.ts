import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import type { SyncEvent, SyncEventBase } from './event-types'
import { getSetting } from '../config/settings'
import { setPreference } from '../db/repositories/preferences.repo'
import { APP_DEFAULTS } from '../config/defaults'
import { appLog } from '../utils/app-logger'

// Appends sync events to the JSONL event log file.
//
// Called from IPC handlers (hidden.ipc.ts, stacks.ipc.ts) after a user-initiated
// metadata change is committed to the local DB. This is intentionally NOT called
// from the repository layer — doing so would cause the sync importer to re-emit
// events it just applied, creating an infinite echo loop.
//
// fs.appendFileSync is used because each event is a single small JSON line
// (well under the 4KB pipe buffer), making the write atomic at the OS level.
// This is safe even if Dropbox is syncing the file simultaneously.

/**
 * Get (or create) a persistent device ID for this app install.
 * Stored in the preferences table so it survives restarts.
 */
export function getDeviceId(): string {
  let deviceId = getSetting('sync.deviceId', APP_DEFAULTS.sync.deviceId)
  if (!deviceId) {
    deviceId = randomUUID()
    setPreference('sync.deviceId', deviceId)
  }
  return deviceId
}

/**
 * Get the human-readable device name for conflict messages.
 */
function getDeviceName(): string {
  return getSetting('sync.deviceName', APP_DEFAULTS.sync.deviceName) || 'Unknown device'
}

/**
 * Check if sync is configured (event log path is set).
 */
export function isSyncConfigured(): boolean {
  const logPath = getSetting('sync.eventLogPath', APP_DEFAULTS.sync.eventLogPath)
  return logPath.length > 0
}

/**
 * Get the configured event log path.
 */
export function getEventLogPath(): string {
  return getSetting('sync.eventLogPath', APP_DEFAULTS.sync.eventLogPath)
}

/**
 * Emit a sync event by appending it to the JSONL event log.
 *
 * Silently skips if:
 * - Sync is not configured (no event log path set)
 * - The event log directory doesn't exist (Dropbox not mounted, etc.)
 *
 * @param partial — The event-specific fields (type, relPath, etc.).
 *   The base fields (id, ts, deviceId, deviceName) are auto-populated.
 */
export function emitEvent(partial: Omit<SyncEvent, keyof SyncEventBase>): void {
  const logPath = getEventLogPath()
  if (!logPath) return

  try {
    // Ensure the parent directory exists (user may have just configured sync)
    const dir = path.dirname(logPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    const event: SyncEvent = {
      id: randomUUID(),
      ts: new Date().toISOString(),
      deviceId: getDeviceId(),
      deviceName: getDeviceName(),
      ...partial
    } as SyncEvent

    const line = JSON.stringify(event) + '\n'
    fs.appendFileSync(logPath, line, 'utf-8')

    appLog('info', 'sync', `Emitted ${event.type} event`)
  } catch (err) {
    // Non-fatal: sync failures shouldn't block the user's action.
    // The event is lost, but the local DB mutation already succeeded.
    appLog('warn', 'sync', `Failed to emit event: ${err}`)
  }
}
