import { app, BrowserWindow, protocol, net, nativeImage } from 'electron'
import { pathToFileURL } from 'url'

// Disable Chromium's built-in pinch-to-zoom at the engine level.
// On macOS, trackpad pinch fires wheel events with ctrlKey: true. Chromium
// normally intercepts these *before* any DOM event listener (even capture-phase)
// to handle its native page zoom. This switch prevents that interception entirely,
// so our renderer-side useGalleryZoom hook can use pinch events for tile resizing.
app.commandLine.appendSwitch('disable-pinch')
import path from 'path'

// Pin the userData path so it stays stable across app renames.
// Electron derives userData from productName in package.json — so renaming the
// app (e.g. "kArtGallery" → "Art Gallery") would silently change the data
// directory, causing the app to lose its database, thumbnails, and preferences.
// By hardcoding the path to the original name, data survives display-name changes.
// Must run before anything calls app.getPath('userData') (e.g. paths.ts).
app.setPath('userData', path.join(app.getPath('appData'), 'kArtGallery'))
import fs from 'fs'
import os from 'os'
import { initDb, closeDb } from './db/connection'
import { registerAllHandlers } from './ipc/handlers'
import { shutdownWorkers } from './thumbnails/thumbnail-manager'
import { shutdownWatcher } from './watcher/folder-watcher'
import { initSync, shutdownSync } from './sync/sync-watcher'

// Register a custom protocol to serve local files securely.
// By default, Electron's renderer can't load file:// URLs for security reasons.
// Instead, we register a "local-file://" protocol that serves files from disk.
// This is safer than disabling web security — we control exactly what gets served.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-file',
    privileges: {
      secure: true,
      supportFetchAPI: true,
      stream: true
    }
  }
])

function createWindow(): void {
  // macOS: launch fullscreen (hides traffic lights, but they reappear on hover).
  // Windows: launch maximized instead — fullscreen hides the native title bar
  // entirely and there's no hover-to-reveal, so the user loses min/max/close.
  const isMac = process.platform === 'darwin'

  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    fullscreen: isMac,
    icon: path.join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      // These security settings are Electron best practices:
      sandbox: false, // Required for preload script to use Node.js APIs
      contextIsolation: true, // Prevents renderer from accessing Node.js directly
      nodeIntegration: false // Extra safety: no require() in renderer
    }
  })

  // On non-macOS platforms, maximize the window so it fills the screen
  // while keeping the native title bar with min/max/close buttons.
  if (!isMac) {
    mainWindow.maximize()
  }

  // Prevent Electron's default pinch/Ctrl+scroll zoom so our custom tile
  // scaling (useGalleryZoom) handles it instead. Must run after page loads
  // because setVisualZoomLevelLimits requires an active renderer.
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.setZoomFactor(1)
    mainWindow.webContents.setVisualZoomLevelLimits(1, 1)
  })

  // Lock zoom factor to 1. Chromium still intercepts Ctrl+scroll (trackpad
  // pinch) and changes zoomFactor even with visual limits set. This resets
  // it immediately so the page never actually zooms — our renderer-side
  // useGalleryZoom hook handles tile resizing instead.
  mainWindow.webContents.on('zoom-changed', () => {
    mainWindow.webContents.setZoomFactor(1)
  })

  // In development, load from Vite's dev server (with HMR).
  // In production, load the built HTML file.
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // Register the local-file protocol handler.
  // When the renderer loads <img src="local-file:///path/to/image.jpg">,
  // this handler reads the file from disk and streams it back.
  protocol.handle('local-file', (request) => {
    // Strip the protocol prefix to get the file path.
    // On Windows, paths look like C:\Users\... which can't be naively
    // prepended with file:// (needs file:///C:/Users/... with forward slashes).
    // Node's pathToFileURL handles all the edge cases: drive letters, spaces,
    // special characters, and OS-specific separators.
    const filePath = decodeURIComponent(request.url.replace('local-file://', ''))
    return net.fetch(pathToFileURL(filePath).href)
  })

  // Set the dock icon and app name for dev mode. In production builds,
  // electron-builder handles this via the packaged .app bundle. But in dev
  // mode, Electron uses its default icon and "Electron" process name.
  if (process.platform === 'darwin') {
    const iconPath = path.join(__dirname, '../../resources/icon.png')
    if (fs.existsSync(iconPath)) {
      app.dock.setIcon(nativeImage.createFromPath(iconPath))
    }
  }

  initDb()
  registerAllHandlers()

  // Initialize cross-device sync: import events that arrived while the app
  // was closed, then start watching the event log for live changes.
  // Must run after initDb() and registerAllHandlers() since import writes to
  // the DB and sync IPC handlers need to be registered.
  initSync()

  createWindow()

  // macOS convention: re-create window when dock icon is clicked and no windows exist
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// Clean up preview cache on quit
app.on('will-quit', () => {
  try {
    const previewDir = path.join(os.tmpdir(), 'kArtGallery-previews')
    if (fs.existsSync(previewDir)) {
      fs.rmSync(previewDir, { recursive: true, force: true })
    }
  } catch { /* best effort */ }
})

// Quit when all windows are closed (except on macOS, where apps stay in dock)
app.on('window-all-closed', () => {
  shutdownSync()
  shutdownWatcher()
  shutdownWorkers()
  closeDb()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
