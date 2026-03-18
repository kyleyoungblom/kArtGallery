import { useState, useEffect, useCallback, useRef } from 'react'
import { useGalleryStore } from '../../stores/gallery.store'
import { loadFolder } from '../../utils/load-folder'
import { DEFAULT_SHORTCUTS } from '../../config/keyboard-defaults'
import { eventToKeyString, formatKeyString } from '../../config/shortcut-matcher'
import type { SyncRootMapping } from '../../types/models'

// Data-driven tab system: add a new entry here to create a new tab.
// No other structural changes needed — the tab bar and routing are
// auto-generated from this array. Makes adding future tabs (Database
// stats, Activity Log, etc.) trivial.
const SETTINGS_TABS = [
  { id: 'general', label: 'General' },
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'sync', label: 'Sync' }
] as const

type SettingsTab = (typeof SETTINGS_TABS)[number]['id']

export function SettingsModal(): JSX.Element {
  const closeSettings = useGalleryStore((s) => s.closeSettings)
  const keyboardShortcuts = useGalleryStore((s) => s.keyboardShortcuts)
  const setKeyboardShortcut = useGalleryStore((s) => s.setKeyboardShortcut)
  const resetKeyboardShortcut = useGalleryStore((s) => s.resetKeyboardShortcut)

  const [tab, setTab] = useState<SettingsTab>('general')

  // General tab state — gallery layout
  const gapSize = useGalleryStore((s) => s.gapSize)
  const setGapSize = useGalleryStore((s) => s.setGapSize)
  const accentColor = useGalleryStore((s) => s.accentColor)
  const setAccentColor = useGalleryStore((s) => s.setAccentColor)
  const lightboxFitToScreen = useGalleryStore((s) => s.lightboxFitToScreen)
  const setLightboxFitToScreen = useGalleryStore((s) => s.setLightboxFitToScreen)

  // General tab state — thumbnails
  const [thumbMaxDim, setThumbMaxDim] = useState(400)
  const [thumbQuality, setThumbQuality] = useState(80)

  // Shortcuts tab: which action is being recorded (null = none)
  const [recordingAction, setRecordingAction] = useState<string | null>(null)

  // Update status — tracks the lifecycle of an update check.
  // The shape mirrors what auto-updater.ts sends over IPC:
  //   idle | checking | available | downloading | ready | up-to-date | error
  const [updateStatus, setUpdateStatus] = useState<{
    state: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'up-to-date' | 'error'
    version?: string
    percent?: number
    message?: string
  }>({ state: 'idle' })

  // Timer ref for auto-clearing the "up-to-date" message after a few seconds
  const upToDateTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync tab state
  const [syncEventLogPath, setSyncEventLogPath] = useState('')
  const [syncDeviceName, setSyncDeviceName] = useState('')
  const [syncMappings, setSyncMappings] = useState<SyncRootMapping[]>([])
  const [syncConfigured, setSyncConfigured] = useState(false)

  // Subscribe to update status changes from the main process.
  // Also fetch the current status on mount so we pick up any
  // background download that started before Settings was opened.
  useEffect(() => {
    window.api.getUpdateStatus().then((status) => {
      if (status && typeof status === 'object') {
        setUpdateStatus(status as typeof updateStatus)
      }
    })

    const unsub = window.api.onUpdateStatusChanged((status) => {
      const s = status as typeof updateStatus
      setUpdateStatus(s)

      // Auto-clear "up-to-date" after 4 seconds so the button returns to idle
      if (s.state === 'up-to-date') {
        if (upToDateTimer.current) clearTimeout(upToDateTimer.current)
        upToDateTimer.current = setTimeout(() => setUpdateStatus({ state: 'idle' }), 4000)
      }
    })

    return () => {
      unsub()
      if (upToDateTimer.current) clearTimeout(upToDateTimer.current)
    }
  }, [])

  // Load current preferences on mount
  useEffect(() => {
    window.api.getPreferences().then((prefs) => {
      if (prefs['thumbnail.maxDimension']) setThumbMaxDim(Number(prefs['thumbnail.maxDimension']))
      if (prefs['thumbnail.jpegQuality']) setThumbQuality(Number(prefs['thumbnail.jpegQuality']))
    })

    // Load sync config
    window.api.getSyncConfig().then((config) => {
      setSyncEventLogPath(config.eventLogPath)
      setSyncDeviceName(config.deviceName)
      setSyncConfigured(config.configured)
      try {
        setSyncMappings(JSON.parse(config.rootMappings) as SyncRootMapping[])
      } catch {
        setSyncMappings([])
      }
    })
  }, [])

  // Close on Escape (but not when recording a shortcut)
  useEffect(() => {
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape' && !recordingAction) {
        e.preventDefault()
        e.stopPropagation()
        closeSettings()
      }
    }
    document.addEventListener('keydown', handleKey, true)
    return () => document.removeEventListener('keydown', handleKey, true)
  }, [closeSettings, recordingAction])

  // Key capture for shortcut recording
  useEffect(() => {
    if (!recordingAction) return

    function handleKey(e: KeyboardEvent): void {
      e.preventDefault()
      e.stopPropagation()

      // Ignore bare modifier keys (waiting for the actual key)
      const key = e.key.toLowerCase()
      if (['meta', 'control', 'shift', 'alt'].includes(key)) return

      const keyStr = eventToKeyString(e)

      // If user presses Escape alone, cancel recording
      if (keyStr === 'escape') {
        setRecordingAction(null)
        return
      }

      setKeyboardShortcut(recordingAction!, keyStr)
      // Persist immediately
      const updated = { ...useGalleryStore.getState().keyboardShortcuts }
      window.api.setPreference('keyboardShortcuts', JSON.stringify(updated))
      setRecordingAction(null)
    }

    document.addEventListener('keydown', handleKey, true)
    return () => document.removeEventListener('keydown', handleKey, true)
  }, [recordingAction, setKeyboardShortcut])

  const handleThumbMaxDimChange = useCallback((value: number) => {
    setThumbMaxDim(value)
    window.api.setPreference('thumbnail.maxDimension', String(value))
  }, [])

  const handleThumbQualityChange = useCallback((value: number) => {
    setThumbQuality(value)
    window.api.setPreference('thumbnail.jpegQuality', String(value))
  }, [])

  const handleResetShortcut = useCallback((actionId: string) => {
    resetKeyboardShortcut(actionId)
    const updated = { ...useGalleryStore.getState().keyboardShortcuts }
    window.api.setPreference('keyboardShortcuts', JSON.stringify(updated))
  }, [resetKeyboardShortcut])

  // Check for conflicts: does any other action use this key?
  const getConflict = useCallback((actionId: string, keyStr: string): string | null => {
    for (const def of DEFAULT_SHORTCUTS) {
      if (def.id === actionId) continue
      const bound = keyboardShortcuts[def.id] ?? def.defaultKey
      if (bound === keyStr) return def.label
    }
    return null
  }, [keyboardShortcuts])

  // ── Sync tab handlers ──

  const handlePickEventLogPath = useCallback(async () => {
    const result = await window.api.pickSyncLogPath()
    if (result) {
      setSyncEventLogPath(result)
      await window.api.setSyncConfig('sync.eventLogPath', result)
      setSyncConfigured(true)
    }
  }, [])

  const handleDeviceNameChange = useCallback((value: string) => {
    setSyncDeviceName(value)
    window.api.setSyncConfig('sync.deviceName', value)
  }, [])

  const handleAddMapping = useCallback(async () => {
    const folder = await window.api.pickSyncMappingFolder()
    if (!folder) return

    // Suggest a sync alias from the last path component
    const parts = folder.replace(/\\/g, '/').split('/')
    const suggestedAlias = parts[parts.length - 1] || 'Root'

    const updated = [...syncMappings, { localAbsolute: folder, syncRelative: suggestedAlias }]
    setSyncMappings(updated)
    window.api.setSyncConfig('sync.rootMappings', JSON.stringify(updated))

    // Auto-add the folder to the sidebar so it's immediately browsable.
    // This is what the user expects: adding a sync mapping for a folder
    // means "I want to use this folder in the app." Without this, they'd
    // have to separately open the folder via the sidebar — an unnecessary
    // extra step that's easy to forget on a fresh machine.
    loadFolder(folder)
  }, [syncMappings])

  const handleRemoveMapping = useCallback((index: number) => {
    const updated = syncMappings.filter((_, i) => i !== index)
    setSyncMappings(updated)
    window.api.setSyncConfig('sync.rootMappings', JSON.stringify(updated))
  }, [syncMappings])

  const handleMappingAliasChange = useCallback((index: number, alias: string) => {
    const updated = syncMappings.map((m, i) => i === index ? { ...m, syncRelative: alias } : m)
    setSyncMappings(updated)
    window.api.setSyncConfig('sync.rootMappings', JSON.stringify(updated))
  }, [syncMappings])

  return (
    <div className="modal-overlay" onClick={closeSettings}>
      <div className="modal-content settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="modal-close" onClick={closeSettings}>{'\u2715'}</button>
        </div>

        <div className="settings-tabs">
          {SETTINGS_TABS.map((t) => (
            <button
              key={t.id}
              className={`settings-tab ${tab === t.id ? 'settings-tab--active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="settings-body">
          {tab === 'general' && (
            <div className="settings-section">
              <h3 className="settings-section-title">Appearance</h3>

              <div className="settings-row">
                <label className="settings-label">Accent color</label>
                <div className="settings-control settings-accent-control">
                  <input
                    type="color"
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    className="settings-color-picker"
                  />
                  <span className="settings-value" style={{ fontFamily: 'monospace' }}>{accentColor}</span>
                  {accentColor !== '#7b9ad4' && (
                    <button
                      className="settings-btn"
                      style={{ marginLeft: 6, fontSize: 10, padding: '2px 6px' }}
                      onClick={() => setAccentColor('#7b9ad4')}
                      title="Reset to default"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>

              <h3 className="settings-section-title" style={{ marginTop: 18 }}>Gallery Layout</h3>

              <div className="settings-row">
                <label className="settings-label">Tile gap</label>
                <div className="settings-control">
                  <input
                    type="range"
                    min="0"
                    max="24"
                    value={gapSize}
                    onChange={(e) => setGapSize(Number(e.target.value))}
                    className="settings-range"
                  />
                  <span className="settings-value">{gapSize}px</span>
                </div>
              </div>

              <h3 className="settings-section-title" style={{ marginTop: 18 }}>Lightbox</h3>

              <div className="settings-row">
                <label className="settings-label">Fit to screen</label>
                <div className="settings-control">
                  <label className="toolbar-label toolbar-label--checkbox" style={{ fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={lightboxFitToScreen}
                      onChange={(e) => setLightboxFitToScreen(e.target.checked)}
                    />
                    Scale small images up to fill the viewport
                  </label>
                </div>
              </div>

              <h3 className="settings-section-title" style={{ marginTop: 18 }}>Thumbnails</h3>
              <p className="settings-note">Changes take effect on next thumbnail regeneration.</p>

              <div className="settings-row">
                <label className="settings-label">Max dimension</label>
                <div className="settings-control">
                  <input
                    type="range"
                    min="200"
                    max="800"
                    step="50"
                    value={thumbMaxDim}
                    onChange={(e) => handleThumbMaxDimChange(Number(e.target.value))}
                    className="settings-range"
                  />
                  <span className="settings-value">{thumbMaxDim}px</span>
                </div>
              </div>

              <div className="settings-row">
                <label className="settings-label">JPEG quality</label>
                <div className="settings-control">
                  <input
                    type="range"
                    min="50"
                    max="100"
                    step="5"
                    value={thumbQuality}
                    onChange={(e) => handleThumbQualityChange(Number(e.target.value))}
                    className="settings-range"
                  />
                  <span className="settings-value">{thumbQuality}%</span>
                </div>
              </div>

              <h3 className="settings-section-title" style={{ marginTop: 18 }}>App Update</h3>

              <div className="settings-row settings-update-row">
                {updateStatus.state === 'idle' && (
                  <button
                    className="settings-btn"
                    onClick={() => window.api.checkForUpdate()}
                  >
                    Check for Updates
                  </button>
                )}

                {updateStatus.state === 'checking' && (
                  <span className="settings-update-status">
                    <span className="statusbar-spinner" /> Checking for updates…
                  </span>
                )}

                {updateStatus.state === 'available' && (
                  <span className="settings-update-status">
                    Version {updateStatus.version} available — downloading…
                  </span>
                )}

                {updateStatus.state === 'downloading' && (
                  <span className="settings-update-status">
                    Downloading update… {updateStatus.percent != null ? `${Math.round(updateStatus.percent)}%` : ''}
                  </span>
                )}

                {updateStatus.state === 'ready' && (
                  <div className="settings-update-ready">
                    <span>Update ready{updateStatus.version ? ` (v${updateStatus.version})` : ''}</span>
                    <button
                      className="settings-btn settings-btn--primary"
                      onClick={() => window.api.installUpdate()}
                    >
                      Restart to Update
                    </button>
                  </div>
                )}

                {updateStatus.state === 'up-to-date' && (
                  <span className="settings-update-status settings-update-status--ok">
                    You're on the latest version
                  </span>
                )}

                {updateStatus.state === 'error' && (
                  <>
                    <span className="settings-update-status settings-update-status--error">
                      Update check failed{updateStatus.message ? `: ${updateStatus.message}` : ''}
                    </span>
                    <button
                      className="settings-btn"
                      style={{ marginLeft: 8 }}
                      onClick={() => window.api.checkForUpdate()}
                    >
                      Retry
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {tab === 'shortcuts' && (
            <div className="settings-section">
              {(['global', 'gallery'] as const).map((scope) => {
                const scopeShortcuts = DEFAULT_SHORTCUTS.filter((s) => s.scope === scope)
                return (
                  <div key={scope}>
                    <h3 className="settings-section-title">
                      {scope === 'global' ? 'Global' : 'Gallery'}
                    </h3>
                    {scopeShortcuts.map((def) => {
                      const currentKey = keyboardShortcuts[def.id] ?? def.defaultKey
                      const isRecording = recordingAction === def.id
                      const isOverridden = keyboardShortcuts[def.id] !== undefined
                      const conflict = getConflict(def.id, currentKey)

                      return (
                        <div key={def.id} className="settings-shortcut-row">
                          <span className="settings-shortcut-label">{def.label}</span>
                          <div className="settings-shortcut-controls">
                            <button
                              className={`settings-shortcut-key ${isRecording ? 'settings-shortcut-key--recording' : ''}`}
                              onClick={() => setRecordingAction(isRecording ? null : def.id)}
                              title={isRecording ? 'Press a key combo (Esc to cancel)' : 'Click to change'}
                            >
                              {isRecording ? 'Press keys...' : formatKeyString(currentKey)}
                            </button>
                            {isOverridden && (
                              <button
                                className="settings-shortcut-reset"
                                onClick={() => handleResetShortcut(def.id)}
                                title={`Reset to ${formatKeyString(def.defaultKey)}`}
                              >
                                {'\u21BA'}
                              </button>
                            )}
                            {conflict && (
                              <span className="settings-shortcut-conflict">
                                Conflicts with {conflict}
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}

          {tab === 'sync' && (
            <div className="settings-section">
              <h3 className="settings-section-title">Cross-Device Sync</h3>
              <p className="settings-note">
                Share hidden files, stacks, and other metadata between machines via an event log stored in a synced folder (e.g., Dropbox).
              </p>

              <div className="settings-row">
                <label className="settings-label">Event log file</label>
                <div className="settings-control settings-control--path">
                  <input
                    type="text"
                    className="settings-input"
                    value={syncEventLogPath}
                    readOnly
                    placeholder="Not configured"
                    title={syncEventLogPath || 'Click Browse to select a location'}
                  />
                  <button className="settings-btn" onClick={handlePickEventLogPath}>
                    Browse
                  </button>
                </div>
              </div>

              <div className="settings-row">
                <label className="settings-label">Device name</label>
                <div className="settings-control">
                  <input
                    type="text"
                    className="settings-input"
                    value={syncDeviceName}
                    onChange={(e) => handleDeviceNameChange(e.target.value)}
                    placeholder="e.g., Kyle's MacBook"
                    title="A human-readable name for this machine (shown in conflict messages)"
                  />
                </div>
              </div>

              <h3 className="settings-section-title" style={{ marginTop: 18 }}>Path Mappings</h3>
              <p className="settings-note">
                Map local folders to sync aliases so events use relative paths that work across machines.
              </p>

              {syncMappings.length > 0 && (
                <div className="settings-mappings">
                  {syncMappings.map((mapping, i) => (
                    <div key={i} className="settings-mapping-row">
                      <span className="settings-mapping-path" title={mapping.localAbsolute}>
                        {mapping.localAbsolute}
                      </span>
                      <span className="settings-mapping-arrow">{'\u2192'}</span>
                      <input
                        type="text"
                        className="settings-input settings-mapping-alias"
                        value={mapping.syncRelative}
                        onChange={(e) => handleMappingAliasChange(i, e.target.value)}
                        title="Sync alias — must match across all devices"
                      />
                      <button
                        className="settings-btn settings-btn--danger"
                        onClick={() => handleRemoveMapping(i)}
                        title="Remove this mapping"
                      >
                        {'\u2715'}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button className="settings-btn" onClick={handleAddMapping}>
                + Add Folder Mapping
              </button>

              {syncConfigured && (
                <div className="settings-sync-status">
                  <span className="settings-sync-status-dot" />
                  Sync enabled
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
