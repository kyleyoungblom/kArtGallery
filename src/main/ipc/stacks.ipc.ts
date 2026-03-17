import { ipcMain } from 'electron'
import {
  createStack,
  dissolveStack,
  addFilesToStack,
  removeFileFromStack,
  setStackCover,
  getStacksByFolder,
  getStackFiles
} from '../db/repositories/stacks.repo'

export function registerStackHandlers(): void {
  // Create a new stack from a set of file IDs.
  // Returns the new stack row.
  ipcMain.handle(
    'gallery:create-stack',
    (_event, folderId: number, fileIds: number[], name: string | null) => {
      return createStack(folderId, fileIds, name)
    }
  )

  // Dissolve a stack: ungroup all files and delete the stack record.
  ipcMain.handle(
    'gallery:dissolve-stack',
    (_event, stackId: number) => {
      dissolveStack(stackId)
    }
  )

  // Add files to an existing stack (appended after current items).
  ipcMain.handle(
    'gallery:add-to-stack',
    (_event, stackId: number, fileIds: number[]) => {
      addFilesToStack(stackId, fileIds)
    }
  )

  // Remove a single file from its stack. Auto-dissolves if stack becomes empty.
  ipcMain.handle(
    'gallery:remove-from-stack',
    (_event, fileId: number) => {
      removeFileFromStack(fileId)
    }
  )

  // Set the cover image for a stack.
  ipcMain.handle(
    'gallery:set-stack-cover',
    (_event, stackId: number, fileId: number) => {
      setStackCover(stackId, fileId)
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
