import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { BUILTIN_AGENTS } from '../lib/builtin-agents'
import {
  BUILTIN_PROFILE_NAMES,
  getActiveProfileName,
  getProfilesRoot,
  setActiveProfile,
} from './profiles-browser'
import type { BuiltinAgent } from '../lib/builtin-agents'

let bootstrapped = false

/**
 * Schema version for the `.profiles-bootstrap` marker file — see
 * `adoptDefaultProfileOnce`.
 *
 * Deliberately still `1` even though `revertedAdoption` was added later: the
 * field is purely additive and optional, this module is the marker's only
 * reader, and — critically — `repairHarmfulAdoptionOnce()` must recognise
 * markers written by the *previous* (buggy) release, which are exactly
 * `{version: 1, adoptedProfile: "hermes-switch"}`. Gating anything on a
 * version bump would make the repair unable to see the very installs it
 * exists to fix.
 */
const PROFILES_BOOTSTRAP_MARKER_VERSION = 1

type ProfilesBootstrapMarker = {
  version: number
  /** The profile id adopted as active, or `null` if adoption was skipped/declined. */
  adoptedProfile: string | null
  /**
   * Set exactly once, by `repairHarmfulAdoptionOnce()`, when a previous
   * adoption is detected as having broken the installation and is reverted.
   * Its presence is the idempotence latch — the repair never runs twice.
   */
  revertedAdoption?: {
    /** The profile that was un-adopted (`active_profile` was removed). */
    profile: string
    /** ISO timestamp of the revert. */
    at: string
    /** Machine-readable reason, for support/debugging. */
    reason: string
  }
}

/**
 * Hermes home — `~/.hermes` unless `HERMES_HOME` / `CLAUDE_HOME` says
 * otherwise. Derived from `getProfilesRoot()`'s parent rather than
 * re-deriving it with a fresh `os.homedir()` call, so this module always
 * agrees with whatever home resolution `profiles-browser.ts` performed.
 */
function getHermesHome(): string {
  return path.dirname(getProfilesRoot())
}

/**
 * Path to the one-time bootstrap marker. Lives directly under the Hermes
 * home directory, alongside `active_profile`.
 */
function getBootstrapMarkerPath(): string {
  return path.join(getHermesHome(), '.profiles-bootstrap')
}

function hasBootstrapMarker(): boolean {
  return fs.existsSync(getBootstrapMarkerPath())
}

/**
 * Read and shape-check the marker. Returns `null` when it is absent,
 * unreadable or not a JSON object — every caller treats `null` as "no
 * decision recorded", which is the safe direction for both the adoption
 * guard (`hasBootstrapMarker()` is checked separately, so an unparsable
 * marker still blocks re-adoption) and the repair (which does nothing
 * without a well-formed `adoptedProfile`).
 */
function readBootstrapMarker(): ProfilesBootstrapMarker | null {
  try {
    const markerPath = getBootstrapMarkerPath()
    if (!fs.existsSync(markerPath)) return null
    const parsed = JSON.parse(fs.readFileSync(markerPath, 'utf-8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    return parsed as ProfilesBootstrapMarker
  } catch (err) {
    console.warn(
      '[profiles-bootstrap] Could not read the bootstrap marker (treating it as unreadable, not absent):',
      err,
    )
    return null
  }
}

function writeBootstrapMarker(
  adoptedProfile: string | null,
  revertedAdoption?: ProfilesBootstrapMarker['revertedAdoption'],
): void {
  const markerPath = getBootstrapMarkerPath()
  const marker: ProfilesBootstrapMarker = {
    version: PROFILES_BOOTSTRAP_MARKER_VERSION,
    adoptedProfile,
    ...(revertedAdoption ? { revertedAdoption } : {}),
  }
  fs.mkdirSync(path.dirname(markerPath), { recursive: true })
  fs.writeFileSync(markerPath, JSON.stringify(marker, null, 2), 'utf-8')
}

// ── "Is this installation already in use?" detection ───────────────────────

/**
 * `.env` assignment line, tolerating a leading `export`. Continuation lines
 * of a multi-line quoted value can in principle also match this; that only
 * ever makes the file look *more* used, which is the safe direction for
 * every caller below.
 */
const ENV_ASSIGNMENT_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/

/**
 * The only `.env` keys a *never-configured* install is expected to carry.
 *
 * `install.sh` / the Docker image write `API_SERVER_ENABLED=true` (and a
 * generated `API_SERVER_KEY`) into `~/.hermes/.env` — that is what turns on
 * the gateway's HTTP API on :8642. They are machine bootstrap, not user
 * configuration, so their presence alone must not veto adoption. Everything
 * else — a provider key, a base URL, a tuning variable — means a human has
 * configured this install.
 *
 * Keep this list *tiny*. Every name added here is a way for a configured
 * install to look fresh.
 */
const GATEWAY_BOOTSTRAP_ENV_KEYS = new Set([
  'API_SERVER_ENABLED',
  'API_SERVER_KEY',
])

/**
 * Root `config.yaml` keys that carry no user intent. `_config_version` is
 * migration bookkeeping stamped by the gateway (`hermes_cli/config.py`
 * `_persist_migration`) on installs that have never been configured —
 * notably, new *default* keys are explicitly NOT materialised to disk, so
 * anything else present in the file was put there by a human or by a
 * migration acting on a human's setting.
 */
const NON_SUBSTANTIVE_ROOT_CONFIG_KEYS = new Set(['_config_version'])

/**
 * Read the assignment keys out of a `.env` file.
 *
 * Returns `[]` for "file absent or has no assignments" and `null` for
 * "exists but could not be read". Callers must distinguish the two: `null`
 * means *unknown*, and every caller here resolves unknown in the
 * conservative direction (skip adoption / skip the repair).
 */
function readEnvAssignmentKeys(envPath: string): Array<string> | null {
  let raw: string
  try {
    if (!fs.existsSync(envPath)) return []
    raw = fs.readFileSync(envPath, 'utf-8')
  } catch (err) {
    console.warn(`[profiles-bootstrap] Could not read "${envPath}":`, err)
    return null
  }
  const keys: Array<string> = []
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = ENV_ASSIGNMENT_RE.exec(line)
    if (match?.[1]) keys.push(match[1])
  }
  return keys
}

/** A YAML value that actually says something (not null / '' / [] / {}). */
function isMeaningfulConfigValue(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim() !== ''
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value).length > 0
  return true
}

/**
 * Does the root `~/.hermes/config.yaml` carry configuration a profile would
 * NOT inherit?
 *
 * This is the load-bearing signal. A named profile is a fully independent
 * `HERMES_HOME`: `hermes_cli/config.py` reads only that profile's own
 * `config.yaml` and never merges the root's. The install this repair exists
 * for had 21 top-level keys at the root against 4 in the freshly-seeded
 * profile — adopting silently discarded the other 17.
 *
 * Unparsable → reported as in-use. A root config we cannot understand is the
 * last thing we should be routing around.
 */
function rootConfigHasUserSettings(): boolean {
  const configPath = path.join(getHermesHome(), 'config.yaml')
  try {
    if (!fs.existsSync(configPath)) return false
    const parsed = YAML.parse(fs.readFileSync(configPath, 'utf-8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return false
    }
    return Object.entries(parsed as Record<string, unknown>).some(
      ([key, value]) =>
        !NON_SUBSTANTIVE_ROOT_CONFIG_KEYS.has(key) &&
        isMeaningfulConfigValue(value),
    )
  } catch (err) {
    console.warn(
      '[profiles-bootstrap] Root config.yaml is unreadable/unparsable — treating this install as already in use:',
      err,
    )
    return true
  }
}

/**
 * Does the root `~/.hermes/.env` hold anything beyond machine bootstrap?
 *
 * `.env` is the sharpest edge of profile scoping: `hermes_cli/env_loader.py`
 * `load_hermes_dotenv()` reads `HERMES_HOME/.env` and nothing else — there is
 * no root fallback whatsoever (unlike `auth.json`, which
 * `_global_auth_file_path()` deliberately exposes to profile processes). Any
 * user-authored value at the root becomes invisible the moment a profile is
 * activated.
 *
 * Unreadable → reported as in-use.
 */
function rootEnvHasUserValues(): boolean {
  const keys = readEnvAssignmentKeys(path.join(getHermesHome(), '.env'))
  if (keys === null) return true
  return keys.some((key) => !GATEWAY_BOOTSTRAP_ENV_KEYS.has(key))
}

/**
 * Has anything ever run against the root config? A non-empty root
 * `sessions/` directory means this install has real history that a profile
 * switch would hide (each profile has its own `sessions/`).
 *
 * Weaker than the two above — the install that prompted this fix had an
 * empty root `sessions/` because its history lives in `state.db` — but it is
 * cheap and strictly additive.
 */
function rootSessionsExist(): boolean {
  const sessionsDir = path.join(getHermesHome(), 'sessions')
  try {
    if (!fs.existsSync(sessionsDir)) return false
    return fs.readdirSync(sessionsDir).length > 0
  } catch (err) {
    console.warn(
      '[profiles-bootstrap] Could not inspect root sessions/ — treating this install as already in use:',
      err,
    )
    return true
  }
}

/**
 * Are there profiles this module did not seed?
 *
 * A hand-made or wizard-made profile means the user has already engaged with
 * the profiles system and has their own opinion about what should be active;
 * we must not pre-empt it. Builtin ids are excluded by the union of the
 * *resolved* agent list (so a fork's `HERMES_BUILTIN_PROFILES_FILE` seeds do
 * not look user-created) and `BUILTIN_PROFILE_NAMES` (so seeds from a
 * previous, non-overridden run do not either).
 */
function userCreatedProfilesExist(agents: Array<BuiltinAgent>): boolean {
  const profilesRoot = getProfilesRoot()
  const seeded = new Set<string>([
    ...BUILTIN_PROFILE_NAMES,
    ...agents.map((agent) => agent.id),
  ])
  try {
    if (!fs.existsSync(profilesRoot)) return false
    for (const entry of fs.readdirSync(profilesRoot, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      if (seeded.has(entry.name)) continue
      if (entry.isDirectory()) return true
      if (!entry.isSymbolicLink()) continue
      try {
        if (fs.statSync(path.join(profilesRoot, entry.name)).isDirectory()) {
          return true
        }
      } catch {
        // Broken symlink — not a profile.
      }
    }
    return false
  } catch (err) {
    console.warn(
      '[profiles-bootstrap] Could not enumerate profiles/ — treating this install as already in use:',
      err,
    )
    return true
  }
}

/** Reasons an installation is judged "already in use". */
type InstallInUseSignal =
  | 'root-config-has-user-settings'
  | 'root-env-has-user-values'
  | 'root-sessions-exist'
  | 'user-created-profiles-exist'
  | 'detection-failed'

/**
 * Decide whether this installation is *already in use* — i.e. it is running
 * on the root `~/.hermes` config and switching it onto a bare seeded profile
 * would take working configuration away.
 *
 * Why this exists
 * ---------------
 * `getActiveProfileName()` returning `'default'` was previously read as
 * "never configured". It does not mean that. It means "no profile pointer is
 * set", which on a working install means "running on the root config". The
 * first shipped version of `adoptDefaultProfileOnce()` conflated the two and
 * moved a fully-configured install onto a profile whose `config.yaml` had 4
 * keys and whose `.env` was 0 bytes — killing `API_SERVER_ENABLED`, hence
 * the gateway's HTTP API, hence every capability probe.
 *
 * The bias is deliberate and asymmetric: a false positive (skipping adoption
 * on a fresh install) costs a cosmetic default; a false negative breaks the
 * install. So every ambiguous or unreadable case counts as "in use", and the
 * whole function reports `detection-failed` rather than `false` if it throws.
 *
 * Returns every matching signal (not just the first) so the skip can be
 * logged with its actual justification.
 */
function detectInstallInUseSignals(
  agents: Array<BuiltinAgent>,
): Array<InstallInUseSignal> {
  try {
    const signals: Array<InstallInUseSignal> = []
    if (rootConfigHasUserSettings()) {
      signals.push('root-config-has-user-settings')
    }
    if (rootEnvHasUserValues()) signals.push('root-env-has-user-values')
    if (rootSessionsExist()) signals.push('root-sessions-exist')
    if (userCreatedProfilesExist(agents)) {
      signals.push('user-created-profiles-exist')
    }
    return signals
  } catch (err) {
    console.warn(
      '[profiles-bootstrap] In-use detection failed — refusing to adopt a default profile:',
      err,
    )
    return ['detection-failed']
  }
}

/**
 * Pick which resolved builtin agent id to adopt as the default active
 * profile. Prefers `requestedId` verbatim when it exists in the resolved
 * list (so a fork's `HERMES_BUILTIN_PROFILES_FILE` + matching
 * `HERMES_DEFAULT_PROFILE` always agree), otherwise falls back to the first
 * tier-1 agent (the orchestrator role), then simply the first agent in the
 * list. Returns `undefined` only when `agents` is empty — callers already
 * guard against that before reaching here.
 */
function resolveAdoptionTarget(
  agents: Array<BuiltinAgent>,
  requestedId: string,
): string | undefined {
  if (agents.some((agent) => agent.id === requestedId)) return requestedId
  const tier1 = agents.find((agent) => agent.tier === 1)
  if (tier1) return tier1.id
  return agents[0]?.id
}

/**
 * One-time adoption of a default *active* profile for a fresh installation.
 *
 * Why the marker exists
 * ----------------------
 * `getActiveProfileName()` (profiles-browser.ts) returns the literal string
 * `'default'` whenever `~/.hermes/active_profile` is missing OR empty. That
 * single return value conflates two situations this module cannot otherwise
 * tell apart:
 *
 *   1. A brand-new install that has never had an opinion about which
 *      profile to run — `active_profile` was never written.
 *   2. A user who explicitly reverted to the synthetic `default` profile via
 *      `setActiveProfile('default')`, which *deletes* `active_profile`
 *      rather than writing the literal string "default" into it.
 *
 * If this function adopted `hermes-switch` every time `active_profile` is
 * absent, it would silently re-adopt it on the very next page load after a
 * deliberate revert (case 2) — the user could never actually stay on
 * `default`. The marker file (`~/.hermes/.profiles-bootstrap`) is the
 * missing bit of state that disambiguates the two: its *presence* means
 * "this installation has already been evaluated for default-profile
 * adoption," independent of whatever `active_profile` says right now. Once
 * written, this function never touches `active_profile` again for that
 * installation.
 *
 * The rule
 * --------
 * Adopt a default builtin profile as active ONLY when ALL of:
 *   - the marker file is absent, AND
 *   - `active_profile` is absent or empty
 *     (i.e. `getActiveProfileName() === 'default'`), AND
 *   - `detectInstallInUseSignals()` finds nothing — the install is genuinely
 *     new, not merely running on the root config.
 *
 * That third clause is the fix for the regression this module caused. An
 * absent `active_profile` on a *working* install does not mean "never
 * configured"; it means "running on the root `~/.hermes` config". Adopting a
 * bare seeded profile there discards the root's `config.yaml` (profiles do
 * not inherit it) and its entire `.env` (which has no root fallback at all).
 * See `detectInstallInUseSignals` for the signals and the deliberate
 * over-detection bias.
 *
 * The marker is written unconditionally at the end of this function — win,
 * lose, or declined — so adoption is evaluated at most once per
 * installation no matter how many times `ensureBuiltinProfiles()` runs.
 *
 * Which profile gets adopted is controlled by `HERMES_DEFAULT_PROFILE`
 * (default `'hermes-switch'`), matching this module's existing fork-friendly
 * knobs (`HERMES_SKIP_PROFILE_BOOTSTRAP`, `HERMES_BUILTIN_PROFILES_FILE`).
 * If the requested id isn't present in the resolved builtin list, falls back
 * to the first tier-1 agent, then the first agent, then leaves
 * `active_profile` untouched entirely rather than pointing it at a profile
 * that doesn't exist on disk.
 *
 * Resilience: `ensureBuiltinProfiles()` is called from a GET handler
 * (`api/profiles/list.ts`), so a failure here must warn and return, never
 * throw.
 */
function adoptDefaultProfileOnce(agents: Array<BuiltinAgent>): void {
  try {
    if (hasBootstrapMarker()) return

    if (getActiveProfileName() !== 'default') {
      // Someone already has an opinion — either a deliberate user choice, or
      // (pre-marker installs) whatever was already active before this
      // feature shipped. Either way, never override it. Still record that
      // this installation has been evaluated so we don't re-check forever.
      writeBootstrapMarker(null)
      return
    }

    const inUseSignals = detectInstallInUseSignals(agents)
    if (inUseSignals.length > 0) {
      console.info(
        `[profiles-bootstrap] Not adopting a default profile: this installation is already in use (${inUseSignals.join(', ')}). Staying on the root ~/.hermes config, which a bare profile would not inherit.`,
      )
      writeBootstrapMarker(null)
      return
    }

    const requestedId =
      process.env.HERMES_DEFAULT_PROFILE?.trim() || 'hermes-switch'
    const target = resolveAdoptionTarget(agents, requestedId)

    let adopted: string | null = null
    if (target) {
      try {
        // Order matters: make the profile viable BEFORE pointing the gateway
        // at it, so there is no window where `active_profile` names a profile
        // with no `.env`.
        seedProfileEnvFromRoot(path.join(getProfilesRoot(), target))
        setActiveProfile(target)
        adopted = target
      } catch (err) {
        console.warn(
          `[profiles-bootstrap] Failed to adopt default profile "${target}":`,
          err,
        )
      }
    }

    // Record what actually happened, not what was intended: a marker naming
    // a profile we failed to activate would make `repairHarmfulAdoptionOnce`
    // reason about an adoption that never occurred.
    writeBootstrapMarker(adopted)
  } catch (err) {
    console.warn(
      '[profiles-bootstrap] Default-profile adoption failed:',
      err,
    )
  }
}

/**
 * Give a freshly-adopted profile a usable `.env`.
 *
 * Even a genuinely fresh install has one thing that cannot survive a profile
 * switch: `~/.hermes/.env`. `hermes_cli/env_loader.py`'s
 * `load_hermes_dotenv()` reads `HERMES_HOME/.env` and nothing else — there is
 * no root fallback — so `API_SERVER_ENABLED=true` / `API_SERVER_KEY`, written
 * by `install.sh` and the Docker image, vanish the instant `active_profile`
 * points somewhere. Without them the gateway never enables the api_server
 * platform, nothing binds :8642, and the UI is stuck on its "connect your
 * backend" screen. That is precisely the failure this whole change exists to
 * undo, so adoption must not be able to reproduce it in miniature.
 *
 * Copies verbatim, and only when the profile's own `.env` is absent or
 * blank — a `.env` with content is the profile's own credentials and is
 * never overwritten. (`createProfile()` deliberately excludes `.env` from
 * clones for that reason; this is the opposite case — a profile the *system*
 * just created and is about to make active on the user's behalf, which must
 * behave like the root it is replacing.)
 *
 * Best-effort: a failure here is warned about and adoption continues, since
 * `seedProfileEnvFromRoot` throwing must not leave `active_profile` unset in
 * a way that re-runs forever.
 */
function seedProfileEnvFromRoot(profileDir: string): void {
  try {
    const rootEnvPath = path.join(getHermesHome(), '.env')
    if (!fs.existsSync(rootEnvPath)) return
    const rootEnv = fs.readFileSync(rootEnvPath, 'utf-8')
    if (!rootEnv.trim()) return

    const profileEnvPath = path.join(profileDir, '.env')
    if (fs.existsSync(profileEnvPath)) {
      // Never clobber content the profile already has.
      if (fs.readFileSync(profileEnvPath, 'utf-8').trim() !== '') return
    }

    fs.mkdirSync(profileDir, { recursive: true })
    fs.writeFileSync(profileEnvPath, rootEnv, { encoding: 'utf-8', mode: 0o600 })
    try {
      // `mode` on writeFileSync only applies when the file is created, and
      // `ensureEnvFile()` has usually already made a 0-byte one. The root
      // .env holds secrets; the copy must not be world-readable.
      fs.chmodSync(profileEnvPath, 0o600)
    } catch {
      // Non-POSIX filesystem — the copy is still correct, just not chmodded.
    }
    console.info(
      `[profiles-bootstrap] Copied ~/.hermes/.env into "${profileDir}" so the adopted profile keeps the root's environment (profile .env has no root fallback).`,
    )
  } catch (err) {
    console.warn(
      `[profiles-bootstrap] Could not seed "${profileDir}/.env" from the root .env:`,
      err,
    )
  }
}

/**
 * Undo a previous adoption that is demonstrably breaking this installation.
 *
 * THIS IS THE ONLY PLACE IN THIS CODEBASE THAT REVERSES A USER-VISIBLE
 * SETTING WITHOUT BEING ASKED. Treat every condition below as load-bearing.
 *
 * The damage it repairs: a prior release adopted `hermes-switch` whenever
 * `active_profile` was absent, including on installs that were simply running
 * on the root config. The gateway then booted with
 * `HERMES_HOME=~/.hermes/profiles/hermes-switch`, whose `.env` we seed as 0
 * bytes. Because `load_hermes_dotenv()` has no root fallback, the root's
 * `API_SERVER_ENABLED` / `API_SERVER_KEY` became invisible, the api_server
 * platform never enabled, nothing bound :8642, and the UI showed "connect
 * your backend" with an Auto-Start button that could not help — the process
 * was already running. The user cannot reasonably diagnose this, and the
 * failure mode locks them out of the app entirely, which is what justifies an
 * automatic revert instead of a warning.
 *
 * Fires only when ALL of these hold:
 *
 *  1. A marker exists and names a profile in `adoptedProfile` — i.e. *we*
 *     switched this install, it was not the user.
 *  2. The marker has no `revertedAdoption` — the repair is once-only, so a
 *     user who re-selects the profile afterwards is never fought.
 *  3. `active_profile` still equals that adopted value. If it names anything
 *     else (or is absent), the user has since made their own choice and this
 *     function must not touch it. `adoptedProfile` is always a real profile
 *     id, never the literal `'default'`, so the "absent" case — where
 *     `getActiveProfileName()` returns `'default'` — cannot match either.
 *  4. `active_profile` is not *newer* than the marker. Adoption writes
 *     `active_profile` and then the marker in the same breath, so on an
 *     untouched install the marker's mtime is >= the pointer's. A user who
 *     later re-selected the same profile through the UI leaves a pointer
 *     newer than the marker, and this is the only evidence that distinguishes
 *     their deliberate choice from our automatic one. A 1s slack absorbs
 *     filesystem timestamp granularity; if either mtime is unreadable we do
 *     not repair.
 *  5. The adoption is demonstrably harmful: the root `.env` has real
 *     assignments while the adopted profile's `.env` is absent or has none.
 *     A profile with its own `.env` is working (or at least deliberately
 *     configured) and is left alone; a root with no `.env` had nothing to
 *     lose, so the adoption did not cause this.
 *
 * The revert removes `active_profile` (back to the root config) and stamps
 * `revertedAdoption` into the marker so it happens exactly once, ever.
 */
function repairHarmfulAdoptionOnce(): void {
  try {
    const marker = readBootstrapMarker()
    if (!marker) return

    // (2) already repaired — never run twice.
    if (marker.revertedAdoption) return

    // (1) only repair adoptions we performed.
    const adopted = marker.adoptedProfile
    if (typeof adopted !== 'string' || !adopted.trim()) return

    // (3) the user has not since chosen something themselves.
    if (getActiveProfileName() !== adopted) return

    // (4) the pointer was not re-written after we recorded the adoption.
    if (!isActiveProfileUntouchedSinceMarker()) return

    // (5) the adoption actually cost this install its environment.
    const rootEnvKeys = readEnvAssignmentKeys(path.join(getHermesHome(), '.env'))
    if (rootEnvKeys === null || rootEnvKeys.length === 0) return
    const profileEnvKeys = readEnvAssignmentKeys(
      path.join(getProfilesRoot(), adopted, '.env'),
    )
    if (profileEnvKeys === null || profileEnvKeys.length > 0) return

    setActiveProfile('default')
    writeBootstrapMarker(null, {
      profile: adopted,
      at: new Date().toISOString(),
      reason: 'adopted-profile-had-empty-env-while-root-env-was-populated',
    })
    console.warn(
      `[profiles-bootstrap] Reverted the automatic switch to profile "${adopted}" and restored the root ~/.hermes config.\n` +
        `  Why: this workspace adopted "${adopted}" as the active profile, but that profile's .env is empty while ~/.hermes/.env defines ${rootEnvKeys.length} variable(s).\n` +
        `  A profile is a separate HERMES_HOME and .env has no root fallback, so the gateway lost API_SERVER_ENABLED / API_SERVER_KEY and could not serve its HTTP API.\n` +
        `  Nothing was deleted — the profile still exists at ${path.join(getProfilesRoot(), adopted)}. Restart the Hermes Agent gateway to pick up the root config, and re-select the profile from Profiles if you want it (copy ~/.hermes/.env into it first).`,
    )
  } catch (err) {
    console.warn(
      '[profiles-bootstrap] Adoption repair check failed (leaving active_profile untouched):',
      err,
    )
  }
}

/**
 * Condition (4) of `repairHarmfulAdoptionOnce`: is `active_profile` older
 * than (or the same age as) the marker that claims to have written it?
 *
 * Returns `false` — "do not repair" — whenever either timestamp cannot be
 * read. Failing closed here only leaves a broken install broken; failing open
 * could undo a choice the user made on purpose.
 */
function isActiveProfileUntouchedSinceMarker(): boolean {
  /** Filesystem mtime granularity slack. */
  const SLACK_MS = 1000
  try {
    const activeMtimeMs = fs.statSync(
      path.join(getHermesHome(), 'active_profile'),
    ).mtimeMs
    const markerMtimeMs = fs.statSync(getBootstrapMarkerPath()).mtimeMs
    return activeMtimeMs <= markerMtimeMs + SLACK_MS
  } catch {
    return false
  }
}

/**
 * Read the `terminal:` block out of the root `~/.hermes/config.yaml`, if any.
 *
 * Used only at profile-seed time (`ensureConfigYaml`) to emulate an
 * inheritance the gateway itself does not implement — see that function's
 * doc comment. Returns `null` whenever there is nothing safe to copy (file
 * missing, unparsable, or no `terminal:` mapping); callers must treat `null`
 * as "write nothing", never invent a default the user never configured.
 */
function readRootTerminalBlock(): Record<string, unknown> | null {
  try {
    const rootConfigPath = path.join(getHermesHome(), 'config.yaml')
    if (!fs.existsSync(rootConfigPath)) return null
    const parsed = YAML.parse(fs.readFileSync(rootConfigPath, 'utf-8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    const terminal = (parsed as Record<string, unknown>).terminal
    if (!terminal || typeof terminal !== 'object' || Array.isArray(terminal)) {
      return null
    }
    return terminal as Record<string, unknown>
  } catch (err) {
    console.warn(
      '[profiles-bootstrap] Failed to read root `terminal:` block (leaving new profiles without one):',
      err,
    )
    return null
  }
}

/**
 * Resolve the builtin agent list to seed.
 *
 * Priority:
 *   1. `HERMES_BUILTIN_PROFILES_FILE` — JSON file with `BuiltinAgent[]`.
 *      Downstream forks point this at their own curated list.
 *   2. Compiled-in `BUILTIN_AGENTS` (hermes-switch, neo, trinity, morpheus).
 *
 * Invalid override → warns and falls back to the compiled-in list.
 */
function resolveBuiltinAgents(): Array<BuiltinAgent> {
  const override = process.env.HERMES_BUILTIN_PROFILES_FILE?.trim()
  if (!override) return BUILTIN_AGENTS
  try {
    const raw = fs.readFileSync(override, 'utf8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      throw new Error('expected top-level JSON array')
    }
    return parsed as Array<BuiltinAgent>
  } catch (err) {
    console.warn(
      `[profiles-bootstrap] HERMES_BUILTIN_PROFILES_FILE="${override}" invalid — falling back to compiled defaults:`,
      err,
    )
    return BUILTIN_AGENTS
  }
}

/**
 * Ensures each builtin agent (hermes-switch, neo, trinity, morpheus) has a
 * disk profile at ~/.hermes/profiles/{id}/ with full layout:
 * - config.yaml
 * - SOUL.md, memories/MEMORY.md, memories/USER.md
 * - memory/IDENTITY.md
 * - .env (empty)
 * - sessions/, skills/ directories
 *
 * Each file is guarded by fs.existsSync — never overwrites user-customized content.
 * Safe to call multiple times — idempotent per-file, not per-profile.
 *
 * On a genuinely fresh installation (no `.profiles-bootstrap` marker yet, no
 * `active_profile` pointer written, and no sign the install is already in
 * use), this also adopts a default active profile — see
 * `adoptDefaultProfileOnce` for the full rule and why the marker is required.
 * On an installation a *previous* release already broke by adopting too
 * eagerly, `repairHarmfulAdoptionOnce` reverts that one switch. Both are
 * skipped along with everything else under
 * `HERMES_SKIP_PROFILE_BOOTSTRAP=1`.
 *
 * Opt-out / override for downstream forks:
 *   - `HERMES_SKIP_PROFILE_BOOTSTRAP=1` — skip bootstrap entirely.
 *   - `HERMES_BUILTIN_PROFILES_FILE=/path/to/agents.json` — replace the
 *     compiled-in list with a custom `BuiltinAgent[]`.
 *   - `HERMES_DEFAULT_PROFILE=<id>` — adopt a different builtin as the
 *     fresh-install default (falls back sensibly if `<id>` doesn't exist).
 */
export function ensureBuiltinProfiles(): void {
  if (bootstrapped) return
  bootstrapped = true

  if (process.env.HERMES_SKIP_PROFILE_BOOTSTRAP === '1') {
    return
  }

  const agents = resolveBuiltinAgents()
  if (agents.length === 0) return

  const profilesRoot = getProfilesRoot()
  try {
    fs.mkdirSync(profilesRoot, { recursive: true })
  } catch {
    // ignore — likely already exists
  }

  for (const agent of agents) {
    const profileDir = path.join(profilesRoot, agent.id)

    try {
      // Create base directories
      fs.mkdirSync(profileDir, { recursive: true })
      fs.mkdirSync(path.join(profileDir, 'skills'), { recursive: true })
      fs.mkdirSync(path.join(profileDir, 'sessions'), { recursive: true })
      fs.mkdirSync(path.join(profileDir, 'memory'), { recursive: true })
      fs.mkdirSync(path.join(profileDir, 'memories'), { recursive: true })

      // Write each profile file independently, guarded by existence check
      ensureConfigYaml(profileDir, agent)
      ensureSoulMd(profileDir, agent)
      ensureMemoryMd(profileDir, agent)
      ensureUserMd(profileDir, agent)
      ensureIdentityMd(profileDir, agent)
      ensureEnvFile(profileDir)
    } catch (err) {
      console.warn(
        `[profiles-bootstrap] Failed to create builtin profile "${agent.id}":`,
        err,
      )
    }
  }

  // Repair first, adopt second. The repair only ever acts on a marker that
  // already existed when this call began, and adoption only ever acts when no
  // marker exists — so ordering them this way makes it impossible for one
  // call to adopt and then immediately second-guess itself. After a repair
  // the marker is present, which is exactly what stops re-adoption.
  repairHarmfulAdoptionOnce()
  adoptDefaultProfileOnce(agents)
}

/**
 * Write config.yaml if it doesn't exist. Contains model config and agent UI metadata.
 *
 * P-15 investigation — deliberately omits `model.provider` and `providers:`.
 *
 * An earlier version wrote `model.provider: 'manifest'` alongside
 * `providers.manifest.base_url: ''`. Reading the gateway source
 * (`~/.hermes/hermes-agent`) to check what that actually does:
 *
 *   - `_get_named_custom_provider('manifest')` (hermes_cli/runtime_provider.py)
 *     only matches a `providers.<name>` entry when its resolved base_url is
 *     truthy (`if base_url: ...`) — an empty string never matches, via
 *     either the `providers:` dict scan or the legacy `custom_providers:`
 *     fallback (`_normalize_custom_provider_entry` in hermes_cli/config.py
 *     explicitly returns `None` for an empty base_url). So this is NOT the
 *     "agent.base_url.rstrip('/') + /chat/completions" garbled-relative-URL
 *     failure one might expect — that construction
 *     (agent_runtime_helpers.py's `dump_api_request_debug`) is a debug-dump
 *     helper that only runs against an already-built agent; resolution
 *     never gets that far.
 *   - Instead `resolve_runtime_provider()` falls through to
 *     `resolve_provider('manifest')`, which raises a clean
 *     `AuthError("Unknown provider 'manifest'.")` — "manifest" isn't a
 *     built-in provider name. The gateway (`gateway/run.py`
 *     `_resolve_runtime_agent_kwargs`) surfaces this as a comprehensible
 *     `RuntimeError`, not a bad HTTP request. So the literal bug reported
 *     does not reproduce.
 *
 * The REAL problem: setting `model.provider: 'manifest'` at all (empty
 * base_url or not) makes `resolve_requested_provider()` return "manifest"
 * instead of "auto" — which skips `resolve_provider()`'s entire "auto" chain
 * (env vars, OpenRouter credential pool, provider-specific keys, and,
 * critically, the root `auth.json` fallback that `_global_auth_file_path()`
 * in hermes_cli/auth.py deliberately exposes to profile-scoped processes so
 * "credentials authed at the root are visible to profile processes that
 * haven't configured them locally"). A named profile's config.yaml does NOT
 * otherwise merge with the root `~/.hermes/config.yaml` — each profile is a
 * fully independent HERMES_HOME — so `provider: 'manifest'` permanently
 * shadowed whatever provider the user already had working at the root, even
 * though that root provider is reachable for free via the "auto" chain.
 * This is the part that actually matters after Task 1: a fresh install now
 * *starts* on a builtin profile, so this shadowing would hit on first boot.
 *
 * Fix: omit `model.provider` and `providers` entirely. `model: { default:
 * 'auto' }` alone lets resolution fall through to "auto" and inherit the
 * root's already-working setup. Once the user explicitly assigns a provider
 * to this profile (wizard / settings), that write path sets
 * `model.provider` + `providers.<name>` itself.
 *
 * `terminal:` inheritance-gap emulation — see `agent-cwd.ts`'s "gap #1" doc
 * comment: `hermes_cli/config.py` (config.py:751) reads only a profile's own
 * config.yaml and never merges the root's, and no seeded profile shipped a
 * `terminal:` block, so switching to a freshly-seeded builtin profile
 * silently moved the agent's terminal/execute_code tools from wherever the
 * root had them configured back to `$HOME`. If the root config.yaml has a
 * `terminal:` block at the moment this profile is first seeded, copy it in
 * verbatim so the new profile starts out behaving like the root did. This is
 * NOT real inheritance and must never be mistaken for gateway behavior: it
 * is a one-time snapshot taken here, in Switch UI, at seed time only (guarded
 * by the same `fs.existsSync(configPath)` early-return as every other file
 * in this module, so an already-seeded or user-edited profile is never
 * touched again). A later edit to the root's `terminal:` block does not
 * propagate to profiles already seeded, exactly like the gateway's own lack
 * of inheritance. When the root has no `terminal:` block, write nothing —
 * inventing a default here would be worse than the gap it is meant to close.
 */
function ensureConfigYaml(profileDir: string, agent: BuiltinAgent): void {
  const configPath = path.join(profileDir, 'config.yaml')
  if (fs.existsSync(configPath)) return

  const config: Record<string, unknown> = {
    description: agent.description,
    model: {
      default: 'auto',
    },
    agent_ui: {
      tier: agent.tier,
      glyph: agent.glyph,
      role: agent.role,
      status: agent.status,
      tags: agent.tags,
      persona_id: null,
      last_run: null,
    },
  }

  const rootTerminal = readRootTerminalBlock()
  if (rootTerminal) {
    config.terminal = rootTerminal
  }

  fs.writeFileSync(configPath, YAML.stringify(config), 'utf-8')
}

/**
 * Write SOUL.md if it doesn't exist. Persona document for the agent.
 */
function ensureSoulMd(profileDir: string, agent: BuiltinAgent): void {
  const soulPath = path.join(profileDir, 'SOUL.md')
  if (fs.existsSync(soulPath)) return

  const defaultPersona = getDefaultPersona(agent)
  const tags = agent.tags.join(', ')
  const content = `# ${agent.name} — SOUL

**Role:** ${agent.role}
**Tier:** T${agent.tier}
**Tags:** ${tags}

## Persona

${defaultPersona}

## Operating principles

- Stay aligned with role and tier responsibilities
- Defer to user on scope changes
- Preserve user-customized files and configurations
`

  fs.writeFileSync(soulPath, content, 'utf-8')
}

/**
 * Write MEMORY.md if it doesn't exist. Stub for long-term agent memory.
 */
function ensureMemoryMd(profileDir: string, agent: BuiltinAgent): void {
  const memoryPath = path.join(profileDir, 'memories', 'MEMORY.md')
  if (fs.existsSync(memoryPath)) return

  const content = `# ${agent.name} — MEMORY

This file tracks long-term notes and learnings the agent has written.
`

  fs.writeFileSync(memoryPath, content, 'utf-8')
}

/**
 * Write USER.md if it doesn't exist. Stub for user profile as known by the agent.
 */
function ensureUserMd(profileDir: string, agent: BuiltinAgent): void {
  const userPath = path.join(profileDir, 'memories', 'USER.md')
  if (fs.existsSync(userPath)) return

  const content = `# User profile (as known by ${agent.name})

This file is populated by the memory system over time.
`

  fs.writeFileSync(userPath, content, 'utf-8')
}

/**
 * Write memory/IDENTITY.md if it doesn't exist. Identity scaffold for the agent.
 */
function ensureIdentityMd(profileDir: string, agent: BuiltinAgent): void {
  const identityPath = path.join(profileDir, 'memory', 'IDENTITY.md')
  if (fs.existsSync(identityPath)) return

  const content = `# Identity — ${agent.name}

- Name: ${agent.name}
- Role: ${agent.role}
- Glyph: ${agent.glyph}
`

  fs.writeFileSync(identityPath, content, 'utf-8')
}

/**
 * Write .env (empty) if it doesn't exist. Reserved for environment variables.
 */
function ensureEnvFile(profileDir: string): void {
  const envPath = path.join(profileDir, '.env')
  if (fs.existsSync(envPath)) return

  fs.writeFileSync(envPath, '', 'utf-8')
}

/**
 * Return a default persona line based on agent role and tier.
 */
function getDefaultPersona(agent: BuiltinAgent): string {
  if (agent.tier === 1) {
    return `You are ${agent.name}, the tier-1 orchestration agent. You route tasks across tier-2 specialist agents and manage overall system flow.`
  }

  // Tier 2 — customize per role
  switch (agent.role) {
    case 'Builder':
      return `You are ${agent.name}, a tier-2 specialist focused on implementation. You build features decisively, write tests, and maintain code quality.`
    case 'Investigator':
      return `You are ${agent.name}, a tier-2 specialist focused on debugging and verification. You trace issues, isolate root causes, and validate solutions.`
    case 'Architect':
      return `You are ${agent.name}, a tier-2 specialist focused on design and long-term coherence. You review architectures, plan systems, and ensure sustainability.`
    default:
      return `You are ${agent.name}, a tier-2 specialist in the ${agent.role.toLowerCase()} role.`
  }
}
