import { contextBridge, ipcRenderer, webFrame } from 'electron'

// Disable Chromium's built-in pinch-to-zoom at the earliest possible moment.
// On macOS, trackpad pinch fires wheel events with ctrlKey: true. Chromium's
// internal zoom handler intercepts these BEFORE any DOM event listener —
// including capture-phase listeners. By calling setVisualZoomLevelLimits here
// (in the preload script), we lock zoom before any page content loads, ensuring
// the renderer-side useGalleryZoom hook actually receives the wheel events.
webFrame.setVisualZoomLevelLimits(1, 1)
webFrame.setZoomFactor(1)

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
  renderPreview: (fileId: number, maxDimension?: number) => Promise<string | null>
  setHidden: (id: number, type: 'file' | 'folder', hidden: boolean) => Promise<void>
  setFolderHiddenByPath: (folderPath: string, hidden: boolean) => Promise<void>
  getFolderCounts: () => Promise<Record<string, number>>
  getPreferences: () => Promise<Record<string, string>>
  setPreference: (key: string, value: string) => Promise<void>

  // Stacks
  createStack: (folderId: number, fileIds: number[], name?: string | null) => Promise<unknown>
  dissolveStack: (stackId: number) => Promise<void>
  addToStack: (stackId: number, fileIds: number[]) => Promise<void>
  removeFromStack: (fileId: number) => Promise<void>
  setStackCover: (stackId: number, fileId: number) => Promise<void>
  getStacks: (folderId: number) => Promise<unknown[]>
  getStackFiles: (stackId: number) => Promise<unknown[]>

  // Watcher
  stopWatching: (folderPath: string) => Promise<void>

  // Duplicates
  findDuplicates: (options?: { threshold?: number }) => Promise<unknown[]>
  getDuplicateCount: () => Promise<number>
  rehashAll: () => Promise<{ count: number }>
  getHashProgress: () => Promise<{ hashed: number; total: number }>

  // Maintenance
  resetThumbnails: () => Promise<{ resetCount: number; deletedFiles: number }>
  getFailedFiles: () => Promise<unknown[]>
  getStorageStats: () => Promise<{ dbSize: number; cacheSize: number }>
  openDataFolder: () => Promise<void>
  restartApp: () => Promise<void>

  // Shell
  showItemInFolder: (filePath: string) => void
  openFolder: (folderPath: string) => void

  // Event listeners (main -> renderer)
  onScanProgress: (callback: (progress: { scanned: number; total: number; currentFile: string }) => void) => () => void
  onThumbnailProgress: (callback: (progress: { generated: number; total: number; currentFile: string }) => void) => () => void
  onThumbnailsReady: (callback: (fileIds: number[]) => void) => () => void
  onFilesChanged: (callback: (changes: { added: string[]; removed: string[]; modified: string[] }) => void) => () => void
  onAppLog: (callback: (entry: { timestamp: string; level: string; source: string; message: string }) => void) => () => void
}

contextBridge.exposeInMainWorld('api', {
  pickFolder: () => ipcRenderer.invoke('dialog:pick-folder'),
  scanFolder: (folderPath: string) => ipcRenderer.invoke('gallery:scan-folder', folderPath),
  getFolderTree: (rootPath: string) => ipcRenderer.invoke('gallery:get-folder-tree', rootPath),
  getFiles: (folderPath: string, includeHidden?: boolean) =>
    ipcRenderer.invoke('gallery:get-files', folderPath, includeHidden),
  getThumbnail: (fileId: number) => ipcRenderer.invoke('gallery:get-thumbnail', fileId),
  renderPreview: (fileId: number, maxDimension = 2048) =>
    ipcRenderer.invoke('gallery:render-preview', fileId, maxDimension),
  setHidden: (id: number, type: 'file' | 'folder', hidden: boolean) =>
    ipcRenderer.invoke('gallery:set-hidden', id, type, hidden),
  setFolderHiddenByPath: (folderPath: string, hidden: boolean) =>
    ipcRenderer.invoke('gallery:set-folder-hidden-by-path', folderPath, hidden),
  getFolderCounts: () => ipcRenderer.invoke('gallery:get-folder-counts'),
  getPreferences: () => ipcRenderer.invoke('preferences:get-all'),
  setPreference: (key: string, value: string) =>
    ipcRenderer.invoke('preferences:set', key, value),

  // Stacks
  createStack: (folderId: number, fileIds: number[], name: string | null = null) =>
    ipcRenderer.invoke('gallery:create-stack', folderId, fileIds, name),
  dissolveStack: (stackId: number) =>
    ipcRenderer.invoke('gallery:dissolve-stack', stackId),
  addToStack: (stackId: number, fileIds: number[]) =>
    ipcRenderer.invoke('gallery:add-to-stack', stackId, fileIds),
  removeFromStack: (fileId: number) =>
    ipcRenderer.invoke('gallery:remove-from-stack', fileId),
  setStackCover: (stackId: number, fileId: number) =>
    ipcRenderer.invoke('gallery:set-stack-cover', stackId, fileId),
  getStacks: (folderId: number) =>
    ipcRenderer.invoke('gallery:get-stacks', folderId),
  getStackFiles: (stackId: number) =>
    ipcRenderer.invoke('gallery:get-stack-files', stackId),

  stopWatching: (folderPath: string) => ipcRenderer.invoke('watcher:stop', folderPath),

  // Duplicates
  findDuplicates: (options?: { threshold?: number }) =>
    ipcRenderer.invoke('duplicates:find-groups', options),
  getDuplicateCount: () => ipcRenderer.invoke('duplicates:get-count'),
  rehashAll: () => ipcRenderer.invoke('duplicates:rehash-all'),
  getHashProgress: () => ipcRenderer.invoke('duplicates:get-hash-progress'),

  resetThumbnails: () => ipcRenderer.invoke('maintenance:reset-thumbnails'),
  getFailedFiles: () => ipcRenderer.invoke('maintenance:get-failed-files'),
  getStorageStats: () => ipcRenderer.invoke('maintenance:get-storage-stats'),
  openDataFolder: () => ipcRenderer.invoke('maintenance:open-data-folder'),
  restartApp: () => ipcRenderer.invoke('maintenance:restart-app'),

  showItemInFolder: (filePath: string) => ipcRenderer.invoke('shell:show-item-in-folder', filePath),
  openFolder: (folderPath: string) => ipcRenderer.invoke('shell:open-folder', folderPath),

  // Event listeners return an unsubscribe function. This pattern prevents
  // memory leaks — when a React component unmounts, it calls the returned
  // function to stop listening. Without this, old listeners accumulate.
  onScanProgress: (callback: (progress: { scanned: number; total: number; currentFile: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: { scanned: number; total: number; currentFile: string }) => callback(progress)
    ipcRenderer.on('scan:progress', handler)
    return () => ipcRenderer.removeListener('scan:progress', handler)
  },

  onThumbnailProgress: (callback: (progress: { generated: number; total: number; currentFile: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: { generated: number; total: number; currentFile: string }) => callback(progress)
    ipcRenderer.on('thumbnails:progress', handler)
    return () => ipcRenderer.removeListener('thumbnails:progress', handler)
  },

  onThumbnailsReady: (callback: (fileIds: number[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, fileIds: number[]) => callback(fileIds)
    ipcRenderer.on('thumbnails:ready', handler)
    return () => ipcRenderer.removeListener('thumbnails:ready', handler)
  },

  onFilesChanged: (callback: (changes: { added: string[]; removed: string[]; modified: string[] }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, changes: { added: string[]; removed: string[]; modified: string[] }) => callback(changes)
    ipcRenderer.on('watcher:files-changed', handler)
    return () => ipcRenderer.removeListener('watcher:files-changed', handler)
  },

  onAppLog: (callback: (entry: { timestamp: string; level: string; source: string; message: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, entry: { timestamp: string; level: string; source: string; message: string }) => callback(entry)
    ipcRenderer.on('app:log', handler)
    return () => ipcRenderer.removeListener('app:log', handler)
  }
} satisfies ElectronAPI)
