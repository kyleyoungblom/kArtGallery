import { useMemo, useState, useRef, useEffect, useCallback } from 'react'
import { useGalleryStore } from '../../stores/gallery.store'
import type { SortField, SortDirection, GroupBy } from '../../types/models'

const SIZE_PRESETS = [
  { label: 'Any', value: null },
  { label: '> 1 MB', value: 1024 * 1024 },
  { label: '> 10 MB', value: 10 * 1024 * 1024 },
  { label: '> 50 MB', value: 50 * 1024 * 1024 },
  { label: '> 100 MB', value: 100 * 1024 * 1024 }
] as const

const MAX_SIZE_PRESETS = [
  { label: 'Any', value: null },
  { label: '< 1 MB', value: 1024 * 1024 },
  { label: '< 10 MB', value: 10 * 1024 * 1024 },
  { label: '< 50 MB', value: 50 * 1024 * 1024 }
] as const

const DIMENSION_PRESETS = [
  { label: 'Any', value: null },
  { label: '> 500px', value: 500 },
  { label: '> 1000px', value: 1000 },
  { label: '> 2000px', value: 2000 },
  { label: '> 4000px', value: 4000 }
] as const

/**
 * File Type popover — shows checkboxes for each extension found in the
 * current folder. Unchecking an extension hides those files. This replaces
 * the single-select dropdown, which could only show one type at a time.
 *
 * Design: the popover appears below the "File Type" button and dismisses
 * on outside click, similar to the sidebar settings menu pattern.
 */
function FileTypePopover({
  extensions,
  excluded,
  onToggle,
  onClose
}: {
  extensions: string[]
  excluded: Set<string>
  onToggle: (ext: string) => void
  onClose: () => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  return (
    <div className="toolbar-popover" ref={ref}>
      {extensions.map((ext) => (
        <label key={ext} className="toolbar-popover-item">
          <input
            type="checkbox"
            checked={!excluded.has(ext)}
            onChange={() => onToggle(ext)}
          />
          {ext}
        </label>
      ))}
    </div>
  )
}

export function Toolbar(): JSX.Element {
  const sortField = useGalleryStore((s) => s.sortField)
  const sortDirection = useGalleryStore((s) => s.sortDirection)
  const groupBy = useGalleryStore((s) => s.groupBy)
  const cropToAspect = useGalleryStore((s) => s.cropToAspect)
  const showLabels = useGalleryStore((s) => s.showLabels)
  const files = useGalleryStore((s) => s.files)
  const filterExtensions = useGalleryStore((s) => s.filterExtensions)
  const filterMinSize = useGalleryStore((s) => s.filterMinSize)
  const filterMaxSize = useGalleryStore((s) => s.filterMaxSize)
  const filterMinDimension = useGalleryStore((s) => s.filterMinDimension)
  const showHidden = useGalleryStore((s) => s.showHidden)

  const setSortField = useGalleryStore((s) => s.setSortField)
  const setSortDirection = useGalleryStore((s) => s.setSortDirection)
  const setGroupBy = useGalleryStore((s) => s.setGroupBy)
  const setCropToAspect = useGalleryStore((s) => s.setCropToAspect)
  const setShowLabels = useGalleryStore((s) => s.setShowLabels)
  const setFilterExtensions = useGalleryStore((s) => s.setFilterExtensions)
  const setFilterMinSize = useGalleryStore((s) => s.setFilterMinSize)
  const setFilterMaxSize = useGalleryStore((s) => s.setFilterMaxSize)
  const setFilterMinDimension = useGalleryStore((s) => s.setFilterMinDimension)
  const clearFilters = useGalleryStore((s) => s.clearFilters)
  const toggleShowHidden = useGalleryStore((s) => s.toggleShowHidden)
  const [typePopoverOpen, setTypePopoverOpen] = useState(false)

  const hasActiveFilters = filterExtensions.length > 0 || filterMinSize !== null || filterMaxSize !== null || filterMinDimension !== null

  // Unique extensions from current file set
  const uniqueExtensions = useMemo(() => {
    const exts = new Set(files.map((f) => f.extension))
    return [...exts].sort()
  }, [files])

  // filterExtensions stores the list of extensions to *exclude*.
  // This is an inversion from the old model (which stored the single extension
  // to include). Exclusion-based filtering is more natural for checkboxes:
  // unchecking ".psd" means "exclude .psd", while everything else stays visible.
  const excludedSet = useMemo(() => new Set(filterExtensions), [filterExtensions])

  const handleToggleExt = useCallback(
    (ext: string) => {
      const next = new Set(excludedSet)
      if (next.has(ext)) {
        next.delete(ext)
      } else {
        next.add(ext)
      }
      setFilterExtensions([...next])
    },
    [excludedSet, setFilterExtensions]
  )

  // Label for the file type button — show "All" or count of excluded
  const typeLabel = excludedSet.size === 0 ? 'All' : `${uniqueExtensions.length - excludedSet.size}/${uniqueExtensions.length}`

  return (
    <div className="toolbar-wrapper">
      <div className="toolbar">
        {/* Section 1: Sort, Group, File Type, File Size, Dimensions */}
        <div className="toolbar-section">
          <label className="toolbar-label">
            Sort
            <select
              className="toolbar-select"
              value={`${sortField}:${sortDirection}`}
              onChange={(e) => {
                const [field, dir] = e.target.value.split(':') as [SortField, SortDirection]
                setSortField(field)
                setSortDirection(dir)
              }}
            >
              <option value="filename:asc">{`Name \u2191`}</option>
              <option value="filename:desc">{`Name \u2193`}</option>
              <option value="folder:asc">{`Folder \u2191`}</option>
              <option value="folder:desc">{`Folder \u2193`}</option>
              <option value="modifiedAt:desc">{`Modified \u2193`}</option>
              <option value="modifiedAt:asc">{`Modified \u2191`}</option>
              <option value="createdAt:desc">{`Created \u2193`}</option>
              <option value="createdAt:asc">{`Created \u2191`}</option>
              <option value="sizeBytes:desc">{`Size \u2193`}</option>
              <option value="sizeBytes:asc">{`Size \u2191`}</option>
            </select>
          </label>
          <div className="toolbar-group">
            <label className="toolbar-label">
              Group
              <select
                className="toolbar-select"
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value as GroupBy)}
              >
                <option value="none">None</option>
                <option value="folder">Folder</option>
                <option value="month">Month</option>
                <option value="year">Year</option>
              </select>
            </label>
          </div>
          <div className="toolbar-group" style={{ position: 'relative' }}>
            <span className="toolbar-label">File Type</span>
            <button
              className={`toolbar-btn ${excludedSet.size > 0 ? 'toolbar-btn--active' : ''}`}
              onClick={() => setTypePopoverOpen(!typePopoverOpen)}
            >
              {typeLabel}
            </button>
            {typePopoverOpen && (
              <FileTypePopover
                extensions={uniqueExtensions}
                excluded={excludedSet}
                onToggle={handleToggleExt}
                onClose={() => setTypePopoverOpen(false)}
              />
            )}
          </div>
          <label className="toolbar-label">
            Min
            <select
              className="toolbar-select"
              value={filterMinSize ?? ''}
              onChange={(e) => setFilterMinSize(e.target.value ? Number(e.target.value) : null)}
            >
              {SIZE_PRESETS.map((p) => (
                <option key={p.label} value={p.value ?? ''}>{p.label}</option>
              ))}
            </select>
          </label>
          <label className="toolbar-label">
            Max
            <select
              className="toolbar-select"
              value={filterMaxSize ?? ''}
              onChange={(e) => setFilterMaxSize(e.target.value ? Number(e.target.value) : null)}
            >
              {MAX_SIZE_PRESETS.map((p) => (
                <option key={p.label} value={p.value ?? ''}>{p.label}</option>
              ))}
            </select>
          </label>
          <label className="toolbar-label">
            Size
            <select
              className="toolbar-select"
              value={filterMinDimension ?? ''}
              onChange={(e) => setFilterMinDimension(e.target.value ? Number(e.target.value) : null)}
            >
              {DIMENSION_PRESETS.map((p) => (
                <option key={p.label} value={p.value ?? ''}>{p.label}</option>
              ))}
            </select>
          </label>
          {hasActiveFilters && (
            <button className="toolbar-btn toolbar-btn--clear" onClick={clearFilters} title="Clear filters">
              {'\u2715'}
            </button>
          )}
        </div>

        {/* Spacer pushes view controls to the right edge */}
        <div className="toolbar-spacer" />

        {/* Section 2: View controls — right-aligned because these affect
            how images are displayed, not which images are shown */}
        <div className="toolbar-section">
          <label className="toolbar-label toolbar-label--checkbox">
            <input
              type="checkbox"
              checked={cropToAspect}
              onChange={(e) => setCropToAspect(e.target.checked)}
            />
            Crop
          </label>
          <label className="toolbar-label toolbar-label--checkbox">
            <input
              type="checkbox"
              checked={showLabels}
              onChange={(e) => setShowLabels(e.target.checked)}
            />
            Labels
          </label>
          <label className="toolbar-label toolbar-label--checkbox">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={toggleShowHidden}
            />
            Hidden
          </label>
        </div>
      </div>
    </div>
  )
}
