import { create } from 'zustand'
import type { FileEntry, FolderNode, StackEntry, SortField, SortDirection, GroupBy } from '../types/models'

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
  // Multi-root folder model
  pinnedFolders: string[] // Ordered list of root folder paths
  folderTrees: Record<string, FolderNode> // Keyed by root path

  // Current browsing state
  currentPath: string | null
  files: FileEntry[]
  isScanning: boolean
  scanProgress: { scanned: number; total: number } | null
  scanVersion: number // Incremented after each scan to trigger re-fetches
  thumbnailVersion: number // Incremented after thumbnail reset to force tile re-fetch

  // Display settings
  sortField: SortField
  sortDirection: SortDirection
  groupBy: GroupBy
  tileSize: number
  columnCount: number | null // null = auto
  gapSize: number
  cropToAspect: boolean
  showLabels: boolean

  // Filters (empty/null = no filter)
  filterExtensions: string[]
  filterMinSize: number | null
  filterMaxSize: number | null
  filterMinDimension: number | null // Min width or height in pixels
  showHidden: boolean // When true, include hidden files in the gallery (dimmed)

  // Selection & lightbox
  //
  // Multi-select model:
  // - selectedIndices: the full set of selected items (O(1) .has() checks in tile render)
  // - activeIndex: the most-recently-touched item (shown in info panel, used by lightbox)
  // - selectionAnchor: the start point for Shift+click range selection
  //
  // Why Set<number>?  Each tile calls selectedIndices.has(i) during render.
  // A Set gives O(1) lookup vs O(n) for an array.  We create a *new* Set on
  // every mutation so Zustand's shallow-equality check detects the change.
  selectedIndices: Set<number>
  activeIndex: number | null
  selectionAnchor: number | null
  lightboxOpen: boolean
  focusRegion: 'sidebar' | 'gallery'

  // Panel visibility
  sidebarCollapsed: boolean
  infoPanelOpen: boolean
  settingsOpen: boolean
  toolbarVisible: boolean
  statusbarVisible: boolean

  // Keyboard shortcut overrides (user customizations, keyed by action ID)
  keyboardShortcuts: Record<string, string>

  // Sidebar reveal request — set by "Reveal in Sidebar" context menu.
  // The sidebar watches this, expands ancestor nodes, navigates, and clears it.
  revealPath: string | null

  // Stacks
  stacks: StackEntry[]
  expandedStackId: number | null // When set, show this stack's files instead of the collapsed cover

  // Duplicate review
  duplicateReviewOpen: boolean

  // Actions
  addPinnedFolder: (path: string) => void
  removePinnedFolder: (path: string) => void
  setFolderTreeForRoot: (rootPath: string, tree: FolderNode) => void
  setCurrentPath: (path: string) => void
  setFiles: (files: FileEntry[]) => void
  setIsScanning: (scanning: boolean) => void
  setScanProgress: (progress: { scanned: number; total: number } | null) => void
  incrementScanVersion: () => void
  incrementThumbnailVersion: () => void
  setSortField: (field: SortField) => void
  setSortDirection: (direction: SortDirection) => void
  setGroupBy: (group: GroupBy) => void
  setTileSize: (size: number) => void
  setColumnCount: (count: number | null) => void
  setGapSize: (gap: number) => void
  setCropToAspect: (crop: boolean) => void
  setShowLabels: (show: boolean) => void
  setFilterExtensions: (exts: string[]) => void
  setFilterMinSize: (size: number | null) => void
  setFilterMaxSize: (size: number | null) => void
  setFilterMinDimension: (dim: number | null) => void
  setShowHidden: (show: boolean) => void
  toggleShowHidden: () => void
  clearFilters: () => void
  // Multi-select actions
  selectIndex: (index: number) => void       // Plain click: select one, clear rest
  toggleIndex: (index: number) => void       // Cmd+click: toggle one in/out of set
  rangeSelect: (index: number) => void       // Shift+click: select anchor→index range
  clearSelection: () => void                 // Escape / deselect all
  openLightbox: () => void
  closeLightbox: () => void
  setFocusRegion: (region: 'sidebar' | 'gallery') => void
  toggleSidebar: () => void
  toggleInfoPanel: () => void
  toggleToolbar: () => void
  toggleStatusbar: () => void
  openSettings: () => void
  closeSettings: () => void
  setKeyboardShortcut: (actionId: string, key: string) => void
  resetKeyboardShortcut: (actionId: string) => void
  setKeyboardShortcuts: (shortcuts: Record<string, string>) => void
  setRevealPath: (path: string | null) => void
  setStacks: (stacks: StackEntry[]) => void
  setExpandedStackId: (id: number | null) => void
  openDuplicateReview: () => void
  closeDuplicateReview: () => void
}

export const useGalleryStore = create<GalleryState>((set) => ({
  pinnedFolders: [],
  folderTrees: {},
  currentPath: null,
  files: [],
  isScanning: false,
  scanProgress: null,
  scanVersion: 0,
  thumbnailVersion: 0,

  sortField: 'filename',
  sortDirection: 'asc',
  groupBy: 'none',
  tileSize: 200,
  columnCount: null,
  gapSize: 4,
  cropToAspect: true,
  showLabels: true,

  filterExtensions: [],
  filterMinSize: null,
  filterMaxSize: null,
  filterMinDimension: null,
  showHidden: false,

  selectedIndices: new Set<number>(),
  activeIndex: null,
  selectionAnchor: null,
  lightboxOpen: false,
  focusRegion: 'gallery',
  sidebarCollapsed: false,
  infoPanelOpen: false,
  settingsOpen: false,
  toolbarVisible: true,
  statusbarVisible: true,
  keyboardShortcuts: {},
  revealPath: null,
  stacks: [],
  expandedStackId: null,
  duplicateReviewOpen: false,

  addPinnedFolder: (path) => set((state) => ({
    pinnedFolders: state.pinnedFolders.includes(path)
      ? state.pinnedFolders
      : [...state.pinnedFolders, path]
  })),
  removePinnedFolder: (path) => set((state) => {
    const { [path]: _, ...rest } = state.folderTrees
    return {
      pinnedFolders: state.pinnedFolders.filter((p) => p !== path),
      folderTrees: rest
    }
  }),
  setFolderTreeForRoot: (rootPath, tree) => set((state) => ({
    folderTrees: { ...state.folderTrees, [rootPath]: tree }
  })),
  setCurrentPath: (path) => set({ currentPath: path, files: [], selectedIndices: new Set(), activeIndex: null, selectionAnchor: null, lightboxOpen: false }),
  setFiles: (files) => set({ files, selectedIndices: new Set(), activeIndex: null, selectionAnchor: null, lightboxOpen: false }),
  setIsScanning: (scanning) => set({ isScanning: scanning }),
  setScanProgress: (progress) => set({ scanProgress: progress }),
  incrementScanVersion: () => set((state) => ({ scanVersion: state.scanVersion + 1 })),
  incrementThumbnailVersion: () => set((state) => ({ thumbnailVersion: state.thumbnailVersion + 1 })),
  setSortField: (field) => set({ sortField: field }),
  setSortDirection: (direction) => set({ sortDirection: direction }),
  setGroupBy: (group) => set({ groupBy: group }),
  setTileSize: (size) => set({ tileSize: Math.max(60, Math.min(500, size)) }),
  setColumnCount: (count) => set({ columnCount: count }),
  setGapSize: (gap) => set({ gapSize: gap }),
  setCropToAspect: (crop) => set({ cropToAspect: crop }),
  setShowLabels: (show) => set({ showLabels: show }),
  setFilterExtensions: (exts) => set({ filterExtensions: exts }),
  setFilterMinSize: (size) => set({ filterMinSize: size }),
  setFilterMaxSize: (size) => set({ filterMaxSize: size }),
  setFilterMinDimension: (dim) => set({ filterMinDimension: dim }),
  setShowHidden: (show) => set({ showHidden: show }),
  toggleShowHidden: () => set((state) => ({ showHidden: !state.showHidden })),
  clearFilters: () => set({ filterExtensions: [], filterMinSize: null, filterMaxSize: null, filterMinDimension: null }),
  // Plain click: clear set, select exactly one item, set it as anchor
  selectIndex: (index) => set((state) => {
    const clamped = Math.max(0, Math.min(index, state.files.length - 1))
    return {
      selectedIndices: new Set([clamped]),
      activeIndex: clamped,
      selectionAnchor: clamped
    }
  }),

  // Cmd+click: toggle one item in/out of the selection set
  toggleIndex: (index) => set((state) => {
    const clamped = Math.max(0, Math.min(index, state.files.length - 1))
    const next = new Set(state.selectedIndices)
    if (next.has(clamped)) {
      next.delete(clamped)
    } else {
      next.add(clamped)
    }
    return {
      selectedIndices: next,
      activeIndex: next.size > 0 ? clamped : null,
      selectionAnchor: clamped
    }
  }),

  // Shift+click: select contiguous range from anchor to target
  rangeSelect: (index) => set((state) => {
    const clamped = Math.max(0, Math.min(index, state.files.length - 1))
    const anchor = state.selectionAnchor ?? 0
    const lo = Math.min(anchor, clamped)
    const hi = Math.max(anchor, clamped)
    const next = new Set<number>()
    for (let i = lo; i <= hi; i++) next.add(i)
    return {
      selectedIndices: next,
      activeIndex: clamped
      // Keep selectionAnchor unchanged — anchor is the *start* of a range
    }
  }),

  // Escape / click background: clear everything
  clearSelection: () => set({
    selectedIndices: new Set<number>(),
    activeIndex: null,
    selectionAnchor: null
  }),

  openLightbox: () => set((state) => ({
    lightboxOpen: state.activeIndex !== null
  })),
  closeLightbox: () => set({ lightboxOpen: false }),
  setFocusRegion: (region) => set({ focusRegion: region }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  toggleInfoPanel: () => set((state) => ({ infoPanelOpen: !state.infoPanelOpen })),
  toggleToolbar: () => set((state) => ({ toolbarVisible: !state.toolbarVisible })),
  toggleStatusbar: () => set((state) => ({ statusbarVisible: !state.statusbarVisible })),
  openSettings: () => set((state) => (state.lightboxOpen ? {} : { settingsOpen: true })),
  closeSettings: () => set({ settingsOpen: false }),
  setKeyboardShortcut: (actionId, key) => set((state) => ({
    keyboardShortcuts: { ...state.keyboardShortcuts, [actionId]: key }
  })),
  resetKeyboardShortcut: (actionId) => set((state) => {
    const { [actionId]: _, ...rest } = state.keyboardShortcuts
    return { keyboardShortcuts: rest }
  }),
  setKeyboardShortcuts: (shortcuts) => set({ keyboardShortcuts: shortcuts }),
  setRevealPath: (path) => set({ revealPath: path }),
  setStacks: (stacks) => set({ stacks }),
  setExpandedStackId: (id) => set({ expandedStackId: id }),
  openDuplicateReview: () => set({ duplicateReviewOpen: true }),
  closeDuplicateReview: () => set({ duplicateReviewOpen: false })
}))
