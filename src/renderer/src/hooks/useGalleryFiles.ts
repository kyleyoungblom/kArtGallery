import { useEffect, useMemo } from 'react'
import { useGalleryStore } from '../stores/gallery.store'
import type { FileEntry, SortField, SortDirection } from '../types/models'

// Custom hook: encapsulates the logic of fetching files from the main process
// and applying client-side sorting. Components that need files just call
// useGalleryFiles() — they don't need to know about IPC or sorting internals.

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
    }
    return direction === 'asc' ? comparison : -comparison
  })
  return sorted
}

export function useGalleryFiles(): { files: FileEntry[]; isLoading: boolean } {
  const currentPath = useGalleryStore((s) => s.currentPath)
  const files = useGalleryStore((s) => s.files)
  const sortField = useGalleryStore((s) => s.sortField)
  const sortDirection = useGalleryStore((s) => s.sortDirection)
  const isScanning = useGalleryStore((s) => s.isScanning)
  const scanVersion = useGalleryStore((s) => s.scanVersion)
  const setFiles = useGalleryStore((s) => s.setFiles)

  // Re-runs when currentPath changes (user navigates) OR when scanVersion
  // increments (scan just finished, DB now has data to fetch).
  useEffect(() => {
    if (!currentPath) return

    window.api.getFiles(currentPath).then((fetchedFiles) => {
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
        thumbnailGenerated: Boolean(f.thumbnail_generated)
      }))
      setFiles(mapped)
    })
  }, [currentPath, scanVersion, setFiles])

  // useMemo: only re-sort when files or sort settings change.
  // Without this, sorting would run on every render — wasteful for large lists.
  const sortedFiles = useMemo(
    () => sortFiles(files, sortField, sortDirection),
    [files, sortField, sortDirection]
  )

  return { files: sortedFiles, isLoading: isScanning }
}
