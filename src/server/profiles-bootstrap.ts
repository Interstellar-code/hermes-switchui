import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { BUILTIN_AGENTS } from '../lib/builtin-agents'
import {
  getActiveProfileName,
  getProfilesRoot,
  setActiveProfile,
} from './profiles-browser'
import type { BuiltinAgent } from '../lib/builtin-agents'

let bootstrapped = false

/** Schema version for the `.profiles-bootstrap` marker file — see `adoptDefaultProfileOnce`. */
const PROFILES_BOOTSTRAP_MARKER_VERSION = 1

type ProfilesBootstrapMarker = {
  version: number
  /** The profile id adopted as active, or `null` if adoption was skipped/declined. */
  adoptedProfile: string | null
}

/**
 * Path to the one-time bootstrap marker. Lives directly under the Hermes
 * home directory, alongside `active_profile` — derived from
 * `getProfilesRoot()`'s parent rather than re-deriving `~/.hermes` with a
 * fresh `os.homedir()` call, so it stays in sync with whatever home
 * resolution (`HERMES_HOME` / `CLAUDE_HOME` / real homedir) the rest of this
 * module already uses via `profiles-browser.ts`.
 */
function getBootstrapMarkerPath(): string {
  return path.join(path.dirname(getProfilesRoot()), '.profiles-bootstrap')
}

function hasBootstrapMarker(): boolean {
  return fs.existsSync(getBootstrapMarkerPath())
}

function writeBootstrapMarker(adoptedProfile: string | null): void {
  const markerPath = getBootstrapMarkerPath()
  const marker: ProfilesBootstrapMarker = {
    version: PROFILES_BOOTSTRAP_MARKER_VERSION,
    adoptedProfile,
  }
  fs.mkdirSync(path.dirname(markerPath), { recursive: true })
  fs.writeFileSync(markerPath, JSON.stringify(marker, null, 2), 'utf-8')
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
 * Adopt a default builtin profile as active ONLY when:
 *   - the marker file is absent, AND
 *   - `active_profile` is absent or empty
 *     (i.e. `getActiveProfileName() === 'default'`)
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

    const requestedId =
      process.env.HERMES_DEFAULT_PROFILE?.trim() || 'hermes-switch'
    const target = resolveAdoptionTarget(agents, requestedId)

    if (target) {
      try {
        setActiveProfile(target)
      } catch (err) {
        console.warn(
          `[profiles-bootstrap] Failed to adopt default profile "${target}":`,
          err,
        )
      }
    }

    writeBootstrapMarker(target ?? null)
  } catch (err) {
    console.warn(
      '[profiles-bootstrap] Default-profile adoption failed:',
      err,
    )
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
 * On a fresh installation (no `.profiles-bootstrap` marker yet, no
 * `active_profile` pointer written), this also adopts a default active
 * profile — see `adoptDefaultProfileOnce` for the full rule and why the
 * marker is required. Skipped along with everything else under
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
 */
function ensureConfigYaml(profileDir: string, agent: BuiltinAgent): void {
  const configPath = path.join(profileDir, 'config.yaml')
  if (fs.existsSync(configPath)) return

  const config = {
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
