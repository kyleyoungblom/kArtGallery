import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// electron-vite builds three separate bundles:
// 1. main — runs in Node.js (Electron main process)
// 2. preload — runs in a restricted Node.js context (bridge between main and renderer)
// 3. renderer — runs in Chromium (your React app)
//
// This separation is an Electron security best practice. The renderer (web page)
// should never have direct access to Node.js APIs like the filesystem or database.
// Instead, it talks to the main process through the preload bridge.

export default defineConfig({
  main: {
    plugins: [
      // This plugin marks all node_modules as external for the main process build.
      // Native modules like better-sqlite3 can't be bundled by Vite — they need
      // to be loaded as-is at runtime. This plugin handles that automatically.
      externalizeDepsPlugin()
    ]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
