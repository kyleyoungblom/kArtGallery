import { useGalleryStore } from '../../stores/gallery.store'
import { getDisplayFiles } from '../../hooks/useGalleryFiles'

/**
 * Floating pill that appears at the bottom-center of the gallery when
 * multiple tiles are selected. Provides batch actions: Hide, Unhide,
 * Stack, Unstack, and Clear.
 *
 * Why a separate component instead of inside Toolbar?
 * The pill needs to float above the grid content (position: absolute)
 * which doesn't work well inside the sticky toolbar-wrapper. Keeping it
 * as a sibling to GalleryGrid within .app-main gives clean positioning.
 */
export function SelectionPill(): JSX.Element | null {
  const selectedIndices = useGalleryStore((s) => s.selectedIndices)
  const clearSelection = useGalleryStore((s) => s.clearSelection)
  const incrementScanVersion = useGalleryStore((s) => s.incrementScanVersion)

  // Use processed (sorted/filtered/collapsed) files — selectedIndices are
  // indices into this array, NOT the raw store.files array.
  const files = getDisplayFiles()

  const selectionCount = selectedIndices.size
  if (selectionCount < 2) return null

  // Check if any selected file belongs to a stack (for showing Unstack button)
  const stackIdsInSelection = new Set<number>()
  for (const idx of selectedIndices) {
    const file = files[idx]
    if (file?.stackId) stackIdsInSelection.add(file.stackId)
  }
  const hasStacked = stackIdsInSelection.size > 0

  const handleHide = (): void => {
    const promises = Array.from(selectedIndices).map((idx) => {
      const file = files[idx]
      if (file) return window.api.setHidden(file.id, 'file', true)
      return Promise.resolve()
    })
    Promise.all(promises).then(() => {
      clearSelection()
      incrementScanVersion()
    })
  }

  const handleUnhide = (): void => {
    const promises = Array.from(selectedIndices).map((idx) => {
      const file = files[idx]
      if (file) return window.api.setHidden(file.id, 'file', false)
      return Promise.resolve()
    })
    Promise.all(promises).then(() => {
      clearSelection()
      incrementScanVersion()
    })
  }

  const handleStack = (): void => {
    // The last-clicked image (activeIndex) becomes the cover.
    // createStack uses fileIds[0] as cover, so we put activeIndex first.
    const store = useGalleryStore.getState()
    const fileIds: number[] = []
    let folderId: number | null = null

    // Add active file first (it becomes the cover)
    if (store.activeIndex !== null) {
      const activeFile = files[store.activeIndex]
      if (activeFile) {
        fileIds.push(activeFile.id)
        folderId = activeFile.folderId
      }
    }

    // Add remaining selected files
    for (const idx of selectedIndices) {
      const file = files[idx]
      if (file && !fileIds.includes(file.id)) {
        fileIds.push(file.id)
        if (folderId === null) folderId = file.folderId
      }
    }

    if (folderId !== null && fileIds.length >= 2) {
      window.api.createStack(folderId, fileIds).then(() => {
        clearSelection()
        incrementScanVersion()
      })
    }
  }

  const handleUnstack = (): void => {
    // Dissolve every stack that has at least one selected member
    const promises = Array.from(stackIdsInSelection).map((stackId) =>
      window.api.dissolveStack(stackId)
    )
    Promise.all(promises).then(() => {
      clearSelection()
      incrementScanVersion()
    })
  }

  return (
    <div className="selection-pill">
      <span className="selection-pill-count">{selectionCount} selected</span>
      <div className="selection-pill-divider" />
      <button className="selection-pill-btn" onClick={handleHide} title="Hide selected images">
        Hide
      </button>
      <button className="selection-pill-btn" onClick={handleUnhide} title="Unhide selected images">
        Unhide
      </button>
      <button className="selection-pill-btn" onClick={handleStack} title="Group into a stack">
        Stack
      </button>
      {hasStacked && (
        <button className="selection-pill-btn" onClick={handleUnstack} title="Dissolve stacks in selection">
          Unstack
        </button>
      )}
      <div className="selection-pill-divider" />
      <button
        className="selection-pill-btn selection-pill-btn--clear"
        onClick={clearSelection}
        title="Clear selection"
      >
        {'\u2715'}
      </button>
    </div>
  )
}
