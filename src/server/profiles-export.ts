import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'

import { maskSecrets } from '../lib/secret-mask'
import { PROFILE_NAME_RE } from '../lib/profile-name'
import {
  BUILTIN_PROFILE_NAMES,
  getProfilesRoot,
  invalidateProfilesCache,
  normalizeClonedAgentUI,
  readProfile,
} from './profiles-browser'
import type { AgentUIMetadata, ProfileDetail } from './profiles-browser'

/**
 * Export / import a profile as a single portable JSON bundle.
 *
 * A profile is just a directory (`config.yaml` + a handful of well-known
 * files + `skills/`), so making one portable is mostly plumbing: read the
 * authored parts, skip the parts that are either secret (`.env`) or purely
 * local history (`sessions/`), and mask anything secret-shaped that survives
 * in `config.yaml` itself (an MCP server's inline API key, say).
 *
 * This module only builds/consumes the bundle — no route wiring, no UI. The
 * UI is a later wave's job; the request/response shapes here (see
 * {@link ProfileExportBundle} and {@link importProfile}'s options/return) are
 * designed for that UI without assuming its details, since the shapes are the
 * actual contract a not-yet-written screen will be built against.
 */

// ── Bundle shape ────────────────────────────────────────────────────────────

/**
 * Bumped whenever the bundle SHAPE changes in a way `importProfile()` cannot
 * transparently upgrade. `importProfile()` rejects any other value outright
 * rather than guessing at a shape it has never seen.
 */
export const PROFILE_BUNDLE_SCHEMA_VERSION = 1

export type ProfileExportBundle = {
  schemaVersion: typeof PROFILE_BUNDLE_SCHEMA_VERSION
  /** The profile's name at export time. `importProfile()`'s `name` option overrides this. */
  name: string
  /**
   * `config.yaml`, parsed to a plain object, with secret-shaped values masked
   * (see `maskSecrets` in `../lib/secret-mask`). The `builtin` flag
   * `readProfile()` stamps onto reads is stripped — it's a read-time UI hint,
   * never actually written to disk, so re-importing it would be nonsense.
   */
  config: Record<string, unknown>
  /** Text of `SOUL.md`, when the profile has one. */
  soul?: string
  /** Text of `memories/MEMORY.md`, when the profile has one. */
  memoryMd?: string
  /** Text of `memory/IDENTITY.md`, when the profile has one. */
  identityMd?: string
  /**
   * The profile's `skills/` tree, forward-slash relative path → file text.
   * Empty object when the profile has no `skills/` dir or it's empty.
   *
   * Text only: skill directories are overwhelmingly markdown/config/scripts,
   * and a JSON bundle isn't a great fit for binary blobs anyway. A skill file
   * this walk cannot read as UTF-8 text is silently skipped rather than
   * corrupted or failing the whole export — see `collectSkillsTree`.
   */
  skills: Record<string, string>
}

// ── Size ceiling ──────────────────────────────────────────────────────────
//
// Chosen ceiling: 10 MiB of combined skills file content, capped at 2000
// files. Both are enforced on EXPORT (reading from disk) and on IMPORT
// (reading from the untrusted bundle) using the same constants, so a bundle
// that could never have been produced by this module's own exporter is
// refused rather than accepted. 10 MiB comfortably fits any reasonable set of
// hand-authored skill docs/scripts while still refusing to ever attempt to
// serialise (or accept) a pathological multi-hundred-MB tree as one JSON blob
// held fully in memory.

export const MAX_SKILLS_TOTAL_BYTES = 10 * 1024 * 1024 // 10 MiB
export const MAX_SKILLS_FILE_COUNT = 2000

const SKILLS_SIZE_LIMIT_MESSAGE = 'Skills tree exceeds export size limit'

// ── Export ──────────────────────────────────────────────────────────────────

function readTextIfExists(filePath: string): string | undefined {
  if (!fs.existsSync(filePath)) return undefined
  try {
    return fs.readFileSync(filePath, 'utf-8')
  } catch {
    return undefined
  }
}

/**
 * Walk `skillsDir` collecting forward-slash relative path → UTF-8 text.
 * Symlinks are skipped (neither `isFile()` nor `isDirectory()` matches a
 * symlink `Dirent` without `withFileTypes` following it) — export never
 * follows a symlink out of the profile directory. A file that cannot be
 * decoded as UTF-8 text is skipped rather than corrupted into the bundle.
 */
function collectSkillsTree(skillsDir: string): Record<string, string> {
  const result: Record<string, string> = {}
  if (!fs.existsSync(skillsDir)) return result

  let fileCount = 0
  let totalBytes = 0
  const stack: Array<string> = [skillsDir]
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
      if (!entry.isFile()) continue // skip symlinks and other special entries

      fileCount += 1
      if (fileCount > MAX_SKILLS_FILE_COUNT) {
        throw new Error(SKILLS_SIZE_LIMIT_MESSAGE)
      }

      let sizeBytes = 0
      try {
        sizeBytes = fs.statSync(fullPath).size
      } catch {
        continue
      }
      totalBytes += sizeBytes
      if (totalBytes > MAX_SKILLS_TOTAL_BYTES) {
        throw new Error(SKILLS_SIZE_LIMIT_MESSAGE)
      }

      const relPath = path.relative(skillsDir, fullPath).split(path.sep).join('/')
      try {
        result[relPath] = fs.readFileSync(fullPath, 'utf-8')
      } catch {
        // unreadable / undecodable as text — skip rather than fail the whole export
      }
    }
  }
  return result
}

/**
 * Build a self-describing, portable bundle for `name`.
 *
 * Deliberately excludes `.env` (secrets) and `sessions/` (local run history)
 * — neither is portable, and nothing here ever reads them. `readProfile()`
 * does the name resolution/validation (works for `default`, built-ins, and
 * ordinary profiles alike; throws `'Profile not found'` for a missing one,
 * mapped to 404 by `-error-response.ts`).
 */
export function exportProfile(name: string): ProfileExportBundle {
  const detail: ProfileDetail = readProfile(name)

  const configForExport = { ...detail.config } as Record<string, unknown>
  // `builtin` is a read-time flag readProfile() stamps on for the UI; it is
  // never written to config.yaml on disk, so it must never round-trip back
  // in through an export/import cycle.
  delete configForExport.builtin

  const config = maskSecrets(configForExport) as Record<string, unknown>

  const soul = readTextIfExists(path.join(detail.path, 'SOUL.md'))
  const memoryMd = readTextIfExists(path.join(detail.path, 'memories', 'MEMORY.md'))
  const identityMd = readTextIfExists(path.join(detail.path, 'memory', 'IDENTITY.md'))
  const skills = collectSkillsTree(path.join(detail.path, 'skills'))

  return {
    schemaVersion: PROFILE_BUNDLE_SCHEMA_VERSION,
    name: detail.name,
    config,
    ...(soul !== undefined ? { soul } : {}),
    ...(memoryMd !== undefined ? { memoryMd } : {}),
    ...(identityMd !== undefined ? { identityMd } : {}),
    skills,
  }
}

// ── Import ──────────────────────────────────────────────────────────────────

export type ImportProfileOptions = {
  /** Override the bundle's own `name` — e.g. importing under a fresh name to avoid a collision. */
  name?: string
}

function assertPlainObject(
  value: unknown,
  message: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(message)
  }
}

/**
 * Validate a bundle's skills-map key as a safe relative path: no absolute
 * paths (POSIX or `C:\`-style), no `..`/`.`/empty segments, backslashes
 * normalised to forward slashes first so a Windows-style traversal string
 * doesn't sneak past a POSIX-only check. Returns the normalised path.
 */
function validateSkillsRelativePath(rawPath: string): string {
  if (typeof rawPath !== 'string' || rawPath.trim() === '') {
    throw new Error(`Invalid skills path: ${JSON.stringify(rawPath)}`)
  }
  const trimmed = rawPath.trim()
  if (path.isAbsolute(trimmed) || /^[a-zA-Z]:[\\/]/.test(trimmed)) {
    throw new Error(`Invalid skills path: ${trimmed}`)
  }
  const normalized = trimmed.split('\\').join('/')
  const segments = normalized.split('/')
  if (segments.some((seg) => seg === '' || seg === '.' || seg === '..')) {
    throw new Error(`Invalid skills path: ${trimmed}`)
  }
  return normalized
}

/**
 * Import `bundle` as a new profile, treating every field as hostile input —
 * it arrives from a file that was handed to this user by someone else.
 *
 * Validates, in order:
 *  1. `bundle` is a plain object with the expected schema version.
 *  2. The resolved name (options.name, falling back to the bundle's own
 *     `name`) passes the canonical rule in `../lib/profile-name` and isn't
 *     `default` or a reserved built-in name.
 *  3. `config` is a plain object; `skills`, when present, is a plain object
 *     of string values whose keys are safe relative paths and whose combined
 *     size respects the same ceiling `exportProfile()` enforces.
 *  4. No existing profile already occupies the target name (`'Profile
 *     already exists'`, same message/mapping `createProfile()` uses).
 *
 * Only once all of that holds does anything touch disk. `agent_ui` is then
 * normalised exactly like `createProfile()`'s clone path — tier 3, status
 * `draft`, `last_run` null — so an imported bundle can never mint a fake
 * Tier-1 "active" agent.
 */
export function importProfile(
  bundle: unknown,
  options: ImportProfileOptions = {},
): ProfileDetail {
  assertPlainObject(bundle, 'Invalid profile bundle')
  const raw = bundle

  if (raw.schemaVersion !== PROFILE_BUNDLE_SCHEMA_VERSION) {
    throw new Error('Unsupported profile bundle schema version')
  }

  const requestedName =
    (typeof options.name === 'string' ? options.name.trim() : '') ||
    (typeof raw.name === 'string' ? raw.name.trim() : '')
  if (!requestedName) throw new Error('Profile name is required')
  if (requestedName === 'default') {
    throw new Error('Default profile cannot be modified here')
  }
  if (BUILTIN_PROFILE_NAMES.has(requestedName)) {
    throw new Error(`Profile name "${requestedName}" is reserved for built-in agents`)
  }
  if (!PROFILE_NAME_RE.test(requestedName)) {
    throw new Error('Invalid profile name')
  }

  assertPlainObject(raw.config, 'Invalid profile bundle: config must be an object')
  const config = raw.config

  if (raw.skills !== undefined) {
    assertPlainObject(raw.skills, 'Invalid profile bundle: skills must be an object')
  }
  const rawSkills = raw.skills ?? {}

  const validatedSkills: Array<[string, string]> = []
  let fileCount = 0
  let totalBytes = 0
  for (const [rawSkillPath, content] of Object.entries(rawSkills)) {
    if (typeof content !== 'string') {
      throw new Error(
        `Invalid profile bundle: skills["${rawSkillPath}"] must be a string`,
      )
    }
    const safePath = validateSkillsRelativePath(rawSkillPath)
    fileCount += 1
    if (fileCount > MAX_SKILLS_FILE_COUNT) throw new Error(SKILLS_SIZE_LIMIT_MESSAGE)
    totalBytes += Buffer.byteLength(content, 'utf-8')
    if (totalBytes > MAX_SKILLS_TOTAL_BYTES) throw new Error(SKILLS_SIZE_LIMIT_MESSAGE)
    validatedSkills.push([safePath, content])
  }

  for (const key of ['soul', 'memoryMd', 'identityMd'] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== 'string') {
      throw new Error(`Invalid profile bundle: ${key} must be a string`)
    }
  }

  const profilesRoot = getProfilesRoot()
  const profilePath = path.join(profilesRoot, requestedName)
  if (fs.existsSync(profilePath)) throw new Error('Profile already exists')

  fs.mkdirSync(profilePath, { recursive: true })
  fs.mkdirSync(path.join(profilePath, 'skills'), { recursive: true })
  fs.mkdirSync(path.join(profilePath, 'sessions'), { recursive: true })

  const importedConfig: Record<string, unknown> = { ...config }
  importedConfig.agent_ui = normalizeClonedAgentUI(
    config.agent_ui as AgentUIMetadata | undefined,
  )
  fs.writeFileSync(
    path.join(profilePath, 'config.yaml'),
    YAML.stringify(importedConfig),
    'utf-8',
  )

  if (typeof raw.soul === 'string') {
    fs.writeFileSync(path.join(profilePath, 'SOUL.md'), raw.soul, 'utf-8')
  }
  if (typeof raw.memoryMd === 'string') {
    fs.mkdirSync(path.join(profilePath, 'memories'), { recursive: true })
    fs.writeFileSync(
      path.join(profilePath, 'memories', 'MEMORY.md'),
      raw.memoryMd,
      'utf-8',
    )
  }
  if (typeof raw.identityMd === 'string') {
    fs.mkdirSync(path.join(profilePath, 'memory'), { recursive: true })
    fs.writeFileSync(
      path.join(profilePath, 'memory', 'IDENTITY.md'),
      raw.identityMd,
      'utf-8',
    )
  }

  const skillsRoot = path.resolve(path.join(profilePath, 'skills'))
  for (const [relPath, content] of validatedSkills) {
    const fullPath = path.join(profilePath, 'skills', relPath)
    // Defence in depth beyond validateSkillsRelativePath's segment check: the
    // resolved path must still land inside skillsRoot. Nothing observed so
    // far should let this fire, but a write is irreversible, so this refuses
    // rather than trusts.
    const resolved = path.resolve(fullPath)
    if (resolved !== skillsRoot && !resolved.startsWith(skillsRoot + path.sep)) {
      throw new Error(`Invalid skills path: ${relPath}`)
    }
    fs.mkdirSync(path.dirname(fullPath), { recursive: true })
    fs.writeFileSync(fullPath, content, 'utf-8')
  }

  invalidateProfilesCache()
  return readProfile(requestedName)
}
