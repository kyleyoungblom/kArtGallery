import chokidar from 'chokidar'
import type { FSWatcher } from 'chokidar'
import path from 'path'
import fs from 'fs'
import { BrowserWindow } from 'electron'
import { isSupportedImage } from '../utils/supported-formats'
import { upsertFolder, updateFolderPathPrefix, removeFoldersByPathPrefix } from '../db/repositories/folders.repo'
import { upsertFile, getFileByPath, removeFileByPath, updateFilePathPrefix, removeFilesByFolderPrefix } from '../db/repositories/files.repo'
import { startThumbnailGeneration } from '../thumbnails/thumbnail-manager'
import { getThumbnailCacheDir } from '../utils/paths'
import { appLog } from '../utils/app-logger'

// File system watcher for pinned folders.
//
// Uses chokidar to monitor pinned folder trees and incrementally update the DB
// when files or folders change on disk. This means renames, additions, and
// deletions in Finder are reflected in the app automatically.
//
// Design:
// - One chokidar instance per pinned root (clean lifecycle per folder)
// - Events are debounced into batches (500ms quiet period) to avoid
//   thrashing during bulk Finder operations
// - Folder renames are detected by pairing unlinkDir/addDir events within
//   the same batch that share the same parent directory
// - All DB updates happen in the debounce callback, not per-event

interface PendingEvent {
  type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'
  path: string
  timestamp: number
}

const watchers = new Map<string, FSWatcher>()
const pendingEvents = new Map<string, PendingEvent[]>()
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

const DEBOUNCE_MS = 500

// ── Public API ──

export function watchFolder(folderPath: string): void {
  // Don't double-watch
  if (watchers.has(folderPath)) return

  const watcher = chokidar.watch(folderPath, {
    ignoreInitial: true,                    // Don't emit events for existing files
    ignored: /(^|[/\\])\./,                 // Skip dotfiles (.DS_Store, etc.)
    awaitWriteFinish: { stabilityThreshold: 300 },  // Wait for writes to finish
    persistent: true,
    depth: undefined                        // Watch all levels
  })

  watcher
    .on('add', (p) => queueEvent(folderPath, 'add', p))
    .on('change', (p) => queueEvent(folderPath, 'change', p))
    .on('unlink', (p) => queueEvent(folderPath, 'unlink', p))
    .on('addDir', (p) => queueEvent(folderPath, 'addDir', p))
    .on('unlinkDir', (p) => queueEvent(folderPath, 'unlinkDir', p))
    .on('error', (err) => appLog('error', 'watcher', `Watch error on ${folderPath}: ${err.message}`))

  watchers.set(folderPath, watcher)
  appLog('info', 'watcher', `Watching: ${folderPath}`)
}

export function unwatchFolder(folderPath: string): void {
  const watcher = watchers.get(folderPath)
  if (!watcher) return

  watcher.close()
  watchers.delete(folderPath)
  pendingEvents.delete(folderPath)

  const timer = debounceTimers.get(folderPath)
  if (timer) {
    clearTimeout(timer)
    debounceTimers.delete(folderPath)
  }

  appLog('info', 'watcher', `Stopped watching: ${folderPath}`)
}

export function shutdownWatcher(): void {
  for (const [root] of watchers) {
    unwatchFolder(root)
  }
}

// ── Event Accumulation + Debounce ──

function queueEvent(root: string, type: PendingEvent['type'], filePath: string): void {
  if (!pendingEvents.has(root)) {
    pendingEvents.set(root, [])
  }
  pendingEvents.get(root)!.push({ type, path: filePath, timestamp: Date.now() })

  // Reset the debounce timer — wait for 500ms of quiet before processing
  const existing = debounceTimers.get(root)
  if (existing) clearTimeout(existing)

  debounceTimers.set(root, setTimeout(() => {
    debounceTimers.delete(root)
    processBatch(root)
  }, DEBOUNCE_MS))
}

// ── Batch Processing ──

function processBatch(root: string): void {
  const events = pendingEvents.get(root)
  if (!events || events.length === 0) return
  pendingEvents.set(root, [])

  // Separate directory events from file events
  const dirAdds: string[] = []
  const dirRemoves: string[] = []
  const fileAdds: string[] = []
  const fileChanges: string[] = []
  const fileRemoves: string[] = []

  for (const evt of events) {
    switch (evt.type) {
      case 'addDir': dirAdds.push(evt.path); break
      case 'unlinkDir': dirRemoves.push(evt.path); break
      case 'add': fileAdds.push(evt.path); break
      case 'change': fileChanges.push(evt.path); break
      case 'unlink': fileRemoves.push(evt.path); break
    }
  }

  // 1. Detect folder renames: pair unlinkDir + addDir with same parent
  const { renames, remainingAdds, remainingRemoves } = detectFolderRenames(dirAdds, dirRemoves)

  let totalChanges = 0

  // 2. Apply folder renames — update paths in-place to preserve metadata
  for (const { oldPath, newPath } of renames) {
    const folderChanges = updateFolderPathPrefix(oldPath, newPath)
    const fileChanges = updateFilePathPrefix(oldPath, newPath)
    appLog('info', 'watcher', `Folder renamed: ${path.basename(oldPath)} → ${path.basename(newPath)} (${folderChanges} folders, ${fileChanges} files updated)`)
    totalChanges += folderChanges + fileChanges

    // Rewrite any pending file events that reference the old path
    // (chokidar may emit file events with old paths before the rename is detected)
    rewritePendingPaths(fileAdds, oldPath, newPath)
    rewritePendingPaths(fileChanges, oldPath, newPath)
    rewritePendingPaths(fileRemoves, oldPath, newPath)
  }

  // 3. Process remaining folder additions
  for (const dirPath of remainingAdds) {
    upsertFolder(dirPath)
    totalChanges++
  }

  // 4. Process remaining folder deletions (cascade to files)
  for (const dirPath of remainingRemoves) {
    const removedFiles = removeFilesByFolderPrefix(dirPath)
    const removedFolders = removeFoldersByPathPrefix(dirPath)
    totalChanges += removedFiles + removedFolders
    if (removedFiles > 0 || removedFolders > 0) {
      appLog('info', 'watcher', `Folder deleted: ${dirPath} (${removedFolders} folders, ${removedFiles} files removed)`)
    }
  }

  // 5. Process file additions
  let addedCount = 0
  for (const filePath of fileAdds) {
    if (!isSupportedImage(filePath)) continue
    try {
      const stat = fs.statSync(filePath)
      const folder = upsertFolder(path.dirname(filePath))
      upsertFile({
        path: filePath,
        filename: path.basename(filePath),
        extension: path.extname(filePath).toLowerCase(),
        folderId: folder.id,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        createdAt: stat.birthtime.toISOString()
      })
      addedCount++
    } catch {
      // File may have been moved again before we could stat it — skip
    }
  }

  // 6. Process file modifications (upsert handles updates)
  let modifiedCount = 0
  for (const filePath of fileChanges) {
    if (!isSupportedImage(filePath)) continue
    try {
      const stat = fs.statSync(filePath)
      const folder = upsertFolder(path.dirname(filePath))
      upsertFile({
        path: filePath,
        filename: path.basename(filePath),
        extension: path.extname(filePath).toLowerCase(),
        folderId: folder.id,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        createdAt: stat.birthtime.toISOString()
      })
      modifiedCount++
    } catch {
      // Skip unreadable files
    }
  }

  // 7. Process file removals + thumbnail cleanup
  let removedCount = 0
  const cacheDir = getThumbnailCacheDir()
  for (const filePath of fileRemoves) {
    if (!isSupportedImage(filePath)) continue
    // Look up the file first to get its thumbnail path for cleanup
    const existing = getFileByPath(filePath)
    if (existing) {
      removeFileByPath(filePath)
      removedCount++
      // Clean up thumbnail from cache
      if (existing.thumbnail_path) {
        try { fs.unlinkSync(existing.thumbnail_path) } catch { /* best effort */ }
      } else if (existing.id) {
        // Thumbnail might be at the default path even if thumbnail_path is null
        const thumbPath = path.join(cacheDir, `${existing.id}.jpg`)
        try { fs.unlinkSync(thumbPath) } catch { /* best effort */ }
      }
    }
  }

  totalChanges += addedCount + modifiedCount + removedCount

  if (totalChanges === 0) return

  // 8. Trigger thumbnail generation for newly added files
  if (addedCount > 0) {
    startThumbnailGeneration()
  }

  // 9. Notify all renderer windows so they refresh
  const changePayload = {
    added: fileAdds.filter(isSupportedImage),
    removed: fileRemoves.filter(isSupportedImage),
    modified: fileChanges.filter(isSupportedImage)
  }

  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('watcher:files-changed', changePayload)
  }

  // 10. Log summary
  const parts: string[] = []
  if (renames.length > 0) parts.push(`${renames.length} folder rename(s)`)
  if (addedCount > 0) parts.push(`${addedCount} added`)
  if (modifiedCount > 0) parts.push(`${modifiedCount} modified`)
  if (removedCount > 0) parts.push(`${removedCount} removed`)
  if (remainingRemoves.length > 0) parts.push(`${remainingRemoves.length} folder(s) deleted`)
  appLog('info', 'watcher', `Changes detected: ${parts.join(', ')}`)
}

// ── Folder Rename Detection ──

// Heuristic: within a single debounced batch, if an unlinkDir and addDir share
// the same parent directory, treat it as a rename. This matches the common
// Finder rename workflow (right-click → Rename produces unlinkDir + addDir
// in rapid succession). Cross-directory moves are treated as delete + add.
function detectFolderRenames(
  adds: string[],
  removes: string[]
): { renames: Array<{ oldPath: string; newPath: string }>; remainingAdds: string[]; remainingRemoves: string[] } {
  const renames: Array<{ oldPath: string; newPath: string }> = []
  const usedAdds = new Set<number>()
  const usedRemoves = new Set<number>()

  for (let ri = 0; ri < removes.length; ri++) {
    const removedParent = path.dirname(removes[ri])
    for (let ai = 0; ai < adds.length; ai++) {
      if (usedAdds.has(ai)) continue
      const addedParent = path.dirname(adds[ai])
      if (removedParent === addedParent) {
        renames.push({ oldPath: removes[ri], newPath: adds[ai] })
        usedAdds.add(ai)
        usedRemoves.add(ri)
        break // One rename per remove
      }
    }
  }

  return {
    renames,
    remainingAdds: adds.filter((_, i) => !usedAdds.has(i)),
    remainingRemoves: removes.filter((_, i) => !usedRemoves.has(i))
  }
}

// Rewrite paths in an array from oldPrefix to newPrefix.
// Used after a folder rename is detected — any pending file events that still
// reference the old folder path need to be updated.
function rewritePendingPaths(paths: string[], oldPrefix: string, newPrefix: string): void {
  for (let i = 0; i < paths.length; i++) {
    if (paths[i].startsWith(oldPrefix + '/') || paths[i] === oldPrefix) {
      paths[i] = newPrefix + paths[i].slice(oldPrefix.length)
    }
  }
}
