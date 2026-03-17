import { ipcMain } from 'electron'
import {
  createStack,
  dissolveStack,
  addFilesToStack,
  removeFileFromStack,
  setStackCover,
  getStacksByFolder,
  getStackFiles,
  getStackUuid
} from '../db/repositories/stacks.repo'
import { getFileById } from '../db/repositories/files.repo'
import { getFolderById } from '../db/repositories/folders.repo'
import { emitEvent } from '../sync/event-emitter'
import { toRelativePath } from '../sync/path-mapper'

// Helper: resolve an array of file IDs to relative paths for sync events.
// Returns null if ANY file can't be resolved (all-or-nothing for consistency).
function resolveFilePaths(fileIds: number[]): string[] | null {
  const relPaths: string[] = []
  for (const id of fileIds) {
    const file = getFileById(id)
    if (!file) return null
    const rel = toRelativePath(file.path)
    if (!rel) return null
    relPaths.push(rel)
  }
  return relPaths
}

export function registerStackHandlers(): void {
  // Create a new stack from a set of file IDs.
  // Returns the new stack row (now includes uuid for sync).
  ipcMain.handle(
    'gallery:create-stack',
    (_event, folderId: number, fileIds: number[], name: string | null) => {
      const stack = createStack(folderId, fileIds, name)

      // Emit sync event with relative paths and the stack's UUID
      const folder = getFolderById(folderId)
      if (folder && stack.uuid) {
        const relFolderPath = toRelativePath(folder.path)
        const relFilePaths = resolveFilePaths(fileIds)
        if (relFolderPath && relFilePaths) {
          emitEvent({
            type: 'stack.create',
            stackUuid: stack.uuid,
            relFolderPath,
            relFilePaths,
            name
          })
        }
      }

      return stack
    }
  )

  // Dissolve a stack: ungroup all files and delete the stack record.
  ipcMain.handle(
    'gallery:dissolve-stack',
    (_event, stackId: number) => {
      // Capture UUID before dissolving (the stack row is deleted)
      const uuid = getStackUuid(stackId)

      dissolveStack(stackId)

      if (uuid) {
        emitEvent({ type: 'stack.dissolve', stackUuid: uuid })
      }
    }
  )

  // Add files to an existing stack (appended after current items).
  ipcMain.handle(
    'gallery:add-to-stack',
    (_event, stackId: number, fileIds: number[]) => {
      addFilesToStack(stackId, fileIds)

      const uuid = getStackUuid(stackId)
      if (uuid) {
        const relFilePaths = resolveFilePaths(fileIds)
        if (relFilePaths) {
          emitEvent({ type: 'stack.addFiles', stackUuid: uuid, relFilePaths })
        }
      }
    }
  )

  // Remove a single file from its stack. Auto-dissolves if stack becomes empty.
  ipcMain.handle(
    'gallery:remove-from-stack',
    (_event, fileId: number) => {
      // Capture stack UUID before removing (the file's stack_id is cleared)
      const file = getFileById(fileId)
      let stackUuid: string | null = null
      if (file?.stack_id) {
        stackUuid = getStackUuid(file.stack_id)
      }

      removeFileFromStack(fileId)

      if (stackUuid && file) {
        const relFilePath = toRelativePath(file.path)
        if (relFilePath) {
          emitEvent({ type: 'stack.removeFile', stackUuid, relFilePath })
        }
      }
    }
  )

  // Set the cover image for a stack.
  ipcMain.handle(
    'gallery:set-stack-cover',
    (_event, stackId: number, fileId: number) => {
      setStackCover(stackId, fileId)

      const uuid = getStackUuid(stackId)
      const file = getFileById(fileId)
      if (uuid && file) {
        const relFilePath = toRelativePath(file.path)
        if (relFilePath) {
          emitEvent({ type: 'stack.setCover', stackUuid: uuid, relFilePath })
        }
      }
    }
  )

  // Get all stacks in a folder (with file counts).
  ipcMain.handle(
    'gallery:get-stacks',
    (_event, folderId: number) => {
      return getStacksByFolder(folderId)
    }
  )

  // Get files in a specific stack, ordered by stack_order.
  ipcMain.handle(
    'gallery:get-stack-files',
    (_event, stackId: number) => {
      return getStackFiles(stackId)
    }
  )
}
