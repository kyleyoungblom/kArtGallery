import { useState, useRef, useEffect, useCallback } from 'react'
import { useGalleryStore } from '../../stores/gallery.store'
import { useLogStore } from '../../stores/log.store'
import { loadFolder } from '../../utils/load-folder'
import { ContextMenu } from './ContextMenu'

/**
 * Tab bar — each tab represents a folder root.
 *
 * Features:
 * - Drag-to-reorder tabs (native HTML5 DnD)
 * - Tab shrinking with generous min-width when many tabs
 * - Custom display names (aliases) via right-click context menu
 * - Gear menu on the right with View toggles and maintenance actions
 */

function getTabLabel(displayName: string | undefined, rootPath: string): string {
  if (displayName) return displayName
  if (!rootPath) return 'New Tab'
  return rootPath.split('/').pop() || rootPath
}

export function TabBar(): JSX.Element {
  const tabs = useGalleryStore((s) => s.tabs)
  const activeTabId = useGalleryStore((s) => s.activeTabId)
  const createTab = useGalleryStore((s) => s.createTab)
  const closeTab = useGalleryStore((s) => s.closeTab)
  const switchTab = useGalleryStore((s) => s.switchTab)
  const reorderTabs = useGalleryStore((s) => s.reorderTabs)
  const setTabDisplayName = useGalleryStore((s) => s.setTabDisplayName)

  // View toggles (gear menu)
  const sidebarCollapsed = useGalleryStore((s) => s.sidebarCollapsed)
  const infoPanelOpen = useGalleryStore((s) => s.infoPanelOpen)
  const toolbarVisible = useGalleryStore((s) => s.toolbarVisible)
  const statusbarVisible = useGalleryStore((s) => s.statusbarVisible)
  const toggleSidebar = useGalleryStore((s) => s.toggleSidebar)
  const toggleInfoPanel = useGalleryStore((s) => s.toggleInfoPanel)
  const toggleToolbar = useGalleryStore((s) => s.toggleToolbar)
  const toggleStatusbar = useGalleryStore((s) => s.toggleStatusbar)
  const openSettings = useGalleryStore((s) => s.openSettings)
  const incrementThumbnailVersion = useGalleryStore((s) => s.incrementThumbnailVersion)

  const isLogPanelOpen = useLogStore((s) => s.isLogPanelOpen)
  const toggleLogPanel = useLogStore((s) => s.toggleLogPanel)
  const errorCount = useLogStore((s) => s.entries.filter((e) => e.level === 'warn' || e.level === 'error').length)

  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Drag-to-reorder state
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  // Inline rename state
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

  // Context menu state
  const [tabContextMenu, setTabContextMenu] = useState<{ x: number; y: number; tabId: string } | null>(null)

  // Close gear menu on outside click
  useEffect(() => {
    if (!menuOpen) return
    function handleClick(e: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

  // Focus rename input when it appears
  useEffect(() => {
    if (renamingTabId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingTabId])

  const handleResetThumbnails = useCallback(async () => {
    setMenuOpen(false)
    await window.api.resetThumbnails()
    incrementThumbnailVersion()
  }, [incrementThumbnailVersion])

  const handleNewTab = useCallback(async () => {
    const folder = await window.api.pickFolder()
    if (!folder) return
    createTab(folder)
    loadFolder(folder)
  }, [createTab])

  const confirmCloseTab = useCallback((tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId)
    const label = tab ? getTabLabel(tab.displayName, tab.rootPath) : 'this tab'
    if (window.confirm(`Close "${label}"?`)) {
      closeTab(tabId)
    }
  }, [tabs, closeTab])

  const handleTabAuxClick = useCallback((e: React.MouseEvent, tabId: string) => {
    if (e.button === 1 && tabs.length > 1) {
      e.preventDefault()
      confirmCloseTab(tabId)
    }
  }, [tabs.length, confirmCloseTab])

  // ── Drag-to-reorder handlers ──

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    setDragIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    // Use a transparent drag image so we just see the CSS opacity change
    const el = e.currentTarget as HTMLElement
    e.dataTransfer.setDragImage(el, el.offsetWidth / 2, el.offsetHeight / 2)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragIndex !== null && index !== dragIndex) {
      setDragOverIndex(index)
    }
  }, [dragIndex])

  const handleDragEnd = useCallback(() => {
    if (dragIndex !== null && dragOverIndex !== null && dragIndex !== dragOverIndex) {
      reorderTabs(dragIndex, dragOverIndex)
    }
    setDragIndex(null)
    setDragOverIndex(null)
  }, [dragIndex, dragOverIndex, reorderTabs])

  // ── Inline rename handlers ──

  const startRename = useCallback((tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId)
    if (!tab) return
    setRenamingTabId(tabId)
    setRenameValue(tab.displayName || getTabLabel(undefined, tab.rootPath))
    setTabContextMenu(null)
  }, [tabs])

  const commitRename = useCallback(() => {
    if (!renamingTabId) return
    const tab = tabs.find((t) => t.id === renamingTabId)
    if (!tab) return
    const trimmed = renameValue.trim()
    // If empty or same as folder name, clear the alias
    const folderName = tab.rootPath.split('/').pop() || ''
    if (!trimmed || trimmed === folderName) {
      setTabDisplayName(renamingTabId, null)
    } else {
      setTabDisplayName(renamingTabId, trimmed)
    }
    setRenamingTabId(null)
  }, [renamingTabId, renameValue, tabs, setTabDisplayName])

  const cancelRename = useCallback(() => {
    setRenamingTabId(null)
  }, [])

  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commitRename()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelRename()
    }
  }, [commitRename, cancelRename])

  return (
    <div className="tab-bar">
      <div className="tab-bar-tabs">
        {tabs.map((tab, index) => (
          <div
            key={tab.id}
            className={[
              'tab-bar-tab',
              tab.id === activeTabId ? 'tab-bar-tab--active' : '',
              dragIndex === index ? 'tab-bar-tab--dragging' : '',
              dragOverIndex === index ? 'tab-bar-tab--drag-over' : ''
            ].filter(Boolean).join(' ')}
            onClick={() => switchTab(tab.id)}
            onAuxClick={(e) => handleTabAuxClick(e, tab.id)}
            onContextMenu={(e) => {
              e.preventDefault()
              setTabContextMenu({ x: e.clientX, y: e.clientY, tabId: tab.id })
            }}
            title={tab.rootPath || 'New Tab'}
            draggable
            onDragStart={(e) => handleDragStart(e, index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragEnd={handleDragEnd}
          >
            {renamingTabId === tab.id ? (
              <input
                ref={renameInputRef}
                className="tab-bar-tab-rename"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={handleRenameKeyDown}
                onBlur={commitRename}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="tab-bar-tab-label">
                {getTabLabel(tab.displayName, tab.rootPath)}
              </span>
            )}
            {tabs.length > 1 && (
              <button
                className="tab-bar-tab-close"
                onClick={(e) => {
                  e.stopPropagation()
                  confirmCloseTab(tab.id)
                }}
                title="Close tab"
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button
          className="tab-bar-new"
          onClick={handleNewTab}
          title="Open folder in new tab"
        >
          +
        </button>
      </div>

      {/* Tab right-click context menu */}
      {tabContextMenu && (
        <ContextMenu
          x={tabContextMenu.x}
          y={tabContextMenu.y}
          items={[
            { label: 'Edit Display Name\u2026', onClick: () => startRename(tabContextMenu.tabId) },
            ...(tabs.length > 1 ? [{ label: 'Close Tab', onClick: () => { setTabContextMenu(null); confirmCloseTab(tabContextMenu.tabId) } }] : [])
          ]}
          onClose={() => setTabContextMenu(null)}
        />
      )}

      <div className="tab-bar-spacer" />

      <div className="tab-bar-actions">
        <div className="breadcrumb-menu-container" ref={menuRef}>
          <button
            className="breadcrumb-gear-btn"
            onClick={() => setMenuOpen(!menuOpen)}
            title="Menu"
          >
            {'\u2699'}
          </button>
          {menuOpen && (
            <div className="breadcrumb-menu">
              <div className="breadcrumb-menu-section-title">View</div>
              <button className="breadcrumb-menu-item" onClick={() => { toggleSidebar(); setMenuOpen(false) }}>
                <span className="breadcrumb-menu-check">{sidebarCollapsed ? '' : '\u2713'}</span>
                Sidebar
                <span className="breadcrumb-menu-shortcut">{'\u2318'}B</span>
              </button>
              <button className="breadcrumb-menu-item" onClick={() => { toggleToolbar(); setMenuOpen(false) }}>
                <span className="breadcrumb-menu-check">{toolbarVisible ? '\u2713' : ''}</span>
                Toolbar
                <span className="breadcrumb-menu-shortcut">{'\u2318'}T</span>
              </button>
              <button className="breadcrumb-menu-item" onClick={() => { toggleStatusbar(); setMenuOpen(false) }}>
                <span className="breadcrumb-menu-check">{statusbarVisible ? '\u2713' : ''}</span>
                Status Bar
                <span className="breadcrumb-menu-shortcut">{'\u2318'}/</span>
              </button>
              <button className="breadcrumb-menu-item" onClick={() => { toggleInfoPanel(); setMenuOpen(false) }}>
                <span className="breadcrumb-menu-check">{infoPanelOpen ? '\u2713' : ''}</span>
                Info Panel
                <span className="breadcrumb-menu-shortcut">{'\u2318'}I</span>
              </button>
              <button className="breadcrumb-menu-item" onClick={() => { toggleLogPanel(); setMenuOpen(false) }}>
                <span className="breadcrumb-menu-check">{isLogPanelOpen ? '\u2713' : ''}</span>
                Activity Log
                {errorCount > 0 && <span className="breadcrumb-menu-badge">{errorCount}</span>}
              </button>

              <div className="breadcrumb-menu-divider" />

              <button className="breadcrumb-menu-item" onClick={() => { setMenuOpen(false); openSettings() }}>
                Settings{'\u2026'}
                <span className="breadcrumb-menu-shortcut">{'\u2318'},</span>
              </button>
              <button className="breadcrumb-menu-item" onClick={handleResetThumbnails}>
                Reset Thumbnails
              </button>
              <button className="breadcrumb-menu-item" onClick={() => { setMenuOpen(false); window.api.openDataFolder() }}>
                Open Data Folder
              </button>
              <button className="breadcrumb-menu-item" onClick={() => { setMenuOpen(false); window.api.restartApp() }}>
                Restart App
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
