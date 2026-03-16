# Changelog

All notable changes to kArtGallery will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.0] - 2026-03-16

### Added

- Sharp-based thumbnail pipeline with worker thread pool (one per CPU core - 1)
- Thumbnails cached as 400px JPEGs in app data directory
- Batch notification system: tiles refresh as thumbnails become available
- Loading shimmer animation on tiles waiting for thumbnail generation
- Pinned folder: last-opened folder auto-loads on next app launch
- `dev.command` launcher for double-click from Finder

### Fixed

- Files not appearing after folder scan (scanVersion counter fix)
- Tiles not updating when thumbnails generate after initial load

### Changed

- Removed all border-radius for rectangular corners

## [0.1.0] - 2026-03-16

### Added

- Project scaffolding with Electron + React + TypeScript via electron-vite
- SQLite database with migration system (better-sqlite3, WAL mode)
- Recursive folder scanner with progress reporting
- Folder tree sidebar with recursive expand/collapse
- Virtualized masonry grid using masonic for smooth scrolling
- Display controls: tile size slider, gap slider, crop-to-aspect toggle
- Sort controls: by name, date modified, date created, file size (asc/desc)
- Group controls: none, by folder, by month, by year
- Typed IPC layer with preload security bridge (contextBridge)
- Custom `local-file://` protocol for secure image loading
- Dark theme with CSS custom properties
- Status bar showing file count and scan progress
