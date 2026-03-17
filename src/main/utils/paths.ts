import { app } from 'electron'
import path from 'path'
import os from 'os'
import fs from 'fs'

// Centralize all path resolution in one place. This makes it easy to find
// where data lives, and ensures we never scatter path-building logic across
// the codebase. If we ever need to change the data location (e.g., for
// portable mode), there's exactly one file to update.

function ensureDir(dir: string): string {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function getAppDataDir(): string {
  return ensureDir(path.join(app.getPath('userData'), 'kArtGallery'))
}

export function getDbPath(): string {
  return path.join(getAppDataDir(), 'kartgallery.db')
}

export function getThumbnailCacheDir(): string {
  return ensureDir(path.join(getAppDataDir(), 'thumbnails'))
}

export function getPreviewCacheDir(): string {
  return ensureDir(path.join(os.tmpdir(), 'kArtGallery-previews'))
}
