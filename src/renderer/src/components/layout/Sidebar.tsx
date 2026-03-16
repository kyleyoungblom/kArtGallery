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
  const [expanded, setExpanded] = useState(depth < 2) // Auto-expand first 2 levels
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

export function Sidebar(): JSX.Element {
  const rootPath = useGalleryStore((s) => s.rootPath)
  const currentPath = useGalleryStore((s) => s.currentPath)
  const folderTree = useGalleryStore((s) => s.folderTree)
  const setRootPath = useGalleryStore((s) => s.setRootPath)
  const setCurrentPath = useGalleryStore((s) => s.setCurrentPath)
  const setFolderTree = useGalleryStore((s) => s.setFolderTree)
  const setIsScanning = useGalleryStore((s) => s.setIsScanning)
  const incrementScanVersion = useGalleryStore((s) => s.incrementScanVersion)

  const handlePickFolder = useCallback(async () => {
    const path = await window.api.pickFolder()
    if (!path) return

    setRootPath(path)
    setCurrentPath(path)
    setIsScanning(true)

    // Fetch folder tree and scan in parallel
    const [tree] = await Promise.all([
      window.api.getFolderTree(path),
      window.api.scanFolder(path)
    ])

    setFolderTree(tree as FolderNode)
    setIsScanning(false)

    // Bump scanVersion so useGalleryFiles re-fetches from the now-populated DB.
    // We can't just call setCurrentPath again — zustand won't trigger an update
    // if the value hasn't changed.
    incrementScanVersion()
  }, [setRootPath, setCurrentPath, setFolderTree, setIsScanning, incrementScanVersion])

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
