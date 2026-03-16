import { create } from 'zustand'
import type { FileEntry, FolderNode, SortField, SortDirection, GroupBy } from '../types/models'

// Zustand store: a single object that holds all gallery-related state.
//
// Why zustand over React Context or Redux?
// - Context causes re-renders of ALL consumers when ANY value changes.
//   With zustand, components only re-render when the specific slice they
//   subscribe to changes.
// - Redux requires boilerplate (actions, reducers, dispatch). Zustand is
//   just a function that returns an object.
// - Zustand stores are accessible outside React (in event handlers, etc.)
//   which is useful for IPC callbacks.

interface GalleryState {
  // Current browsing state
  rootPath: string | null
  currentPath: string | null
  folderTree: FolderNode | null
  files: FileEntry[]
  isScanning: boolean
  scanProgress: { scanned: number; total: number } | null

  // Display settings
  sortField: SortField
  sortDirection: SortDirection
  groupBy: GroupBy
  tileSize: number
  columnCount: number | null // null = auto
  gapSize: number
  cropToAspect: boolean

  // Actions
  setRootPath: (path: string) => void
  setCurrentPath: (path: string) => void
  setFolderTree: (tree: FolderNode) => void
  setFiles: (files: FileEntry[]) => void
  setIsScanning: (scanning: boolean) => void
  setScanProgress: (progress: { scanned: number; total: number } | null) => void
  setSortField: (field: SortField) => void
  setSortDirection: (direction: SortDirection) => void
  setGroupBy: (group: GroupBy) => void
  setTileSize: (size: number) => void
  setColumnCount: (count: number | null) => void
  setGapSize: (gap: number) => void
  setCropToAspect: (crop: boolean) => void
}

export const useGalleryStore = create<GalleryState>((set) => ({
  rootPath: null,
  currentPath: null,
  folderTree: null,
  files: [],
  isScanning: false,
  scanProgress: null,

  sortField: 'filename',
  sortDirection: 'asc',
  groupBy: 'none',
  tileSize: 200,
  columnCount: null,
  gapSize: 8,
  cropToAspect: true,

  setRootPath: (path) => set({ rootPath: path }),
  setCurrentPath: (path) => set({ currentPath: path }),
  setFolderTree: (tree) => set({ folderTree: tree }),
  setFiles: (files) => set({ files }),
  setIsScanning: (scanning) => set({ isScanning: scanning }),
  setScanProgress: (progress) => set({ scanProgress: progress }),
  setSortField: (field) => set({ sortField: field }),
  setSortDirection: (direction) => set({ sortDirection: direction }),
  setGroupBy: (group) => set({ groupBy: group }),
  setTileSize: (size) => set({ tileSize: size }),
  setColumnCount: (count) => set({ columnCount: count }),
  setGapSize: (gap) => set({ gapSize: gap }),
  setCropToAspect: (crop) => set({ cropToAspect: crop })
}))
