import { contextBridge, ipcRenderer } from 'electron'

// The preload script is Electron's security boundary. It runs in a special
// context that has access to both Node.js APIs and the renderer's window object.
//
// contextBridge.exposeInMainWorld creates a safe, serialization-based bridge.
// The renderer can call window.api.scanFolder() but CANNOT access fs, path,
// child_process, or any other Node.js API directly. This prevents a compromised
// web page (e.g., XSS in a loaded HTML file) from accessing the filesystem.
//
// Every function here is explicitly allowlisted. If a new IPC channel is needed,
// it must be added here — there's no wildcard access.

export interface ElectronAPI {
  pickFolder: () => Promise<string | null>
  scanFolder: (folderPath: string) => Promise<void>
  getFolderTree: (rootPath: string) => Promise<unknown>
  getFiles: (folderPath: string, includeHidden?: boolean) => Promise<unknown[]>
  getThumbnail: (fileId: number) => Promise<string | null>
  setHidden: (id: number, type: 'file' | 'folder', hidden: boolean) => Promise<void>
  getPreferences: () => Promise<Record<string, string>>
  setPreference: (key: string, value: string) => Promise<void>

  // Event listeners (main -> renderer)
  onScanProgress: (callback: (progress: { scanned: number; total: number; currentFile: string }) => void) => () => void
  onThumbnailProgress: (callback: (progress: { generated: number; total: number }) => void) => () => void
  onFilesChanged: (callback: (changes: { added: string[]; removed: string[]; modified: string[] }) => void) => () => void
}

contextBridge.exposeInMainWorld('api', {
  pickFolder: () => ipcRenderer.invoke('dialog:pick-folder'),
  scanFolder: (folderPath: string) => ipcRenderer.invoke('gallery:scan-folder', folderPath),
  getFolderTree: (rootPath: string) => ipcRenderer.invoke('gallery:get-folder-tree', rootPath),
  getFiles: (folderPath: string, includeHidden?: boolean) =>
    ipcRenderer.invoke('gallery:get-files', folderPath, includeHidden),
  getThumbnail: (fileId: number) => ipcRenderer.invoke('gallery:get-thumbnail', fileId),
  setHidden: (id: number, type: 'file' | 'folder', hidden: boolean) =>
    ipcRenderer.invoke('gallery:set-hidden', id, type, hidden),
  getPreferences: () => ipcRenderer.invoke('preferences:get-all'),
  setPreference: (key: string, value: string) =>
    ipcRenderer.invoke('preferences:set', key, value),

  // Event listeners return an unsubscribe function. This pattern prevents
  // memory leaks — when a React component unmounts, it calls the returned
  // function to stop listening. Without this, old listeners accumulate.
  onScanProgress: (callback: (progress: { scanned: number; total: number; currentFile: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: { scanned: number; total: number; currentFile: string }) => callback(progress)
    ipcRenderer.on('scan:progress', handler)
    return () => ipcRenderer.removeListener('scan:progress', handler)
  },

  onThumbnailProgress: (callback: (progress: { generated: number; total: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: { generated: number; total: number }) => callback(progress)
    ipcRenderer.on('thumbnails:progress', handler)
    return () => ipcRenderer.removeListener('thumbnails:progress', handler)
  },

  onFilesChanged: (callback: (changes: { added: string[]; removed: string[]; modified: string[] }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, changes: { added: string[]; removed: string[]; modified: string[] }) => callback(changes)
    ipcRenderer.on('watcher:files-changed', handler)
    return () => ipcRenderer.removeListener('watcher:files-changed', handler)
  }
} satisfies ElectronAPI)
