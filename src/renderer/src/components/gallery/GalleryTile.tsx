import { useState, useEffect, useCallback } from 'react'
import { useGalleryStore } from '../../stores/gallery.store'
import { useThumbnailReady } from '../../hooks/useThumbnailReady'
import { getDisplayFiles } from '../../hooks/useGalleryFiles'
import { ContextMenu } from '../layout/ContextMenu'
import type { GalleryItem } from '../../types/models'

interface GalleryTileProps {
  data: GalleryItem
  index: number // Position in the processed files array (needed for multi-select context menu)
  width: number
  isSelected: boolean
  onSelect: (e: React.MouseEvent) => void
}

export function GalleryTile({ data, index, width, isSelected, onSelect }: GalleryTileProps): JSX.Element {
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [hasCachedThumb, setHasCachedThumb] = useState(false)
  const [noThumbnail, setNoThumbnail] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const cropToAspect = useGalleryStore((s) => s.cropToAspect)
  const showLabels = useGalleryStore((s) => s.showLabels)
  const thumbnailVersion = useGalleryStore((s) => s.thumbnailVersion)
  const openLightbox = useGalleryStore((s) => s.openLightbox)
  const incrementScanVersion = useGalleryStore((s) => s.incrementScanVersion)
  const setExpandedStackId = useGalleryStore((s) => s.setExpandedStackId)
  const expandedStackId = useGalleryStore((s) => s.expandedStackId)

  const isStackCover = (data.stackCount ?? 0) > 1
  const isInsideExpandedStack = data.stackId !== null && data.stackId === expandedStackId

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [])

  const handleClick = useCallback((e: React.MouseEvent) => {
    onSelect(e)
  }, [onSelect])

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    onSelect(e)
    if (isStackCover) {
      // Double-click on a stack cover expands the stack instead of opening lightbox
      setExpandedStackId(data.stackId)
    } else {
      openLightbox()
    }
  }, [onSelect, openLightbox, isStackCover, setExpandedStackId, data.stackId])

  // Subscribe to the pub/sub system — this is a lightweight in-memory
  // subscription, NOT an IPC listener. One global IPC listener feeds all tiles.
  const thumbnailReady = useThumbnailReady(data.id, hasCachedThumb)

  // Request thumbnail. Runs on mount, when thumbnailReady flips to true
  // (background worker finished), or when thumbnailVersion changes (reset).
  useEffect(() => {
    let cancelled = false

    setImageSrc(null)
    setLoaded(false)
    setNoThumbnail(false)
    setHasCachedThumb(false)

    window.api.getThumbnail(data.id).then((thumbPath) => {
      if (cancelled) return
      if (!thumbPath) {
        setNoThumbnail(true)
        return
      }
      setNoThumbnail(false)
      setImageSrc(`local-file://${thumbPath}`)
      setHasCachedThumb(thumbPath.endsWith(`${data.id}.jpg`))
    })

    return () => { cancelled = true }
  }, [data.id, thumbnailReady, thumbnailVersion])

  const tileHeight = cropToAspect ? width : undefined

  return (
    <div
      className={`gallery-tile ${isSelected ? 'gallery-tile--selected' : ''} ${data.hidden ? 'gallery-tile--hidden' : ''} ${data.isExpandedCover ? 'gallery-tile--stack-cover' : ''} ${isInsideExpandedStack && !data.isExpandedCover ? 'gallery-tile--stack-member' : ''}`}
      style={{ width }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
    >
      <div
        className="gallery-tile-image-container"
        style={tileHeight ? { height: tileHeight } : undefined}
      >
        {imageSrc ? (
          <img
            src={imageSrc}
            alt={data.filename}
            className={`gallery-tile-image ${loaded ? 'gallery-tile-image--loaded' : ''}`}
            style={{ objectFit: cropToAspect ? 'cover' : 'contain' }}
            onLoad={() => setLoaded(true)}
            onError={() => {
              setImageSrc(null)
              setNoThumbnail(true)
            }}
            loading="lazy"
          />
        ) : noThumbnail ? (
          <div className="gallery-tile-placeholder gallery-tile-placeholder--unsupported">
            <span className="gallery-tile-ext">{data.extension}</span>
          </div>
        ) : (
          <div className="gallery-tile-placeholder gallery-tile-placeholder--loading" />
        )}
      </div>
      {isStackCover && (
        <div className="gallery-tile-stack-badge">{data.stackCount}</div>
      )}
      {showLabels && (
        <div className="gallery-tile-label" title={data.filename}>
          {data.filename}
        </div>
      )}
      {contextMenu && (() => {
        // Snapshot store state for context menu logic
        const store = useGalleryStore.getState()
        const displayFiles = getDisplayFiles()
        const isMultiSelected = isSelected && store.selectedIndices.size > 1
        const selCount = store.selectedIndices.size

        // Collect stack IDs from the full selection (for multi-select Unstack)
        const stackIdsInSelection = new Set<number>()
        if (isMultiSelected) {
          for (const idx of store.selectedIndices) {
            const f = displayFiles[idx]
            if (f?.stackId) stackIdsInSelection.add(f.stackId)
          }
        }

        const isInStack = data.stackId !== null

        // ── Hide / Unhide ──
        // Only show actions that make sense for the current selection:
        // "Hide" appears when at least one selected file is visible,
        // "Unhide" appears when at least one selected file is hidden.
        const hideUnhideItems: { label: string; onClick: () => void }[] = []
        if (isMultiSelected) {
          let hasVisible = false
          let hasHidden = false
          for (const idx of store.selectedIndices) {
            const f = displayFiles[idx]
            if (f?.hidden) hasHidden = true
            else if (f) hasVisible = true
          }
          if (hasVisible) {
            hideUnhideItems.push({
              label: `Hide ${selCount} Images`,
              onClick: () => {
                const promises = Array.from(store.selectedIndices).map((idx) => {
                  const file = displayFiles[idx]
                  if (file) return window.api.setHidden(file.id, 'file', true)
                  return Promise.resolve()
                })
                Promise.all(promises).then(() => { store.clearSelection(); incrementScanVersion() })
              }
            })
          }
          if (hasHidden) {
            hideUnhideItems.push({
              label: `Unhide ${selCount} Images`,
              onClick: () => {
                const promises = Array.from(store.selectedIndices).map((idx) => {
                  const file = displayFiles[idx]
                  if (file) return window.api.setHidden(file.id, 'file', false)
                  return Promise.resolve()
                })
                Promise.all(promises).then(() => { store.clearSelection(); incrementScanVersion() })
              }
            })
          }
        } else {
          hideUnhideItems.push({
            label: data.hidden ? 'Unhide Image' : 'Hide Image',
            onClick: () => {
              window.api.setHidden(data.id, 'file', !data.hidden).then(() => incrementScanVersion())
            }
          })
        }

        // ── Stack / Unstack ──
        const stackItems: { label: string; onClick: () => void }[] = []

        // "Stack" — available when multi-selected, but not inside an expanded
        // stack (those files are already stacked).
        if (isMultiSelected && !isInsideExpandedStack) {
          stackItems.push({
            label: `Stack ${selCount} Images`,
            onClick: () => {
              const fileIds: number[] = [data.id]
              let folderId: number | null = data.folderId
              for (const idx of store.selectedIndices) {
                const file = displayFiles[idx]
                if (file && file.id !== data.id) {
                  fileIds.push(file.id)
                  if (folderId === null) folderId = file.folderId
                }
              }
              if (folderId !== null && fileIds.length >= 2) {
                window.api.createStack(folderId, fileIds).then(() => {
                  store.clearSelection()
                  incrementScanVersion()
                })
              }
            }
          })
        }

        // "Unstack" — dissolve stacks. Multi-select: dissolve all stacks in selection.
        // Single: dissolve the stack this file belongs to.
        if (isMultiSelected && stackIdsInSelection.size > 0) {
          stackItems.push({
            label: 'Unstack',
            onClick: () => {
              Promise.all(
                Array.from(stackIdsInSelection).map((sid) => window.api.dissolveStack(sid))
              ).then(() => { store.clearSelection(); incrementScanVersion() })
            }
          })
        } else if (!isMultiSelected && isInStack) {
          stackItems.push({
            label: 'Unstack',
            onClick: () => {
              window.api.dissolveStack(data.stackId!).then(() => incrementScanVersion())
            }
          })
        }

        // "Expand Stack" on collapsed covers / "Collapse Stack" inside expanded
        if (isStackCover) {
          stackItems.push({
            label: 'Expand Stack',
            onClick: () => setExpandedStackId(data.stackId)
          })
        }
        if (isInsideExpandedStack) {
          stackItems.push({
            label: 'Collapse Stack',
            onClick: () => setExpandedStackId(null)
          })
        }

        // "Set as Cover" — only inside an expanded stack where you can see
        // all members. On a collapsed cover you can only see the current cover
        // so the option would be confusing.
        if (isInsideExpandedStack && !isMultiSelected) {
          stackItems.push({
            label: 'Set as Cover',
            onClick: () => {
              window.api.setStackCover(data.stackId!, data.id).then(() => incrementScanVersion())
            }
          })
        }

        // "Remove from Stack" — when viewing inside an expanded stack
        if (isInsideExpandedStack) {
          stackItems.push({
            label: 'Remove from Stack',
            onClick: () => {
              window.api.removeFromStack(data.id).then(() => incrementScanVersion())
            }
          })
        }

        return (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={[
              { label: 'Show in Finder', onClick: () => window.api.showItemInFolder(data.path) },
              {
                label: 'Reveal in Sidebar',
                onClick: () => {
                  const folderPath = data.path.substring(0, data.path.lastIndexOf('/'))
                  const s = useGalleryStore.getState()
                  s.setCurrentPath(folderPath)
                  s.setRevealPath(folderPath)
                }
              },
              ...hideUnhideItems,
              ...stackItems
            ]}
            onClose={() => setContextMenu(null)}
          />
        )
      })()}
    </div>
  )
}
