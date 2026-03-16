import { ipcMain, dialog, BrowserWindow } from 'electron'
import path from 'path'
import { scanFolder } from '../scanner/folder-scanner'
import { upsertFolder, updateLastScanned, getAllFolders } from '../db/repositories/folders.repo'
import { upsertFiles, getFilesByFolder, getAllFiles } from '../db/repositories/files.repo'
import { startThumbnailGeneration } from '../thumbnails/thumbnail-manager'
import type { FolderNode } from '../../renderer/src/types/models'
import fs from 'fs'

export function registerFileHandlers(): void {
  ipcMain.handle('dialog:pick-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select Image Folder'
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('gallery:scan-folder', async (event, folderPath: string) => {
    const window = BrowserWindow.fromWebContents(event.sender)

    // Upsert the root folder and all subfolders into the DB.
    // We scan recursively, creating a folder record for each subdirectory.
    // This lets us track which folders are hidden and when they were last scanned.
    const rootFolder = upsertFolder(folderPath)

    const result = await scanFolder(folderPath, rootFolder.id, {
      onProgress: (scanned, total, currentFile) => {
        window?.webContents.send('scan:progress', { scanned, total, currentFile })
      }
    })

    // Create folder records for each subfolder found
    for (const subfolder of result.subfolders) {
      upsertFolder(subfolder)
    }

    // Batch insert all files — this is wrapped in a transaction internally
    // for performance (see files.repo.ts for explanation)
    if (result.files.length > 0) {
      // Assign correct folder IDs based on each file's parent directory
      const filesWithFolders = result.files.map((file) => {
        const parentDir = path.dirname(file.path)
        const folder = upsertFolder(parentDir)
        return { ...file, folderId: folder.id }
      })

      upsertFiles(filesWithFolders)
    }

    updateLastScanned(rootFolder.id)

    // Kick off thumbnail generation in the background.
    // This runs in worker threads so it won't block the UI.
    startThumbnailGeneration()

    return { fileCount: result.files.length, folderCount: result.subfolders.length }
  })

  ipcMain.handle('gallery:get-files', (_event, folderPath: string, includeHidden = false) => {
    if (!folderPath) {
      return getAllFiles(includeHidden)
    }

    const folders = getAllFolders()
    // Find the folder and all its subfolders
    const matchingFolders = folders.filter(
      (f) => f.path === folderPath || f.path.startsWith(folderPath + path.sep)
    )

    const allFiles = matchingFolders.flatMap((f) =>
      getFilesByFolder(f.id, includeHidden)
    )

    return allFiles
  })

  ipcMain.handle('gallery:get-folder-tree', (_event, rootPath: string) => {
    return buildFolderTree(rootPath)
  })
}

// Build a tree structure from the filesystem for the sidebar.
// We read from disk (not DB) so we always show the current state,
// even for folders that haven't been scanned yet.
function buildFolderTree(dirPath: string): FolderNode {
  const name = path.basename(dirPath)
  const children: FolderNode[] = []

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        children.push(buildFolderTree(path.join(dirPath, entry.name)))
      }
    }
  } catch {
    // Can't read directory — return it with no children
  }

  // Sort children alphabetically for consistent display
  children.sort((a, b) => a.name.localeCompare(b.name))

  return { name, path: dirPath, hidden: false, children }
}
