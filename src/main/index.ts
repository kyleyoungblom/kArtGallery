import { app, BrowserWindow, protocol, net } from 'electron'
import path from 'path'
import { initDb, closeDb } from './db/connection'
import { registerAllHandlers } from './ipc/handlers'
import { shutdownWorkers } from './thumbnails/thumbnail-manager'

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
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      // These security settings are Electron best practices:
      sandbox: false, // Required for preload script to use Node.js APIs
      contextIsolation: true, // Prevents renderer from accessing Node.js directly
      nodeIntegration: false // Extra safety: no require() in renderer
    }
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
    // Strip the protocol prefix to get the file path
    const filePath = decodeURIComponent(request.url.replace('local-file://', ''))
    return net.fetch(`file://${filePath}`)
  })

  initDb()
  registerAllHandlers()
  createWindow()

  // macOS convention: re-create window when dock icon is clicked and no windows exist
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// Quit when all windows are closed (except on macOS, where apps stay in dock)
app.on('window-all-closed', () => {
  shutdownWorkers()
  closeDb()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
