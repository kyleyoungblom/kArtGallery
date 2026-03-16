import { useGalleryStore } from '../../stores/gallery.store'
import type { SortField, SortDirection, GroupBy } from '../../types/models'

export function Toolbar(): JSX.Element {
  const sortField = useGalleryStore((s) => s.sortField)
  const sortDirection = useGalleryStore((s) => s.sortDirection)
  const groupBy = useGalleryStore((s) => s.groupBy)
  const tileSize = useGalleryStore((s) => s.tileSize)
  const gapSize = useGalleryStore((s) => s.gapSize)
  const cropToAspect = useGalleryStore((s) => s.cropToAspect)
  const fileCount = useGalleryStore((s) => s.files.length)
  const isScanning = useGalleryStore((s) => s.isScanning)
  const scanProgress = useGalleryStore((s) => s.scanProgress)

  const setSortField = useGalleryStore((s) => s.setSortField)
  const setSortDirection = useGalleryStore((s) => s.setSortDirection)
  const setGroupBy = useGalleryStore((s) => s.setGroupBy)
  const setTileSize = useGalleryStore((s) => s.setTileSize)
  const setGapSize = useGalleryStore((s) => s.setGapSize)
  const setCropToAspect = useGalleryStore((s) => s.setCropToAspect)

  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <label className="toolbar-label">
          Sort
          <select
            className="toolbar-select"
            value={sortField}
            onChange={(e) => setSortField(e.target.value as SortField)}
          >
            <option value="filename">Name</option>
            <option value="modifiedAt">Modified</option>
            <option value="createdAt">Created</option>
            <option value="sizeBytes">Size</option>
          </select>
        </label>
        <button
          className="toolbar-btn"
          onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
          title={sortDirection === 'asc' ? 'Ascending' : 'Descending'}
        >
          {sortDirection === 'asc' ? '\u2191' : '\u2193'}
        </button>
      </div>

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

      <div className="toolbar-group">
        <label className="toolbar-label">
          Size
          <input
            className="toolbar-range"
            type="range"
            min="80"
            max="500"
            value={tileSize}
            onChange={(e) => setTileSize(Number(e.target.value))}
          />
        </label>
      </div>

      <div className="toolbar-group">
        <label className="toolbar-label">
          Gap
          <input
            className="toolbar-range"
            type="range"
            min="0"
            max="24"
            value={gapSize}
            onChange={(e) => setGapSize(Number(e.target.value))}
          />
        </label>
      </div>

      <div className="toolbar-group">
        <label className="toolbar-label toolbar-label--checkbox">
          <input
            type="checkbox"
            checked={cropToAspect}
            onChange={(e) => setCropToAspect(e.target.checked)}
          />
          Crop
        </label>
      </div>

      <div className="toolbar-status">
        {isScanning && scanProgress
          ? `Scanning... ${scanProgress.scanned}/${scanProgress.total}`
          : `${fileCount} images`}
      </div>
    </div>
  )
}
