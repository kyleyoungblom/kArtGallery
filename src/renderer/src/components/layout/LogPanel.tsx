import { useEffect, useRef, useState } from 'react'
import { useLogStore } from '../../stores/log.store'

// LogPanel is a collapsible panel at the bottom of the app (above the status bar)
// that displays structured log entries from the main process. Useful for debugging
// and seeing which files failed to process.
//
// It auto-scrolls to the bottom as new entries arrive so you always see the latest.
// Entries are color-coded by level: info (default), warn (yellow), error (red).
//
// The "Copy" button formats all entries as plain text so you can paste them into
// a chat with Claude or a bug report.

export function LogPanel(): JSX.Element | null {
  const isOpen = useLogStore((s) => s.isLogPanelOpen)
  const entries = useLogStore((s) => s.entries)
  const clearEntries = useLogStore((s) => s.clearEntries)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [entries.length])

  if (!isOpen) return null

  function handleCopy(): void {
    const text = entries
      .map((e) => `${new Date(e.timestamp).toLocaleTimeString()} [${e.source}] ${e.level.toUpperCase()}: ${e.message}`)
      .join('\n')

    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="log-panel">
      <div className="log-panel-header">
        <span className="log-panel-title">Activity Log</span>
        <div className="log-panel-actions">
          <button className="log-panel-action-btn" onClick={handleCopy}>
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button className="log-panel-action-btn" onClick={clearEntries}>
            Clear
          </button>
        </div>
      </div>
      <div className="log-panel-entries" ref={scrollRef}>
        {entries.length === 0 ? (
          <div className="log-panel-empty">No log entries yet</div>
        ) : (
          entries.map((entry, i) => (
            <div key={i} className={`log-entry log-entry--${entry.level}`}>
              <span className="log-entry-time">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>
              <span className="log-entry-source">[{entry.source}]</span>
              <span className="log-entry-message">{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
