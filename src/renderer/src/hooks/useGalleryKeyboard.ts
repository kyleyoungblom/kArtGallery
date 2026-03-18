import { useEffect } from 'react'
import { useGalleryStore } from '../stores/gallery.store'
import { eventToKeyString, buildShortcutMap } from '../config/shortcut-matcher'
import { loadFolder } from '../utils/load-folder'
import type { GalleryItem } from '../types/models'

// Keyboard navigation for the gallery grid.
//
// All keyboard shortcuts are resolved through the configurable shortcut map,
// so users can remap any action via Settings → Shortcuts. The map is rebuilt
// from store.keyboardShortcuts (user overrides) on every keydown — this is
// cheap (10 entries, O(n) map build) and avoids stale closure issues.

export function useGalleryKeyboard(
  containerRef: React.RefObject<HTMLDivElement | null>,
  files: GalleryItem[]
): void {
  useEffect(() => {
    function handleKeydown(e: KeyboardEvent): void {
      const store = useGalleryStore.getState()
      const shortcutMap = buildShortcutMap(store.keyboardShortcuts)
      const keyStr = eventToKeyString(e)
      const action = shortcutMap.get(keyStr)

      // Cmd+, opens settings (works regardless of lightbox, settings, or focus state)
      if (action === 'openSettings') {
        e.preventDefault()
        if (store.settingsOpen) {
          store.closeSettings()
        } else {
          store.openSettings()
        }
        return
      }

      // Don't process other shortcuts when settings modal is open
      if (store.settingsOpen) return

      // When lightbox is open, Space/Enter closes it (prevent default
      // to stop the browser from scrolling the grid behind the overlay)
      if (store.lightboxOpen) {
        if (action === 'openLightbox' || keyStr === 'enter') {
          e.preventDefault()
          store.closeLightbox()
        }
        return
      }

      // --- Global shortcuts (work regardless of focus region) ---

      if (action === 'toggleSidebar') {
        e.preventDefault()
        store.toggleSidebar()
        return
      }
      if (action === 'toggleInfoPanel') {
        e.preventDefault()
        store.toggleInfoPanel()
        return
      }
      if (action === 'toggleToolbar') {
        e.preventDefault()
        store.toggleToolbar()
        return
      }
      if (action === 'toggleStatusbar') {
        e.preventDefault()
        store.toggleStatusbar()
        return
      }
      if (action === 'toggleFullscreen') {
        e.preventDefault()
        window.api.toggleFullscreen()
        return
      }

      // ── Tab shortcuts (global, work regardless of focus region) ──
      // Cmd+T = new tab, Cmd+W = close tab, Ctrl+Tab / Cmd+Shift+] = next tab,
      // Ctrl+Shift+Tab / Cmd+Shift+[ = previous tab
      if (keyStr === 'meta+t' || keyStr === 'ctrl+t') {
        e.preventDefault()
        // Open folder picker, then create tab with chosen folder
        window.api.pickFolder().then((folder: string | null) => {
          if (folder) {
            useGalleryStore.getState().createTab(folder)
            loadFolder(folder)
          }
        })
        return
      }
      if (keyStr === 'meta+w' || keyStr === 'ctrl+w') {
        e.preventDefault()
        if (store.tabs.length > 1) {
          const tab = store.tabs.find((t) => t.id === store.activeTabId)
          const label = tab?.displayName || tab?.rootPath.split('/').pop() || 'this tab'
          if (window.confirm(`Close "${label}"?`)) {
            store.closeTab(store.activeTabId)
          }
        }
        return
      }
      if (keyStr === 'ctrl+tab' || keyStr === 'meta+shift+]') {
        e.preventDefault()
        const idx = store.tabs.findIndex((t) => t.id === store.activeTabId)
        const next = store.tabs[(idx + 1) % store.tabs.length]
        if (next) store.switchTab(next.id)
        return
      }
      if (keyStr === 'ctrl+shift+tab' || keyStr === 'meta+shift+[') {
        e.preventDefault()
        const idx = store.tabs.findIndex((t) => t.id === store.activeTabId)
        const prev = store.tabs[(idx - 1 + store.tabs.length) % store.tabs.length]
        if (prev) store.switchTab(prev.id)
        return
      }

      if (action === 'switchFocus') {
        e.preventDefault()
        const newRegion = store.focusRegion === 'gallery' ? 'sidebar' : 'gallery'
        store.setFocusRegion(newRegion)
        if (newRegion === 'gallery' && store.activeIndex === null && files.length > 0) {
          store.selectIndex(0)
        }
        return
      }

      // --- Gallery-scoped shortcuts ---

      if (store.focusRegion !== 'gallery') return

      // Don't hijack input elements in the toolbar
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return

      const fileCount = files.length
      if (fileCount === 0) return

      const el = containerRef.current
      if (!el) return

      const { tileSize, gapSize } = store
      const columns = Math.max(1, Math.floor(el.clientWidth / (tileSize + gapSize)))

      // Helper: navigate to a new index, using selectIndex (plain) or
      // rangeSelect (Shift held) so Shift+Arrow extends the selection.
      const navigate = (newIdx: number): void => {
        const clamped = Math.max(0, Math.min(fileCount - 1, newIdx))
        if (e.shiftKey) {
          store.rangeSelect(clamped)
        } else {
          store.selectIndex(clamped)
        }
        scrollToIndex(el, columns, tileSize, gapSize)
      }

      // Enter always opens lightbox (not remappable) — prevents the browser
      // from firing a synthetic click on the focused grid div, which would
      // flash the focus outline.
      if (keyStr === 'enter') {
        e.preventDefault()
        if (store.activeIndex !== null) {
          store.openLightbox()
        }
        return
      }

      switch (action) {
        case 'navLeft': {
          e.preventDefault()
          navigate((store.activeIndex ?? 0) - 1)
          break
        }
        case 'navRight': {
          e.preventDefault()
          navigate((store.activeIndex ?? -1) + 1)
          break
        }
        case 'navUp': {
          e.preventDefault()
          navigate((store.activeIndex ?? columns) - columns)
          break
        }
        case 'navDown': {
          e.preventDefault()
          navigate((store.activeIndex ?? -columns) + columns)
          break
        }
        case 'openLightbox': {
          e.preventDefault()
          if (store.activeIndex !== null) {
            store.openLightbox()
          }
          break
        }
        case 'clearSelection': {
          // Escape has layered behavior:
          // 1. If a stack is expanded, collapse it first
          // 2. Otherwise, clear the selection
          if (store.expandedStackId !== null) {
            store.setExpandedStackId(null)
          } else {
            store.clearSelection()
          }
          break
        }
      }
    }

    document.addEventListener('keydown', handleKeydown)
    return () => document.removeEventListener('keydown', handleKeydown)
  }, [containerRef, files.length])
}

// Scroll the container so the selected item is visible.
// Uses approximate row position since masonic handles exact layout internally.
function scrollToIndex(
  el: HTMLDivElement,
  columns: number,
  tileSize: number,
  gapSize: number
): void {
  // Re-read from store since selectIndex/rangeSelect may have clamped the value
  const actualIndex = useGalleryStore.getState().activeIndex
  if (actualIndex === null) return

  const row = Math.floor(actualIndex / columns)
  const rowTop = row * (tileSize + gapSize)
  const rowBottom = rowTop + tileSize

  if (rowTop < el.scrollTop) {
    el.scrollTo({ top: rowTop, behavior: 'smooth' })
  } else if (rowBottom > el.scrollTop + el.clientHeight) {
    el.scrollTo({ top: rowBottom - el.clientHeight, behavior: 'smooth' })
  }
}
