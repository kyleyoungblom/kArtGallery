// Single source of truth for every configurable value in the app.
//
// Each key maps 1:1 to a preferences DB key using dot notation
// (e.g., APP_DEFAULTS.thumbnail.maxDimension → DB key "thumbnail.maxDimension").
//
// Why a flat-ish object instead of a JSON config file?
// - TypeScript enforces the shape at compile time
// - Defaults live next to the code that uses them (greppable)
// - A future Settings UI can iterate this to auto-generate form fields
//
// This is the Obsidian pattern: defaults → user overrides → runtime value.

export const APP_DEFAULTS = {
  thumbnail: {
    maxDimension: 400,
    jpegQuality: 80
  }
} as const
