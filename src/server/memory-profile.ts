/**
 * memory-profile — which Hermes profile the /memory page reads.
 *
 * Profiles live at $HERMES_HOME/profiles/<p>/; `default` is the synthetic
 * root profile (HERMES_HOME itself), matching profiles-browser. Memory APIs
 * take an optional `profile` param; absent = the legacy hermes-switch paths.
 */

import fs from 'node:fs'
import path from 'node:path'
import { getHermesRoot, getProfilesDir } from './claude-paths'
import { isWithinRealRoot } from './path-containment'

export const DEFAULT_MEMORY_PROFILE = 'hermes-switch'

const PROFILE_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i

function profileDirNames(): Array<string> {
  try {
    const dir = getProfilesDir()
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => {
        if (!PROFILE_RE.test(e.name)) return false
        if (e.isDirectory()) return true
        if (!e.isSymbolicLink()) return false
        // A symlinked profile must still resolve inside HERMES_HOME.
        const full = path.join(dir, e.name)
        try {
          return (
            fs.statSync(full).isDirectory() &&
            isWithinRealRoot(getHermesRoot(), full)
          )
        } catch {
          return false
        }
      })
      .map((e) => e.name)
  } catch {
    return []
  }
}

/** Strict: name-shaped AND an existing profile (exact, case-sensitive).
 *  `default` and DEFAULT_MEMORY_PROFILE are always valid — the latter reads
 *  the legacy constant-path candidate chain, not necessarily profiles/<p>. */
export function isMemoryProfile(raw: unknown): raw is string {
  if (typeof raw !== 'string' || !PROFILE_RE.test(raw)) return false
  return (
    raw === 'default' ||
    raw === DEFAULT_MEMORY_PROFILE ||
    profileDirNames().includes(raw)
  )
}

/** Home dir of a validated profile (`default` → HERMES_HOME root). */
export function getMemoryProfileHome(profile: string): string {
  return profile === 'default'
    ? getHermesRoot()
    : path.join(getProfilesDir(), profile)
}

export function getProfileMatrixMemoryDir(profile: string): string {
  return path.join(getMemoryProfileHome(profile), 'matrix-memory')
}

export type MemoryProfileSummary = { name: string; hasMatrixMemory: boolean }

/** `dbPathFor` resolves a profile's DB (mnemosyne-browser's
 *  getMnemosyneDbPath); injected to avoid an import cycle. */
export function listMemoryProfiles(
  dbPathFor: (profile: string) => string,
): Array<MemoryProfileSummary> {
  const names = [
    'default',
    DEFAULT_MEMORY_PROFILE,
    ...profileDirNames().filter(
      (n) => n !== 'default' && n !== DEFAULT_MEMORY_PROFILE,
    ),
  ]
  return names.map((name) => ({
    name,
    hasMatrixMemory: fs.existsSync(dbPathFor(name)),
  }))
}
