import { ipcMain } from 'electron'
import { setFileHidden } from '../db/repositories/files.repo'
import { setFolderHidden } from '../db/repositories/folders.repo'

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
}
