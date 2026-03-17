import fs from 'fs'
import path from 'path'
import { appLog } from '../utils/app-logger'
import type { SyncEvent } from './event-types'

// Detects and merges Dropbox conflict copies of the sync event log.
//
// When two machines write to events.jsonl simultaneously, Dropbox creates a
// conflict copy named something like:
//   "events (Kyle's MacBook Pro's conflicted copy 2026-03-17).jsonl"
//
// This module finds those files, extracts their events, merges them into the
// main event log, and deletes the conflict copies after successful merge.

/**
 * Find Dropbox conflict copies of the event log in the same directory.
 * Returns absolute paths to the conflict files (not the main file).
 */
export function findConflictFiles(eventLogPath: string): string[] {
  const dir = path.dirname(eventLogPath)
  const baseName = path.basename(eventLogPath, '.jsonl')

  try {
    const files = fs.readdirSync(dir)
    return files
      .filter((f) => {
        // Match: "events (... conflicted copy ...).jsonl" or similar Dropbox patterns
        // Also handles: "events (1).jsonl" style copies
        if (f === path.basename(eventLogPath)) return false // skip the main file
        if (!f.endsWith('.jsonl')) return false
        if (!f.startsWith(baseName)) return false
        return true
      })
      .map((f) => path.join(dir, f))
  } catch {
    return []
  }
}

/**
 * Parse all events from a JSONL file. Skips malformed lines gracefully.
 */
function parseEventsFromFile(filePath: string): SyncEvent[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const events: SyncEvent[] = []
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        events.push(JSON.parse(trimmed) as SyncEvent)
      } catch {
        appLog('warn', 'sync', `Skipped malformed line in ${path.basename(filePath)}`)
      }
    }
    return events
  } catch {
    return []
  }
}

/**
 * Merge events from Dropbox conflict files into the main event log.
 *
 * 1. Reads all events from conflict files
 * 2. Reads all event IDs from the main file (for deduplication)
 * 3. Appends only new events to the main file
 * 4. Deletes the conflict files after successful merge
 *
 * Returns the newly-merged events (events that were in conflict files
 * but not in the main file). These should be passed to the importer
 * for application to the local database.
 */
export function mergeConflictFiles(eventLogPath: string): SyncEvent[] {
  const conflictPaths = findConflictFiles(eventLogPath)
  if (conflictPaths.length === 0) return []

  appLog('info', 'sync', `Found ${conflictPaths.length} Dropbox conflict file(s) — merging`)

  // Collect all event IDs from the main file
  const mainEvents = parseEventsFromFile(eventLogPath)
  const mainEventIds = new Set(mainEvents.map((e) => e.id))

  // Collect new events from all conflict files
  const newEvents: SyncEvent[] = []
  for (const conflictPath of conflictPaths) {
    const events = parseEventsFromFile(conflictPath)
    for (const event of events) {
      if (!mainEventIds.has(event.id)) {
        newEvents.push(event)
        mainEventIds.add(event.id) // prevent cross-conflict-file duplicates
      }
    }
  }

  if (newEvents.length > 0) {
    // Sort by timestamp for consistent ordering
    newEvents.sort((a, b) => a.ts.localeCompare(b.ts))

    // Append to main file
    const lines = newEvents.map((e) => JSON.stringify(e)).join('\n') + '\n'
    fs.appendFileSync(eventLogPath, lines, 'utf-8')
    appLog('info', 'sync', `Merged ${newEvents.length} event(s) from conflict files`)
  }

  // Delete conflict files after successful merge
  for (const conflictPath of conflictPaths) {
    try {
      fs.unlinkSync(conflictPath)
      appLog('info', 'sync', `Deleted conflict file: ${path.basename(conflictPath)}`)
    } catch (err) {
      appLog('warn', 'sync', `Failed to delete conflict file: ${err}`)
    }
  }

  return newEvents
}
