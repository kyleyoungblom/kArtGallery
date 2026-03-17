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

export function setFolderHidden(folderId: number, hidden: boolean): void {
  getDb()
    .prepare('UPDATE folders SET hidden = ? WHERE id = ?')
    .run(hidden ? 1 : 0, folderId)
}

export function getAllFolders(): FolderRow[] {
  return getDb().prepare('SELECT * FROM folders ORDER BY path').all() as FolderRow[]
}

export function getFolderByPath(folderPath: string): FolderRow | undefined {
  return getDb()
    .prepare('SELECT * FROM folders WHERE path = ?')
    .get(folderPath) as FolderRow | undefined
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
