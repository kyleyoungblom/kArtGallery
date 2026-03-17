import { ipcMain } from 'electron'
import { findDuplicateGroups, getDuplicateCount, getHashProgress } from '../db/repositories/duplicates.repo'
import { resetAllHashes, resetFilesNeedingHashes } from '../db/repositories/files.repo'
import { startThumbnailGeneration } from '../thumbnails/thumbnail-manager'
import { appLog } from '../utils/app-logger'

// IPC handlers for duplicate image detection.
//
// duplicates:find-groups — runs the detection algorithm and returns grouped results.
// duplicates:rehash-all — clears all hashes and re-queues files for hash computation.
// duplicates:get-hash-progress — returns how many files have been hashed vs total.

export function registerDuplicateHandlers(): void {
  ipcMain.handle('duplicates:find-groups', (_event, options?: { threshold?: number }) => {
    const threshold = options?.threshold ?? 0
    appLog('info', 'duplicates', `Finding duplicate groups (threshold: ${threshold})`)
    const groups = findDuplicateGroups(threshold)
    const totalDupes = groups.reduce((sum, g) => sum + g.files.length, 0)
    appLog('info', 'duplicates', `Found ${groups.length} groups (${totalDupes} files)`)
    return groups
  })

  ipcMain.handle('duplicates:rehash-all', () => {
    const count = resetAllHashes()
    appLog('info', 'duplicates', `Reset ${count} hashes — re-queuing for computation`)
    // Trigger re-computation by resetting thumbnail state for unhashed files
    resetFilesNeedingHashes()
    startThumbnailGeneration()
    return { count }
  })

  ipcMain.handle('duplicates:get-count', () => {
    return getDuplicateCount()
  })

  ipcMain.handle('duplicates:get-hash-progress', () => {
    return getHashProgress()
  })
}
