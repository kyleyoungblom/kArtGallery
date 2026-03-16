import Database from 'better-sqlite3'
import { getDbPath } from '../utils/paths'
import { runMigrations } from './migrations/001_initial'

// We use a singleton pattern for the database connection. In Electron's main
// process, there's exactly one process that should own the DB connection.
// Multiple connections to the same SQLite file can cause locking issues.

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.')
  }
  return db
}

export function initDb(): Database.Database {
  const dbPath = getDbPath()

  db = new Database(dbPath)

  // WAL (Write-Ahead Logging) mode is critical for performance.
  // Without it, SQLite locks the entire database file during writes,
  // which would freeze the UI while thumbnails are being indexed.
  // WAL allows concurrent reads while a write is in progress.
  db.pragma('journal_mode = WAL')

  // foreign_keys is OFF by default in SQLite (for backwards compatibility).
  // Without this, our REFERENCES constraints are decorative — they won't
  // actually prevent bad data.
  db.pragma('foreign_keys = ON')

  runMigrations(db)

  return db
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
