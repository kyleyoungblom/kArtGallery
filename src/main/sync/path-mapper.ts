import path from 'path'
import { getSetting } from '../config/settings'

// Maps between absolute local paths and relative sync paths.
//
// On Kyle's Mac:  /Users/kyle/Dropbox/Art/landscapes/sunset.jpg
// In events.jsonl: Art/landscapes/sunset.jpg
// On Kyle's PC:   D:\Dropbox\Art\landscapes\sunset.jpg
//
// The sync root mapping connects these: { localAbsolute: "/Users/kyle/Dropbox/Art", syncRelative: "Art" }
// All event paths use forward slashes (POSIX-style) regardless of OS.

export interface RootMapping {
  localAbsolute: string
  syncRelative: string
}

/**
 * Load root mappings from the preferences table. Returns an empty array
 * if not configured (sync disabled or not yet set up).
 */
export function getRootMappings(): RootMapping[] {
  const raw = getSetting<string>('sync.rootMappings', '[]')
  try {
    return JSON.parse(raw) as RootMapping[]
  } catch {
    return []
  }
}

/**
 * Convert an absolute local path to a relative sync path.
 *
 * Finds the longest matching localAbsolute prefix among all root mappings
 * and replaces it with the corresponding syncRelative prefix.
 *
 * Returns null if the file is outside all mapped roots (not syncable).
 *
 * Example:
 *   Input:  "/Users/kyle/Dropbox/Art/landscapes/sunset.jpg"
 *   Mapping: { localAbsolute: "/Users/kyle/Dropbox/Art", syncRelative: "Art" }
 *   Output: "Art/landscapes/sunset.jpg"
 */
export function toRelativePath(absolutePath: string): string | null {
  const mappings = getRootMappings()
  if (mappings.length === 0) return null

  // Normalize the input path to use the OS separator
  const normalized = path.normalize(absolutePath)

  // Find the longest matching prefix (most specific mapping wins)
  let bestMapping: RootMapping | null = null
  let bestPrefixLength = 0

  for (const mapping of mappings) {
    const normalizedLocal = path.normalize(mapping.localAbsolute)
    // Check if the path starts with this mapping's local root
    if (normalized.startsWith(normalizedLocal + path.sep) || normalized === normalizedLocal) {
      if (normalizedLocal.length > bestPrefixLength) {
        bestMapping = mapping
        bestPrefixLength = normalizedLocal.length
      }
    }
  }

  if (!bestMapping) return null

  // Replace the local prefix with the sync relative prefix
  const normalizedLocal = path.normalize(bestMapping.localAbsolute)
  const remainder = normalized.slice(normalizedLocal.length)

  // Convert to forward slashes for the event log (POSIX-style, cross-platform)
  const relRemainder = remainder.split(path.sep).join('/')
  const relPath = bestMapping.syncRelative + relRemainder

  return relPath
}

/**
 * Convert a relative sync path back to an absolute local path.
 *
 * Finds the matching syncRelative prefix and replaces it with localAbsolute.
 *
 * Returns null if no mapping matches (file not present on this machine).
 *
 * Example:
 *   Input:  "Art/landscapes/sunset.jpg"
 *   Mapping: { localAbsolute: "/Users/kyle/Dropbox/Art", syncRelative: "Art" }
 *   Output: "/Users/kyle/Dropbox/Art/landscapes/sunset.jpg"
 */
export function toAbsolutePath(relPath: string): string | null {
  const mappings = getRootMappings()
  if (mappings.length === 0) return null

  // Find the matching sync prefix (longest match wins)
  let bestMapping: RootMapping | null = null
  let bestPrefixLength = 0

  for (const mapping of mappings) {
    const syncPrefix = mapping.syncRelative
    if (relPath.startsWith(syncPrefix + '/') || relPath === syncPrefix) {
      if (syncPrefix.length > bestPrefixLength) {
        bestMapping = mapping
        bestPrefixLength = syncPrefix.length
      }
    }
  }

  if (!bestMapping) return null

  // Replace the sync prefix with the local absolute path
  const remainder = relPath.slice(bestMapping.syncRelative.length)
  // Convert forward slashes to OS-native separators
  const nativeRemainder = remainder.split('/').join(path.sep)
  return path.join(bestMapping.localAbsolute, nativeRemainder)
}
