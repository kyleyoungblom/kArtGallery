// Utilities for matching keyboard events to configurable shortcuts.
//
// The shortcut system uses normalized key strings like "cmd+b" or "space".
// "cmd" unifies macOS Cmd (metaKey) and Windows/Linux Ctrl (ctrlKey) so
// shortcut configs are cross-platform without separate definitions.

import { DEFAULT_SHORTCUTS } from './keyboard-defaults'

/**
 * Convert a KeyboardEvent into a normalized key string.
 * Examples: "cmd+b", "space", "arrowleft", "shift+arrowup"
 */
export function eventToKeyString(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.metaKey || e.ctrlKey) parts.push('cmd')
  if (e.shiftKey) parts.push('shift')
  if (e.altKey) parts.push('alt')

  const key = e.key.toLowerCase()
  // Don't duplicate modifier keys as the key itself
  if (!['meta', 'control', 'shift', 'alt'].includes(key)) {
    parts.push(key === ' ' ? 'space' : key)
  }
  return parts.join('+')
}

/**
 * Format a key string for display in the UI.
 * "cmd+b" → "⌘B", "space" → "Space", "arrowleft" → "←"
 */
export function formatKeyString(keyStr: string): string {
  return keyStr.split('+').map((part) => {
    switch (part) {
      case 'cmd': return '\u2318'
      case 'shift': return '\u21E7'
      case 'alt': return '\u2325'
      case 'space': return 'Space'
      case 'tab': return 'Tab'
      case 'enter': return 'Enter'
      case 'escape': return 'Esc'
      case 'arrowleft': return '\u2190'
      case 'arrowright': return '\u2192'
      case 'arrowup': return '\u2191'
      case 'arrowdown': return '\u2193'
      case ',': return ','
      default: return part.toUpperCase()
    }
  }).join('')
}

/**
 * Build a reverse lookup map: keyString → actionId.
 * User overrides take precedence over defaults.
 */
export function buildShortcutMap(overrides: Record<string, string>): Map<string, string> {
  const map = new Map<string, string>()
  for (const def of DEFAULT_SHORTCUTS) {
    const key = overrides[def.id] ?? def.defaultKey
    map.set(key, def.id)
  }
  return map
}
