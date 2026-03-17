import { useGalleryStore } from '../../stores/gallery.store'
import { useGalleryFiles } from '../../hooks/useGalleryFiles'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function InfoPanel(): JSX.Element {
  const infoPanelOpen = useGalleryStore((s) => s.infoPanelOpen)
  const toggleInfoPanel = useGalleryStore((s) => s.toggleInfoPanel)
  const activeIndex = useGalleryStore((s) => s.activeIndex)
  const { files } = useGalleryFiles()

  // When closed, render nothing — the View menu in the breadcrumb bar
  // controls panel visibility, so we don't need a toggle strip.
  if (!infoPanelOpen) return <div className="info-panel info-panel--hidden" />

  const file = activeIndex !== null ? files[activeIndex] : null

  return (
    <div className="info-panel">
      <div className="info-panel-header">
        <span className="info-panel-title">Info</span>
        <button className="info-panel-close" onClick={toggleInfoPanel} title="Close (Cmd+I)">{'\u00BB'}</button>
      </div>
      <div className="info-panel-content">
        {file ? (
          <>
            <div className="info-row">
              <div className="info-label">Filename</div>
              <div className="info-value">{file.filename}</div>
            </div>
            <div className="info-row">
              <div className="info-label">Type</div>
              <div className="info-value">{file.extension.toUpperCase().replace('.', '')}</div>
            </div>
            {file.width && file.height && (
              <div className="info-row">
                <div className="info-label">Dimensions</div>
                <div className="info-value">{file.width} &times; {file.height}</div>
              </div>
            )}
            <div className="info-row">
              <div className="info-label">File Size</div>
              <div className="info-value">{formatBytes(file.sizeBytes)}</div>
            </div>
            <div className="info-row">
              <div className="info-label">Modified</div>
              <div className="info-value">{formatDate(file.modifiedAt)}</div>
            </div>
            <div className="info-row">
              <div className="info-label">Created</div>
              <div className="info-value">{formatDate(file.createdAt)}</div>
            </div>
            <div className="info-row">
              <div className="info-label">Path</div>
              <div className="info-value">{file.path}</div>
            </div>
          </>
        ) : (
          <div className="info-panel-empty">No image selected</div>
        )}
      </div>
    </div>
  )
}
