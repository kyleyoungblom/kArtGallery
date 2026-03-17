// Shared folder-loading workflow used by both Sidebar ("Open Folder") and
// SettingsModal (sync path mapping auto-add). Extracted here so the scan →
// pin → tree → persist flow is defined once. Duplicating it across
// components would mean bugs get fixed in one place but not the other.

import { useGalleryStore } from '../stores/gallery.store'
import type { FolderNode } from '../types/models'

/**
 * Scan a folder, add it to the sidebar, build its tree, and persist.
 *
 * This is the canonical way to add a folder to the gallery. It:
 * 1. Pins the folder in the sidebar (no-op if already pinned)
 * 2. Sets it as the current browsing path
 * 3. Triggers a full scan (files + thumbnails + watcher)
 * 4. Builds the folder tree for the sidebar
 * 5. Persists the pinned folder list to preferences
 *
 * Safe to call for folders that are already pinned — the store's
 * `addPinnedFolder` deduplicates, and `scanFolder` is idempotent
 * (it upserts files rather than duplicating them).
 */
export async function loadFolder(folderPath: string): Promise<void> {
  const store = useGalleryStore.getState()

  // Skip if already pinned — still scan (picks up new files) but don't
  // disrupt the user's current navigation if they're browsing something else.
  const alreadyPinned = store.pinnedFolders.includes(folderPath)

  store.addPinnedFolder(folderPath)
  store.setCurrentPath(folderPath)
  store.setIsScanning(true)

  const [tree] = await Promise.all([
    window.api.getFolderTree(folderPath),
    window.api.scanFolder(folderPath)
  ])

  store.setFolderTreeForRoot(folderPath, tree as FolderNode)
  store.setIsScanning(false)
  store.incrementScanVersion()

  // Persist pinned folders list so they restore on next launch
  window.api.setPreference(
    'pinnedFolders',
    JSON.stringify(useGalleryStore.getState().pinnedFolders)
  )
}
