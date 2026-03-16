import fs from 'fs'
import path from 'path'
import { isSupportedImage } from '../utils/supported-formats'
import { UpsertFileData } from '../db/repositories/files.repo'

// The scanner is intentionally simple: recursive readdir + stat.
// We don't use glob libraries or complex file-walking abstractions
// because our needs are straightforward and we want to control
// exactly how progress is reported.

export interface ScanResult {
  files: UpsertFileData[]
  subfolders: string[]
}

export interface ScanCallbacks {
  onProgress?: (scanned: number, total: number, currentFile: string) => void
}

export async function scanFolder(
  folderPath: string,
  folderId: number,
  callbacks?: ScanCallbacks
): Promise<ScanResult> {
  const files: UpsertFileData[] = []
  const subfolders: string[] = []

  // First pass: collect all entries to get a total count for progress reporting.
  // This is a small upfront cost that makes the progress bar accurate instead
  // of indeterminate (which is a much worse user experience).
  const allEntries = await collectEntries(folderPath)
  let scanned = 0

  for (const entryPath of allEntries) {
    try {
      const stat = await fs.promises.stat(entryPath)

      if (stat.isDirectory()) {
        subfolders.push(entryPath)
      } else if (stat.isFile() && isSupportedImage(entryPath)) {
        const filename = path.basename(entryPath)
        const extension = path.extname(entryPath).toLowerCase()

        files.push({
          path: entryPath,
          filename,
          extension,
          folderId,
          sizeBytes: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          createdAt: stat.birthtime.toISOString()
        })
      }

      scanned++
      if (callbacks?.onProgress && scanned % 50 === 0) {
        callbacks.onProgress(scanned, allEntries.length, entryPath)
      }
    } catch {
      // Skip files we can't stat (permissions, broken symlinks, etc.)
      // This is intentional — a gallery app shouldn't crash because of
      // one unreadable file. We silently skip and continue.
      scanned++
    }
  }

  // Final progress update
  callbacks?.onProgress?.(scanned, allEntries.length, '')

  return { files, subfolders }
}

// Recursively collect all file/directory paths under a root.
// Returns a flat array for simple iteration.
async function collectEntries(dirPath: string): Promise<string[]> {
  const entries: string[] = []

  try {
    const dirents = await fs.promises.readdir(dirPath, { withFileTypes: true })

    for (const dirent of dirents) {
      // Skip hidden files/folders (starting with .) — these are OS metadata
      // like .DS_Store, .Thumbs.db, etc. that we never want to index.
      if (dirent.name.startsWith('.')) continue

      const fullPath = path.join(dirPath, dirent.name)
      entries.push(fullPath)

      if (dirent.isDirectory()) {
        const subEntries = await collectEntries(fullPath)
        entries.push(...subEntries)
      }
    }
  } catch {
    // Can't read directory — skip it
  }

  return entries
}
