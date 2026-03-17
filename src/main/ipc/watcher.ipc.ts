import { ipcMain } from 'electron'
import { unwatchFolder } from '../watcher/folder-watcher'

// IPC handler for stopping a file watcher. Called from the renderer when
// a pinned folder is removed — we need to clean up the chokidar instance
// so it's not leaking memory and file handles.

export function registerWatcherHandlers(): void {
  ipcMain.handle('watcher:stop', (_event, folderPath: string) => {
    unwatchFolder(folderPath)
  })
}
