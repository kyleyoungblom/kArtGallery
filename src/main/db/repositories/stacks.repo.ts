import { randomUUID } from 'crypto'
import { getDb } from '../connection'

// Repository for stack operations. Stacks group files visually in the gallery
// — a stack appears as a single tile with a count badge, expandable to show
// its contents. The DB schema has a `stacks` table and files have `stack_id`
// and `stack_order` columns.
//
// Stacks have a `uuid` column for cross-device sync. Auto-increment IDs are
// local to each SQLite database and won't match across machines. The UUID is
// generated at creation time and used in the sync event log to identify stacks.

export interface StackRow {
  id: number
  uuid: string | null
  name: string | null
  cover_file_id: number | null
  folder_id: number
  created_at: string
}

/**
 * Create a stack and assign files to it in a single transaction.
 * The first file becomes the cover unless overridden.
 *
 * @param uuid — If provided (e.g., from a sync event), uses that UUID.
 *   Otherwise generates a new one via crypto.randomUUID().
 *
 * **Merge behavior:** If any of the provided fileIds already belong to
 * existing stacks, those stacks are dissolved and ALL of their member files
 * are folded into the new stack. This means selecting 2 images where one is
 * a stack cover results in a single stack containing the original stack's
 * files plus the new selection — no orphaned stack remnants.
 */
export function createStack(
  folderId: number,
  fileIds: number[],
  name: string | null = null,
  uuid?: string
): StackRow {
  const db = getDb()

  const result = db.transaction(() => {
    // 1. Find any existing stacks that the selected files belong to.
    //    We need to dissolve them and absorb their files.
    const existingStackIds = new Set<number>()
    const checkStmt = db.prepare('SELECT stack_id FROM files WHERE id = ?')
    for (const fid of fileIds) {
      const row = checkStmt.get(fid) as { stack_id: number | null } | undefined
      if (row?.stack_id) {
        existingStackIds.add(row.stack_id)
      }
    }

    // 2. Collect all file IDs from those stacks (members not in our selection).
    //    Preserves ordering: selected files first, then absorbed stack members.
    const selectedSet = new Set(fileIds)
    const extraFileIds: number[] = []

    if (existingStackIds.size > 0) {
      const getFilesStmt = db.prepare(
        'SELECT id FROM files WHERE stack_id = ? ORDER BY stack_order'
      )
      for (const stackId of existingStackIds) {
        const members = getFilesStmt.all(stackId) as { id: number }[]
        for (const m of members) {
          if (!selectedSet.has(m.id)) {
            extraFileIds.push(m.id)
            selectedSet.add(m.id) // prevent duplicates across stacks
          }
        }
      }

      // Dissolve old stacks (clear file associations, delete stack rows)
      const clearFilesStmt = db.prepare(
        'UPDATE files SET stack_id = NULL, stack_order = 0 WHERE stack_id = ?'
      )
      const deleteStackStmt = db.prepare('DELETE FROM stacks WHERE id = ?')
      for (const stackId of existingStackIds) {
        clearFilesStmt.run(stackId)
        deleteStackStmt.run(stackId)
      }
    }

    // 3. Merged file list: user's selection first, then absorbed extras
    const allFileIds = [...fileIds, ...extraFileIds]

    const coverFileId = allFileIds.length > 0 ? allFileIds[0] : null
    const stackUuid = uuid ?? randomUUID()

    const info = db.prepare(`
      INSERT INTO stacks (name, cover_file_id, folder_id, uuid)
      VALUES (?, ?, ?, ?)
    `).run(name, coverFileId, folderId, stackUuid)

    const stackId = info.lastInsertRowid as number

    // Assign files with sequential stack_order
    const updateStmt = db.prepare(
      'UPDATE files SET stack_id = ?, stack_order = ? WHERE id = ?'
    )
    for (let i = 0; i < allFileIds.length; i++) {
      updateStmt.run(stackId, i, allFileIds[i])
    }

    return db.prepare('SELECT * FROM stacks WHERE id = ?').get(stackId) as StackRow
  })()

  return result
}

/**
 * Look up a stack by its UUID. Used during sync import to find the local
 * stack corresponding to a remote event.
 */
export function getStackByUuid(uuid: string): StackRow | undefined {
  return getDb()
    .prepare('SELECT * FROM stacks WHERE uuid = ?')
    .get(uuid) as StackRow | undefined
}

/**
 * Get the UUID for a stack by its local integer ID. Used when emitting sync
 * events — the IPC layer has the integer ID, but the event log needs the UUID.
 */
export function getStackUuid(stackId: number): string | null {
  const row = getDb()
    .prepare('SELECT uuid FROM stacks WHERE id = ?')
    .get(stackId) as { uuid: string | null } | undefined
  return row?.uuid ?? null
}

/**
 * Dissolve a stack: clear stack_id from all its files, then delete the stack.
 */
export function dissolveStack(stackId: number): void {
  const db = getDb()
  db.transaction(() => {
    db.prepare('UPDATE files SET stack_id = NULL, stack_order = 0 WHERE stack_id = ?').run(stackId)
    db.prepare('DELETE FROM stacks WHERE id = ?').run(stackId)
  })()
}

/**
 * Add files to an existing stack, appended after current max order.
 */
export function addFilesToStack(stackId: number, fileIds: number[]): void {
  const db = getDb()
  db.transaction(() => {
    // Find current max order in this stack
    const row = db.prepare(
      'SELECT COALESCE(MAX(stack_order), -1) as max_order FROM files WHERE stack_id = ?'
    ).get(stackId) as { max_order: number }

    let order = row.max_order + 1
    const stmt = db.prepare('UPDATE files SET stack_id = ?, stack_order = ? WHERE id = ?')
    for (const fileId of fileIds) {
      stmt.run(stackId, order++, fileId)
    }
  })()
}

/**
 * Remove a single file from its stack. If it was the cover, reassign cover
 * to the next file. If the stack becomes empty, dissolve it.
 */
export function removeFileFromStack(fileId: number): void {
  const db = getDb()
  db.transaction(() => {
    // Get the file's current stack
    const file = db.prepare('SELECT stack_id FROM files WHERE id = ?').get(fileId) as { stack_id: number | null } | undefined
    if (!file?.stack_id) return

    const stackId = file.stack_id

    // Clear from file
    db.prepare('UPDATE files SET stack_id = NULL, stack_order = 0 WHERE id = ?').run(fileId)

    // Check if stack still has files
    const remaining = db.prepare(
      'SELECT id FROM files WHERE stack_id = ? ORDER BY stack_order LIMIT 1'
    ).get(stackId) as { id: number } | undefined

    if (!remaining) {
      // Stack is empty — delete it
      db.prepare('DELETE FROM stacks WHERE id = ?').run(stackId)
    } else {
      // If the removed file was the cover, reassign to first remaining file
      const stack = db.prepare('SELECT cover_file_id FROM stacks WHERE id = ?').get(stackId) as { cover_file_id: number | null }
      if (stack.cover_file_id === fileId) {
        db.prepare('UPDATE stacks SET cover_file_id = ? WHERE id = ?').run(remaining.id, stackId)
      }
    }
  })()
}

/**
 * Set the cover file for a stack. Also swaps stack_order so the new cover
 * gets the lowest order (the client uses lowest stack_order to identify
 * the cover when collapsing stacks).
 */
export function setStackCover(stackId: number, fileId: number): void {
  const db = getDb()
  db.transaction(() => {
    // Find current lowest-order file (the current cover)
    const currentCover = db.prepare(
      'SELECT id, stack_order FROM files WHERE stack_id = ? ORDER BY stack_order LIMIT 1'
    ).get(stackId) as { id: number; stack_order: number } | undefined

    // Find the new cover's current order
    const newCover = db.prepare(
      'SELECT stack_order FROM files WHERE id = ? AND stack_id = ?'
    ).get(fileId, stackId) as { stack_order: number } | undefined

    // Swap their stack_order values so the new cover has the lowest order
    if (currentCover && newCover && currentCover.id !== fileId) {
      db.prepare('UPDATE files SET stack_order = ? WHERE id = ?').run(newCover.stack_order, currentCover.id)
      db.prepare('UPDATE files SET stack_order = ? WHERE id = ?').run(currentCover.stack_order, fileId)
    }

    // Update the stacks table
    db.prepare('UPDATE stacks SET cover_file_id = ? WHERE id = ?').run(fileId, stackId)
  })()
}

/**
 * Get all stacks for a folder, including file count.
 */
export function getStacksByFolder(folderId: number): (StackRow & { file_count: number })[] {
  return getDb().prepare(`
    SELECT s.*, COUNT(f.id) as file_count
    FROM stacks s
    LEFT JOIN files f ON f.stack_id = s.id
    WHERE s.folder_id = ?
    GROUP BY s.id
  `).all(folderId) as (StackRow & { file_count: number })[]
}

/**
 * Get files in a stack, ordered by stack_order.
 */
export function getStackFiles(stackId: number): { id: number; stack_order: number }[] {
  return getDb().prepare(
    'SELECT id, stack_order FROM files WHERE stack_id = ? ORDER BY stack_order'
  ).all(stackId) as { id: number; stack_order: number }[]
}
