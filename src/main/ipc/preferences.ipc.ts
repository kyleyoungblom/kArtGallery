import { ipcMain } from 'electron'
import { getAllPreferences, setPreference } from '../db/repositories/preferences.repo'

export function registerPreferencesHandlers(): void {
  ipcMain.handle('preferences:get-all', () => {
    return getAllPreferences()
  })

  ipcMain.handle('preferences:set', (_event, key: string, value: string) => {
    setPreference(key, value)
  })
}
