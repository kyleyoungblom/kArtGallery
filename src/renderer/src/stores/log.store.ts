import { create } from 'zustand'

// Store for log entries sent from the main process via the app:log IPC channel.
// The StatusBar and LogPanel read from this store.

export interface LogEntry {
  timestamp: string
  level: string
  source: string
  message: string
}

interface LogState {
  entries: LogEntry[]
  isLogPanelOpen: boolean

  // Thumbnail processing progress (from thumbnails:progress IPC)
  thumbnailProgress: { generated: number; total: number; currentFile: string } | null

  addEntry: (entry: LogEntry) => void
  setLogPanelOpen: (open: boolean) => void
  toggleLogPanel: () => void
  setThumbnailProgress: (progress: { generated: number; total: number; currentFile: string } | null) => void
  clearEntries: () => void
}

const MAX_LOG_ENTRIES = 500

export const useLogStore = create<LogState>((set) => ({
  entries: [],
  isLogPanelOpen: false,
  thumbnailProgress: null,

  addEntry: (entry) =>
    set((state) => ({
      entries: [...state.entries, entry].slice(-MAX_LOG_ENTRIES)
    })),

  setLogPanelOpen: (open) => set({ isLogPanelOpen: open }),
  toggleLogPanel: () => set((state) => ({ isLogPanelOpen: !state.isLogPanelOpen })),
  setThumbnailProgress: (progress) => set({ thumbnailProgress: progress }),
  clearEntries: () => set({ entries: [] })
}))
