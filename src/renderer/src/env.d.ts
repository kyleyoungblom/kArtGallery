/// <reference types="vite/client" />

// Declare the API that the preload script exposes on window.
// This gives us full TypeScript autocomplete and type checking
// when calling window.api.* from React components.

interface ElectronAPI {
  pickFolder: () => Promise<string | null>
  scanFolder: (folderPath: string) => Promise<{ fileCount: number; folderCount: number }>
  getFolderTree: (rootPath: string) => Promise<import('./types/models').FolderNode>
  getFiles: (folderPath: string, includeHidden?: boolean) => Promise<import('./types/models').FileEntry[]>
  getThumbnail: (fileId: number) => Promise<string | null>
  setHidden: (id: number, type: 'file' | 'folder', hidden: boolean) => Promise<void>
  getPreferences: () => Promise<Record<string, string>>
  setPreference: (key: string, value: string) => Promise<void>
  onScanProgress: (callback: (progress: import('./types/models').ScanProgress) => void) => () => void
  onThumbnailProgress: (callback: (progress: import('./types/models').ThumbnailProgress) => void) => () => void
  onFilesChanged: (callback: (changes: { added: string[]; removed: string[]; modified: string[] }) => void) => () => void
}

interface Window {
  api: ElectronAPI
}
