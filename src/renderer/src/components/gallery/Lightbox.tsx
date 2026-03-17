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

const BROWSER_RENDERABLE = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'])

export function Lightbox(): JSX.Element | null {
  const lightboxOpen = useGalleryStore((s) => s.lightboxOpen)
  const activeIndex = useGalleryStore((s) => s.activeIndex)
  const closeLightbox = useGalleryStore((s) => s.closeLightbox)
  const selectIndex = useGalleryStore((s) => s.selectIndex)
  const { files } = useGalleryFiles()

  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [loaded, setLoaded] = useState(false)
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const overlayRef = useRef<HTMLDivElement>(null)

  const file = lightboxOpen && activeIndex !== null ? files[activeIndex] : null

  // Resolve image source — use thumbnail for non-browser-renderable formats,
  // then progressively load a high-res preview via sips
  useEffect(() => {
    if (!file) {
      setImageSrc(null)
      setPreviewLoading(false)
      return
    }

    const fileId = file.id

    if (BROWSER_RENDERABLE.has(file.extension)) {
      setImageSrc(`local-file://${file.path}`)
      setPreviewLoading(false)
    } else {
      // Phase 1: Show low-res thumbnail immediately
      setPreviewLoading(true)
      window.api.getThumbnail(file.id).then((thumbPath) => {
        if (thumbPath) {
          setImageSrc(`local-file://${thumbPath}`)
        }
      })

      // Phase 2: Render high-res preview in parallel
      window.api.renderPreview(file.id, 2048).then((previewPath) => {
        // Only swap if we're still viewing the same file
        const current = useGalleryStore.getState()
        const currentFile = current.activeIndex !== null ? files[current.activeIndex] : null
        if (currentFile && currentFile.id === fileId && previewPath) {
          setImageSrc(`local-file://${previewPath}`)
          setLoaded(false) // trigger re-load for new image
        }
        setPreviewLoading(false)
      }).catch(() => {
        setPreviewLoading(false)
      })
    }
  }, [file?.id, file?.extension, file?.path])

  // Reset zoom/pan when image changes
  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setLoaded(false)
  }, [activeIndex])

  // Keyboard: Escape, Left/Right arrows, Cmd+/-
  useEffect(() => {
    if (!lightboxOpen) return

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

  if (!lightboxOpen || !file) return null

  const cursor = zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'default'
  const isThumbnailOnly = !BROWSER_RENDERABLE.has(file.extension)

  // For non-browser-renderable files (PSD, TIFF), set explicit dimensions from
  // file metadata so the low-res thumbnail is CSS-scaled to match the eventual
  // high-res preview, reducing visual "pop" when the swap happens.
  const sizeStyle: React.CSSProperties = {}
  if (isThumbnailOnly && previewLoading && file.width && file.height) {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const scale = Math.min(1, vw / file.width, vh / file.height)
    sizeStyle.width = `${Math.round(file.width * scale)}px`
    sizeStyle.height = `${Math.round(file.height * scale)}px`
    sizeStyle.objectFit = 'contain'
  }

  return createPortal(
    <div
      className="lightbox-overlay"
      ref={overlayRef}
      onClick={handleOverlayClick}
      style={{ cursor }}
    >
      {loaded ? null : <div className="lightbox-loading">Loading...</div>}
      {imageSrc && (
        <img
          key={imageSrc}
          src={imageSrc}
          alt={file.filename}
          className="lightbox-image"
          style={{
            transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
            opacity: loaded ? 1 : 0,
            ...sizeStyle
          }}
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(false)}
          onMouseDown={handleMouseDown}
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
