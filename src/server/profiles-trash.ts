import fs from 'node:fs'
import path from 'node:path'
import { getProfilesRoot, invalidateProfilesCache } from './profiles-browser'

/**
 * `deleteProfile()` in `profiles-browser.ts` doesn't actually delete a
 * profile — it renames its directory to
 * `~/.hermes/trash/<name>-<epochMs>`. This module is the backend for
 * surfacing that trash as a "Recently Deleted" view: listing what's there,
 * restoring an entry, and permanently purging one.
 */

export type TrashedProfile = {
  /**
   * The on-disk directory name (`<name>-<epochMs>`). This is the only
   * unambiguous handle for a trashed entry — the same profile name can be
   * deleted more than once, producing multiple entries with the same
   * `originalName` but different `id`s.
   */
  id: string
  originalName: string
  /** ISO 8601 timestamp. Parsed from the `<epochMs>` suffix when possible. */
  deletedAt: string
  path: string
  /** Best-effort recursive size of the trashed directory; omitted if it could not be computed. */
  sizeBytes?: number
}

// A deleted-profile directory is named `${name}-${Date.now()}`. Date.now()
// has produced 13-digit values since 2001 and won't drop below 10 digits
// until the year 2286, so requiring >= 10 digits at the end is a cheap way
// to tell a real epoch-ms suffix apart from a profile name that merely ends
// in a short number.
const TRASH_ENTRY_RE = /^(.+)-(\d{10,})$/

/**
 * Directory/file name safety check shared by restore and purge. Mirrors
 * `validateProfileIdentifier` in `profiles-browser.ts` (not imported —
 * that function isn't exported, and duplicating this three-line guard is
 * cheaper than reaching into that module while it's being edited
 * concurrently).
 */
function validateTrashId(id: string): string {
  const trimmed = id.trim()
  if (!trimmed) throw new Error('Trash id is required')
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) {
    throw new Error('Invalid trash id')
  }
  return trimmed
}

/**
 * `profiles-browser.ts` resolves `~/.hermes` from `HERMES_HOME` /
 * `CLAUDE_HOME` / `os.homedir()` via a private (unexported) `getClaudeRoot`.
 * `getProfilesRoot()` — `<hermesRoot>/profiles` — IS exported, so deriving
 * the parent gets the same root without duplicating the env var precedence
 * here or editing that module.
 */
function getHermesRoot(): string {
  return path.dirname(getProfilesRoot())
}

function getTrashRoot(): string {
  return path.join(getHermesRoot(), 'trash')
}

function mtimeIso(fullPath: string): string {
  try {
    return fs.statSync(fullPath).mtime.toISOString()
  } catch {
    return new Date(0).toISOString()
  }
}

function getDirSizeBytes(rootPath: string): number {
  let total = 0
  const stack = [rootPath]
  while (stack.length > 0) {
    const current = stack.pop() as string
    let entries: Array<fs.Dirent> = []
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
        continue
      }
      try {
        total += fs.statSync(fullPath).size
      } catch {
        // unreadable file — skip rather than fail the whole listing
      }
    }
  }
  return total
}

/**
 * List everything in `~/.hermes/trash/`, newest deletion first.
 *
 * Defensive by design: non-directory entries (stray files) are skipped, and
 * a directory whose name doesn't match `<name>-<epochMs>` falls back to
 * treating the whole name as `originalName` and the directory's mtime as
 * `deletedAt` rather than throwing or dropping the entry.
 */
export function listTrashedProfiles(): Array<TrashedProfile> {
  const trashDir = getTrashRoot()
  if (!fs.existsSync(trashDir)) return []

  let entries: Array<fs.Dirent> = []
  try {
    entries = fs.readdirSync(trashDir, { withFileTypes: true })
  } catch {
    return []
  }

  const results: Array<TrashedProfile> = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue // ignore stray files
    const id = entry.name
    const fullPath = path.join(trashDir, id)
    const match = TRASH_ENTRY_RE.exec(id)

    let originalName: string
    let deletedAt: string
    if (match) {
      const epochMs = Number(match[2])
      if (Number.isFinite(epochMs)) {
        originalName = match[1]
        deletedAt = new Date(epochMs).toISOString()
      } else {
        originalName = id
        deletedAt = mtimeIso(fullPath)
      }
    } else {
      originalName = id
      deletedAt = mtimeIso(fullPath)
    }

    let sizeBytes: number | undefined
    try {
      sizeBytes = getDirSizeBytes(fullPath)
    } catch {
      sizeBytes = undefined
    }

    results.push({ id, originalName, deletedAt, path: fullPath, sizeBytes })
  }

  results.sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt))
  return results
}

/**
 * Move a trashed profile back to `~/.hermes/profiles/<originalName>`.
 *
 * CACHE COHERENCE NOTE: `profiles-browser.ts` caches `listProfiles()` output
 * for 5s behind a module-private `listProfilesCache` variable. Every mutator
 * inside that module resets it directly; this module calls the exported
 * `invalidateProfilesCache()` instead, so a profile restored here shows up in
 * `GET /api/profiles/list` immediately rather than after the TTL.
 */
export function restoreTrashedProfile(id: string): { name: string } {
  const validId = validateTrashId(id)
  const trashedPath = path.join(getTrashRoot(), validId)
  if (!fs.existsSync(trashedPath)) throw new Error('Trashed profile not found')

  const match = TRASH_ENTRY_RE.exec(validId)
  const originalName = match && Number.isFinite(Number(match[2])) ? match[1] : validId

  const targetPath = path.join(getProfilesRoot(), originalName)
  if (fs.existsSync(targetPath)) throw new Error('Profile already exists')

  fs.renameSync(trashedPath, targetPath)
  invalidateProfilesCache()
  return { name: originalName }
}

/** Permanently and irrecoverably remove a trashed profile from disk. No undo. */
export function purgeTrashedProfile(id: string): void {
  const validId = validateTrashId(id)
  const trashedPath = path.join(getTrashRoot(), validId)
  if (!fs.existsSync(trashedPath)) throw new Error('Trashed profile not found')
  fs.rmSync(trashedPath, { recursive: true, force: true })
  invalidateProfilesCache()
}
