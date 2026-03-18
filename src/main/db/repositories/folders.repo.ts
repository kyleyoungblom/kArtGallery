import { getDb } from '../connection'

// Repository pattern: all SQL for a given table lives in one file.
// The rest of the app calls these functions instead of writing SQL directly.
// This means if we change the schema, we update SQL in one place — not
// scattered across IPC handlers, scanners, and UI logic.

export interface FolderRow {
  id: number
  path: string
  hidden: number
  last_scanned: string | null
  metadata_updated_at: string | null
}

export function upsertFolder(folderPath: string): FolderRow {
  const db = getDb()
  db.prepare(`
    INSERT INTO folders (path) VALUES (?)
    ON CONFLICT(path) DO UPDATE SET path = path
  `).run(folderPath)

  return db.prepare('SELECT * FROM folders WHERE path = ?').get(folderPath) as FolderRow
}

export function updateLastScanned(folderId: number): void {
  getDb()
    .prepare('UPDATE folders SET last_scanned = datetime(?) WHERE id = ?')
    .run(new Date().toISOString(), folderId)
}

// Set a folder's hidden state and record the timestamp for sync conflict resolution.
export function setFolderHidden(folderId: number, hidden: boolean): void {
  getDb()
    .prepare('UPDATE folders SET hidden = ?, metadata_updated_at = ? WHERE id = ?')
    .run(hidden ? 1 : 0, new Date().toISOString(), folderId)
}

// Set a folder's hidden state with a specific timestamp. Used by the sync importer.
export function setFolderHiddenWithTimestamp(folderId: number, hidden: boolean, timestamp: string): void {
  getDb()
    .prepare('UPDATE folders SET hidden = ?, metadata_updated_at = ? WHERE id = ?')
    .run(hidden ? 1 : 0, timestamp, folderId)
}

// Get a folder's metadata_updated_at timestamp for conflict resolution.
export function getFolderMetadataTimestamp(folderId: number): string | null {
  const row = getDb()
    .prepare('SELECT metadata_updated_at FROM folders WHERE id = ?')
    .get(folderId) as { metadata_updated_at: string | null } | undefined
  return row?.metadata_updated_at ?? null
}

export function getFolderById(folderId: number): FolderRow | undefined {
  return getDb()
    .prepare('SELECT * FROM folders WHERE id = ?')
    .get(folderId) as FolderRow | undefined
}

export function getAllFolders(): FolderRow[] {
  return getDb().prepare('SELECT * FROM folders ORDER BY path').all() as FolderRow[]
}

export function getFolderByPath(folderPath: string): FolderRow | undefined {
  return getDb()
    .prepare('SELECT * FROM folders WHERE path = ?')
    .get(folderPath) as FolderRow | undefined
}

/** Get a Set of all folder paths marked as hidden in the DB. */
export function getHiddenFolderPaths(): Set<string> {
  const rows = getDb()
    .prepare('SELECT path FROM folders WHERE hidden = 1')
    .all() as Array<{ path: string }>
  return new Set(rows.map((r) => r.path))
}

// Rename a folder and all its subfolders by rewriting path prefixes.
// Used by the file watcher when a folder is renamed in Finder.
// Preserves all metadata (hidden flags, scan timestamps) since we update in-place.
export function updateFolderPathPrefix(oldPrefix: string, newPrefix: string): number {
  const result = getDb()
    .prepare(`
      UPDATE folders SET path = REPLACE(path, ?, ?)
      WHERE path = ? OR path LIKE ? || '/%'
    `)
    .run(oldPrefix, newPrefix, oldPrefix, oldPrefix)
  return result.changes
}

// Remove a folder and all its subfolders from the DB.
// Used by the file watcher when a folder is deleted from disk.
export function removeFoldersByPathPrefix(folderPath: string): number {
  const result = getDb()
    .prepare('DELETE FROM folders WHERE path = ? OR path LIKE ? || \'/%\'')
    .run(folderPath, folderPath)
  return result.changes
}
