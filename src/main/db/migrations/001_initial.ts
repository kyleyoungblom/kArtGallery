import Database from 'better-sqlite3'

// Migration system: each migration runs exactly once, tracked by a version table.
//
// Why migrations instead of just CREATE TABLE IF NOT EXISTS?
// IF NOT EXISTS only handles creating new tables — it can't alter existing ones.
// As the app evolves, we'll need to add columns, rename things, or change
// constraints. Migrations let us evolve the schema safely without losing
// user data. Each migration is a function that takes the DB and makes changes.
//
// The version table tracks which migrations have already run, so adding
// a new migration file is all it takes to update the schema on next launch.

const MIGRATIONS: { version: number; up: (db: Database.Database) => void }[] = [
  {
    version: 1,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS folders (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          path        TEXT NOT NULL UNIQUE,
          hidden      INTEGER NOT NULL DEFAULT 0,
          last_scanned TEXT
        );

        CREATE TABLE IF NOT EXISTS stacks (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          name        TEXT,
          cover_file_id INTEGER,
          folder_id   INTEGER REFERENCES folders(id),
          created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS files (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          path              TEXT NOT NULL UNIQUE,
          filename          TEXT NOT NULL,
          extension         TEXT NOT NULL,
          folder_id         INTEGER REFERENCES folders(id),
          size_bytes        INTEGER,
          modified_at       TEXT,
          created_at        TEXT,
          width             INTEGER,
          height            INTEGER,
          hidden            INTEGER NOT NULL DEFAULT 0,
          stack_id          INTEGER REFERENCES stacks(id),
          stack_order       INTEGER DEFAULT 0,
          thumbnail_path    TEXT,
          thumbnail_generated INTEGER NOT NULL DEFAULT 0,
          indexed_at        TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_files_folder ON files(folder_id);
        CREATE INDEX IF NOT EXISTS idx_files_stack ON files(stack_id);
        CREATE INDEX IF NOT EXISTS idx_files_hidden ON files(hidden);
        CREATE INDEX IF NOT EXISTS idx_files_extension ON files(extension);

        CREATE TABLE IF NOT EXISTS preferences (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `)
    }
  },
  {
    version: 2,
    up: (db) => {
      // Store the reason a thumbnail failed so users can diagnose issues.
      // Existing failed rows will have thumbnail_error = NULL (pre-existing failure).
      db.exec(`ALTER TABLE files ADD COLUMN thumbnail_error TEXT`)
    }
  },
  {
    version: 3,
    up: (db) => {
      // Perceptual hash for duplicate detection. Stores a dHash as a hex string.
      // NULL means hash hasn't been computed yet. Stored as TEXT (not INTEGER)
      // because dHash values are unsigned — hex avoids sign issues and is debuggable.
      db.exec(`
        ALTER TABLE files ADD COLUMN phash TEXT;
        CREATE INDEX idx_files_phash ON files(phash) WHERE phash IS NOT NULL;
      `)
    }
  },
  {
    version: 4,
    up: (db) => {
      // Upgrade dHash from 64-bit (16 hex chars) to 256-bit (64 hex chars).
      // The wider hash captures more spatial detail, dramatically reducing false
      // positives where visually different images were grouped as "exact match."
      // Clear all existing hashes so they're recomputed with the new algorithm.
      // Also reset thumbnail_generated so the backfill logic re-queues them.
      db.exec(`
        UPDATE files SET phash = NULL, thumbnail_generated = 0
        WHERE phash IS NOT NULL
      `)
    }
  },
  {
    version: 5,
    up: (db) => {
      // Cross-device metadata sync support.
      //
      // stacks.uuid: Auto-increment IDs are local to each SQLite DB and won't
      // match across machines. UUID provides a stable identity for stacks in the
      // sync event log. Existing stacks get UUIDs backfilled below.
      //
      // metadata_updated_at: Tracks when syncable metadata (hidden, stack assignment)
      // was last changed. Used for "latest timestamp wins" conflict resolution
      // during sync import. Separate from modified_at (which tracks filesystem
      // modification time) because hiding a file is orthogonal to editing its bytes.
      //
      // sync_applied_events: Idempotency table — prevents double-applying events
      // if the JSONL file is re-read from the beginning (e.g., cursor misalignment).
      db.exec(`
        ALTER TABLE stacks ADD COLUMN uuid TEXT;
        CREATE UNIQUE INDEX idx_stacks_uuid ON stacks(uuid) WHERE uuid IS NOT NULL;

        ALTER TABLE files ADD COLUMN metadata_updated_at TEXT;
        ALTER TABLE folders ADD COLUMN metadata_updated_at TEXT;

        CREATE TABLE sync_applied_events (
          event_id TEXT PRIMARY KEY,
          applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `)

      // Backfill existing stacks with UUIDs. We use randomUUID() via a hex
      // timestamp + random suffix since crypto.randomUUID() isn't available in
      // the migration context (better-sqlite3 runs synchronously). The format
      // doesn't matter as long as it's globally unique.
      const stacks = db.prepare('SELECT id FROM stacks').all() as { id: number }[]
      const updateStmt = db.prepare('UPDATE stacks SET uuid = ? WHERE id = ?')
      for (const stack of stacks) {
        // Generate a v4-style UUID: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
        const hex = () => Math.random().toString(16).slice(2)
        const uuid = `${hex().slice(0, 8)}-${hex().slice(0, 4)}-4${hex().slice(0, 3)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${hex().slice(0, 3)}-${hex()}`.slice(0, 36)
        updateStmt.run(uuid, stack.id)
      }
    }
  }
]

export function runMigrations(db: Database.Database): void {
  // Create the version tracking table if it doesn't exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  const currentVersion = db.prepare(
    'SELECT MAX(version) as version FROM schema_version'
  ).get() as { version: number | null }

  const appliedVersion = currentVersion?.version ?? 0

  // Run each migration that hasn't been applied yet, wrapped in a transaction.
  // If any migration fails, all changes in that transaction are rolled back,
  // leaving the database in a known-good state.
  for (const migration of MIGRATIONS) {
    if (migration.version > appliedVersion) {
      db.transaction(() => {
        migration.up(db)
        db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(
          migration.version
        )
      })()
    }
  }
}
