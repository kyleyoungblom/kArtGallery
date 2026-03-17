import { BrowserWindow } from 'electron'

// Centralized logger that both writes to the console (for your terminal)
// and sends log entries to the renderer (for the in-app log viewer).
//
// Why not just use console.log? Two reasons:
// 1. console.log in the main process only shows in the terminal — the user
//    can't see it from inside the app
// 2. We want structured log entries (timestamp, level, source) that the
//    UI can filter and display nicely

export type LogLevel = 'info' | 'warn' | 'error'

export interface LogEntry {
  timestamp: string
  level: LogLevel
  source: string
  message: string
}

export function appLog(level: LogLevel, source: string, message: string): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    source,
    message
  }

  // Write to terminal
  const prefix = `[${source}]`
  switch (level) {
    case 'info':
      console.log(prefix, message)
      break
    case 'warn':
      console.warn(prefix, message)
      break
    case 'error':
      console.error(prefix, message)
      break
  }

  // Send to renderer for the log viewer
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    win.webContents.send('app:log', entry)
  }
}
