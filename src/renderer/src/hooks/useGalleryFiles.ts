import { useEffect, useMemo, useState } from 'react'
import { useGalleryStore } from '../stores/gallery.store'
import type { FileEntry, GalleryItem, SortField, SortDirection } from '../types/models'

// Custom hook: encapsulates the logic of fetching files from the main process
// and applying client-side sorting. Components that need files just call
// useGalleryFiles() — they don't need to know about IPC or sorting internals.

// Module-level cache of the last processed (sorted, filtered, stack-collapsed)
// file list. Updated every time useMemo recalculates inside useGalleryFiles.
//
// Why a module variable instead of putting this in the store?
// selectedIndices stores indices into the PROCESSED array (the one masonic renders),
// but action handlers (stack, hide, etc.) need to look up the actual file at each
// index. They can't call useGalleryFiles() (hooks aren't allowed in callbacks).
// A module variable is set synchronously during render — always in sync, no extra
// re-renders, no stale data.
let _displayFiles: GalleryItem[] = []

/** Get the current processed gallery items. Safe to call from event handlers. */
export function getDisplayFiles(): GalleryItem[] {
  return _displayFiles
}

function sortFiles(files: FileEntry[], field: SortField, direction: SortDirection): FileEntry[] {
  const sorted = [...files].sort((a, b) => {
    let comparison = 0
    switch (field) {
      case 'filename':
        comparison = a.filename.localeCompare(b.filename, undefined, { numeric: true })
        break
      case 'modifiedAt':
        comparison = a.modifiedAt.localeCompare(b.modifiedAt)
        break
      case 'createdAt':
        comparison = a.createdAt.localeCompare(b.createdAt)
        break
      case 'sizeBytes':
        comparison = a.sizeBytes - b.sizeBytes
        break
      case 'folder': {
        // Sort by parent folder name, then filename within each folder
        const folderA = a.path.substring(0, a.path.lastIndexOf('/'))
        const folderB = b.path.substring(0, b.path.lastIndexOf('/'))
        comparison = folderA.localeCompare(folderB, undefined, { numeric: true })
        if (comparison === 0) {
          comparison = a.filename.localeCompare(b.filename, undefined, { numeric: true })
        }
        break
      }
    }
    return direction === 'asc' ? comparison : -comparison
  })
  return sorted
}

export function useGalleryFiles(): { files: GalleryItem[]; isLoading: boolean } {
  const currentPath = useGalleryStore((s) => s.currentPath)
  const files = useGalleryStore((s) => s.files)
  const sortField = useGalleryStore((s) => s.sortField)
  const sortDirection = useGalleryStore((s) => s.sortDirection)
  const isScanning = useGalleryStore((s) => s.isScanning)
  const scanVersion = useGalleryStore((s) => s.scanVersion)
  const setFiles = useGalleryStore((s) => s.setFiles)
  const filterExtensions = useGalleryStore((s) => s.filterExtensions)
  const filterMinSize = useGalleryStore((s) => s.filterMinSize)
  const filterMaxSize = useGalleryStore((s) => s.filterMaxSize)
  const filterMinDimension = useGalleryStore((s) => s.filterMinDimension)
  const showHidden = useGalleryStore((s) => s.showHidden)
  const expandedStackId = useGalleryStore((s) => s.expandedStackId)

  // Track whether we're fetching files from the main process.
  // This prevents a flash of "No images found" when navigating between folders.
  const [isFetchingFiles, setIsFetchingFiles] = useState(false)

  // Re-runs when currentPath changes (user navigates), when scanVersion
  // increments (scan just finished), or when showHidden toggles (need to
  // re-fetch from DB to include/exclude hidden files).
  useEffect(() => {
    if (!currentPath) return

    setIsFetchingFiles(true)
    window.api.getFiles(currentPath, showHidden).then((fetchedFiles) => {
      // Map DB row format (snake_case) to our TypeScript interface (camelCase)
      const mapped: FileEntry[] = (fetchedFiles as Record<string, unknown>[]).map((f) => ({
        id: f.id as number,
        path: f.path as string,
        filename: f.filename as string,
        extension: f.extension as string,
        folderId: f.folder_id as number,
        sizeBytes: f.size_bytes as number,
        modifiedAt: f.modified_at as string,
        createdAt: f.created_at as string,
        width: (f.width as number) ?? null,
        height: (f.height as number) ?? null,
        hidden: Boolean(f.hidden),
        stackId: (f.stack_id as number) ?? null,
        stackOrder: (f.stack_order as number) ?? 0,
        thumbnailPath: (f.thumbnail_path as string) ?? null,
        thumbnailGenerated: Boolean(f.thumbnail_generated),
        thumbnailError: (f.thumbnail_error as string) ?? null
      }))
      setFiles(mapped)
      setIsFetchingFiles(false)
    })
  }, [currentPath, scanVersion, showHidden, setFiles])

  // useMemo: sort → filter → collapse stacks.
  // Stack collapsing: when no stack is expanded, each stack is represented by
  // its cover file with a stackCount badge. When a stack is expanded, its files
  // are shown individually and other stacks remain collapsed.
  const processedFiles = useMemo(() => {
    let result: FileEntry[] = sortFiles(files, sortField, sortDirection)

    // filterExtensions now stores extensions to *exclude* (unchecked in the
    // checkbox list). This is the inverse of the old single-select model.
    if (filterExtensions.length > 0) {
      const excluded = new Set(filterExtensions)
      result = result.filter((f) => !excluded.has(f.extension))
    }
    if (filterMinSize !== null) {
      result = result.filter((f) => f.sizeBytes >= filterMinSize)
    }
    if (filterMaxSize !== null) {
      result = result.filter((f) => f.sizeBytes <= filterMaxSize)
    }
    if (filterMinDimension !== null) {
      result = result.filter((f) =>
        f.width !== null && f.height !== null &&
        Math.min(f.width, f.height) >= filterMinDimension
      )
    }

    // --- Stack collapsing ---
    // Group files by stackId to count members and identify covers.
    const stackGroups = new Map<number, FileEntry[]>()
    for (const file of result) {
      if (file.stackId !== null) {
        const group = stackGroups.get(file.stackId)
        if (group) {
          group.push(file)
        } else {
          stackGroups.set(file.stackId, [file])
        }
      }
    }

    // Only collapse if there are any stacks
    if (stackGroups.size > 0) {
      const galleryItems: GalleryItem[] = []
      const seenStackIds = new Set<number>()

      for (const file of result) {
        if (file.stackId === null) {
          // Not in a stack — pass through unchanged
          galleryItems.push(file)
        } else if (file.stackId === expandedStackId) {
          // This stack is expanded — show all its files individually.
          // Mark the cover so the tile can render it prominently.
          const group = stackGroups.get(file.stackId)!
          const coverFile = group.reduce((a, b) => a.stackOrder <= b.stackOrder ? a : b)
          galleryItems.push({
            ...file,
            isExpandedCover: file.id === coverFile.id
          })
        } else {
          // Collapsed stack — show only the first file as the cover
          if (!seenStackIds.has(file.stackId)) {
            seenStackIds.add(file.stackId)
            const group = stackGroups.get(file.stackId)!
            // Use the first file in sort order as the cover
            // (the file with the lowest stackOrder within the group)
            const cover = group.reduce((a, b) => a.stackOrder <= b.stackOrder ? a : b)
            galleryItems.push({ ...cover, stackCount: group.length })
          }
          // Skip non-cover files in collapsed stacks
        }
      }

      return galleryItems
    }

    return result
  }, [files, sortField, sortDirection, filterExtensions, filterMinSize, filterMaxSize, filterMinDimension, expandedStackId])

  // Keep the module-level cache in sync so action handlers can look up files
  // by index without calling this hook.
  _displayFiles = processedFiles

  return { files: processedFiles, isLoading: isScanning || isFetchingFiles }
}
