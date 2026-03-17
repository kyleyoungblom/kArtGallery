import { useState, useEffect, useCallback } from 'react'
import { useGalleryStore } from '../../stores/gallery.store'
import { DEFAULT_SHORTCUTS } from '../../config/keyboard-defaults'
import { eventToKeyString, formatKeyString } from '../../config/shortcut-matcher'

type SettingsTab = 'general' | 'shortcuts'

export function SettingsModal(): JSX.Element {
  const closeSettings = useGalleryStore((s) => s.closeSettings)
  const keyboardShortcuts = useGalleryStore((s) => s.keyboardShortcuts)
  const setKeyboardShortcut = useGalleryStore((s) => s.setKeyboardShortcut)
  const resetKeyboardShortcut = useGalleryStore((s) => s.resetKeyboardShortcut)

  const [tab, setTab] = useState<SettingsTab>('general')

  // General tab state — gallery layout
  const gapSize = useGalleryStore((s) => s.gapSize)
  const setGapSize = useGalleryStore((s) => s.setGapSize)

  // General tab state — thumbnails
  const [thumbMaxDim, setThumbMaxDim] = useState(400)
  const [thumbQuality, setThumbQuality] = useState(80)

  // Shortcuts tab: which action is being recorded (null = none)
  const [recordingAction, setRecordingAction] = useState<string | null>(null)

  // Load current preferences on mount
  useEffect(() => {
    window.api.getPreferences().then((prefs) => {
      if (prefs['thumbnail.maxDimension']) setThumbMaxDim(Number(prefs['thumbnail.maxDimension']))
      if (prefs['thumbnail.jpegQuality']) setThumbQuality(Number(prefs['thumbnail.jpegQuality']))
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

  return (
    <div className="modal-overlay" onClick={closeSettings}>
      <div className="modal-content settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="modal-close" onClick={closeSettings}>{'\u2715'}</button>
        </div>

        <div className="settings-tabs">
          <button
            className={`settings-tab ${tab === 'general' ? 'settings-tab--active' : ''}`}
            onClick={() => setTab('general')}
          >
            General
          </button>
          <button
            className={`settings-tab ${tab === 'shortcuts' ? 'settings-tab--active' : ''}`}
            onClick={() => setTab('shortcuts')}
          >
            Shortcuts
          </button>
        </div>

        <div className="settings-body">
          {tab === 'general' && (
            <div className="settings-section">
              <h3 className="settings-section-title">Gallery Layout</h3>

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
        </div>
      </div>
    </div>
  )
}
