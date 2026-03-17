import { useEffect, useRef } from 'react'
import { useGalleryStore } from '../stores/gallery.store'

// Handles Cmd/Ctrl+scroll, trackpad pinch, and Cmd/Ctrl+/- to change tile size.
// On macOS, trackpad pinch fires wheel events with ctrlKey: true.
// The wheel handler is on document (capture phase) so it intercepts pinch
// before Chromium's built-in zoom can consume the event.

export function useGalleryZoom(containerRef: React.RefObject<HTMLDivElement | null>): void {
  const rafRef = useRef<number | null>(null)
  const pendingDelta = useRef(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    function handleWheel(e: WheelEvent): void {
      // Only handle Cmd+scroll or trackpad pinch (ctrlKey on macOS)
      if (!e.metaKey && !e.ctrlKey) return
      if (useGalleryStore.getState().lightboxOpen) return

      e.preventDefault()
      e.stopPropagation()

      // Accumulate delta from all events between frames. Trackpad pinch
      // fires many small events per frame — dropping them (as rAF-only
      // throttling does) makes the gesture feel unresponsive.
      pendingDelta.current += -e.deltaY

      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null
          const store = useGalleryStore.getState()
          // Scale delta proportionally to current tile size so pinch feels
          // consistent at all zoom levels. Trackpad pinch deltaY is typically
          // 0.5–3 per event; Cmd+scroll is 4–12. With Chromium's built-in
          // pinch disabled (--disable-pinch flag), all events arrive unfiltered,
          // so a modest multiplier is enough.
          const scale = Math.max(store.tileSize / 200, 0.5)
          const step = Math.round(pendingDelta.current * 1.5 * scale)
          pendingDelta.current = 0
          if (step !== 0) {
            store.setTileSize(store.tileSize + step)
          }
        })
      }
    }

    function handleKeydown(e: KeyboardEvent): void {
      if (!e.metaKey && !e.ctrlKey) return
      if (useGalleryStore.getState().lightboxOpen) return
      if (useGalleryStore.getState().focusRegion !== 'gallery') return

      if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        const store = useGalleryStore.getState()
        store.setTileSize(store.tileSize + 30)
      } else if (e.key === '-') {
        e.preventDefault()
        const store = useGalleryStore.getState()
        store.setTileSize(store.tileSize - 30)
      }
    }

    // Use document-level listener with capture phase to intercept trackpad
    // pinch before Chromium's built-in zoom handler can consume it.
    document.addEventListener('wheel', handleWheel, { passive: false, capture: true })
    document.addEventListener('keydown', handleKeydown)

    return () => {
      document.removeEventListener('wheel', handleWheel, { capture: true })
      document.removeEventListener('keydown', handleKeydown)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [containerRef])
}
