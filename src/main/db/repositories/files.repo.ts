import { getDb } from '../connection'

export interface FileRow {
  id: number
  path: string
  filename: string
  extension: string
  folder_id: number
  size_bytes: number
  modified_at: string
  created_at: string
  width: number | null
  height: number | null
  hidden: number
  stack_id: number | null
  stack_order: number
  thumbnail_path: string | null
  thumbnail_generated: number
  indexed_at: string
}

export interface UpsertFileData {
  path: string
  filename: string
  extension: string
  folderId: number
  sizeBytes: number
  modifiedAt: string
  createdAt: string
}

export function upsertFile(data: UpsertFileData): FileRow {
  const db = getDb()

  // UPSERT: insert the file if it's new, or update its metadata if it already
  // exists (e.g., file was modified since last scan). We match on path since
  // that's the unique identifier for a file on disk.
  db.prepare(`
    INSERT INTO files (path, filename, extension, folder_id, size_bytes, modified_at, created_at)
    VALUES (@path, @filename, @extension, @folderId, @sizeBytes, @modifiedAt, @createdAt)
    ON CONFLICT(path) DO UPDATE SET
      filename = @filename,
      size_bytes = @sizeBytes,
      modified_at = @modifiedAt
  `).run(data)

  return db.prepare('SELECT * FROM files WHERE path = ?').get(data.path) as FileRow
}

// Batch insert for performance during initial scan. Inserting thousands of
// files one-by-one would be slow because each INSERT is a separate transaction.
// Wrapping them in a single transaction is dramatically faster (100x+).
export function upsertFiles(files: UpsertFileData[]): void {
  const db = getDb()
  const stmt = db.prepare(`
    INSERT INTO files (path, filename, extension, folder_id, size_bytes, modified_at, created_at)
    VALUES (@path, @filename, @extension, @folderId, @sizeBytes, @modifiedAt, @createdAt)
    ON CONFLICT(path) DO UPDATE SET
      filename = @filename,
      size_bytes = @sizeBytes,
      modified_at = @modifiedAt
  `)

  const insertMany = db.transaction((files: UpsertFileData[]) => {
    for (const file of files) {
      stmt.run(file)
    }
  })

  insertMany(files)
}

export function getFilesByFolder(folderId: number, includeHidden = false): FileRow[] {
  const db = getDb()
  if (includeHidden) {
    return db
      .prepare('SELECT * FROM files WHERE folder_id = ?')
      .all(folderId) as FileRow[]
  }
  return db
    .prepare('SELECT * FROM files WHERE folder_id = ? AND hidden = 0')
    .all(folderId) as FileRow[]
}

export function getAllFiles(includeHidden = false): FileRow[] {
  const db = getDb()
  if (includeHidden) {
    return db.prepare('SELECT * FROM files').all() as FileRow[]
  }
  return db.prepare('SELECT * FROM files WHERE hidden = 0').all() as FileRow[]
}

export function getFilesNeedingThumbnails(): FileRow[] {
  return getDb()
    .prepare('SELECT * FROM files WHERE thumbnail_generated = 0')
    .all() as FileRow[]
}

export function updateThumbnail(fileId: number, thumbnailPath: string, width: number, height: number): void {
  getDb()
    .prepare(
      'UPDATE files SET thumbnail_path = ?, thumbnail_generated = 1, width = ?, height = ? WHERE id = ?'
    )
    .run(thumbnailPath, width, height, fileId)
}

// Mark a file's thumbnail as "generated" even though it failed.
// This prevents the file from being re-queued on every scan.
// We set thumbnail_generated = 1 but leave thumbnail_path NULL,
// so the fallback (original file) is used permanently for this file.
export function markThumbnailFailed(fileId: number): void {
  getDb()
    .prepare('UPDATE files SET thumbnail_generated = 1 WHERE id = ?')
    .run(fileId)
}

export function setFileHidden(fileId: number, hidden: boolean): void {
  getDb()
    .prepare('UPDATE files SET hidden = ? WHERE id = ?')
    .run(hidden ? 1 : 0, fileId)
}

export function removeFileByPath(filePath: string): void {
  getDb().prepare('DELETE FROM files WHERE path = ?').run(filePath)
}

export function getFileById(fileId: number): FileRow | undefined {
  return getDb()
    .prepare('SELECT * FROM files WHERE id = ?')
    .get(fileId) as FileRow | undefined
}
