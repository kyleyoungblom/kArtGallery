// Shared folder-loading workflow. Scan a folder, build its tree, and update
// the store. Used when opening a new tab, restoring tabs on startup, and
// when sync adds a folder mapping.
//
// IMPORTANT: This function does NOT navigate (no setCurrentPath call).
// Navigation is the caller's responsibility — createTab already sets
// currentPath, and calling setCurrentPath here would write through to
// whatever tab happens to be active at the time, which can corrupt
// another tab's state if called during startup restoration.

import { useGalleryStore } from '../stores/gallery.store'
import type { FolderNode } from '../types/models'

/**
 * Scan a folder, build its tree, and store the results.
 *
 * This triggers a full scan (files + thumbnails + watcher) and builds
 * the folder tree for the sidebar. It does NOT change the current
 * browsing path — callers should handle navigation separately.
 *
 * Safe to call for folders that are already scanned — scanFolder is
 * idempotent (it upserts files rather than duplicating them).
 */
export async function loadFolder(folderPath: string): Promise<void> {
  const store = useGalleryStore.getState()

  store.setIsScanning(true)

  const [tree] = await Promise.all([
    window.api.getFolderTree(folderPath),
    window.api.scanFolder(folderPath)
  ])

  store.setFolderTreeForRoot(folderPath, tree as FolderNode)
  store.setIsScanning(false)
  store.incrementScanVersion()
}
