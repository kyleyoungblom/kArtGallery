import { useState, useEffect } from 'react'
import type { FileEntry } from '../../types/models'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function mapRow(f: Record<string, unknown>): FileEntry {
  return {
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
  }
}

export function FailedFilesModal({ onClose }: { onClose: () => void }): JSX.Element {
  const [files, setFiles] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    window.api.getFailedFiles().then((rows) => {
      setFiles((rows as Record<string, unknown>[]).map(mapRow))
      setLoading(false)
    })
  }, [])

  function handleCopy(): void {
    const lines = files.map((f) => {
      const error = f.thumbnailError ?? 'Unknown (pre-existing failure)'
      return `${f.filename}  ${formatBytes(f.sizeBytes)}  ${error}  ${f.path}`
    })
    const text = `Failed thumbnail files (${files.length}):\n\n${lines.join('\n')}`
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleRetry(): Promise<void> {
    await window.api.resetThumbnails()
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">
            {loading ? 'Loading...' : `${files.length} file${files.length !== 1 ? 's' : ''} failed thumbnail generation`}
          </span>
          <button className="modal-close" onClick={onClose}>x</button>
        </div>

        {!loading && files.length === 0 && (
          <div className="modal-empty">No failed files</div>
        )}

        {!loading && files.length > 0 && (
          <div className="modal-table-wrap">
            <table className="modal-table">
              <thead>
                <tr>
                  <th>Filename</th>
                  <th>Size</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <tr key={f.id}>
                    <td title={f.path}>{f.filename}</td>
                    <td>{formatBytes(f.sizeBytes)}</td>
                    <td>{f.thumbnailError ?? 'Unknown (pre-existing failure)'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="modal-footer">
          <button className="modal-btn" onClick={handleCopy}>
            {copied ? 'Copied!' : 'Copy to Clipboard'}
          </button>
          <button className="modal-btn" onClick={handleRetry}>
            Retry All
          </button>
        </div>
      </div>
    </div>
  )
}
