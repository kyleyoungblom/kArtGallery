// Type definitions for the cross-device sync event log.
//
// Every metadata change (hide, stack, etc.) is recorded as a JSON line in
// events.jsonl. Each event is self-contained: it carries all the data needed
// to replay the change on another machine, using relative paths so the same
// event works regardless of where Dropbox is mounted.
//
// Events are append-only — we never modify or delete existing lines. This
// makes the file safe for Dropbox sync (no in-place edits = no corruption).

// ── Base envelope shared by all events ──

export interface SyncEventBase {
  /** UUIDv4 — globally unique, used as idempotency key to skip re-application */
  id: string
  /** ISO 8601 timestamp with millisecond precision (e.g., "2026-03-17T14:30:00.123Z") */
  ts: string
  /** Persistent random ID per app install — identifies which machine emitted the event */
  deviceId: string
  /** Human-readable device name (e.g., "Kyle's MacBook") for conflict messages */
  deviceName: string
  /** Event discriminator */
  type: string
}

// ── Hidden state events ──

export interface FileHiddenEvent extends SyncEventBase {
  type: 'file.hidden'
  /** Path relative to the sync root, using forward slashes (e.g., "Art/landscapes/sunset.jpg") */
  relPath: string
  hidden: boolean
}

export interface FolderHiddenEvent extends SyncEventBase {
  type: 'folder.hidden'
  relPath: string
  hidden: boolean
}

// ── Stack events ──
//
// Stacks are identified by UUID (not auto-increment ID) because integer IDs
// are local to each SQLite database and won't match across machines.

export interface StackCreateEvent extends SyncEventBase {
  type: 'stack.create'
  stackUuid: string
  /** Folder containing the stack, relative path */
  relFolderPath: string
  /** Files in the stack, ordered (first = cover). Relative paths. */
  relFilePaths: string[]
  name: string | null
}

export interface StackDissolveEvent extends SyncEventBase {
  type: 'stack.dissolve'
  stackUuid: string
}

export interface StackAddFilesEvent extends SyncEventBase {
  type: 'stack.addFiles'
  stackUuid: string
  relFilePaths: string[]
}

export interface StackRemoveFileEvent extends SyncEventBase {
  type: 'stack.removeFile'
  stackUuid: string
  relFilePath: string
}

export interface StackSetCoverEvent extends SyncEventBase {
  type: 'stack.setCover'
  stackUuid: string
  relFilePath: string
}

// ── Perceptual hash sync (optional, saves recomputation on second device) ──

export interface FilePhashEvent extends SyncEventBase {
  type: 'file.phash'
  relPath: string
  /** 256-bit dHash as 64-character hex string */
  phash: string
}

// ── Union type for all events ──

export type SyncEvent =
  | FileHiddenEvent
  | FolderHiddenEvent
  | StackCreateEvent
  | StackDissolveEvent
  | StackAddFilesEvent
  | StackRemoveFileEvent
  | StackSetCoverEvent
  | FilePhashEvent

// ── Conflict tracking ──

export interface SyncConflict {
  ts: string
  description: string
  resolution: 'kept_local' | 'applied_remote'
}
