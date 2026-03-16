import { getDb } from '../connection'

export function getPreference(key: string): string | undefined {
  const row = getDb()
    .prepare('SELECT value FROM preferences WHERE key = ?')
    .get(key) as { value: string } | undefined
  return row?.value
}

export function setPreference(key: string, value: string): void {
  getDb()
    .prepare(
      'INSERT INTO preferences (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?'
    )
    .run(key, value, value)
}

export function getAllPreferences(): Record<string, string> {
  const rows = getDb()
    .prepare('SELECT key, value FROM preferences')
    .all() as { key: string; value: string }[]

  const prefs: Record<string, string> = {}
  for (const row of rows) {
    prefs[row.key] = row.value
  }
  return prefs
}
