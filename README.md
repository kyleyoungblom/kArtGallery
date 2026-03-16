# kArtGallery

A fast, lightweight desktop app for browsing local image collections. Built for artists and creators who store their work in regular folders and want a better way to browse, organize, and review it.

## Features (MVP)

- Browse images from any local folder with recursive subfolder scanning
- Virtualized masonry grid for smooth scrolling through thousands of images
- Adjustable display: tile size, gap spacing, crop-to-aspect toggle
- Sortable by name, date modified, date created, or file size
- Groupable by folder, month, or year
- Folder tree sidebar for navigation
- Dark theme

## Tech Stack

- **Electron** — cross-platform desktop shell
- **React + TypeScript** — UI layer
- **electron-vite** — build tooling with HMR
- **better-sqlite3** — metadata storage (in app data directory, not your image folders)
- **masonic** — virtualized masonry grid
- **zustand** — state management

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Project Structure

```
src/
  main/         # Electron main process (Node.js)
    db/         # SQLite connection, migrations, repositories
    ipc/        # IPC handlers (bridge between main and renderer)
    scanner/    # Folder scanning logic
    thumbnails/ # Thumbnail generation (Phase 3)
    utils/      # Path helpers, format detection
  preload/      # Security bridge (contextBridge API)
  renderer/     # React app (Chromium)
    src/
      components/  # UI components
      hooks/       # Custom React hooks
      stores/      # Zustand state stores
      styles/      # CSS
      types/       # TypeScript interfaces
```
