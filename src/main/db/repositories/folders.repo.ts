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
