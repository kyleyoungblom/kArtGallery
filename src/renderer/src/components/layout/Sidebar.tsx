import { useState, useEffect, useCallback } from 'react'
import { useGalleryStore } from '../../stores/gallery.store'
import type { FolderNode } from '../../types/models'

// Recursive tree component. Each FolderTreeItem renders itself and its children.
// This is a natural fit for recursive data — the component mirrors the data structure.

function FolderTreeItem({
  node,
  depth,
  selectedPath,
  onSelect
}: {
  node: FolderNode
  depth: number
  selectedPath: string | null
  onSelect: (path: string) => void
}): JSX.Element {
  const [expanded, setExpanded] = useState(depth < 2)
  const hasChildren = node.children.length > 0
  const isSelected = node.path === selectedPath

  return (
    <div>
      <div
        className={`sidebar-item ${isSelected ? 'sidebar-item--selected' : ''}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => onSelect(node.path)}
      >
        {hasChildren && (
          <button
            className="sidebar-toggle"
            onClick={(e) => {
              e.stopPropagation()
              setExpanded(!expanded)
            }}
          >
            {expanded ? '\u25BE' : '\u25B8'}
          </button>
        )}
        {!hasChildren && <span className="sidebar-toggle-spacer" />}
        <span className="sidebar-item-name">{node.name}</span>
      </div>
      {expanded &&
        hasChildren &&
        node.children.map((child) => (
          <FolderTreeItem
            key={child.path}
            node={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            onSelect={onSelect}
          />
        ))}
    </div>
  )
}

// Extract the scan workflow so both "Open Folder" and "restore on startup"
// can share it. Duplication here would mean bugs get fixed in one path
// but not the other — a classic source of subtle issues.
async function loadFolder(folderPath: string): Promise<void> {
  const store = useGalleryStore.getState()
  store.setRootPath(folderPath)
  store.setCurrentPath(folderPath)
  store.setIsScanning(true)

  const [tree] = await Promise.all([
    window.api.getFolderTree(folderPath),
    window.api.scanFolder(folderPath)
  ])

  store.setFolderTree(tree as FolderNode)
  store.setIsScanning(false)
  store.incrementScanVersion()

  // Persist as pinned folder so it auto-loads next session
  window.api.setPreference('pinnedFolder', folderPath)
}

export function Sidebar(): JSX.Element {
  const currentPath = useGalleryStore((s) => s.currentPath)
  const folderTree = useGalleryStore((s) => s.folderTree)
  const setCurrentPath = useGalleryStore((s) => s.setCurrentPath)

  const handlePickFolder = useCallback(async () => {
    const path = await window.api.pickFolder()
    if (!path) return
    await loadFolder(path)
  }, [])

  // On startup, check for a pinned folder and auto-load it.
  // This means the app opens exactly where you left off — no
  // re-selecting your Art folder every time.
  useEffect(() => {
    window.api.getPreferences().then((prefs) => {
      const pinned = prefs['pinnedFolder']
      if (pinned) {
        loadFolder(pinned)
      }
    })
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
    },
    [setCurrentPath]
  )

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <button className="sidebar-open-btn" onClick={handlePickFolder}>
          Open Folder
        </button>
      </div>
      <div className="sidebar-tree">
        {folderTree ? (
          <FolderTreeItem
            node={folderTree}
            depth={0}
            selectedPath={currentPath}
            onSelect={handleFolderSelect}
          />
        ) : (
          <div className="sidebar-empty">No folder selected</div>
        )}
      </div>
    </div>
  )
}
