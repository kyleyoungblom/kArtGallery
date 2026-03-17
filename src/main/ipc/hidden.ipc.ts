import { ipcMain } from 'electron'
import { setFileHidden, getFileById } from '../db/repositories/files.repo'
import { setFolderHidden, getFolderByPath, getFolderById } from '../db/repositories/folders.repo'
import { emitEvent } from '../sync/event-emitter'
import { toRelativePath } from '../sync/path-mapper'

export function registerHiddenHandlers(): void {
  ipcMain.handle(
    'gallery:set-hidden',
    (_event, id: number, type: 'file' | 'folder', hidden: boolean) => {
      if (type === 'file') {
        setFileHidden(id, hidden)

        // Emit sync event — resolve absolute path to relative for the event log.
        // If the file is outside all sync root mappings, toRelativePath returns
        // null and the event is silently skipped (not all files are syncable).
        const file = getFileById(id)
        if (file) {
          const relPath = toRelativePath(file.path)
          if (relPath) {
            emitEvent({ type: 'file.hidden', relPath, hidden })
          }
        }
      } else {
        setFolderHidden(id, hidden)

        // For folders, we need to look up the path from the DB.
        const folder = getFolderById(id)
        if (folder) {
          const relPath = toRelativePath(folder.path)
          if (relPath) {
            emitEvent({ type: 'folder.hidden', relPath, hidden })
          }
        }
      }
    }
  )

  // Convenience handler for the sidebar, which has the folder path but not
  // the DB id. Looks up the folder by path, then sets the hidden flag.
  ipcMain.handle(
    'gallery:set-folder-hidden-by-path',
    (_event, folderPath: string, hidden: boolean) => {
      const folder = getFolderByPath(folderPath)
      if (folder) {
        setFolderHidden(folder.id, hidden)

        const relPath = toRelativePath(folderPath)
        if (relPath) {
          emitEvent({ type: 'folder.hidden', relPath, hidden })
        }
      }
    }
  )
}
