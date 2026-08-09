import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import YAML from 'yaml'

import { mergeProfileConfig } from '../lib/profile-merge'
import { PROFILE_NAME_RE } from '../lib/profile-name'

// ── New types for the Profiles Revamp (PR-04) ──────────────────────────────

/**
 * Every memory plugin the agent ships, plus `''` for "built-in files only".
 *
 * The narrow six-name version of this union was the type-level half of the bug
 * `memory-provider-catalog.ts` documents: `matrix-memory`, `honcho` and
 * `supermemory` exist on disk and one of them is a common active provider, so
 * a config carrying any of them could not even be *described*, let alone
 * offered. `''` is representable because that is exactly what the gateway
 * writes when the external provider is switched off and only the Tier 1
 * `MEMORY.md` / `USER.md` files remain.
 */
export type MemoryProvider =
  | ''
  | 'matrix-memory'
  | 'hindsight'
  | 'mem0'
  | 'openviking'
  | 'holographic'
  | 'retaindb'
  | 'byterover'
  | 'honcho'
  | 'supermemory'

export type MemoryConfig = {
  memory_enabled?: boolean
  provider?: MemoryProvider
}

export type SkillsConfig = {
  external_dirs?: Array<string>
}

export type McpServerConfig = {
  url?: string
  command?: string
  args?: Array<string>
  env?: Record<string, string>
  headers?: Record<string, string>
}

export type AgentRuntime = {
  max_turns?: number
  reasoning_effort?: 'low' | 'medium' | 'high'
  disabled_toolsets?: Array<string>
}

/** Lifecycle state of a profile, as shown by the Profiles screen. */
export type ProfileStatus = 'draft' | 'idle' | 'active'

export type AgentUIMetadata = {
  tier?: 1 | 2 | 3
  glyph?: string
  role?: string
  /**
   * LEGACY / INERT. Written once at creation and never updated — the update
   * route rejects the field outright — so it drifts immediately and cannot be
   * trusted. `ProfileSummary.status` is the authoritative value; see the
   * comment there. Kept on the type only so existing config.yaml files still
   * round-trip through read/write; a later cleanup can drop it.
   */
  status?: ProfileStatus
  tags?: Array<string>
  persona_id?: string | null
  /**
   * LEGACY / INERT. Only ever written as `null` (by bootstrap). Nothing
   * advances it when a session runs, so it is never a real timestamp. Use
   * `ProfileSummary.lastRunAt`, which is derived from the sessions directory.
   */
  last_run?: number | null
}

export type ModelConfig = {
  default?: string
  provider?: string
}

// ── ProfileConfig: typed shape for a profile's config.yaml ────────────────

export type ProfileConfig = {
  description?: string
  system_prompt?: string
  model?: ModelConfig | string
  mcp_servers?: Record<string, McpServerConfig>
  skills?: SkillsConfig
  memory?: MemoryConfig
  agent?: AgentRuntime
  agent_ui?: AgentUIMetadata
  [key: string]: unknown
}

export type ProfileSummary = {
  name: string
  path: string
  active: boolean
  exists: boolean
  model?: string
  provider?: string
  skillCount: number
  sessionCount: number
  hasEnv: boolean
  updatedAt?: string
  // P2 additions — agent_ui metadata + description surfaced for the grid/table
  description?: string
  agent_ui?: AgentUIMetadata
  /**
   * Derived lifecycle state — the authoritative one (P-06).
   *
   * `agent_ui.status` on disk is stamped once at creation and never advanced
   * (all four built-ins are hardcoded `active` in `lib/builtin-agents.ts`), so
   * the Profiles screen used to report a permanent "4 Active" and its status
   * filter partitioned agents by origin rather than by state. This field is
   * computed fresh on every uncached `listProfiles()` call and deliberately
   * ignores whatever `agent_ui.status` claims:
   *
   *   active — this is the profile named in `~/.hermes/active_profile`
   *   idle   — not active, but it has sessions on disk (it has run before)
   *   draft  — not active and has never run
   */
  status: ProfileStatus
  /**
   * Derived "last run" timestamp in UNIX SECONDS (P-12), or `null` when the
   * profile has no sessions.
   *
   * Seconds, not milliseconds: the client's `formatRelative` computes
   * `Date.now() / 1000 - ts`. Sourced from the newest mtime among the files in
   * the profile's `sessions/` directory, piggybacked on the same traversal
   * that produces `sessionCount` — `agent_ui.last_run` is inert (see above).
   */
  lastRunAt?: number | null
}

export type ProfileDetail = {
  name: string
  path: string
  active: boolean
  config: ProfileConfig
  envPath?: string
  hasEnv: boolean
  sessionsDir?: string
  skillsDir?: string
}

/**
 * Exported (rather than module-private) so `profiles-export.ts`'s
 * `importProfile()` can apply the same reserved-name guard this module uses
 * everywhere else, without re-declaring a second copy of the built-in list.
 */
export const BUILTIN_PROFILE_NAMES = new Set([
  'hermes-switch',
  'neo',
  'trinity',
  'morpheus',
])
const TEXT_REWRITE_EXTENSIONS = new Set([
  '.md',
  '.txt',
  '.yaml',
  '.yml',
  '.json',
  '.jsonl',
  '.toml',
  '.env',
  '.plist',
  '.sh',
  '.js',
  '.ts',
  '.tsx',
])

function getHermesRoot(): string {
  return (
    process.env.HERMES_HOME ??
    process.env.CLAUDE_HOME ??
    path.join(os.homedir(), '.hermes')
  )
}

function getClaudeRoot(): string {
  return getHermesRoot()
}

export function getProfilesRoot(): string {
  return path.join(getClaudeRoot(), 'profiles')
}

function getActiveProfilePath(): string {
  return path.join(getClaudeRoot(), 'active_profile')
}

/**
 * Validate a profile name that will be *written* to disk (create, rename,
 * delete). The 'default' profile is reserved — callers must not create or
 * mutate it via the UI.
 *
 * This is the ONLY validator that applies `PROFILE_NAME_RE` (P-09). Before it
 * did, the write path checked nothing but path separators, so the API would
 * `mkdir` a profile directory named `My Agent!!`. The regex lives in
 * `lib/profile-name.ts` because the wizard, the rename dialog and this module
 * all used to carry disagreeing copies of the rule.
 */
function validateProfileName(name: string): string {
  const trimmed = validateNonReservedProfileName(name)
  // Reuses the identifier validator's message on purpose: callers map error
  // strings to HTTP status codes, and both rejections are the same 400.
  if (!PROFILE_NAME_RE.test(trimmed)) throw new Error('Invalid profile name')
  return trimmed
}

/**
 * Path-safe + not a reserved name, but WITHOUT the canonical shape rule.
 *
 * This is the check for the *subject* of a mutation that must already exist:
 * `deleteProfile(name)` and `renameProfile(oldName, …)`. Those two are the only
 * ways to get rid of a badly-named directory, so holding them to
 * `PROFILE_NAME_RE` would permanently trap any profile created before the rule
 * existed. The reserved-name guards still apply — `default` and the built-ins
 * must not be deleted or renamed.
 */
function validateNonReservedProfileName(name: string): string {
  const trimmed = validateProfileIdentifier(name)
  if (trimmed === 'default')
    throw new Error('Default profile cannot be modified here')
  if (BUILTIN_PROFILE_NAMES.has(trimmed))
    throw new Error(`Profile name "${trimmed}" is reserved for built-in agents`)
  return trimmed
}

/**
 * Validate a profile name that will only be *read* (e.g. \`cloneFrom\` source,
 * `readProfile`, `setActiveProfile`, `updateProfileConfig`).
 *
 * Any existing profile name is allowed, including 'default'. This stays
 * deliberately permissive — it only guards against path traversal. Applying
 * `PROFILE_NAME_RE` here would make profiles that are already on disk under an
 * odd name unreadable, and therefore unrenamable and unfixable.
 */
function validateProfileIdentifier(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Profile name is required')
  if (
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    trimmed.includes('..')
  ) {
    throw new Error('Invalid profile name')
  }
  return trimmed
}

function safeReadText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8')
}

function readYamlConfig(configPath: string): ProfileConfig {
  if (!fs.existsSync(configPath)) return {}
  try {
    const parsed = YAML.parse(safeReadText(configPath)) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as ProfileConfig)
      : {}
  } catch {
    return {}
  }
}

type WalkFilesResult = {
  count: number
  /** Newest mtime in MILLISECONDS among matched files; 0 when none matched. */
  newestMtimeMs: number
}

const SESSION_FILE_RE = /\.(jsonl|json|sqlite|db)$/i

const isSessionFile = (fullPath: string): boolean =>
  SESSION_FILE_RE.test(fullPath)

const isSkillFile = (fullPath: string): boolean =>
  path.basename(fullPath) === 'SKILL.md'

/**
 * Single recursive walk producing both the matched-file count and the newest
 * matched mtime.
 *
 * `listProfiles()` needs `sessionCount` and `lastRunAt` from the same
 * `sessions/` tree, and it runs synchronously for every profile on every
 * uncached call — a second walk would double the blocking readdir/stat work on
 * the event loop. `trackMtime` is opt-in so the `skills/` caller, which only
 * wants a count, does not pay a `statSync` per SKILL.md.
 */
function walkFiles(
  rootPath: string,
  predicate: (fullPath: string) => boolean,
  options?: { trackMtime?: boolean },
): WalkFilesResult {
  if (!fs.existsSync(rootPath)) return { count: 0, newestMtimeMs: 0 }
  const trackMtime = options?.trackMtime === true
  let count = 0
  let newestMtimeMs = 0
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
      if (!predicate(fullPath)) continue
      count += 1
      if (!trackMtime) continue
      try {
        const { mtimeMs } = fs.statSync(fullPath)
        if (mtimeMs > newestMtimeMs) newestMtimeMs = mtimeMs
      } catch {
        // ignore — an unreadable session file still counts, it just cannot
        // contribute a timestamp
      }
    }
  }
  return { count, newestMtimeMs }
}

/** Thin count-only wrapper over {@link walkFiles}. */
function countFilesRecursive(
  rootPath: string,
  predicate: (fullPath: string) => boolean,
): number {
  return walkFiles(rootPath, predicate).count
}

/** Convert a walk's newest mtime (ms) to the UNIX SECONDS the client expects. */
function toLastRunAt(newestMtimeMs: number): number | null {
  return newestMtimeMs > 0 ? Math.floor(newestMtimeMs / 1000) : null
}

/** Derive the authoritative lifecycle state — see `ProfileSummary.status`. */
function deriveStatus(active: boolean, sessionCount: number): ProfileStatus {
  if (active) return 'active'
  return sessionCount > 0 ? 'idle' : 'draft'
}

function latestMtime(paths: Array<string>): string | undefined {
  let latest = 0
  for (const target of paths) {
    if (!fs.existsSync(target)) continue
    try {
      const stat = fs.statSync(target)
      latest = Math.max(latest, stat.mtimeMs)
    } catch {
      // ignore
    }
  }
  return latest > 0 ? new Date(latest).toISOString() : undefined
}

export function getActiveProfileName(): string {
  const activePath = getActiveProfilePath()
  if (!fs.existsSync(activePath)) return 'default'
  try {
    const raw = safeReadText(activePath).trim()
    return raw || 'default'
  } catch {
    return 'default'
  }
}

// 5-second TTL cache to avoid repeated full filesystem walks on every Profiles
// screen mount + auto-refresh. The screen tolerates a brief lag on add/remove;
// the cache prevents N+1 sync stat/readdir calls from blocking the event loop
// on every API hit.
let listProfilesCache: { ts: number; results: Array<ProfileSummary> } | null =
  null
const LIST_PROFILES_TTL_MS = 5000

/**
 * Drop the cached `listProfiles()` result so the next call re-walks the
 * filesystem. Every mutation in this module already does this inline (it
 * owns the module-private variable); this export exists so callers in other
 * modules — e.g. `profiles-trash.ts`'s restore/purge — can invalidate it too
 * instead of a restored/purged profile staying invisible for up to
 * `LIST_PROFILES_TTL_MS`.
 */
export function invalidateProfilesCache(): void {
  listProfilesCache = null
}

export function listProfiles(): Array<ProfileSummary> {
  const now = Date.now()
  if (listProfilesCache && now - listProfilesCache.ts < LIST_PROFILES_TTL_MS) {
    return listProfilesCache.results
  }
  const profilesRoot = getProfilesRoot()
  const activeProfile = getActiveProfileName()
  const results: Array<ProfileSummary> = []

  if (fs.existsSync(profilesRoot)) {
    let entries: Array<fs.Dirent> = []
    try {
      entries = fs.readdirSync(profilesRoot, { withFileTypes: true })
    } catch {
      entries = []
    }

    for (const entry of entries) {
      const name = entry.name
      const profilePath = path.join(profilesRoot, name)
      if (!entry.isDirectory()) {
        if (!entry.isSymbolicLink()) continue
        try {
          if (!fs.statSync(profilePath).isDirectory()) continue
        } catch {
          continue
        }
      }
      const configPath = path.join(profilePath, 'config.yaml')
      const envPath = path.join(profilePath, '.env')
      const skillsDir = path.join(profilePath, 'skills')
      const sessionsDir = path.join(profilePath, 'sessions')
      const config = readYamlConfig(configPath)
      const skillCount = countFilesRecursive(skillsDir, isSkillFile)
      // One walk, two answers: sessionCount (P-06 inputs) and lastRunAt (P-12).
      const sessions = walkFiles(sessionsDir, isSessionFile, {
        trackMtime: true,
      })
      const sessionCount = sessions.count
      const isActive = name === activeProfile
      // Resolve model/provider from nested or flat config structure
      let modelName: string | undefined
      let providerName: string | undefined
      if (typeof config.model === 'string') {
        modelName = config.model
      } else if (
        config.model &&
        typeof config.model === 'object' &&
        !Array.isArray(config.model)
      ) {
        const m = config.model as Record<string, unknown>
        if (typeof m.default === 'string') modelName = m.default
        if (typeof m.provider === 'string') providerName = m.provider
      }
      if (!providerName && typeof config.provider === 'string') {
        providerName = config.provider
      }
      results.push({
        name,
        path: profilePath,
        active: isActive,
        exists: true,
        model: modelName,
        provider: providerName,
        skillCount,
        sessionCount,
        hasEnv: fs.existsSync(envPath),
        updatedAt: latestMtime([
          profilePath,
          configPath,
          envPath,
          skillsDir,
          sessionsDir,
        ]),
        description:
          typeof config.description === 'string'
            ? config.description
            : undefined,
        agent_ui: config.agent_ui,
        status: deriveStatus(isActive, sessionCount),
        lastRunAt: toLastRunAt(sessions.newestMtimeMs),
      })
    }
  }

  // Synthetic "default" profile — only surface it when no named profile is
  // selected. Otherwise it duplicates the active named profile's identity in
  // the UI (e.g. both `default` and `hermes-switch` show up for the same
  // gateway runtime). The synthetic default exists only because the root
  // ~/.hermes/config.yaml isn't a first-class profile in hermes-agent.
  if (activeProfile !== 'default') {
    listProfilesCache = { ts: now, results }
    return results
  }

  const root = getClaudeRoot()
  const config = readYamlConfig(path.join(root, 'config.yaml'))
  // Resolve model/provider for default profile too
  let defaultModel: string | undefined
  let defaultProvider: string | undefined
  if (typeof config.model === 'string') {
    defaultModel = config.model
  } else if (
    config.model &&
    typeof config.model === 'object' &&
    !Array.isArray(config.model)
  ) {
    const m = config.model as Record<string, unknown>
    if (typeof m.default === 'string') defaultModel = m.default
    if (typeof m.provider === 'string') defaultProvider = m.provider
  }
  if (!defaultProvider && typeof config.provider === 'string') {
    defaultProvider = config.provider
  }
  const defaultSessions = walkFiles(
    path.join(root, 'sessions'),
    isSessionFile,
    { trackMtime: true },
  )
  results.unshift({
    name: 'default',
    path: root,
    active: true,
    exists: true,
    model: defaultModel,
    provider: defaultProvider,
    skillCount: countFilesRecursive(path.join(root, 'skills'), isSkillFile),
    sessionCount: defaultSessions.count,
    hasEnv: fs.existsSync(path.join(root, '.env')),
    updatedAt: latestMtime([root, path.join(root, 'config.yaml')]),
    // This branch only runs when `default` IS the active profile.
    status: 'active',
    lastRunAt: toLastRunAt(defaultSessions.newestMtimeMs),
  })

  results.sort((a, b) => {
    if (a.active && !b.active) return -1
    if (!a.active && b.active) return 1
    return Date.parse(b.updatedAt || '') - Date.parse(a.updatedAt || '')
  })
  listProfilesCache = { ts: now, results }
  return results
}

export function readProfile(name: string): ProfileDetail {
  const active = getActiveProfileName()
  const normalized = name.trim() || 'default'

  let isBuiltin = false
  let profilePath: string
  if (normalized === 'default') {
    profilePath = getClaudeRoot()
  } else if (BUILTIN_PROFILE_NAMES.has(normalized)) {
    isBuiltin = true
    profilePath = path.join(getProfilesRoot(), normalized)
  } else {
    // Read path: `validateProfileIdentifier`, NOT `validateProfileName`. A
    // profile directory that predates PROFILE_NAME_RE (or was created by hand)
    // must stay readable, otherwise it can never be renamed into a valid name.
    // The two branches above already handle the reserved names that
    // validateProfileName exists to block.
    profilePath = path.join(
      getProfilesRoot(),
      validateProfileIdentifier(normalized),
    )
  }

  if (!fs.existsSync(profilePath)) throw new Error('Profile not found')
  const configPath = path.join(profilePath, 'config.yaml')
  const envPath = path.join(profilePath, '.env')
  const sessionsDir = path.join(profilePath, 'sessions')
  const skillsDir = path.join(profilePath, 'skills')
  const config = readYamlConfig(configPath)

  // Built-ins are flagged so the UI can badge them — NOT because they are
  // read-only (P-17). They are deliberately EDITABLE: `updateProfileConfig()`
  // uses the permissive identifier validator precisely so `hermes-switch`,
  // `neo`, `trinity` and `morpheus` can be tuned. What they cannot be is
  // *created*, *renamed* or *deleted* — `validateProfileName()` blocks their
  // names on those paths. A `readonly: true` flag used to be stamped here,
  // contradicting all of that; nothing consumed it, so it is gone. Do not
  // re-add it.
  const returnConfig: ProfileConfig & {
    builtin?: boolean
  } = {
    ...config,
    ...(isBuiltin && { builtin: true }),
  }

  return {
    name: normalized,
    path: profilePath,
    active: normalized === active,
    config: returnConfig,
    envPath: fs.existsSync(envPath) ? envPath : undefined,
    hasEnv: fs.existsSync(envPath),
    sessionsDir: fs.existsSync(sessionsDir) ? sessionsDir : undefined,
    skillsDir: fs.existsSync(skillsDir) ? skillsDir : undefined,
  }
}

export type SetActiveProfileResult = {
  profile: string
  /**
   * The Hermes Agent gateway loads its config at startup and does NOT
   * hot-reload when `active_profile` changes. Callers must restart the
   * gateway for the new profile to actually take effect — surface this
   * in the UI rather than relying on the dev-only console warning below.
   */
  needsGatewayRestart: boolean
}

export function setActiveProfile(name: string): SetActiveProfileResult {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Profile name is required')
  // "default" means clear the active_profile file (revert to default)
  if (trimmed === 'default') {
    const activePath = getActiveProfilePath()
    if (fs.existsSync(activePath)) fs.unlinkSync(activePath)
    // Every path out of this function mutates what listProfiles() reports —
    // `active` flags flip and the synthetic `default` row appears/disappears.
    // Skipping the reset here left the Profiles screen showing the old active
    // profile (and hiding `default`) for up to LIST_PROFILES_TTL_MS.
    listProfilesCache = null
    return { profile: 'default', needsGatewayRestart: true }
  }
  // Activating a profile is a read operation — point `active_profile`
  // at an existing directory. Builtin profiles (neo/trinity/morpheus/
  // hermes-switch) are valid activation targets even though they cannot
  // be created or mutated via the UI.
  const normalized = validateProfileIdentifier(trimmed)
  const profilePath = path.join(getProfilesRoot(), normalized)
  if (!fs.existsSync(profilePath)) throw new Error('Profile not found')
  fs.mkdirSync(getClaudeRoot(), { recursive: true })
  fs.writeFileSync(getActiveProfilePath(), `${normalized}\n`, 'utf-8')
  listProfilesCache = null
  if (process.env.NODE_ENV !== 'production') {
    console.warn(
      `[profiles] Active profile set to "${normalized}". Restart the Hermes Agent gateway for this profile switch to take effect.`,
    )
  }
  return { profile: normalized, needsGatewayRestart: true }
}

export function createProfile(
  name: string,
  options?: { cloneFrom?: string; model?: string; provider?: string },
): ProfileDetail {
  const normalized = validateProfileName(name)
  const profilePath = path.join(getProfilesRoot(), normalized)
  if (fs.existsSync(profilePath)) throw new Error('Profile already exists')
  fs.mkdirSync(profilePath, { recursive: true })

  const configPath = path.join(profilePath, 'config.yaml')

  // Clone config from source profile if specified
  let cloneSourceRoot: string | null = null
  if (options?.cloneFrom) {
    const sourceName = validateProfileIdentifier(options.cloneFrom)
    // The 'default' profile lives at ~/.hermes, not ~/.hermes/profiles/default
    const sourceRoot =
      sourceName === 'default'
        ? getClaudeRoot()
        : path.join(getProfilesRoot(), sourceName)
    cloneSourceRoot = sourceRoot
    const sourceConfigPath = path.join(sourceRoot, 'config.yaml')
    if (fs.existsSync(sourceConfigPath)) {
      const cloned = readYamlConfig(sourceConfigPath)
      cloned.agent_ui = normalizeClonedAgentUI(cloned.agent_ui)
      fs.writeFileSync(configPath, YAML.stringify(cloned), 'utf-8')
    } else {
      fs.writeFileSync(
        configPath,
        YAML.stringify({ model: '', provider: '' }),
        'utf-8',
      )
    }
  } else {
    fs.writeFileSync(
      configPath,
      YAML.stringify({ model: '', provider: '' }),
      'utf-8',
    )
  }

  // Override model/provider if specified
  if (options?.model || options?.provider) {
    const config = readYamlConfig(configPath)
    if (options.model) config.model = options.model
    if (options.provider) config.provider = options.provider
    fs.writeFileSync(configPath, YAML.stringify(config), 'utf-8')
  }

  // Create subdirectories. These run BEFORE the clone-asset copy below so the
  // copy lands inside (and is not clobbered by) the scaffolded `skills/` dir.
  fs.mkdirSync(path.join(profilePath, 'skills'), { recursive: true })
  fs.mkdirSync(path.join(profilePath, 'sessions'), { recursive: true })

  // A clone inherits the source's *authored* assets, never its history or
  // secrets: `sessions/`, `memories/`, `memory/` and `.env` are deliberately
  // excluded so the clone starts with a clean run history and its own
  // credentials. Every copy is existence-guarded — a source profile without a
  // SOUL.md or skills/ dir must still clone cleanly.
  if (cloneSourceRoot) {
    const soulSource = path.join(cloneSourceRoot, 'SOUL.md')
    if (fs.existsSync(soulSource)) {
      fs.copyFileSync(soulSource, path.join(profilePath, 'SOUL.md'))
    }
    const skillsSource = path.join(cloneSourceRoot, 'skills')
    if (fs.existsSync(skillsSource)) {
      fs.cpSync(skillsSource, path.join(profilePath, 'skills'), {
        recursive: true,
      })
    }
  }

  listProfilesCache = null
  return readProfile(normalized)
}

/**
 * Reset the identity fields a clone must NOT inherit from its source.
 *
 * `createProfile()` copies the source's config.yaml, so cloning a built-in
 * (`hermes-switch`, tier 1, status `active`) used to mint a Tier-1 ACTIVE
 * orchestrator that had never run — corrupting the Profiles screen's tier
 * counters and tier filter, and walking straight around the
 * "agent_ui.tier must be 3 for user-created profiles" 400 that
 * `api/profiles/create` enforces on the wizard path.
 *
 * This lives in the server layer rather than in the route handler on purpose:
 * `createProfile()` is where the copy happens, so the invariant cannot be
 * bypassed by a future caller (CLI, importer, a second route) that forgets to
 * re-implement it. The clone dialog posts only `{ name, cloneFrom }` — there is
 * no `agent_ui` in the body for a route-layer check to inspect — while the
 * wizard path is unaffected because `create.ts` applies its own explicit
 * `agent_ui` patch afterwards, which deep-merges over these defaults.
 *
 * Everything else the source declared (`glyph`, `role`, `tags`, `persona_id`)
 * is authored identity and is preserved.
 *
 * Exported so `profiles-export.ts`'s `importProfile()` can apply the exact
 * same reset to an imported bundle's `agent_ui` — an imported config is
 * hostile input in the same way a cloned built-in's config is: without this,
 * a handed-around bundle could mint a fake Tier-1 "active" agent that has
 * never actually run.
 */
export function normalizeClonedAgentUI(source?: AgentUIMetadata): AgentUIMetadata {
  return {
    ...(source ?? {}),
    tier: 3,
    status: 'draft',
    last_run: null,
  }
}

export function deleteProfile(name: string): void {
  // Shape-permissive on purpose — see validateNonReservedProfileName.
  const normalized = validateNonReservedProfileName(name)
  if (normalized === getActiveProfileName())
    throw new Error('Cannot delete the active profile')
  const profilePath = path.join(getProfilesRoot(), normalized)
  if (!fs.existsSync(profilePath)) throw new Error('Profile not found')
  const trashDir = path.join(getClaudeRoot(), 'trash')
  fs.mkdirSync(trashDir, { recursive: true })
  const trashName = `${normalized}-${Date.now()}`
  fs.renameSync(profilePath, path.join(trashDir, trashName))
  listProfilesCache = null
}

export function writeProfile(
  name: string,
  patch: Partial<ProfileConfig>,
): ProfileDetail {
  return updateProfileConfig(name, patch)
}

// NOTE(yaml-comments): updateProfileConfig round-trips config through YAML.parse → YAML.stringify,
// which discards comments. Preserving comments via the yaml CST/Document API is deferred — the
// config.yaml files are generated/managed by this tool, not hand-authored in normal usage.
// If comment preservation becomes critical, replace the YAML.stringify(current) call below with
// a YAML.parseDocument(rawText) + doc.setIn([key], value) + doc.toString() flow.
export function updateProfileConfig(
  name: string,
  patch: Partial<ProfileConfig> | Record<string, unknown>,
): ProfileDetail {
  const normalized = name.trim() || 'default'
  // Use the read-style identifier validator (path-safe, allows any existing name)
  // rather than validateProfileName: updating only ever MUTATES an existing profile
  // dir (guarded by the existsSync check below), so built-in-named profiles
  // (hermes-switch/neo/trinity/morpheus) are editable. Creating a new profile with a
  // reserved name is still blocked in createProfile via validateProfileName.
  const profilePath =
    normalized === 'default'
      ? getClaudeRoot()
      : path.join(getProfilesRoot(), validateProfileIdentifier(normalized))
  if (!fs.existsSync(profilePath)) throw new Error('Profile not found')
  const configPath = path.join(profilePath, 'config.yaml')
  const current = readYamlConfig(configPath)

  // Merge semantics (null-means-delete, mcp_servers replace-whole, deep merge
  // everything else) live in ../lib/profile-merge so the wizard's client-side
  // save-preview (predictMergedConfig in profile-config-map.ts) runs the exact
  // same algorithm instead of a hand-kept copy of it. See that module's doc
  // comment for why the two must never drift apart again.
  const merged = mergeProfileConfig(current, patch)

  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, YAML.stringify(merged), 'utf-8')
  listProfilesCache = null
  return readProfile(normalized)
}

export function renameProfile(oldName: string, newName: string): ProfileDetail {
  // The SOURCE is only dereferenced, so it stays shape-permissive: renaming is
  // how an oddly-named legacy profile gets fixed. The TARGET is written to
  // disk, so it must satisfy the canonical rule.
  const from = validateNonReservedProfileName(oldName)
  const to = validateProfileName(newName)
  const fromPath = path.join(getProfilesRoot(), from)
  const toPath = path.join(getProfilesRoot(), to)
  if (!fs.existsSync(fromPath)) throw new Error('Profile not found')
  if (fs.existsSync(toPath)) throw new Error('Target profile already exists')
  fs.renameSync(fromPath, toPath)
  if (getActiveProfileName() === from) {
    fs.writeFileSync(getActiveProfilePath(), `${to}\n`, 'utf-8')
  }
  listProfilesCache = null
  return readProfile(to)
}
