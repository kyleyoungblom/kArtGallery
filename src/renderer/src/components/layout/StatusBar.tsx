import { useEffect, useState } from 'react'
import { useLogStore } from '../../stores/log.store'
import { useGalleryStore } from '../../stores/gallery.store'

// StatusBar sits at the bottom of the app. It shows:
// Left:  Thumbnail progress when active, otherwise file count + storage stats + sync status
// Right: Grid size slider (tile size control)
//
// The log toggle has moved to the settings gear menu in the breadcrumb bar.

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

// Format a relative time string (e.g., "just now", "2m ago", "1h ago")
function formatRelativeTime(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

export function StatusBar(): JSX.Element {
  const thumbnailProgress = useLogStore((s) => s.thumbnailProgress)
  const addEntry = useLogStore((s) => s.addEntry)
  const setThumbnailProgress = useLogStore((s) => s.setThumbnailProgress)
  const fileCount = useGalleryStore((s) => s.files.length)
  const tileSize = useGalleryStore((s) => s.tileSize)
  const setTileSize = useGalleryStore((s) => s.setTileSize)
  const statusbarVisible = useGalleryStore((s) => s.statusbarVisible)
  const scanVersion = useGalleryStore((s) => s.scanVersion)

  const [storageStats, setStorageStats] = useState<{ dbSize: number; cacheSize: number } | null>(null)
  const [syncStatus, setSyncStatus] = useState<{
    configured: boolean
    lastSyncAt: string | null
    pendingConflicts: number
  } | null>(null)

  // Wire up IPC listeners once when the StatusBar mounts.
  useEffect(() => {
    const unsubLog = window.api.onAppLog((entry) => {
      addEntry(entry)
    })

    const unsubProgress = window.api.onThumbnailProgress((progress) => {
      setThumbnailProgress(progress)
      if (progress.generated >= progress.total) {
        setTimeout(() => {
          setThumbnailProgress(null)
          // Refresh storage stats after thumbnail generation completes
          window.api.getStorageStats().then(setStorageStats)
        }, 1500)
      }
    })

    // Listen for filesystem watcher events (file added/removed/modified on disk).
    // Bumping scanVersion triggers useGalleryFiles to re-fetch from the DB,
    // which picks up whatever the watcher wrote. Same pattern as scan completion.
    const unsubWatcher = window.api.onFilesChanged(() => {
      useGalleryStore.getState().incrementScanVersion()
    })

    // Listen for sync events imported from other devices.
    // Bump scanVersion so the gallery refreshes with any hidden/stack changes.
    const unsubSync = window.api.onSyncEventsImported((info) => {
      if (info.count > 0) {
        useGalleryStore.getState().incrementScanVersion()
      }
      // Update sync status indicator
      setSyncStatus((prev) => ({
        configured: true,
        lastSyncAt: new Date().toISOString(),
        pendingConflicts: (prev?.pendingConflicts ?? 0) + info.conflicts
      }))
    })

    return () => {
      unsubLog()
      unsubProgress()
      unsubWatcher()
      unsubSync()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch storage stats and sync status on mount and after scans
  useEffect(() => {
    window.api.getStorageStats().then(setStorageStats)
    window.api.getSyncStatus().then((status) => {
      setSyncStatus({
        configured: status.configured,
        lastSyncAt: status.lastSyncAt,
        pendingConflicts: status.pendingConflicts
      })
    })
  }, [scanVersion])

  const isProcessing = thumbnailProgress !== null && thumbnailProgress.generated < thumbnailProgress.total

  return (
    <div className="statusbar" style={statusbarVisible ? undefined : { display: 'none' }}>
      <div className="statusbar-left">
        {isProcessing ? (
          <span className="statusbar-processing">
            <span className="statusbar-spinner" />
            Generating thumbnails: {thumbnailProgress.generated}/{thumbnailProgress.total}
            {thumbnailProgress.currentFile && (
              <span className="statusbar-current-file" title={thumbnailProgress.currentFile}>
                — {thumbnailProgress.currentFile}
              </span>
            )}
          </span>
        ) : (
          <span className="statusbar-idle">
            {/* Sync dot: green = configured & healthy, red = conflicts */}
            {syncStatus?.configured && (
              <span
                className={
                  'statusbar-sync-dot' +
                  (syncStatus.pendingConflicts > 0
                    ? ' statusbar-sync-dot--conflict'
                    : ' statusbar-sync-dot--ok')
                }
                title={
                  syncStatus.pendingConflicts > 0
                    ? `${syncStatus.pendingConflicts} sync conflict(s) — check Activity Log`
                    : syncStatus.lastSyncAt
                      ? `Sync enabled · last synced ${formatRelativeTime(syncStatus.lastSyncAt)}`
                      : 'Sync enabled'
                }
              />
            )}
            {fileCount} images
            {storageStats && (
              <span className="statusbar-storage">
                {' · '}DB {formatSize(storageStats.dbSize)} · Cache {formatSize(storageStats.cacheSize)}
              </span>
            )}
          </span>
        )}
      </div>

      <div className="statusbar-right">
        <input
          type="range"
          className="statusbar-slider"
          min={60}
          max={500}
          value={tileSize}
          onChange={(e) => setTileSize(Number(e.target.value))}
          title={`Grid size: ${tileSize}px`}
        />
      </div>
    </div>
  )
}
