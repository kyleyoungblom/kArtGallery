import fs from 'fs'
import { getDb } from '../db/connection'
import { getFileByPath, setFileHiddenWithTimestamp, getFileMetadataTimestamp, updateFileHash } from '../db/repositories/files.repo'
import { getFolderByPath, setFolderHiddenWithTimestamp, getFolderMetadataTimestamp } from '../db/repositories/folders.repo'
import { createStack, getStackByUuid, dissolveStack, addFilesToStack, removeFileFromStack, setStackCover } from '../db/repositories/stacks.repo'
import { setPreference } from '../db/repositories/preferences.repo'
import { getSetting } from '../config/settings'
import { APP_DEFAULTS } from '../config/defaults'
import { toAbsolutePath } from './path-mapper'
import { getDeviceId, isSyncConfigured, getEventLogPath } from './event-emitter'
import { mergeConflictFiles } from './conflict-files'
import { appLog } from '../utils/app-logger'
import type { SyncEvent, SyncConflict } from './event-types'

// Reads new events from the JSONL event log and applies them to the local DB.
//
// Uses a cursor (byte offset + last event ID) stored in preferences to avoid
// re-reading the entire file on every import. Events from the local device are
// skipped (they were already applied when the user made the change). Events
// already in the sync_applied_events table are also skipped (idempotency).
//
// Conflict resolution: "latest timestamp wins." If an event's timestamp is
// older than the local entity's metadata_updated_at, the event is skipped
// and a conflict is logged.

/** Recent conflicts from the last import, surfaced to the UI via IPC */
let lastConflicts: SyncConflict[] = []

export function getLastConflicts(): SyncConflict[] {
  return lastConflicts
}

/**
 * Import new events from the JSONL event log.
 * Returns the number of events applied.
 */
export function importNewEvents(): { applied: number; skipped: number; conflicts: SyncConflict[] } {
  if (!isSyncConfigured()) return { applied: 0, skipped: 0, conflicts: [] }

  const logPath = getEventLogPath()
  if (!fs.existsSync(logPath)) return { applied: 0, skipped: 0, conflicts: [] }

  // Step 1: Merge any Dropbox conflict files first
  mergeConflictFiles(logPath)

  // Step 2: Read new events using cursor
  const lastReadByte = Number(getSetting('sync.lastReadByte', APP_DEFAULTS.sync.lastReadByte))
  const localDeviceId = getDeviceId()

  let events: SyncEvent[]
  let newCursorByte: number

  try {
    const stat = fs.statSync(logPath)

    // If file is smaller than our cursor, it was truncated/rewritten — read from start
    const startByte = stat.size < lastReadByte ? 0 : lastReadByte

    const fd = fs.openSync(logPath, 'r')
    const buffer = Buffer.alloc(stat.size - startByte)
    fs.readSync(fd, buffer, 0, buffer.length, startByte)
    fs.closeSync(fd)

    const content = buffer.toString('utf-8')
    events = []
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        events.push(JSON.parse(trimmed) as SyncEvent)
      } catch {
        appLog('warn', 'sync', 'Skipped malformed event line during import')
      }
    }

    newCursorByte = stat.size
  } catch (err) {
    appLog('warn', 'sync', `Failed to read event log: ${err}`)
    return { applied: 0, skipped: 0, conflicts: [] }
  }

  if (events.length === 0) {
    setPreference('sync.lastReadByte', String(newCursorByte))
    return { applied: 0, skipped: 0, conflicts: [] }
  }

  // Step 3: Filter and apply events
  const db = getDb()
  const conflicts: SyncConflict[] = []
  let applied = 0
  let skipped = 0

  // Check if event was already applied (idempotency)
  const checkApplied = db.prepare('SELECT 1 FROM sync_applied_events WHERE event_id = ?')
  const markApplied = db.prepare('INSERT OR IGNORE INTO sync_applied_events (event_id) VALUES (?)')

  for (const event of events) {
    // Skip our own events (already applied locally when the user made the change)
    if (event.deviceId === localDeviceId) {
      // Still mark as applied so we don't re-check next time
      markApplied.run(event.id)
      skipped++
      continue
    }

    // Skip already-applied events (idempotency)
    if (checkApplied.get(event.id)) {
      skipped++
      continue
    }

    const conflict = applyEvent(event)
    if (conflict) {
      conflicts.push(conflict)
    } else {
      applied++
    }

    markApplied.run(event.id)
  }

  // Update cursor
  setPreference('sync.lastReadByte', String(newCursorByte))
  if (events.length > 0) {
    setPreference('sync.lastReadEventId', events[events.length - 1].id)
  }

  lastConflicts = conflicts

  if (applied > 0 || conflicts.length > 0) {
    appLog('info', 'sync', `Import complete: ${applied} applied, ${skipped} skipped, ${conflicts.length} conflicts`)
  }

  return { applied, skipped, conflicts }
}

/**
 * Apply a single event to the local database.
 * Returns a SyncConflict if the event was rejected due to a newer local state,
 * or null if applied successfully.
 */
function applyEvent(event: SyncEvent): SyncConflict | null {
  switch (event.type) {
    case 'file.hidden':
      return applyFileHidden(event)
    case 'folder.hidden':
      return applyFolderHidden(event)
    case 'stack.create':
      return applyStackCreate(event)
    case 'stack.dissolve':
      return applyStackDissolve(event)
    case 'stack.addFiles':
      return applyStackAddFiles(event)
    case 'stack.removeFile':
      return applyStackRemoveFile(event)
    case 'stack.setCover':
      return applyStackSetCover(event)
    case 'file.phash':
      return applyFilePhash(event)
    default:
      appLog('warn', 'sync', `Unknown event type: ${(event as SyncEvent).type}`)
      return null
  }
}

function applyFileHidden(event: SyncEvent & { type: 'file.hidden' }): SyncConflict | null {
  const absPath = toAbsolutePath(event.relPath)
  if (!absPath) {
    appLog('info', 'sync', `Skipped file.hidden — no local mapping for ${event.relPath}`)
    return null
  }

  const file = getFileByPath(absPath)
  if (!file) {
    appLog('info', 'sync', `Skipped file.hidden — file not in local DB: ${event.relPath}`)
    return null
  }

  // Conflict resolution: latest timestamp wins
  const localTs = getFileMetadataTimestamp(file.id)
  if (localTs && localTs >= event.ts) {
    const localState = file.hidden ? 'hidden' : 'visible'
    const remoteState = event.hidden ? 'hidden' : 'visible'
    if (localState !== remoteState) {
      const conflict: SyncConflict = {
        ts: new Date().toISOString(),
        description: `${event.relPath}: hidden state conflict — kept local '${localState}' (local: ${localTs}, remote: ${event.ts} from ${event.deviceName})`,
        resolution: 'kept_local'
      }
      appLog('info', 'sync', conflict.description)
      return conflict
    }
    return null // Same state, no conflict
  }

  setFileHiddenWithTimestamp(file.id, event.hidden, event.ts)
  appLog('info', 'sync', `Applied file.hidden: ${event.relPath} → ${event.hidden ? 'hidden' : 'visible'} (from ${event.deviceName})`)
  return null
}

function applyFolderHidden(event: SyncEvent & { type: 'folder.hidden' }): SyncConflict | null {
  const absPath = toAbsolutePath(event.relPath)
  if (!absPath) return null

  const folder = getFolderByPath(absPath)
  if (!folder) {
    appLog('info', 'sync', `Skipped folder.hidden — folder not in local DB: ${event.relPath}`)
    return null
  }

  const localTs = getFolderMetadataTimestamp(folder.id)
  if (localTs && localTs >= event.ts) {
    const localState = folder.hidden ? 'hidden' : 'visible'
    const remoteState = event.hidden ? 'hidden' : 'visible'
    if (localState !== remoteState) {
      const conflict: SyncConflict = {
        ts: new Date().toISOString(),
        description: `${event.relPath}: folder hidden state conflict — kept local '${localState}' (from ${event.deviceName})`,
        resolution: 'kept_local'
      }
      appLog('info', 'sync', conflict.description)
      return conflict
    }
    return null
  }

  setFolderHiddenWithTimestamp(folder.id, event.hidden, event.ts)
  return null
}

function applyStackCreate(event: SyncEvent & { type: 'stack.create' }): SyncConflict | null {
  // Check if stack already exists (duplicate event)
  const existing = getStackByUuid(event.stackUuid)
  if (existing) return null

  // Resolve folder path
  const absFolderPath = toAbsolutePath(event.relFolderPath)
  if (!absFolderPath) return null

  const folder = getFolderByPath(absFolderPath)
  if (!folder) {
    appLog('info', 'sync', `Skipped stack.create — folder not in local DB: ${event.relFolderPath}`)
    return null
  }

  // Resolve file paths
  const fileIds: number[] = []
  for (const relPath of event.relFilePaths) {
    const absPath = toAbsolutePath(relPath)
    if (!absPath) continue
    const file = getFileByPath(absPath)
    if (file) fileIds.push(file.id)
  }

  if (fileIds.length === 0) {
    appLog('info', 'sync', `Skipped stack.create — no matching local files for stack ${event.stackUuid}`)
    return null
  }

  createStack(folder.id, fileIds, event.name, event.stackUuid)
  appLog('info', 'sync', `Applied stack.create: ${fileIds.length} files (from ${event.deviceName})`)
  return null
}

function applyStackDissolve(event: SyncEvent & { type: 'stack.dissolve' }): SyncConflict | null {
  const stack = getStackByUuid(event.stackUuid)
  if (!stack) return null // Already dissolved or never existed locally

  dissolveStack(stack.id)
  appLog('info', 'sync', `Applied stack.dissolve: ${event.stackUuid} (from ${event.deviceName})`)
  return null
}

function applyStackAddFiles(event: SyncEvent & { type: 'stack.addFiles' }): SyncConflict | null {
  const stack = getStackByUuid(event.stackUuid)
  if (!stack) {
    appLog('info', 'sync', `Skipped stack.addFiles — stack not found: ${event.stackUuid}`)
    return null
  }

  const fileIds: number[] = []
  for (const relPath of event.relFilePaths) {
    const absPath = toAbsolutePath(relPath)
    if (!absPath) continue
    const file = getFileByPath(absPath)
    if (file) fileIds.push(file.id)
  }

  if (fileIds.length > 0) {
    addFilesToStack(stack.id, fileIds)
  }
  return null
}

function applyStackRemoveFile(event: SyncEvent & { type: 'stack.removeFile' }): SyncConflict | null {
  const absPath = toAbsolutePath(event.relFilePath)
  if (!absPath) return null

  const file = getFileByPath(absPath)
  if (!file) return null

  removeFileFromStack(file.id)
  return null
}

function applyStackSetCover(event: SyncEvent & { type: 'stack.setCover' }): SyncConflict | null {
  const stack = getStackByUuid(event.stackUuid)
  if (!stack) return null

  const absPath = toAbsolutePath(event.relFilePath)
  if (!absPath) return null

  const file = getFileByPath(absPath)
  if (!file) return null

  setStackCover(stack.id, file.id)
  return null
}

function applyFilePhash(event: SyncEvent & { type: 'file.phash' }): SyncConflict | null {
  const absPath = toAbsolutePath(event.relPath)
  if (!absPath) return null

  const file = getFileByPath(absPath)
  if (!file) return null

  // Only apply if local file doesn't already have a hash
  // (don't overwrite a locally-computed hash with a remote one)
  if (!file.phash) {
    updateFileHash(file.id, event.phash)
  }
  return null
}
