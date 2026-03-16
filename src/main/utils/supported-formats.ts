// Single source of truth for which file extensions the app recognizes.
// Adding a new format means updating this one file — the scanner,
// thumbnail pipeline, and UI all reference this list.

export const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.tiff',
  '.tif',
  '.bmp',
  '.svg',
  '.psd'
])

export const PSD_EXTENSIONS = new Set(['.psd'])

export function isSupportedImage(filename: string): boolean {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase()
  return SUPPORTED_IMAGE_EXTENSIONS.has(ext)
}

export function isPsd(filename: string): boolean {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase()
  return PSD_EXTENSIONS.has(ext)
}
