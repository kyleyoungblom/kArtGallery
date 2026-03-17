import { useCallback, useEffect, useState } from 'react'
import { useGalleryStore } from '../../stores/gallery.store'
import type { DuplicateGroup, DuplicateFile } from '../../types/models'

// Duplicate Review Modal — shows groups of visually similar images
// so the user can decide which to keep and which to hide.
//
// Design choices:
// - Uses "Hide" (not delete) for safety — reversible via "Show Hidden" toggle
// - Auto-suggests "best" file per group (highest resolution, largest file)
// - Threshold slider lets user tune exact vs similar matching interactively
// - "Keep Best, Hide Rest" one-click per group for fast resolution

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatDimensions(w: number | null, h: number | null): string {
  if (w && h) return `${w} \u00d7 ${h}`
  return 'Unknown'
}

// Format an ISO date string to a short readable form.
// Shows just the date (no time) since that's the useful signal for comparing duplicates.
function formatDate(isoStr: string | null): string {
  if (!isoStr) return '—'
  try {
    return new Date(isoStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  } catch {
    return '—'
  }
}

// Shorten path for display: show last 2 segments (folder/filename)
function shortenPath(filePath: string): string {
  const parts = filePath.split('/')
  if (parts.length <= 2) return filePath
  return '\u2026/' + parts.slice(-2).join('/')
}

interface DuplicateCardProps {
  file: DuplicateFile
  isBest: boolean
  isHidden: boolean
  onToggleHide: (fileId: number, hide: boolean) => void
}

function DuplicateCard({ file, isBest, isHidden, onToggleHide }: DuplicateCardProps): JSX.Element {
  const [thumbSrc, setThumbSrc] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api.getThumbnail(file.id).then((src) => {
      // getThumbnail returns a filesystem path — must use the local-file://
      // protocol for Electron's custom protocol handler to serve it securely.
      if (!cancelled && src) setThumbSrc(`local-file://${src}`)
    })
    return () => { cancelled = true }
  }, [file.id])

  return (
    <div className={`dup-card ${isBest ? 'dup-card--best' : ''} ${isHidden ? 'dup-card--hidden' : ''}`}>
      {/* Clicking the thumbnail toggles hide/unhide — large click target for fast triage */}
      <div
        className="dup-card-thumb dup-card-thumb--clickable"
        onClick={() => onToggleHide(file.id, !isHidden)}
        title={isHidden ? 'Click to unhide' : 'Click to hide'}
      >
        {thumbSrc ? (
          <img src={thumbSrc} alt={file.filename} draggable={false} />
        ) : (
          <div className="dup-card-thumb-placeholder" />
        )}
        {isBest && <span className="dup-card-badge">Best</span>}
        <div className="dup-card-thumb-overlay">
          {isHidden ? 'Unhide' : 'Hide'}
        </div>
      </div>
      <div className="dup-card-info">
        <div className="dup-card-filename" title={file.path}>
          {/* Split into stem + extension so CSS truncates the stem but always shows the extension */}
          <span className="dup-card-filename-stem">
            {file.filename.includes('.') ? file.filename.slice(0, file.filename.lastIndexOf('.')) : file.filename}
          </span>
          {file.filename.includes('.') && (
            <span className="dup-card-filename-ext">
              {file.filename.slice(file.filename.lastIndexOf('.'))}
            </span>
          )}
        </div>
        <div className="dup-card-meta">
          <span>{formatDimensions(file.width, file.height)}</span>
          <span>{formatSize(file.sizeBytes)}</span>
        </div>
        <div className="dup-card-dates">
          <span title="Date created">Created: {formatDate(file.createdAt)}</span>
          <span title="Date modified">Modified: {formatDate(file.modifiedAt)}</span>
        </div>
        {/* Clicking the path opens Finder at that location */}
        <div
          className="dup-card-path dup-card-path--clickable"
          title={`${file.path}\nClick to reveal in Finder`}
          onClick={() => window.api.showItemInFolder(file.path)}
        >
          {shortenPath(file.path)}
        </div>
      </div>
      <div className="dup-card-actions">
        {/* Single toggle button: Hide when visible, Unhide when hidden */}
        <button
          className={`dup-card-btn ${isHidden ? 'dup-card-btn--unhide' : 'dup-card-btn--hide'}`}
          onClick={() => onToggleHide(file.id, !isHidden)}
          title={isHidden
            ? 'Make this file visible again in the gallery'
            : 'Hide this file from the gallery (reversible via Show Hidden)'
          }
        >
          {isHidden ? 'Unhide' : 'Hide'}
        </button>
      </div>
    </div>
  )
}

export function DuplicateReviewModal(): JSX.Element {
  const closeDuplicateReview = useGalleryStore((s) => s.closeDuplicateReview)
  const incrementScanVersion = useGalleryStore((s) => s.incrementScanVersion)

  const [groups, setGroups] = useState<DuplicateGroup[]>([])
  const [threshold, setThreshold] = useState(0)
  const [loading, setLoading] = useState(false)
  const [hiddenFileIds, setHiddenFileIds] = useState(new Set<number>())
  const [resolvedGroupIds, setResolvedGroupIds] = useState(new Set<number>())

  // Fetch duplicates when modal opens or threshold changes
  const fetchDuplicates = useCallback(async (thresh: number) => {
    setLoading(true)
    try {
      const result = await window.api.findDuplicates({ threshold: thresh }) as DuplicateGroup[]
      setGroups(result)
    } catch (err) {
      console.error('Failed to find duplicates:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDuplicates(threshold)
  }, [fetchDuplicates, threshold])

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') closeDuplicateReview()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [closeDuplicateReview])

  const handleToggleHide = useCallback(async (fileId: number, hide: boolean) => {
    try {
      await window.api.setHidden(fileId, 'file', hide)
      setHiddenFileIds((prev) => {
        const next = new Set(prev)
        if (hide) next.add(fileId)
        else next.delete(fileId)
        return next
      })
      // Refresh gallery in background
      incrementScanVersion()
    } catch (err) {
      console.error('Failed to hide/unhide file:', err)
    }
  }, [incrementScanVersion])

  // "Keep Best, Hide Rest" for a single group
  const handleKeepBest = useCallback(async (group: DuplicateGroup) => {
    const toHide = group.files.filter((f) => f.id !== group.bestFileId)
    for (const f of toHide) {
      await window.api.setHidden(f.id, 'file', true)
    }
    setHiddenFileIds((prev) => {
      const next = new Set(prev)
      for (const f of toHide) next.add(f.id)
      return next
    })
    setResolvedGroupIds((prev) => {
      const next = new Set(prev)
      next.add(group.groupId)
      return next
    })
    incrementScanVersion()
  }, [incrementScanVersion])

  // "Auto-resolve All" — apply keep-best across all groups
  const handleAutoResolveAll = useCallback(async () => {
    for (const group of groups) {
      if (resolvedGroupIds.has(group.groupId)) continue
      const toHide = group.files.filter((f) => f.id !== group.bestFileId)
      for (const f of toHide) {
        await window.api.setHidden(f.id, 'file', true)
      }
      setHiddenFileIds((prev) => {
        const next = new Set(prev)
        for (const f of toHide) next.add(f.id)
        return next
      })
    }
    setResolvedGroupIds(new Set(groups.map((g) => g.groupId)))
    incrementScanVersion()
  }, [groups, resolvedGroupIds, incrementScanVersion])

  const unresolvedGroups = groups.filter((g) => !resolvedGroupIds.has(g.groupId))
  const totalDuplicateFiles = groups.reduce((sum, g) => sum + g.files.length, 0)

  return (
    <div className="modal-overlay" onClick={closeDuplicateReview}>
      <div className="modal-content dup-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Find Duplicates</h2>
          <button className="modal-close" onClick={closeDuplicateReview}>{'\u2715'}</button>
        </div>

        <div className="dup-controls">
          <div className="dup-threshold">
            <label>
              Similarity threshold:
              <input
                type="range"
                min={0}
                max={60}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
              />
              <span className="dup-threshold-value">
                {threshold === 0
                  ? 'Exact only'
                  : `\u2264 ${threshold} bits (${Math.round(((256 - threshold) / 256) * 100)}% similar)`
                }
              </span>
            </label>
          </div>
          <div className="dup-summary">
            {loading ? (
              <span>Scanning...</span>
            ) : groups.length > 0 ? (
              <span>
                Found {groups.length} group{groups.length !== 1 ? 's' : ''} ({totalDuplicateFiles} images)
                {unresolvedGroups.length < groups.length && (
                  <span className="dup-resolved-count">
                    {' \u00b7 '}{groups.length - unresolvedGroups.length} resolved
                  </span>
                )}
              </span>
            ) : (
              <span>No duplicates found</span>
            )}
          </div>
          {unresolvedGroups.length > 1 && (
            <button
              className="modal-btn dup-auto-resolve"
              onClick={handleAutoResolveAll}
              title="For every group, keep the highest-resolution file and hide the rest"
            >
              Auto-resolve All
            </button>
          )}
        </div>

        <div className="modal-body dup-body">
          {unresolvedGroups.length === 0 && groups.length > 0 && (
            <div className="dup-all-resolved">
              All duplicate groups have been resolved.
            </div>
          )}
          {unresolvedGroups.map((group) => (
            <div key={group.groupId} className="dup-group">
              <div className="dup-group-header">
                <span className="dup-group-label">
                  {group.files.length} images {'\u00b7'} {group.matchReason}
                </span>
                <button
                  className="modal-btn dup-keep-best"
                  onClick={() => handleKeepBest(group)}
                  title="Keep the highest-resolution file in this group and hide all others"
                >
                  Keep Best, Hide Rest
                </button>
              </div>
              <div className="dup-group-cards">
                {group.files.map((file) => (
                  <DuplicateCard
                    key={file.id}
                    file={file}
                    isBest={file.id === group.bestFileId}
                    isHidden={hiddenFileIds.has(file.id) || file.hidden === 1}
                    onToggleHide={handleToggleHide}
                  />
                ))}
              </div>
            </div>
          ))}
          {!loading && groups.length === 0 && (
            <div className="modal-empty">
              No duplicate images found. Try increasing the similarity threshold.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
