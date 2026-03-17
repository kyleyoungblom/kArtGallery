import { useRef, useState, useEffect, useCallback } from 'react'
import {
  usePositioner,
  useResizeObserver,
  useContainerPosition,
  useMasonry
} from 'masonic'
import type { RenderComponentProps } from 'masonic'
import { useGalleryStore } from '../../stores/gallery.store'
import { useGalleryFiles } from '../../hooks/useGalleryFiles'
import { useGalleryZoom } from '../../hooks/useGalleryZoom'
import { useGalleryKeyboard } from '../../hooks/useGalleryKeyboard'
import { Toolbar } from '../layout/Toolbar'
import { GalleryTile } from './GalleryTile'
import type { GalleryItem } from '../../types/models'

// Masonic's <Masonry> component uses window.scrollTop to determine which
// items to render. Our app scrolls inside .gallery-grid (overflow-y: auto),
// not the window. So we use the lower-level useMasonry hook with a custom
// scroll tracker that reads from the actual scrollable element.

function MasonryTile({ data, index, width }: RenderComponentProps<GalleryItem>): JSX.Element {
  const selectedIndices = useGalleryStore((s) => s.selectedIndices)
  const selectIndex = useGalleryStore((s) => s.selectIndex)
  const toggleIndex = useGalleryStore((s) => s.toggleIndex)
  const rangeSelect = useGalleryStore((s) => s.rangeSelect)

  // Dispatch modifier-aware selection:
  //   Shift+click → extend range from anchor
  //   Cmd/Ctrl+click → toggle individual item
  //   Plain click → select single item (clears rest)
  const handleSelect = useCallback((e: React.MouseEvent) => {
    if (e.shiftKey) {
      rangeSelect(index)
    } else if (e.metaKey || e.ctrlKey) {
      toggleIndex(index)
    } else {
      selectIndex(index)
    }
  }, [index, selectIndex, toggleIndex, rangeSelect])

  return (
    <GalleryTile
      data={data}
      index={index}
      width={width}
      isSelected={selectedIndices.has(index)}
      onSelect={handleSelect}
    />
  )
}

function useElementScroll(ref: React.RefObject<HTMLDivElement | null>, fps = 12): {
  scrollTop: number
  isScrolling: boolean
  height: number
} {
  const [scrollTop, setScrollTop] = useState(0)
  const [isScrolling, setIsScrolling] = useState(false)
  const [height, setHeight] = useState(0)
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    setHeight(el.clientHeight)

    const interval = 1000 / fps
    let lastUpdate = 0

    function handleScroll(): void {
      const now = performance.now()
      if (now - lastUpdate < interval) return
      lastUpdate = now

      setScrollTop(el!.scrollTop)
      setIsScrolling(true)

      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
      scrollTimerRef.current = setTimeout(() => setIsScrolling(false), 800)
    }

    const observer = new ResizeObserver(() => {
      setHeight(el.clientHeight)
    })
    observer.observe(el)

    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', handleScroll)
      observer.disconnect()
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
    }
  }, [ref, fps])

  return { scrollTop, isScrolling, height }
}

// useMasonry is a React hook (uses useEffect/useState internally), so it
// must be called unconditionally. We isolate it in its own component that
// only mounts when we have files, ensuring hooks run every render.
function MasonryGrid({
  files,
  containerRef
}: {
  files: GalleryItem[]
  containerRef: React.RefObject<HTMLDivElement | null>
}): JSX.Element {
  const masonryRef = useRef<HTMLDivElement>(null)
  const tileSize = useGalleryStore((s) => s.tileSize)
  const gapSize = useGalleryStore((s) => s.gapSize)
  const thumbnailVersion = useGalleryStore((s) => s.thumbnailVersion)
  const currentPath = useGalleryStore((s) => s.currentPath)
  const showLabels = useGalleryStore((s) => s.showLabels)
  const sidebarCollapsed = useGalleryStore((s) => s.sidebarCollapsed)
  const infoPanelOpen = useGalleryStore((s) => s.infoPanelOpen)

  const { scrollTop, isScrolling, height } = useElementScroll(containerRef)

  // Toggle scrollbar-visibility class on the container element.
  // CSS transitions handle the fade; we just toggle the class.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    if (isScrolling) {
      el.classList.add('gallery-grid--scrolling')
    } else {
      el.classList.remove('gallery-grid--scrolling')
    }
  }, [isScrolling, containerRef])

  // Track a counter that bumps after CSS transitions finish (sidebar/panel
  // open/close animate over 200ms). This forces masonic to re-measure the
  // container at its final width rather than an intermediate value.
  const [layoutVersion, setLayoutVersion] = useState(0)
  useEffect(() => {
    const timer = setTimeout(() => setLayoutVersion((v) => v + 1), 250)
    return () => clearTimeout(timer)
  }, [sidebarCollapsed, infoPanelOpen])

  // Include files.length so that any change in visible items (filters, folder
  // switch, scan) forces positioner and container position to reset. This
  // prevents the recurring black-screen bug where masonic uses stale cached
  // positions for a different set of items.
  const resetKey = `${currentPath}:${thumbnailVersion}:${files.length}:${showLabels}:${layoutVersion}`

  const { offset, width } = useContainerPosition(masonryRef, [resetKey])

  const positioner = usePositioner(
    { width: width || 1, columnWidth: tileSize, columnGutter: gapSize },
    [resetKey]
  )
  const resizeObserver = useResizeObserver(positioner)

  // Scroll to top when content changes (folder switch, thumbnail reset)
  // but NOT when file count changes from stacking/unstacking/filtering,
  // and NOT from layout shifts (sidebar/panel toggle = layoutVersion).
  const contentKey = `${currentPath}:${thumbnailVersion}:${showLabels}`
  useEffect(() => {
    containerRef.current?.scrollTo(0, 0)
  }, [contentKey, containerRef])

  return useMasonry({
    positioner,
    resizeObserver,
    items: files,
    height: height || 800,
    scrollTop: Math.max(0, scrollTop - offset),
    isScrolling,
    overscanBy: 5,
    render: MasonryTile,
    containerRef: masonryRef
  })
}

export function GalleryGrid(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const { files, isLoading } = useGalleryFiles()
  const currentPath = useGalleryStore((s) => s.currentPath)
  const setFocusRegion = useGalleryStore((s) => s.setFocusRegion)
  const toolbarVisible = useGalleryStore((s) => s.toolbarVisible)

  // Attach zoom (Cmd+scroll, Cmd+/-) and keyboard nav (arrows, Space, Esc)
  useGalleryZoom(containerRef)
  useGalleryKeyboard(containerRef, files)

  const handleFocus = useCallback(() => {
    setFocusRegion('gallery')
  }, [setFocusRegion])

  if (!currentPath) {
    return (
      <div className="gallery-empty">
        <p>Select a folder to start browsing</p>
      </div>
    )
  }

  if (isLoading && files.length === 0) {
    return (
      <div className="gallery-empty">
        <p>Loading...</p>
      </div>
    )
  }

  if (files.length === 0) {
    return (
      <div className="gallery-empty">
        <p>No images found in this folder</p>
      </div>
    )
  }

  return (
    <div
      className="gallery-grid"
      ref={containerRef}
      tabIndex={-1}
      onMouseDown={handleFocus}
      onFocus={handleFocus}
    >
      {toolbarVisible && <Toolbar />}
      <MasonryGrid files={files} containerRef={containerRef} />
    </div>
  )
}
