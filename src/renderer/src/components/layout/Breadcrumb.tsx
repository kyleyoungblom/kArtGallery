import { useMemo, useCallback, useState, useRef, useEffect } from 'react'
import { useGalleryStore } from '../../stores/gallery.store'
import { useLogStore } from '../../stores/log.store'

/**
 * Breadcrumb navigation header / title bar.
 *
 * Left side:  folder path as clickable breadcrumb segments.
 * Right side: settings gear menu with View toggles (sidebar, toolbar, etc.),
 *             log panel toggle, and maintenance actions.
 *
 * The settings gear was originally in the sidebar header but it makes more
 * sense here because:
 * 1. It's always accessible even when the sidebar is collapsed/hidden
 * 2. The View menu items control app-wide layout, not sidebar-specific state
 * 3. It follows the pattern of apps like Obsidian that put menus in the title bar
 */
export function Breadcrumb(): JSX.Element {
  const currentPath = useGalleryStore((s) => s.currentPath)
  const pinnedFolders = useGalleryStore((s) => s.pinnedFolders)
  const setCurrentPath = useGalleryStore((s) => s.setCurrentPath)

  // View toggles
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

  const segments = useMemo(() => {
    if (!currentPath) return []

    const root = pinnedFolders.find((r) => currentPath === r || currentPath.startsWith(r + '/'))
    if (!root) return []

    const rootName = root.split('/').pop() || root

    if (currentPath === root) {
      return [{ name: rootName, path: root }]
    }

    const relative = currentPath.slice(root.length + 1)
    const parts = relative.split('/')
    const result = [{ name: rootName, path: root }]

    let accumulated = root
    for (const part of parts) {
      accumulated += '/' + part
      result.push({ name: part, path: accumulated })
    }

    return result
  }, [currentPath, pinnedFolders])

  const handleClick = useCallback(
    (path: string) => {
      setCurrentPath(path)
    },
    [setCurrentPath]
  )

  const handleResetThumbnails = useCallback(async () => {
    setMenuOpen(false)
    await window.api.resetThumbnails()
    incrementThumbnailVersion()
  }, [incrementThumbnailVersion])

  return (
    <div className="breadcrumb">
      <div className="breadcrumb-path">
        {segments.map((seg, i) => (
          <span key={seg.path} className="breadcrumb-segment">
            {i > 0 && <span className="breadcrumb-separator">/</span>}
            {i < segments.length - 1 ? (
              <button
                className="breadcrumb-btn"
                onClick={() => handleClick(seg.path)}
                title={seg.path}
              >
                {seg.name}
              </button>
            ) : (
              <span className="breadcrumb-current" title={seg.path}>
                {seg.name}
              </span>
            )}
          </span>
        ))}
      </div>

      <div className="breadcrumb-actions">
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
