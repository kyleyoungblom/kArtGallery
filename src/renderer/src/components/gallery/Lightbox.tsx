import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useGalleryStore } from '../../stores/gallery.store'
import { useGalleryFiles } from '../../hooks/useGalleryFiles'

// Full-size image viewer overlay.
// Opens when lightboxOpen is true, shows the file at activeIndex.
//
// For browser-renderable formats (jpg, png, gif, webp, svg, bmp) we load the
// original file at full resolution. For non-renderable formats (PSD, TIFF) we
// load the cached thumbnail — Chromium can't decode these, but macOS Quick Look
// can because it uses Core Graphics which has native PSD/TIFF support.
//
// Image transitions when cycling:
// We use two layered <img> elements — the "current" (visible) and the "incoming"
// (loading behind the scenes). When the incoming image finishes loading, it
// becomes the new current and the old one is discarded. This means the previous
// image stays visible until the next one is ready, eliminating flicker.

const BROWSER_RENDERABLE = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'])

export function Lightbox(): JSX.Element | null {
  const lightboxOpen = useGalleryStore((s) => s.lightboxOpen)
  const activeIndex = useGalleryStore((s) => s.activeIndex)
  const closeLightbox = useGalleryStore((s) => s.closeLightbox)
  const selectIndex = useGalleryStore((s) => s.selectIndex)
  const lightboxFitToScreen = useGalleryStore((s) => s.lightboxFitToScreen)
  const { files } = useGalleryFiles()

  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [previewLoading, setPreviewLoading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const overlayRef = useRef<HTMLDivElement>(null)

  // Track whether the lightbox just opened so we only play the zoom-in
  // animation on first open, not when cycling between images with arrows.
  const justOpened = useRef(false)

  // Two-layer image state: currentSrc is what's visible, incomingSrc is loading.
  // When incoming finishes loading, it replaces current (no flicker).
  const [currentSrc, setCurrentSrc] = useState<string | null>(null)
  const [incomingSrc, setIncomingSrc] = useState<string | null>(null)
  const [currentLoaded, setCurrentLoaded] = useState(false)

  const file = lightboxOpen && activeIndex !== null ? files[activeIndex] : null

  // ── IMPORTANT: Effect declaration order matters! ──
  //
  // React fires useEffect hooks in declaration order within the same commit.
  // When lightboxOpen changes, both effects below fire. The reset effect MUST
  // run first so it sets justOpened.current = true before the file resolution
  // effect reads it. If the order is reversed, justOpened is still false when
  // the file effect runs → it sets incomingSrc instead of currentSrc → the
  // reset effect then wipes incomingSrc → stuck on "Loading..." forever.

  // Effect 1: Reset image state when lightbox opens.
  // Sets justOpened ref so the file resolution effect knows to set currentSrc
  // directly (instead of using the incoming layer for flicker-free cycling).
  useEffect(() => {
    if (lightboxOpen) {
      justOpened.current = true
      // Reset image state for fresh open. These may be overwritten by the
      // file resolution effect below (which runs after this in the same commit).
      setCurrentSrc(null)
      setIncomingSrc(null)
      setCurrentLoaded(false)
    }
  }, [lightboxOpen])

  // Effect 2: Resolve image source for the current file.
  // On fresh open (justOpened ref = true), sets currentSrc directly.
  // When cycling between images, sets incomingSrc so the previous image
  // stays visible until the new one finishes loading (no flicker).
  useEffect(() => {
    if (!file) {
      setCurrentSrc(null)
      setIncomingSrc(null)
      setCurrentLoaded(false)
      setPreviewLoading(false)
      return
    }

    const fileId = file.id
    const isFreshOpen = justOpened.current

    if (BROWSER_RENDERABLE.has(file.extension)) {
      const src = `local-file://${file.path}`
      if (isFreshOpen) {
        setCurrentSrc(src)
        setCurrentLoaded(false)
      } else {
        setIncomingSrc(src)
      }
      setPreviewLoading(false)
    } else {
      // Phase 1: Show low-res thumbnail immediately
      setPreviewLoading(true)
      window.api.getThumbnail(file.id).then((thumbPath) => {
        if (thumbPath) {
          const src = `local-file://${thumbPath}`
          if (isFreshOpen) {
            setCurrentSrc(src)
            setCurrentLoaded(false)
          } else {
            setIncomingSrc(src)
          }
        }
      })

      // Phase 2: Render high-res preview in parallel
      window.api.renderPreview(file.id, 2048).then((previewPath) => {
        // Only swap if we're still viewing the same file
        const current = useGalleryStore.getState()
        const currentFile = current.activeIndex !== null ? files[current.activeIndex] : null
        if (currentFile && currentFile.id === fileId && previewPath) {
          setIncomingSrc(`local-file://${previewPath}`)
        }
        setPreviewLoading(false)
      }).catch(() => {
        setPreviewLoading(false)
      })
    }
  // lightboxOpen included so the effect re-runs when re-opening on the same image.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.id, file?.extension, file?.path, lightboxOpen])

  // Reset zoom/pan when image changes
  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [activeIndex])

  // Keyboard: Escape, arrows, Cmd+/-
  // Left/Right = previous/next image (linear)
  // Up/Down = jump by column count (matches grid row navigation)
  useEffect(() => {
    if (!lightboxOpen) return

    function getColumnCount(): number {
      // Replicate masonic's column calculation from tileSize, gapSize, and
      // the gallery container width (viewport minus sidebar and info panel).
      const store = useGalleryStore.getState()
      const sidebarW = store.sidebarCollapsed ? 36 : 240
      const infoW = store.infoPanelOpen ? 280 : 0
      const containerW = window.innerWidth - sidebarW - infoW - 16 // 16 = grid padding
      return Math.max(1, Math.floor((containerW + store.gapSize) / (store.tileSize + store.gapSize)))
    }

    function handleKeydown(e: KeyboardEvent): void {
      switch (e.key) {
        case 'Escape':
          closeLightbox()
          break
        case 'ArrowLeft':
          e.preventDefault()
          if (activeIndex !== null && activeIndex > 0) {
            selectIndex(activeIndex - 1)
          }
          break
        case 'ArrowRight':
          e.preventDefault()
          if (activeIndex !== null && activeIndex < files.length - 1) {
            selectIndex(activeIndex + 1)
          }
          break
        case 'ArrowUp': {
          e.preventDefault()
          const cols = getColumnCount()
          if (activeIndex !== null && activeIndex - cols >= 0) {
            selectIndex(activeIndex - cols)
          }
          break
        }
        case 'ArrowDown': {
          e.preventDefault()
          const cols = getColumnCount()
          if (activeIndex !== null && activeIndex + cols < files.length) {
            selectIndex(activeIndex + cols)
          }
          break
        }
        case '=':
        case '+':
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault()
            setZoom((z) => Math.min(10, z * 1.25))
          }
          break
        case '-':
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault()
            setZoom((z) => {
              const next = z * 0.8
              if (next <= 1.05) {
                setPan({ x: 0, y: 0 })
                return 1
              }
              return next
            })
          }
          break
      }
    }

    document.addEventListener('keydown', handleKeydown)
    return () => document.removeEventListener('keydown', handleKeydown)
  }, [lightboxOpen, activeIndex, files.length, closeLightbox, selectIndex])

  // Wheel handler: Cmd/Ctrl+wheel = zoom (center-based), plain wheel when zoomed = pan
  useEffect(() => {
    if (!lightboxOpen) return
    const el = overlayRef.current
    if (!el) return

    function handleWheel(e: WheelEvent): void {
      // Pinch-to-zoom on macOS trackpad fires with ctrlKey: true
      const isZoomGesture = e.metaKey || e.ctrlKey

      if (isZoomGesture) {
        e.preventDefault()

        setZoom((prevZoom) => {
          const factor = e.deltaY < 0 ? 1.1 : 0.9
          const nextZoom = Math.max(0.5, Math.min(10, prevZoom * factor))

          if (nextZoom <= 1.05) {
            setPan({ x: 0, y: 0 })
            return 1
          }
          return nextZoom
        })
      } else {
        // Two-finger scroll/pan on trackpad when zoomed in
        setZoom((currentZoom) => {
          if (currentZoom > 1) {
            e.preventDefault()
            setPan((prev) => ({
              x: prev.x - e.deltaX,
              y: prev.y - e.deltaY
            }))
          }
          return currentZoom
        })
      }
    }

    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [lightboxOpen])

  // Click-and-drag pan
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (zoom <= 1) return
    e.preventDefault()
    setDragging(true)
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
  }, [zoom, pan])

  useEffect(() => {
    if (!dragging) return

    function handleMouseMove(e: MouseEvent): void {
      const dx = e.clientX - dragStart.current.x
      const dy = e.clientY - dragStart.current.y
      setPan({ x: dragStart.current.panX + dx, y: dragStart.current.panY + dy })
    }

    function handleMouseUp(): void {
      setDragging(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragging])

  // Click overlay to close (only if not zoomed and not dragging)
  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget && zoom <= 1) {
      closeLightbox()
    }
  }, [zoom, closeLightbox])

  // When incoming image loads, promote it to current (flicker-free swap)
  const handleIncomingLoad = useCallback(() => {
    setCurrentSrc(incomingSrc)
    setCurrentLoaded(true)
    setIncomingSrc(null)
    justOpened.current = false
  }, [incomingSrc])

  // When current image loads (first image on open)
  const handleCurrentLoad = useCallback(() => {
    setCurrentLoaded(true)
    justOpened.current = false
  }, [])

  if (!lightboxOpen || !file) return null

  const cursor = zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'default'
  const isThumbnailOnly = !BROWSER_RENDERABLE.has(file.extension)

  // Compute explicit sizing for the lightbox image.
  //
  // Two cases where we need to set explicit dimensions:
  // 1. Non-browser-renderable files (PSD, TIFF): force the thumbnail to display
  //    at the file's real dimensions so it doesn't "pop" when the full preview loads.
  // 2. "Fit to screen" mode: scale any image (even small ones) up to fill the
  //    viewport while maintaining aspect ratio via object-fit: contain.
  const sizeStyle: React.CSSProperties = {}
  if (lightboxFitToScreen) {
    // Scale up to fill viewport — object-fit: contain keeps aspect ratio
    sizeStyle.width = '100vw'
    sizeStyle.height = '100vh'
    sizeStyle.objectFit = 'contain'
  } else if (isThumbnailOnly && file.width && file.height) {
    // Only scale down (never up) for non-renderable formats
    const vw = window.innerWidth
    const vh = window.innerHeight
    const scale = Math.min(1, vw / file.width, vh / file.height)
    sizeStyle.width = `${Math.round(file.width * scale)}px`
    sizeStyle.height = `${Math.round(file.height * scale)}px`
    sizeStyle.objectFit = 'contain'
  }

  const transformStyle = `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`

  return createPortal(
    <div
      className="lightbox-overlay"
      ref={overlayRef}
      onClick={handleOverlayClick}
      style={{ cursor }}
    >
      {!currentLoaded && <div className="lightbox-loading">Loading...</div>}

      {/* Current image — always visible once loaded */}
      {currentSrc && (
        <img
          key={currentSrc}
          src={currentSrc}
          alt={file.filename}
          className={`lightbox-image${justOpened.current ? ' lightbox-image--entering' : ''}`}
          style={{
            transform: transformStyle,
            opacity: currentLoaded ? 1 : 0,
            ...sizeStyle
          }}
          onLoad={handleCurrentLoad}
          onError={() => setCurrentLoaded(false)}
          onMouseDown={handleMouseDown}
          draggable={false}
        />
      )}

      {/* Incoming image — hidden, loading behind the scenes.
          When it finishes loading, handleIncomingLoad promotes it to current. */}
      {incomingSrc && incomingSrc !== currentSrc && (
        <img
          key={incomingSrc}
          src={incomingSrc}
          alt=""
          className="lightbox-image"
          style={{
            transform: transformStyle,
            position: 'absolute',
            opacity: 0,
            pointerEvents: 'none'
          }}
          onLoad={handleIncomingLoad}
          onError={() => setIncomingSrc(null)}
          draggable={false}
        />
      )}

      {previewLoading && (
        <div className="lightbox-preview-loading">Rendering preview...</div>
      )}
      <div className="lightbox-info">
        <span>
          {file.filename}
          {isThumbnailOnly && previewLoading ? ' (thumbnail)' : ''}
        </span>
        <span>
          {activeIndex !== null ? `${activeIndex + 1} / ${files.length}` : ''}
          {zoom !== 1 ? ` \u00B7 ${Math.round(zoom * 100)}%` : ''}
        </span>
      </div>
    </div>,
    document.body
  )
}
