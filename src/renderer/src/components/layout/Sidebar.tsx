import { useState, useEffect, useCallback, useMemo } from 'react'
import { useGalleryStore } from '../../stores/gallery.store'
import { ContextMenu } from './ContextMenu'
import { FailedFilesModal } from './FailedFilesModal'
import type { FolderNode, SortField, SortDirection, GroupBy } from '../../types/models'

// Recursive tree component. Each FolderTreeItem renders itself and its children.
// Expand state is lifted to Sidebar so keyboard navigation can read/write it.

function FolderTreeItem({
  node,
  depth,
  selectedPath,
  focusedPath,
  expandedPaths,
  folderCounts,
  onSelect,
  onToggle,
  onToggleRecursive
}: {
  node: FolderNode
  depth: number
  selectedPath: string | null
  focusedPath: string | null
  expandedPaths: Set<string>
  folderCounts: Record<string, number>
  onSelect: (path: string) => void
  onToggle: (path: string) => void
  onToggleRecursive: (path: string) => void
}): JSX.Element {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const hasChildren = node.children.length > 0
  const isSelected = node.path === selectedPath
  const isFocused = node.path === focusedPath
  const expanded = expandedPaths.has(node.path)

  const className = [
    'sidebar-item',
    isSelected ? 'sidebar-item--selected' : '',
    isFocused ? 'sidebar-item--focused' : ''
  ].filter(Boolean).join(' ')

  return (
    <div>
      <div
        className={className}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => onSelect(node.path)}
        onContextMenu={(e) => {
          e.preventDefault()
          setContextMenu({ x: e.clientX, y: e.clientY })
        }}
      >
        {hasChildren && (
          <button
            className="sidebar-toggle"
            onClick={(e) => {
              e.stopPropagation()
              if (e.altKey) {
                onToggleRecursive(node.path)
              } else {
                onToggle(node.path)
              }
            }}
          >
            {expanded ? '\u25BE' : '\u25B8'}
          </button>
        )}
        {!hasChildren && <span className="sidebar-toggle-spacer" />}
        <span className="sidebar-item-name">{node.name}</span>
        {folderCounts[node.path] !== undefined && (
          <span className="sidebar-item-count">{folderCounts[node.path]}</span>
        )}
      </div>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={[
            { label: 'Open in Finder', onClick: () => window.api.openFolder(node.path) },
            {
              label: node.hidden ? 'Unhide Folder' : 'Hide Folder',
              onClick: () => {
                // setHidden takes a DB id — but we only have the path here.
                // The IPC handler for set-hidden accepts (id, type, hidden).
                // For folders, we need the folder's DB id. We'll use a dedicated
                // IPC channel that accepts a path instead.
                window.api.setFolderHiddenByPath(node.path, !node.hidden).then(() => {
                  useGalleryStore.getState().incrementScanVersion()
                })
              }
            }
          ]}
          onClose={() => setContextMenu(null)}
        />
      )}
      {expanded &&
        hasChildren &&
        node.children.map((child) => (
          <FolderTreeItem
            key={child.path}
            node={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            focusedPath={focusedPath}
            expandedPaths={expandedPaths}
            folderCounts={folderCounts}
            onSelect={onSelect}
            onToggle={onToggle}
            onToggleRecursive={onToggleRecursive}
          />
        ))}
    </div>
  )
}

// Collect all descendant paths of a node (inclusive)
function collectPaths(node: FolderNode): string[] {
  const paths = [node.path]
  for (const child of node.children) {
    paths.push(...collectPaths(child))
  }
  return paths
}

// Find a node by path in the tree
function findNode(tree: FolderNode, path: string): FolderNode | null {
  if (tree.path === path) return tree
  for (const child of tree.children) {
    const found = findNode(child, path)
    if (found) return found
  }
  return null
}

// Find parent path of a node in the tree
function findParentPath(tree: FolderNode, targetPath: string): string | null {
  for (const child of tree.children) {
    if (child.path === targetPath) return tree.path
    const found = findParentPath(child, targetPath)
    if (found) return found
  }
  return null
}

// Build a flat list of visible folder paths (respecting expand state)
function flattenVisible(node: FolderNode, expandedPaths: Set<string>): string[] {
  const result = [node.path]
  if (expandedPaths.has(node.path)) {
    for (const child of node.children) {
      result.push(...flattenVisible(child, expandedPaths))
    }
  }
  return result
}

// Initialize expanded paths: only expand the root node (depth 0).
// Child folders start collapsed so the user sees a clean overview
// and can drill into specific sub-folders on demand.
function initExpandedPaths(node: FolderNode, depth = 0): string[] {
  const paths: string[] = []
  if (depth < 1 && node.children.length > 0) {
    paths.push(node.path)
  }
  return paths
}

// Extract the scan workflow so both "Open Folder" and "restore on startup"
// can share it. Duplication here would mean bugs get fixed in one path
// but not the other — a classic source of subtle issues.
async function loadFolder(folderPath: string): Promise<void> {
  const store = useGalleryStore.getState()
  store.addPinnedFolder(folderPath)
  store.setCurrentPath(folderPath)
  store.setIsScanning(true)

  const [tree] = await Promise.all([
    window.api.getFolderTree(folderPath),
    window.api.scanFolder(folderPath)
  ])

  store.setFolderTreeForRoot(folderPath, tree as FolderNode)
  store.setIsScanning(false)
  store.incrementScanVersion()

  // Persist pinned folders list
  window.api.setPreference('pinnedFolders', JSON.stringify(useGalleryStore.getState().pinnedFolders))
}

export function Sidebar(): JSX.Element {
  const currentPath = useGalleryStore((s) => s.currentPath)
  const pinnedFolders = useGalleryStore((s) => s.pinnedFolders)
  const folderTrees = useGalleryStore((s) => s.folderTrees)
  const removePinnedFolder = useGalleryStore((s) => s.removePinnedFolder)
  const setCurrentPath = useGalleryStore((s) => s.setCurrentPath)
  const focusRegion = useGalleryStore((s) => s.focusRegion)
  const setFocusRegion = useGalleryStore((s) => s.setFocusRegion)
  const sidebarCollapsed = useGalleryStore((s) => s.sidebarCollapsed)
  const revealPath = useGalleryStore((s) => s.revealPath)
  const setRevealPath = useGalleryStore((s) => s.setRevealPath)

  const scanVersion = useGalleryStore((s) => s.scanVersion)
  const openDuplicateReview = useGalleryStore((s) => s.openDuplicateReview)

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [focusedPath, setFocusedPath] = useState<string | null>(null)
  const [folderCounts, setFolderCounts] = useState<Record<string, number>>({})
  const [duplicateCount, setDuplicateCount] = useState<number>(0)
  const [failedModalOpen, setFailedModalOpen] = useState(false)

  // Initialize expanded paths when folder trees change
  useEffect(() => {
    const paths: string[] = []
    for (const tree of Object.values(folderTrees)) {
      paths.push(...initExpandedPaths(tree))
    }
    if (paths.length > 0) {
      setExpandedPaths((prev) => {
        const next = new Set(prev)
        for (const p of paths) next.add(p)
        return next
      })
    }
  }, [folderTrees])

  // Fetch file counts per folder after each scan completes.
  // scanVersion increments after every scan, so this re-runs automatically.
  useEffect(() => {
    window.api.getFolderCounts().then(setFolderCounts)
    // Also refresh duplicate count — hashes may have been computed since last check
    window.api.getDuplicateCount().then(setDuplicateCount)
  }, [scanVersion])

  // Sync focusedPath to currentPath when it changes
  useEffect(() => {
    setFocusedPath(currentPath)
  }, [currentPath])

  // Handle "Reveal in Sidebar" — expand all ancestor folders so the
  // target path is visible in the tree, then scroll it into view.
  useEffect(() => {
    if (!revealPath) return

    // Build the list of ancestor paths that need to be expanded.
    // Walk up from the target path, collecting each parent until we
    // reach a pinned root (which is always visible).
    const ancestors: string[] = []
    let p = revealPath
    const rootSet = new Set(pinnedFolders)
    while (p && !rootSet.has(p)) {
      const parent = p.substring(0, p.lastIndexOf('/'))
      if (parent === p) break // reached filesystem root
      ancestors.push(parent)
      p = parent
    }

    setExpandedPaths((prev) => {
      const next = new Set(prev)
      for (const a of ancestors) next.add(a)
      return next
    })

    // Scroll the selected item into view after React renders the expanded tree
    requestAnimationFrame(() => {
      document.querySelector('.sidebar-item--selected')?.scrollIntoView({ block: 'nearest' })
    })

    setRevealPath(null)
  }, [revealPath, pinnedFolders, setRevealPath])

  // When focus switches to sidebar, ensure focusedPath is set and visible
  useEffect(() => {
    if (focusRegion === 'sidebar') {
      if (!focusedPath && currentPath) {
        setFocusedPath(currentPath)
      }
      requestAnimationFrame(() => {
        document.querySelector('.sidebar-item--focused')?.scrollIntoView({ block: 'nearest' })
      })
    }
  }, [focusRegion])

  const handlePickFolder = useCallback(async () => {
    const path = await window.api.pickFolder()
    if (!path) return
    await loadFolder(path)
  }, [])

  // On startup, restore view settings and auto-load pinned folder.
  useEffect(() => {
    window.api.getPreferences().then((prefs) => {
      const store = useGalleryStore.getState()
      if (prefs['sortField']) store.setSortField(prefs['sortField'] as SortField)
      if (prefs['sortDirection']) store.setSortDirection(prefs['sortDirection'] as SortDirection)
      if (prefs['groupBy']) store.setGroupBy(prefs['groupBy'] as GroupBy)
      if (prefs['tileSize']) store.setTileSize(Number(prefs['tileSize']))
      if (prefs['gapSize']) store.setGapSize(Number(prefs['gapSize']))
      if (prefs['cropToAspect'] !== undefined) store.setCropToAspect(prefs['cropToAspect'] === 'true')
      if (prefs['showLabels'] !== undefined) store.setShowLabels(prefs['showLabels'] === 'true')
      if (prefs['showHidden'] !== undefined) store.setShowHidden(prefs['showHidden'] === 'true')
      if (prefs['toolbarVisible'] !== undefined && prefs['toolbarVisible'] === 'false') store.toggleToolbar()
      if (prefs['statusbarVisible'] !== undefined && prefs['statusbarVisible'] === 'false') store.toggleStatusbar()
      if (prefs['filterExtensions']) {
        try { store.setFilterExtensions(JSON.parse(prefs['filterExtensions'])) } catch { /* ignore */ }
      }
      if (prefs['filterMinSize']) store.setFilterMinSize(Number(prefs['filterMinSize']))
      if (prefs['filterMaxSize']) store.setFilterMaxSize(Number(prefs['filterMaxSize']))
      if (prefs['filterMinDimension']) store.setFilterMinDimension(Number(prefs['filterMinDimension']))
      if (prefs['sidebarCollapsed'] !== undefined) {
        if (prefs['sidebarCollapsed'] === 'true') store.toggleSidebar()
      }
      if (prefs['infoPanelOpen'] !== undefined) {
        if (prefs['infoPanelOpen'] === 'true') store.toggleInfoPanel()
      }

      // Restore keyboard shortcut overrides
      if (prefs['keyboardShortcuts']) {
        try {
          store.setKeyboardShortcuts(JSON.parse(prefs['keyboardShortcuts']))
        } catch { /* ignore malformed JSON */ }
      }

      // Migrate from old single pinnedFolder to new pinnedFolders array
      const pinnedFoldersJson = prefs['pinnedFolders']
      const oldPinned = prefs['pinnedFolder']
      let foldersToLoad: string[] = []

      if (pinnedFoldersJson) {
        try { foldersToLoad = JSON.parse(pinnedFoldersJson) } catch { /* ignore */ }
      } else if (oldPinned) {
        foldersToLoad = [oldPinned]
        window.api.setPreference('pinnedFolders', JSON.stringify(foldersToLoad))
      }

      for (const folder of foldersToLoad) {
        loadFolder(folder)
      }
    })
  }, [])

  // Persist view settings whenever they change.
  useEffect(() => {
    const unsub = useGalleryStore.subscribe((state, prev) => {
      if (state.sortField !== prev.sortField) window.api.setPreference('sortField', state.sortField)
      if (state.sortDirection !== prev.sortDirection) window.api.setPreference('sortDirection', state.sortDirection)
      if (state.groupBy !== prev.groupBy) window.api.setPreference('groupBy', state.groupBy)
      if (state.tileSize !== prev.tileSize) window.api.setPreference('tileSize', String(state.tileSize))
      if (state.gapSize !== prev.gapSize) window.api.setPreference('gapSize', String(state.gapSize))
      if (state.cropToAspect !== prev.cropToAspect) window.api.setPreference('cropToAspect', String(state.cropToAspect))
      if (state.showLabels !== prev.showLabels) window.api.setPreference('showLabels', String(state.showLabels))
      if (state.sidebarCollapsed !== prev.sidebarCollapsed) window.api.setPreference('sidebarCollapsed', String(state.sidebarCollapsed))
      if (state.infoPanelOpen !== prev.infoPanelOpen) window.api.setPreference('infoPanelOpen', String(state.infoPanelOpen))
      if (state.showHidden !== prev.showHidden) window.api.setPreference('showHidden', String(state.showHidden))
      if (state.toolbarVisible !== prev.toolbarVisible) window.api.setPreference('toolbarVisible', String(state.toolbarVisible))
      if (state.statusbarVisible !== prev.statusbarVisible) window.api.setPreference('statusbarVisible', String(state.statusbarVisible))
      if (JSON.stringify(state.filterExtensions) !== JSON.stringify(prev.filterExtensions)) window.api.setPreference('filterExtensions', JSON.stringify(state.filterExtensions))
      if (state.filterMinSize !== prev.filterMinSize) window.api.setPreference('filterMinSize', state.filterMinSize !== null ? String(state.filterMinSize) : '')
      if (state.filterMaxSize !== prev.filterMaxSize) window.api.setPreference('filterMaxSize', state.filterMaxSize !== null ? String(state.filterMaxSize) : '')
      if (state.filterMinDimension !== prev.filterMinDimension) window.api.setPreference('filterMinDimension', state.filterMinDimension !== null ? String(state.filterMinDimension) : '')
    })
    return unsub
  }, [])

  // Listen for scan progress events
  useEffect(() => {
    const unsubscribe = window.api.onScanProgress((progress) => {
      useGalleryStore.getState().setScanProgress(progress)
    })
    return unsubscribe
  }, [])


  const handleFolderSelect = useCallback(
    (path: string) => {
      setCurrentPath(path)
      setFocusedPath(path)
    },
    [setCurrentPath]
  )

  const handleToggle = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  const findNodeInTrees = useCallback((path: string): FolderNode | null => {
    for (const tree of Object.values(folderTrees)) {
      const found = findNode(tree, path)
      if (found) return found
    }
    return null
  }, [folderTrees])

  const findParentInTrees = useCallback((targetPath: string): string | null => {
    for (const tree of Object.values(folderTrees)) {
      const found = findParentPath(tree, targetPath)
      if (found) return found
    }
    return null
  }, [folderTrees])

  const handleToggleRecursive = useCallback((path: string) => {
    const node = findNodeInTrees(path)
    if (!node) return
    const descendants = collectPaths(node)

    setExpandedPaths((prev) => {
      const next = new Set(prev)
      const shouldExpand = !next.has(path)
      for (const p of descendants) {
        if (shouldExpand) {
          next.add(p)
        } else {
          next.delete(p)
        }
      }
      return next
    })
  }, [findNodeInTrees])

  // Flat list of visible paths for keyboard navigation
  const visiblePaths = useMemo(() => {
    const paths: string[] = []
    for (const root of pinnedFolders) {
      const tree = folderTrees[root]
      if (tree) paths.push(...flattenVisible(tree, expandedPaths))
    }
    return paths
  }, [pinnedFolders, folderTrees, expandedPaths])

  // Keyboard navigation for the sidebar
  useEffect(() => {
    if (focusRegion !== 'sidebar') return
    if (useGalleryStore.getState().lightboxOpen) return

    function handleKeydown(e: KeyboardEvent): void {
      if (useGalleryStore.getState().focusRegion !== 'sidebar') return
      if (useGalleryStore.getState().lightboxOpen) return

      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return

      const currentIndex = focusedPath ? visiblePaths.indexOf(focusedPath) : -1

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault()
          const next = Math.min(visiblePaths.length - 1, currentIndex + 1)
          if (next >= 0) {
            setFocusedPath(visiblePaths[next])
            setCurrentPath(visiblePaths[next])
          }
          break
        }
        case 'ArrowUp': {
          e.preventDefault()
          const prev = Math.max(0, currentIndex - 1)
          if (prev >= 0) {
            setFocusedPath(visiblePaths[prev])
            setCurrentPath(visiblePaths[prev])
          }
          break
        }
        case 'ArrowRight': {
          e.preventDefault()
          if (!focusedPath) break
          if (e.altKey) {
            handleToggleRecursive(focusedPath)
            break
          }
          const node = findNodeInTrees(focusedPath)
          if (!node || node.children.length === 0) break
          if (!expandedPaths.has(focusedPath)) {
            handleToggle(focusedPath)
          } else {
            // Already expanded — move to first child
            setFocusedPath(node.children[0].path)
          }
          break
        }
        case 'ArrowLeft': {
          e.preventDefault()
          if (!focusedPath) break
          if (e.altKey) {
            handleToggleRecursive(focusedPath)
            break
          }
          if (expandedPaths.has(focusedPath)) {
            handleToggle(focusedPath)
          } else {
            // Collapse: move to parent
            const parentPath = findParentInTrees(focusedPath)
            if (parentPath) setFocusedPath(parentPath)
          }
          break
        }
        case 'Enter': {
          if (focusedPath) {
            setCurrentPath(focusedPath)
          }
          break
        }
      }
    }

    document.addEventListener('keydown', handleKeydown)
    return () => document.removeEventListener('keydown', handleKeydown)
  }, [focusRegion, focusedPath, visiblePaths, expandedPaths, findNodeInTrees, findParentInTrees, handleToggle, handleToggleRecursive, setCurrentPath])

  const handleSidebarFocus = useCallback(() => {
    setFocusRegion('sidebar')
  }, [setFocusRegion])

  return (
    <div
      className="sidebar"
      tabIndex={-1}
      onMouseDown={handleSidebarFocus}
      onFocus={handleSidebarFocus}
    >
      <div className="sidebar-header">
        <button className="sidebar-icon-btn" onClick={handlePickFolder} title="Add Folder">
          +
        </button>
        <span className="sidebar-header-title">Folders</span>
      </div>
      <div className="sidebar-tree">
        {pinnedFolders.length > 0 ? (
          pinnedFolders.map((rootPath) => {
            const tree = folderTrees[rootPath]
            if (!tree) return null
            return (
              <div key={rootPath} className="sidebar-pinned-root">
                <FolderTreeItem
                  node={tree}
                  depth={0}
                  selectedPath={currentPath}
                  focusedPath={focusRegion === 'sidebar' ? focusedPath : null}
                  expandedPaths={expandedPaths}
                  folderCounts={folderCounts}
                  onSelect={handleFolderSelect}
                  onToggle={handleToggle}
                  onToggleRecursive={handleToggleRecursive}
                />
                {pinnedFolders.length > 1 && (
                  <button
                    className="sidebar-unpin-btn"
                    onClick={() => {
                      removePinnedFolder(rootPath)
                      window.api.stopWatching(rootPath)
                      window.api.setPreference('pinnedFolders', JSON.stringify(
                        useGalleryStore.getState().pinnedFolders
                      ))
                    }}
                    title="Remove folder"
                  >
                    {'\u2715'}
                  </button>
                )}
              </div>
            )
          })
        ) : (
          <div className="sidebar-empty">No folder selected</div>
        )}
      </div>
      <div className="sidebar-section-label">Filters</div>
      <div
        className="sidebar-filter-item"
        onClick={openDuplicateReview}
        title="Find duplicate images by visual similarity"
      >
        <span className="sidebar-filter-item-name">Duplicates</span>
        {duplicateCount > 0 && (
          <span className="sidebar-item-count">{duplicateCount}</span>
        )}
      </div>
      {failedModalOpen && <FailedFilesModal onClose={() => setFailedModalOpen(false)} />}
    </div>
  )
}
