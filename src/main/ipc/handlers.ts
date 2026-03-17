import { registerFileHandlers } from './files.ipc'
import { registerThumbnailHandlers } from './thumbnails.ipc'
import { registerPreferencesHandlers } from './preferences.ipc'
import { registerHiddenHandlers } from './hidden.ipc'
import { registerMaintenanceHandlers } from './maintenance.ipc'
import { registerStackHandlers } from './stacks.ipc'
import { registerWatcherHandlers } from './watcher.ipc'
import { registerDuplicateHandlers } from './duplicates.ipc'

// Single registration point for all IPC handlers. This makes it easy to see
// at a glance what the main process can do, and ensures we don't accidentally
// register handlers multiple times (which would cause Electron warnings).

export function registerAllHandlers(): void {
  registerFileHandlers()
  registerThumbnailHandlers()
  registerPreferencesHandlers()
  registerHiddenHandlers()
  registerMaintenanceHandlers()
  registerStackHandlers()
  registerWatcherHandlers()
  registerDuplicateHandlers()
}
