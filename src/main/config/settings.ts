import { getPreference } from '../db/repositories/preferences.repo'

// Runtime settings accessor. Reads from the preferences DB, falling back
// to the provided default if no override exists.
//
// The preferences table stores everything as strings (it's a key/value store),
// so this function handles type coercion based on the type of the fallback.
// If the fallback is a number, the DB value is parsed as a number, etc.
//
// Usage:
//   getSetting('thumbnail.maxDimension', APP_DEFAULTS.thumbnail.maxDimension)
//   // Returns 400 (number) if no DB override, or the DB value parsed as number

export function getSetting<T extends string | number | boolean>(key: string, fallback: T): T {
  const raw = getPreference(key)
  if (raw === undefined) return fallback

  // Coerce the string value to match the fallback's type
  if (typeof fallback === 'number') {
    const parsed = Number(raw)
    return (isNaN(parsed) ? fallback : parsed) as T
  }

  if (typeof fallback === 'boolean') {
    return (raw === 'true' || raw === '1') as unknown as T
  }

  // String — return as-is
  return raw as T
}
