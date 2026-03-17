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
  thumbnail_error: string | null
  phash: string | null
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
    .prepare('SELECT * FROM files WHERE folder_id = ? AND hidden = 0 AND NOT (thumbnail_generated = 1 AND thumbnail_path IS NULL)')
    .all(folderId) as FileRow[]
}

export function getAllFiles(includeHidden = false): FileRow[] {
  const db = getDb()
  if (includeHidden) {
    return db.prepare('SELECT * FROM files').all() as FileRow[]
  }
  return db.prepare('SELECT * FROM files WHERE hidden = 0 AND NOT (thumbnail_generated = 1 AND thumbnail_path IS NULL)').all() as FileRow[]
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
// The error string is persisted so users can diagnose failures.
export function markThumbnailFailed(fileId: number, error: string): void {
  getDb()
    .prepare('UPDATE files SET thumbnail_generated = 1, thumbnail_error = ? WHERE id = ?')
    .run(error, fileId)
}

export function getFailedFiles(): FileRow[] {
  return getDb()
    .prepare('SELECT * FROM files WHERE thumbnail_generated = 1 AND thumbnail_path IS NULL')
    .all() as FileRow[]
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

// Reset all thumbnail state so they can be regenerated from scratch.
// Clears thumbnail_path and sets thumbnail_generated = 0 for every file.
export function resetAllThumbnails(): number {
  const result = getDb()
    .prepare('UPDATE files SET thumbnail_path = NULL, thumbnail_generated = 0, thumbnail_error = NULL')
    .run()
  return result.changes
}

// Get the number of visible files in each folder. Returns a map of folder path
// to file count. Used by the sidebar to show counts next to each folder name.
export function getFileCountsByFolderPath(): Record<string, number> {
  const db = getDb()
  const rows = db.prepare(`
    SELECT fo.path, COUNT(fi.id) as count
    FROM files fi
    JOIN folders fo ON fi.folder_id = fo.id
    WHERE fi.hidden = 0
      AND NOT (fi.thumbnail_generated = 1 AND fi.thumbnail_path IS NULL)
    GROUP BY fi.folder_id
  `).all() as { path: string; count: number }[]

  const result: Record<string, number> = {}
  for (const row of rows) {
    result[row.path] = row.count
  }
  return result
}

// Batch-assign files to a stack with sequential ordering.
export function setFilesStack(fileIds: number[], stackId: number, startOrder = 0): void {
  const db = getDb()
  const stmt = db.prepare('UPDATE files SET stack_id = ?, stack_order = ? WHERE id = ?')
  const assign = db.transaction(() => {
    for (let i = 0; i < fileIds.length; i++) {
      stmt.run(stackId, startOrder + i, fileIds[i])
    }
  })
  assign()
}

// Clear stack assignment from all files in a given stack.
export function clearStackFromFiles(stackId: number): void {
  getDb()
    .prepare('UPDATE files SET stack_id = NULL, stack_order = 0 WHERE stack_id = ?')
    .run(stackId)
}

// Re-queue files that were previously marked as failed (thumbnail_generated = 1
// but thumbnail_path IS NULL). Used when adding support for new formats (e.g., PSD)
// so previously-skipped files get another chance.
export function resetFailedThumbnails(): number {
  const result = getDb()
    .prepare('UPDATE files SET thumbnail_generated = 0, thumbnail_error = NULL WHERE thumbnail_generated = 1 AND thumbnail_path IS NULL')
    .run()
  return result.changes
}

// Rename files by rewriting path prefixes when a parent folder is renamed.
// Preserves all metadata (hidden, stacks, thumbnails) since we update in-place.
export function updateFilePathPrefix(oldPrefix: string, newPrefix: string): number {
  const result = getDb()
    .prepare('UPDATE files SET path = REPLACE(path, ?, ?) WHERE path LIKE ? || \'/%\'')
    .run(oldPrefix, newPrefix, oldPrefix)
  return result.changes
}

// Look up a file by its disk path. Used by the watcher to get the file's
// thumbnail_path before deleting the DB row, so the thumbnail can be cleaned up.
export function getFileByPath(filePath: string): FileRow | undefined {
  return getDb()
    .prepare('SELECT * FROM files WHERE path = ?')
    .get(filePath) as FileRow | undefined
}

// Remove all files under a folder path prefix. Used when a folder is deleted
// and we need to cascade the removal to all its contents.
export function removeFilesByFolderPrefix(folderPath: string): number {
  const result = getDb()
    .prepare('DELETE FROM files WHERE path LIKE ? || \'/%\'')
    .run(folderPath)
  return result.changes
}

// ── Perceptual Hash Functions ──

// Save a computed dHash for a file. Called after thumbnail generation
// when the worker returns a hash alongside the thumbnail.
export function updateFileHash(fileId: number, phash: string): void {
  getDb()
    .prepare('UPDATE files SET phash = ? WHERE id = ?')
    .run(phash, fileId)
}

// Find files that have thumbnails but no perceptual hash yet.
// Used to identify files needing backfill after the phash column is added.
export function getFilesNeedingHashes(): FileRow[] {
  return getDb()
    .prepare('SELECT * FROM files WHERE phash IS NULL AND thumbnail_generated = 1 AND thumbnail_path IS NOT NULL')
    .all() as FileRow[]
}

// Re-queue files that need hash computation by resetting their thumbnail state.
// This causes startThumbnailGeneration() to pick them up again. The thumbnail
// JPEG gets overwritten identically — harmless. Returns the number of files re-queued.
export function resetFilesNeedingHashes(): number {
  const result = getDb()
    .prepare('UPDATE files SET thumbnail_generated = 0 WHERE phash IS NULL AND thumbnail_generated = 1 AND thumbnail_path IS NOT NULL')
    .run()
  return result.changes
}

// Clear all perceptual hashes so they can be recomputed from scratch.
// Used for the "Rehash All" maintenance action.
export function resetAllHashes(): number {
  const result = getDb()
    .prepare('UPDATE files SET phash = NULL')
    .run()
  return result.changes
}
