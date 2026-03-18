import { useEffect } from 'react'
import { useGalleryStore } from '../stores/gallery.store'

// Syncs the store's accentColor to CSS custom properties on :root.
// This lets us define a default in global.css but override it at runtime
// when the user picks a custom color in Settings.
//
// Derived colors (muted, hover) are computed from the hex value so we don't
// need a full color library — just parse RGB and adjust.

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.replace('#', ''), 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function lighten(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex)
  const lr = Math.min(255, Math.round(r + (255 - r) * amount))
  const lg = Math.min(255, Math.round(g + (255 - g) * amount))
  const lb = Math.min(255, Math.round(b + (255 - b) * amount))
  return `#${((1 << 24) + (lr << 16) + (lg << 8) + lb).toString(16).slice(1)}`
}

export function useAccentColor(): void {
  const accentColor = useGalleryStore((s) => s.accentColor)

  useEffect(() => {
    const root = document.documentElement
    const { r, g, b } = hexToRgb(accentColor)

    root.style.setProperty('--color-accent', accentColor)
    root.style.setProperty('--color-accent-muted', `rgba(${r}, ${g}, ${b}, 0.15)`)
    root.style.setProperty('--color-accent-hover', lighten(accentColor, 0.15))
  }, [accentColor])
}
