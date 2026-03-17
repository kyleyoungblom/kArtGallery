import { ipcMain } from 'electron'
import { setFileHidden } from '../db/repositories/files.repo'
import { setFolderHidden, getFolderByPath } from '../db/repositories/folders.repo'

export function registerHiddenHandlers(): void {
  ipcMain.handle(
    'gallery:set-hidden',
    (_event, id: number, type: 'file' | 'folder', hidden: boolean) => {
      if (type === 'file') {
        setFileHidden(id, hidden)
      } else {
        setFolderHidden(id, hidden)
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
      }
    }
  )
}
