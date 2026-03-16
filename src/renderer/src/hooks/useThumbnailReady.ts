import { useEffect, useState } from 'react'

// Lightweight pub/sub for thumbnail-ready notifications.
//
// Problem: each GalleryTile was creating its own IPC listener for
// 'thumbnails:ready'. With 500+ visible tiles, that meant 500+ listeners
// on a single IPC channel — Node warns at 10 and performance degrades.
//
// Solution: ONE global IPC listener feeds a simple in-memory pub/sub.
// Tiles subscribe here (zero IPC cost per tile). When their file ID
// appears in a batch, they get notified.
//
// This is the Observer pattern — a single event source (the IPC listener)
// broadcasts to many observers (the tiles) without them knowing about
// each other or about IPC at all.

type Callback = () => void
const subscribers = new Map<number, Set<Callback>>()
let initialized = false

function subscribe(fileId: number, callback: Callback): () => void {
  if (!subscribers.has(fileId)) {
    subscribers.set(fileId, new Set())
  }
  subscribers.get(fileId)!.add(callback)

  // Return unsubscribe function
  return () => {
    const subs = subscribers.get(fileId)
    if (subs) {
      subs.delete(callback)
      if (subs.size === 0) {
        subscribers.delete(fileId)
      }
    }
  }
}

function notifyBatch(fileIds: number[]): void {
  for (const id of fileIds) {
    const subs = subscribers.get(id)
    if (subs) {
      for (const callback of subs) {
        callback()
      }
      // Once notified, remove — the tile will update and won't need
      // further notifications for this file ID
      subscribers.delete(id)
    }
  }
}

// Call this once at app startup to wire up the single IPC listener.
export function initThumbnailNotifications(): void {
  if (initialized) return
  initialized = true
  window.api.onThumbnailsReady(notifyBatch)
}

// Hook for tiles: returns true once the thumbnail for this file ID is ready.
// The tile can then re-request the thumbnail path from the main process.
export function useThumbnailReady(fileId: number, alreadyCached: boolean): boolean {
  const [ready, setReady] = useState(alreadyCached)

  useEffect(() => {
    if (alreadyCached) return

    const unsubscribe = subscribe(fileId, () => setReady(true))
    return unsubscribe
  }, [fileId, alreadyCached])

  return ready
}
