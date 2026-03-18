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

// ── Tab = Folder Root ──
//
// Each tab represents one root folder. The sidebar shows the active tab's
// folder tree. Tabs replace the old "pinned folders" concept entirely.
//
// The top-level fields (currentPath, selectedIndices, etc.) remain the "live"
// state that all components read. Switching tabs saves the current tab's
// per-tab state and restores the target tab's state into those same top-level
// fields. This means GalleryGrid, Lightbox, InfoPanel, etc. need zero changes.

export interface TabState {
  id: string
  rootPath: string              // The folder chosen when tab was created (constant)
  currentPath: string | null    // Where you're browsing within rootPath
  displayName?: string          // User-set alias (e.g., "Elixir" instead of "Attachments")
  selectedIndices: Set<number>
  activeIndex: number | null
  selectionAnchor: number | null
  lightboxOpen: boolean
  scrollTop: number
  expandedStackId: number | null
  sidebarExpandedPaths: Set<string>
}

function createTabState(rootPath: string, currentPath?: string | null): TabState {
  return {
    id: crypto.randomUUID(),
    rootPath,
    currentPath: currentPath ?? rootPath,
    selectedIndices: new Set<number>(),
    activeIndex: null,
    selectionAnchor: null,
    lightboxOpen: false,
    scrollTop: 0,
    expandedStackId: null,
    sidebarExpandedPaths: new Set<string>()
  }
}

// Placeholder initial tab — will be replaced by restored tabs on startup
const initialTab = createTabState('')

interface GalleryState {
  // Folder tree cache — keyed by root path, shared across tabs.
  // When a folder is scanned, its tree is stored here. Multiple tabs
  // pointing to the same root reuse the same cached tree.
  folderTrees: Record<string, FolderNode>

  // Tabs — each tab IS a folder root
  tabs: TabState[]
  activeTabId: string
  pendingScrollRestore: number | null

  // Current browsing state (the "live" state — written to by tab switching)
  sidebarExpandedPaths: Set<string>
  currentPath: string | null
  files: FileEntry[]
  isScanning: boolean
  scanProgress: { scanned: number; total: number } | null
  scanVersion: number // Incremented after each scan to trigger re-fetches
  thumbnailVersion: number // Incremented after thumbnail reset to force tile re-fetch

  // Display settings (global — shared across all tabs)
  sortField: SortField
  sortDirection: SortDirection
  groupBy: GroupBy
  tileSize: number
  columnCount: number | null // null = auto
  gapSize: number
  cropToAspect: boolean
  showLabels: boolean
  lightboxFitToScreen: boolean
  accentColor: string
  sidebarMaxDepth: number // 0 = unlimited

  // Filters (empty/null = no filter)
  filterExtensions: string[]
  filterMinSize: number | null
  filterMaxSize: number | null
  filterMinDimension: number | null
  showHidden: boolean

  // Selection & lightbox
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

  // Keyboard shortcut overrides
  keyboardShortcuts: Record<string, string>

  // Sidebar reveal request
  revealPath: string | null

  // Stacks
  stacks: StackEntry[]
  expandedStackId: number | null

  // Duplicate review
  duplicateReviewOpen: boolean

  // Tab actions
  createTab: (rootPath: string, currentPath?: string | null) => void
  closeTab: (tabId: string) => void
  switchTab: (tabId: string) => void
  reorderTabs: (fromIndex: number, toIndex: number) => void
  setTabDisplayName: (tabId: string, name: string | null) => void
  updateActiveTabScroll: (scrollTop: number) => void
  clearPendingScrollRestore: () => void
  setSidebarExpandedPaths: (paths: Set<string>) => void
  setTabs: (tabs: TabState[], activeTabId: string) => void

  // Actions
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
  setLightboxFitToScreen: (fit: boolean) => void
  setAccentColor: (color: string) => void
  setSidebarMaxDepth: (depth: number) => void
  setFilterExtensions: (exts: string[]) => void
  setFilterMinSize: (size: number | null) => void
  setFilterMaxSize: (size: number | null) => void
  setFilterMinDimension: (dim: number | null) => void
  setShowHidden: (show: boolean) => void
  toggleShowHidden: () => void
  clearFilters: () => void
  selectIndex: (index: number) => void
  toggleIndex: (index: number) => void
  rangeSelect: (index: number) => void
  clearSelection: () => void
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

// Helper: snapshot the per-tab fields from top-level state into a tab entry
function saveTabState(state: GalleryState, tabId: string): TabState[] {
  return state.tabs.map((t) =>
    t.id === tabId
      ? {
          ...t,
          currentPath: state.currentPath,
          selectedIndices: state.selectedIndices,
          activeIndex: state.activeIndex,
          selectionAnchor: state.selectionAnchor,
          lightboxOpen: state.lightboxOpen,
          expandedStackId: state.expandedStackId,
          sidebarExpandedPaths: state.sidebarExpandedPaths
        }
      : t
  )
}

// Helper: restore per-tab fields from a tab entry to top-level state
function restoreTabState(tab: TabState): Partial<GalleryState> {
  return {
    currentPath: tab.currentPath,
    selectedIndices: tab.selectedIndices,
    activeIndex: tab.activeIndex,
    selectionAnchor: tab.selectionAnchor,
    lightboxOpen: tab.lightboxOpen,
    expandedStackId: tab.expandedStackId,
    sidebarExpandedPaths: tab.sidebarExpandedPaths,
    pendingScrollRestore: tab.scrollTop > 0 ? tab.scrollTop : null
  }
}

export const useGalleryStore = create<GalleryState>((set) => ({
  tabs: [initialTab],
  activeTabId: initialTab.id,
  pendingScrollRestore: null,

  folderTrees: {},
  sidebarExpandedPaths: new Set<string>(),
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
  lightboxFitToScreen: true,
  accentColor: '#7b9ad4',
  sidebarMaxDepth: 0,

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

  // ── Tab actions ──

  createTab: (rootPath, currentPath) => set((state) => {
    const savedTabs = saveTabState(state, state.activeTabId)
    const newTab = createTabState(rootPath, currentPath)
    return {
      tabs: [...savedTabs, newTab],
      activeTabId: newTab.id,
      currentPath: newTab.currentPath,
      files: [],
      selectedIndices: new Set<number>(),
      activeIndex: null,
      selectionAnchor: null,
      lightboxOpen: false,
      expandedStackId: null,
      sidebarExpandedPaths: new Set<string>(),
      pendingScrollRestore: null
    }
  }),

  closeTab: (tabId) => set((state) => {
    if (state.tabs.length <= 1) return {}
    const idx = state.tabs.findIndex((t) => t.id === tabId)
    if (idx === -1) return {}

    const newTabs = state.tabs.filter((t) => t.id !== tabId)

    if (tabId === state.activeTabId) {
      const newActive = newTabs[Math.min(idx, newTabs.length - 1)]
      return {
        tabs: newTabs,
        activeTabId: newActive.id,
        files: [],
        scanVersion: state.scanVersion + 1,
        ...restoreTabState(newActive)
      }
    }
    return { tabs: newTabs }
  }),

  switchTab: (tabId) => set((state) => {
    if (tabId === state.activeTabId) return {}
    const target = state.tabs.find((t) => t.id === tabId)
    if (!target) return {}

    const savedTabs = saveTabState(state, state.activeTabId)
    return {
      tabs: savedTabs,
      activeTabId: tabId,
      files: [],
      scanVersion: state.scanVersion + 1,
      ...restoreTabState(target)
    }
  }),

  reorderTabs: (fromIndex, toIndex) => set((state) => {
    if (fromIndex === toIndex) return {}
    const newTabs = [...state.tabs]
    const [moved] = newTabs.splice(fromIndex, 1)
    newTabs.splice(toIndex, 0, moved)
    return { tabs: newTabs }
  }),

  setTabDisplayName: (tabId, name) => set((state) => ({
    tabs: state.tabs.map((t) => t.id === tabId ? { ...t, displayName: name ?? undefined } : t)
  })),

  updateActiveTabScroll: (scrollTop) => set((state) => ({
    tabs: state.tabs.map((t) => t.id === state.activeTabId ? { ...t, scrollTop } : t)
  })),

  clearPendingScrollRestore: () => set({ pendingScrollRestore: null }),

  setSidebarExpandedPaths: (paths) => set((state) => ({
    sidebarExpandedPaths: paths,
    tabs: state.tabs.map((t) => t.id === state.activeTabId ? { ...t, sidebarExpandedPaths: paths } : t)
  })),

  // Bulk-set tabs (used by startup restore)
  setTabs: (tabs, activeTabId) => set((state) => {
    const active = tabs.find((t) => t.id === activeTabId) ?? tabs[0]
    return {
      tabs,
      activeTabId: active.id,
      ...restoreTabState(active),
      files: [],
      scanVersion: state.scanVersion + 1
    }
  }),

  setFolderTreeForRoot: (rootPath, tree) => set((state) => ({
    folderTrees: { ...state.folderTrees, [rootPath]: tree }
  })),
  setCurrentPath: (path) => set((state) => ({
    currentPath: path,
    files: [],
    selectedIndices: new Set(),
    activeIndex: null,
    selectionAnchor: null,
    lightboxOpen: false,
    expandedStackId: null,
    tabs: state.tabs.map((t) => t.id === state.activeTabId ? { ...t, currentPath: path } : t)
  })),
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
  setLightboxFitToScreen: (fit) => set({ lightboxFitToScreen: fit }),
  setAccentColor: (color) => set({ accentColor: color }),
  setSidebarMaxDepth: (depth) => set({ sidebarMaxDepth: depth }),
  setFilterExtensions: (exts) => set({ filterExtensions: exts }),
  setFilterMinSize: (size) => set({ filterMinSize: size }),
  setFilterMaxSize: (size) => set({ filterMaxSize: size }),
  setFilterMinDimension: (dim) => set({ filterMinDimension: dim }),
  setShowHidden: (show) => set({ showHidden: show }),
  toggleShowHidden: () => set((state) => ({ showHidden: !state.showHidden })),
  clearFilters: () => set({ filterExtensions: [], filterMinSize: null, filterMaxSize: null, filterMinDimension: null }),
  selectIndex: (index) => set((state) => {
    const clamped = Math.max(0, Math.min(index, state.files.length - 1))
    return { selectedIndices: new Set([clamped]), activeIndex: clamped, selectionAnchor: clamped }
  }),
  toggleIndex: (index) => set((state) => {
    const clamped = Math.max(0, Math.min(index, state.files.length - 1))
    const next = new Set(state.selectedIndices)
    if (next.has(clamped)) { next.delete(clamped) } else { next.add(clamped) }
    return { selectedIndices: next, activeIndex: next.size > 0 ? clamped : null, selectionAnchor: clamped }
  }),
  rangeSelect: (index) => set((state) => {
    const clamped = Math.max(0, Math.min(index, state.files.length - 1))
    const anchor = state.selectionAnchor ?? 0
    const lo = Math.min(anchor, clamped)
    const hi = Math.max(anchor, clamped)
    const next = new Set<number>()
    for (let i = lo; i <= hi; i++) next.add(i)
    return { selectedIndices: next, activeIndex: clamped }
  }),
  clearSelection: () => set({ selectedIndices: new Set<number>(), activeIndex: null, selectionAnchor: null }),
  openLightbox: () => set((state) => ({ lightboxOpen: state.activeIndex !== null })),
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
