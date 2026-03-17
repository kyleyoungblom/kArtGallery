// Central definition of all configurable keyboard shortcuts.
//
// Each entry has:
// - id: unique action identifier (used as key in the overrides record)
// - label: human-readable name shown in the Settings → Shortcuts tab
// - defaultKey: the default key combo string
// - scope: where the shortcut is active
//
// Key combo format: modifier+key, all lowercase.
// "cmd" means Cmd on macOS or Ctrl on Windows/Linux.
// Examples: "cmd+b", "space", "arrowleft", "shift+arrowup"

export interface ShortcutDefinition {
  id: string
  label: string
  defaultKey: string
  scope: 'global' | 'gallery' | 'sidebar'
}

export const DEFAULT_SHORTCUTS: ShortcutDefinition[] = [
  // Global shortcuts (work regardless of focus region)
  { id: 'toggleSidebar', label: 'Toggle Sidebar', defaultKey: 'cmd+b', scope: 'global' },
  { id: 'toggleInfoPanel', label: 'Toggle Info Panel', defaultKey: 'cmd+i', scope: 'global' },
  { id: 'openSettings', label: 'Open Settings', defaultKey: 'cmd+,', scope: 'global' },
  { id: 'switchFocus', label: 'Switch Focus', defaultKey: 'tab', scope: 'global' },
  { id: 'toggleToolbar', label: 'Toggle Toolbar', defaultKey: 'cmd+t', scope: 'global' },
  { id: 'toggleStatusbar', label: 'Toggle Status Bar', defaultKey: 'cmd+/', scope: 'global' },

  // Gallery shortcuts (only when gallery has focus)
  { id: 'navLeft', label: 'Navigate Left', defaultKey: 'arrowleft', scope: 'gallery' },
  { id: 'navRight', label: 'Navigate Right', defaultKey: 'arrowright', scope: 'gallery' },
  { id: 'navUp', label: 'Navigate Up', defaultKey: 'arrowup', scope: 'gallery' },
  { id: 'navDown', label: 'Navigate Down', defaultKey: 'arrowdown', scope: 'gallery' },
  { id: 'openLightbox', label: 'Open Lightbox', defaultKey: 'space', scope: 'gallery' },
  { id: 'clearSelection', label: 'Clear Selection', defaultKey: 'escape', scope: 'gallery' },
]
