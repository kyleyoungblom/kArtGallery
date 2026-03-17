import { ipcMain } from 'electron'
import { getAllPreferences, setPreference } from '../db/repositories/preferences.repo'
import { APP_DEFAULTS } from '../config/defaults'

export function registerPreferencesHandlers(): void {
  ipcMain.handle('preferences:get-all', () => {
    return getAllPreferences()
  })

  ipcMain.handle('preferences:set', (_event, key: string, value: string) => {
    setPreference(key, value)
  })

  // Returns the app's default configuration values. A future Settings UI
  // can use this to show defaults alongside user overrides.
  ipcMain.handle('preferences:get-defaults', () => {
    return APP_DEFAULTS
  })
}
