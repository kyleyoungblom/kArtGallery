// Shared type definitions for data that flows between main and renderer.
// These types represent the "contract" between the two processes.
// Both sides must agree on these shapes for IPC to work correctly.

export interface FileEntry {
  id: number
  path: string
  filename: string
  extension: string
  folderId: number
  sizeBytes: number
  modifiedAt: string
  createdAt: string
  width: number | null
  height: number | null
  hidden: boolean
  stackId: number | null
  stackOrder: number
  thumbnailPath: string | null
  thumbnailGenerated: boolean
  thumbnailError: string | null
}

export interface FolderEntry {
  id: number
  path: string
  hidden: boolean
  lastScanned: string | null
}

export interface FolderNode {
  name: string
  path: string
  hidden: boolean
  children: FolderNode[]
}

export interface StackEntry {
  id: number
  name: string | null
  coverFileId: number | null
  folderId: number
  createdAt: string
}

// Extended file entry used in the gallery grid. When a file is a stack cover,
// stackCount tells the tile to show a count badge. The underlying type is still
// a FileEntry so masonic and all existing tile logic work unchanged.
export interface GalleryItem extends FileEntry {
  stackCount?: number       // Number of files in the stack (only set on collapsed cover)
  isExpandedCover?: boolean // True for the cover file when viewing an expanded stack
}

export interface ScanProgress {
  scanned: number
  total: number
  currentFile: string
}

export interface ThumbnailProgress {
  generated: number
  total: number
  currentFile: string
}

export type SortField = 'filename' | 'modifiedAt' | 'createdAt' | 'sizeBytes' | 'folder'
export type SortDirection = 'asc' | 'desc'
export type GroupBy = 'none' | 'folder' | 'month' | 'year'

// Duplicate detection types — returned from the main process via IPC

export interface DuplicateFile {
  id: number
  path: string
  filename: string
  extension: string
  sizeBytes: number
  width: number | null
  height: number | null
  modifiedAt: string
  createdAt: string
  thumbnailPath: string | null
  hidden: number
  phash: string
}

export interface DuplicateGroup {
  groupId: number
  matchType: 'exact' | 'similar'
  hammingDistance: number
  matchReason: string
  files: DuplicateFile[]
  bestFileId: number
}
