import { getDb } from '../connection'
import type { FileRow } from './files.repo'

// Duplicate detection using perceptual hashes (dHash).
//
// Two tiers of matching:
// 1. Exact: identical phash values — catches resized copies, re-encoded copies,
//    and minor crop variants. Queried via SQL GROUP BY.
// 2. Similar: hamming distance ≤ threshold — catches significant edits, color
//    adjustments, watermarks. Computed in application code (XOR + popcount).
//
// Performance: pairwise comparison is O(n²) where n = unique hashes. For 10K
// images, that's ~50M comparisons at ~3ns each = ~150ms. Acceptable for an
// interactive button click.

export interface DuplicateGroup {
  groupId: number
  matchType: 'exact' | 'similar'
  hammingDistance: number // 0 for exact matches
  matchReason: string // Human-readable explanation of why this group was flagged
  files: DuplicateFile[]
  bestFileId: number // Auto-suggested "keep" file (highest resolution × largest size)
}

export interface DuplicateFile {
  id: number
  path: string
  filename: string
  extension: string
  sizeBytes: number
  width: number | null
  height: number | null
  modifiedAt: string
  createdAt: string
  thumbnailPath: string | null
  hidden: number
  phash: string
}

// ── Hamming Distance ──

// Compute the hamming distance between two 64-char hex hash strings (256-bit dHash).
// This is the number of differing bits. Lower = more similar. 0 = perceptually identical.
//
// The hash is 256 bits = 64 hex characters = eight 32-bit chunks. We parse each
// chunk with parseInt (safe for 8 hex chars = 32 bits), XOR, and popcount.
// This avoids BigInt overhead while handling the full 256-bit width.
function hammingDistance(hashA: string, hashB: string): number {
  let distance = 0
  // Process in 8-character (32-bit) chunks. 64 hex chars / 8 = 8 chunks.
  for (let i = 0; i < 64; i += 8) {
    const a = parseInt(hashA.slice(i, i + 8), 16)
    const b = parseInt(hashB.slice(i, i + 8), 16)
    distance += popcount32(a ^ b)
  }
  return distance
}

// Count set bits in a 32-bit integer (Hamming weight).
// Uses the classic bit-manipulation algorithm.
function popcount32(n: number): number {
  n = n - ((n >> 1) & 0x55555555)
  n = (n & 0x33333333) + ((n >> 2) & 0x33333333)
  return (((n + (n >> 4)) & 0x0f0f0f0f) * 0x01010101) >> 24
}

// ── Auto "Best" Selection ──

// Heuristic: the "best" file in a group is the one with the highest resolution
// (width × height) and, as a tiebreaker, the largest file size. This typically
// picks the original over a resized or re-compressed copy.
function pickBestFile(files: DuplicateFile[]): number {
  let bestId = files[0].id
  let bestPixels = (files[0].width ?? 0) * (files[0].height ?? 0)
  let bestSize = files[0].sizeBytes

  for (let i = 1; i < files.length; i++) {
    const f = files[i]
    const pixels = (f.width ?? 0) * (f.height ?? 0)
    if (pixels > bestPixels || (pixels === bestPixels && f.sizeBytes > bestSize)) {
      bestId = f.id
      bestPixels = pixels
      bestSize = f.sizeBytes
    }
  }

  return bestId
}

// ── Match Reason ──
//
// Generate a human-readable explanation of why a group was flagged.
// Analyzes shared properties (dimensions, file size, format) to give the user
// context beyond just "exact" or "similar." This helps users trust the grouping
// and make better keep/hide decisions.

function describeMatchReason(files: DuplicateFile[], matchType: 'exact' | 'similar', distance: number): string {
  const allSameDimensions = files.every(
    (f) => f.width != null && f.height != null &&
           f.width === files[0].width && f.height === files[0].height
  )
  const allSameSize = files.every((f) => f.sizeBytes === files[0].sizeBytes)
  const allSameExtension = files.every(
    (f) => f.extension.toLowerCase() === files[0].extension.toLowerCase()
  )

  if (matchType === 'exact') {
    // Identical perceptual hash — images look the same when normalized
    if (allSameDimensions && allSameSize && allSameExtension) {
      return 'Likely identical files'
    }
    if (allSameDimensions && allSameSize) {
      return 'Same dimensions & file size · Different format'
    }
    if (allSameDimensions) {
      return 'Same dimensions · Identical appearance'
    }
    return 'Identical appearance · Different resolutions'
  }

  // Similar match — perceptual hash within threshold
  // Show similarity as a percentage (more intuitive than raw bit distance)
  const similarity = Math.round(((256 - distance) / 256) * 100)

  if (allSameDimensions) {
    return `Same dimensions · ${similarity}% similar appearance`
  }
  return `${similarity}% similar appearance`
}

// ── Main Detection ──

export function findDuplicateGroups(threshold = 0): DuplicateGroup[] {
  const db = getDb()

  // Load all files that have a perceptual hash
  const allFiles = db.prepare(`
    SELECT id, path, filename, extension, size_bytes, width, height,
           modified_at, created_at, thumbnail_path, hidden, phash
    FROM files
    WHERE phash IS NOT NULL
    ORDER BY phash, id
  `).all() as DuplicateFile[]

  // Remap snake_case from DB to our interface
  for (const f of allFiles) {
    // SQLite returns snake_case columns; cast to match our interface
    (f as any).sizeBytes = (f as any).size_bytes;
    (f as any).modifiedAt = (f as any).modified_at;
    (f as any).createdAt = (f as any).created_at;
    (f as any).thumbnailPath = (f as any).thumbnail_path
  }

  const groups: DuplicateGroup[] = []
  let groupId = 1

  // ── Tier 1: Exact matches (identical phash) ──
  // Group by phash using a simple scan since results are sorted by phash.
  const exactGroups = new Map<string, DuplicateFile[]>()
  for (const file of allFiles) {
    const existing = exactGroups.get(file.phash)
    if (existing) {
      existing.push(file)
    } else {
      exactGroups.set(file.phash, [file])
    }
  }

  // Track which files have been grouped (to avoid double-counting in tier 2)
  const groupedFileIds = new Set<number>()

  for (const [, files] of exactGroups) {
    if (files.length < 2) continue
    const bestFileId = pickBestFile(files)
    groups.push({
      groupId: groupId++,
      matchType: 'exact',
      hammingDistance: 0,
      matchReason: describeMatchReason(files, 'exact', 0),
      files,
      bestFileId
    })
    for (const f of files) {
      groupedFileIds.add(f.id)
    }
  }

  // ── Tier 2: Similar matches (hamming distance ≤ threshold) ──
  if (threshold > 0) {
    // Collect ungrouped files for pairwise comparison
    const ungrouped = allFiles.filter((f) => !groupedFileIds.has(f.id))

    // Union-Find to cluster similar images
    const parent = new Map<number, number>()
    function find(x: number): number {
      if (!parent.has(x)) parent.set(x, x)
      while (parent.get(x) !== x) {
        parent.set(x, parent.get(parent.get(x)!)!)
        x = parent.get(x)!
      }
      return x
    }
    function union(a: number, b: number): void {
      const ra = find(a)
      const rb = find(b)
      if (ra !== rb) parent.set(ra, rb)
    }

    // Track the max hamming distance per pair for group labeling
    const maxDist = new Map<string, number>()

    for (let i = 0; i < ungrouped.length; i++) {
      for (let j = i + 1; j < ungrouped.length; j++) {
        const dist = hammingDistance(ungrouped[i].phash, ungrouped[j].phash)
        if (dist <= threshold) {
          union(ungrouped[i].id, ungrouped[j].id)
          const key = `${find(ungrouped[i].id)}`
          maxDist.set(key, Math.max(maxDist.get(key) ?? 0, dist))
        }
      }
    }

    // Collect clusters
    const clusters = new Map<number, DuplicateFile[]>()
    for (const file of ungrouped) {
      const root = find(file.id)
      const cluster = clusters.get(root)
      if (cluster) {
        cluster.push(file)
      } else {
        clusters.set(root, [file])
      }
    }

    for (const [root, files] of clusters) {
      if (files.length < 2) continue
      const bestFileId = pickBestFile(files)
      const dist = maxDist.get(`${root}`) ?? 0
      groups.push({
        groupId: groupId++,
        matchType: 'similar',
        hammingDistance: dist,
        matchReason: describeMatchReason(files, 'similar', dist),
        files,
        bestFileId
      })
    }
  }

  // Sort by group size descending (largest groups first — most impactful to resolve)
  groups.sort((a, b) => b.files.length - a.files.length)

  return groups
}

// Quick count of files that have exact-match duplicates (share a phash with
// at least one other file). Uses SQL aggregation so it's fast — no pairwise
// comparison needed. Used by the sidebar badge to show a count without
// running the full detection algorithm.
export function getDuplicateCount(): number {
  const db = getDb()
  const row = db.prepare(`
    SELECT COUNT(*) as count FROM files
    WHERE phash IN (
      SELECT phash FROM files
      WHERE phash IS NOT NULL
      GROUP BY phash
      HAVING COUNT(*) > 1
    )
  `).get() as { count: number }
  return row.count
}

// Get hash computation progress for the status display.
export function getHashProgress(): { hashed: number; total: number } {
  const db = getDb()
  const hashed = (db.prepare('SELECT COUNT(*) as count FROM files WHERE phash IS NOT NULL').get() as { count: number }).count
  const total = (db.prepare('SELECT COUNT(*) as count FROM files WHERE thumbnail_generated = 1 AND thumbnail_path IS NOT NULL').get() as { count: number }).count
  return { hashed, total }
}
