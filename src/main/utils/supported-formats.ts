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

// Formats that sharp can decode for thumbnail generation.
// TIFF and BMP are included — sharp (via libvips) handles most variants.
// Unusual variants (OS/2 BMP, exotic TIFF compression) will fail gracefully
// and get recorded as failed files rather than silently skipped.
// PSD and SVG need special handling (PSD via @webtoon/psd, SVG via rasterizer).
export const SHARP_SUPPORTED_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.tiff',
  '.tif',
  '.bmp'
])

// Formats a browser <img> tag can natively render.
// Used to decide whether getThumbnail should fall back to the original file
// when no cached thumbnail exists. Non-renderable formats (PSD, TIFF) should
// show a placeholder instead of an invisible broken image.
export const BROWSER_RENDERABLE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.svg',
  '.bmp'
])

function getExtension(filename: string): string {
  return filename.slice(filename.lastIndexOf('.')).toLowerCase()
}

export function isSupportedImage(filename: string): boolean {
  return SUPPORTED_IMAGE_EXTENSIONS.has(getExtension(filename))
}

export function isSharpSupported(filename: string): boolean {
  return SHARP_SUPPORTED_EXTENSIONS.has(getExtension(filename))
}

export function isBrowserRenderable(filename: string): boolean {
  return BROWSER_RENDERABLE_EXTENSIONS.has(getExtension(filename))
}

export function isPsd(filename: string): boolean {
  return PSD_EXTENSIONS.has(getExtension(filename))
}
