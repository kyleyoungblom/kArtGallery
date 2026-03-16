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

export interface ScanProgress {
  scanned: number
  total: number
  currentFile: string
}

export interface ThumbnailProgress {
  generated: number
  total: number
}

export type SortField = 'filename' | 'modifiedAt' | 'createdAt' | 'sizeBytes'
export type SortDirection = 'asc' | 'desc'
export type GroupBy = 'none' | 'folder' | 'month' | 'year'
