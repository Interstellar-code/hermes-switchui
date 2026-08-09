/**
 * credential-status.ts — where does a credential *actually* come from?
 *
 * The old answer was a boolean: `configured: true`. That boolean was wrong in
 * both directions, and each direction had a different cause:
 *
 *  - **False positives.** A key can be present in a store the gateway will
 *    never read (a shell export under `gateway.multiplex_profiles`), or be
 *    present but out-ranked by a *different* copy of itself elsewhere. The
 *    provider looks configured and 401s.
 *  - **False negatives.** When the dashboard is unreachable we cannot see the
 *    `.env`, and "cannot see" was being rendered as "not set". That is the
 *    worst possible failure mode for a setup UI: it tells the user to paste a
 *    key they already have, and the paste goes to the unreconciled write path.
 *
 * So this module reports **provenance plus precedence**, and it has an
 * explicit `'unknown'` origin. Unreachable never reads as unconfigured.
 *
 * ## Where the numbers come from
 *
 * Every rule below is read off the gateway source (`~/.hermes/hermes-agent`),
 * not invented here. We *proxy* the dashboard wherever the dashboard can
 * answer — duplicating the gateway's resolution in TypeScript is how the two
 * drift — and only read local files for the two questions the dashboard has no
 * endpoint for (inline `config.yaml` mirrors, and the `auth.json` store).
 *
 * ### The precedence inversion
 *
 * There are two config shapes and they resolve credentials in *opposite*
 * order. This is the single most surprising thing about Hermes credentials:
 *
 *  - `providers.<id>` (v12+, `hermes_cli/runtime_provider.py:674-679`)
 *    resolves `key_env` FIRST and falls back to inline `api_key`:
 *
 *        resolved = getenv(entry.key_env) or entry.api_key
 *
 *  - legacy `custom_providers[*]` / inline `model:`
 *    (`hermes_cli/runtime_provider.py:1017-1020`) resolves inline `api_key`
 *    FIRST and falls back to `key_env`:
 *
 *        candidates = [explicit, entry.api_key, getenv(entry.key_env), ...]
 *
 * Neither path warns when both are set. A user who rotates the `.env` value on
 * a legacy-shaped provider keeps authenticating with the stale inline copy —
 * upstream #62269.
 *
 * Both shapes consult the **credential pool** before anything else
 * (`_try_resolve_from_custom_pool`, `runtime_provider.py:993`), so a pool entry
 * outranks every file on disk.
 *
 * ### The multiplex trap
 *
 * Under `gateway.multiplex_profiles`, `key_env` is resolved by
 * `agent/secret_scope.py:get_secret`, which reads the installed profile scope
 * and **never falls through to `os.environ`** (`secret_scope.py:197-213`). The
 * scope is built from `<profile>/.env` alone
 * (`build_profile_secret_scope`), and a per-profile `.env` is a one-time copy
 * at profile creation (`hermes_cli/profiles.py:1228-1277`), NOT inheritance
 * from the root `.env`. A profile can therefore look configured at the root
 * and hold no credential at all. We model that by dropping `env-shell` from
 * the candidate set entirely when multiplexing is on, and saying so.
 *
 * ### External secret sources ("vault")
 *
 * `agent/secret_sources/registry.py` applies mapped/bulk sources after the
 * `.env` load. By default a source is skipped when the var already exists
 * (`skipped_existing` — ".env/shell won"); with `override_existing` it beats
 * them. Hence `vaultOverrides`.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import YAML from 'yaml'
import {
  deleteEnvVar,
  getEnvVars,
  getOAuthProviders,
  getStatus,
  setEnvVar,
} from './claude-dashboard-api'
import type { CredentialWriteResult, EnvVarInfo } from './claude-dashboard-api'

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Where a credential lives. `'unknown'` is not padding: it is the answer we
 * must be able to give when a store could not be read, and it is deliberately
 * distinct from `'none'`.
 */
export type CredentialOrigin =
  /** A literal `api_key` in `config.yaml`. */
  | 'inline-config'
  /** `~/.hermes/.env` (or `<profile>/.env`). */
  | 'env-file'
  /** Exported in the environment of the process that started the gateway. */
  | 'env-shell'
  /** An OAuth grant in `auth.json` → `providers.<id>`. */
  | 'oauth'
  /** An `auth.json` → `credential_pool.<provider>[*]` entry. */
  | 'pool'
  /** An external secret source (Bitwarden, 1Password, plugin-provided). */
  | 'vault'
  /** Definitively absent from every store we could read. */
  | 'none'
  /** At least one store could not be read — NOT the same as `none`. */
  | 'unknown'

export type CredentialScope = 'root' | `profile:${string}`

/**
 * Which precedence table applies. Determined by how the provider is written in
 * `config.yaml`, because that is what the gateway dispatches on.
 */
export type CredentialShape =
  /** `providers: { <id>: { base_url, key_env } }` — env-first. */
  | 'providers-map'
  /** `model:` inline or `custom_providers[*]` — inline-first (the inversion). */
  | 'legacy-inline'
  /** OAuth/CLI-token provider: the auth store is the primary credential. */
  | 'oauth-provider'

export type CredentialStatus = {
  /** Env var name, or `inline:<provider>` for a credential with no env var. */
  key: string
  /**
   * The store this row is *about* — the one the surface showing it can edit.
   * For an env-var row that is `env-file`/`env-shell`; when the env var is
   * unset it falls through to whatever store does hold the credential.
   */
  origin: CredentialOrigin
  scope: CredentialScope
  /**
   * A **strictly higher-precedence** copy exists, so the gateway will use that
   * one and not `origin`. Absent when `origin` is what the gateway resolves.
   */
  shadowedBy?: CredentialOrigin
  /** `shadowedBy ?? origin` — what the gateway will actually use. */
  effectiveOrigin: CredentialOrigin
  /** Which precedence table produced this answer. */
  shape: CredentialShape
  /** Plain-language caveat: a store we could not read, or a dead-letter copy. */
  detail?: string
  /** Stores we could not read at all, by human name. */
  unreadable?: Array<string>
  verified?: { ok: boolean; at: number; detail?: string }
  /** Provider this credential belongs to, when known. */
  provider?: string
  providerLabel?: string
  /** Masked preview, straight from the dashboard. Never a real value. */
  preview?: string | null
}

/**
 * Everything the precedence engine needs, with `null` meaning "could not be
 * read". Keeping this a plain record is what makes the precedence table
 * testable without a gateway, a dashboard, or a filesystem.
 */
export type CredentialFacts = {
  key: string
  scope: CredentialScope
  shape: CredentialShape
  /** `gateway.multiplex_profiles` is live on the running gateway. */
  multiplex: boolean
  inEnvFile: boolean | null
  inShellEnv: boolean
  inlineConfig: boolean | null
  oauth: boolean | null
  pool: boolean | null
  vault?: boolean
  /** The source declares `override_existing`, so it beats `.env`. */
  vaultOverrides?: boolean
  provider?: string
  providerLabel?: string
  preview?: string | null
}

// ── The precedence tables ────────────────────────────────────────────────────

/**
 * Highest precedence first. Read directly off `runtime_provider.py`; see the
 * module docstring for line references.
 *
 * `vault` appears twice in spirit — see {@link rankOf}, which lifts it above
 * `env-file` when the source overrides.
 */
const PRECEDENCE: Record<CredentialShape, Array<CredentialOrigin>> = {
  // `_get_named_custom_provider`: key_env first, inline api_key as fallback.
  'providers-map': ['pool', 'env-file', 'env-shell', 'vault', 'inline-config'],
  // `_resolve_custom_runtime`: inline api_key first, key_env as fallback.
  'legacy-inline': ['pool', 'inline-config', 'env-file', 'env-shell', 'vault'],
  // The auth store is the credential for these; env is a manual override.
  'oauth-provider': [
    'oauth',
    'pool',
    'env-file',
    'env-shell',
    'vault',
    'inline-config',
  ],
}

function rankOf(
  origin: CredentialOrigin,
  shape: CredentialShape,
  vaultOverrides: boolean,
): number {
  if (origin === 'vault' && vaultOverrides) {
    // An overriding source beats `.env` and the shell but never the pool or
    // (on legacy shapes) the inline copy that is consulted before env at all.
    const table = PRECEDENCE[shape]
    return table.indexOf('env-file') - 0.5
  }
  const index = PRECEDENCE[shape].indexOf(origin)
  return index === -1 ? Number.POSITIVE_INFINITY : index
}

/** Human names, for the `unreadable` list and for UI copy. */
export const ORIGIN_LABEL: Record<CredentialOrigin, string> = {
  'inline-config': 'inline',
  'env-file': '.env',
  'env-shell': 'shell',
  oauth: 'OAuth',
  pool: 'pool',
  vault: 'vault',
  none: 'none',
  unknown: 'unknown',
}

// ── The engine ───────────────────────────────────────────────────────────────

/**
 * Resolve one credential the way the gateway would, and say what else is
 * lying around that could bite.
 *
 * Pure. Every interesting case in the audit is a row in the unit test.
 */
export function resolveCredentialStatus(
  facts: CredentialFacts,
): CredentialStatus {
  const {
    key,
    scope,
    shape,
    multiplex,
    inEnvFile,
    inShellEnv,
    inlineConfig,
    oauth,
    pool,
    vault = false,
    vaultOverrides = false,
  } = facts

  const unreadable: Array<string> = []
  if (inEnvFile === null) unreadable.push('.env (dashboard unreachable)')
  if (inlineConfig === null) unreadable.push('config.yaml')
  if (oauth === null || pool === null) unreadable.push('auth.json')

  const notes: Array<string> = []

  // Under multiplexing `get_secret` reads the profile scope and stops. A shell
  // export is not merely lower precedence — it is never consulted.
  const shellCounts = inShellEnv && !multiplex
  if (inShellEnv && multiplex) {
    notes.push(
      `${key} is exported in the server's shell, but this gateway is multiplexing profiles — ` +
        `it resolves env vars only from ${scope === 'root' ? 'the profile .env' : `${scope.slice('profile:'.length)}/.env`}, ` +
        `so the shell value will never be used.`,
    )
  }
  if (multiplex && inEnvFile === false && scope !== 'root') {
    notes.push(
      'A per-profile .env is copied once at profile creation, not inherited — ' +
        'a credential added to the root .env afterwards does not reach this profile.',
    )
  }

  const present: Array<CredentialOrigin> = []
  if (pool === true) present.push('pool')
  if (oauth === true) present.push('oauth')
  if (inEnvFile === true) present.push('env-file')
  if (shellCounts) present.push('env-shell')
  if (vault) present.push('vault')
  if (inlineConfig === true) present.push('inline-config')

  // The store this row is *about*: an env-var row is about the env var, and
  // only falls through to another store when the env var is genuinely unset.
  const nominalPreference: Array<CredentialOrigin> = [
    'env-file',
    'env-shell',
    'vault',
    'inline-config',
    'oauth',
    'pool',
  ]
  const nominal =
    nominalPreference.find((candidate) => present.includes(candidate)) ?? null

  if (nominal === null) {
    // Nothing found. Whether that means "not set" or "we could not look" is
    // the whole point of this module.
    if (unreadable.length > 0) {
      return {
        key,
        scope,
        shape,
        origin: 'unknown',
        effectiveOrigin: 'unknown',
        unreadable,
        detail: `Could not read ${unreadable.join(', ')} — this credential may well be set. Not the same as "missing".`,
        provider: facts.provider,
        providerLabel: facts.providerLabel,
        preview: facts.preview,
      }
    }
    return {
      key,
      scope,
      shape,
      origin: 'none',
      effectiveOrigin: 'none',
      detail: notes.length > 0 ? notes.join(' ') : undefined,
      provider: facts.provider,
      providerLabel: facts.providerLabel,
      preview: facts.preview,
    }
  }

  const nominalRank = rankOf(nominal, shape, vaultOverrides)
  const higher = present
    .filter(
      (candidate) =>
        candidate !== nominal &&
        rankOf(candidate, shape, vaultOverrides) < nominalRank,
    )
    .sort(
      (a, b) =>
        rankOf(a, shape, vaultOverrides) - rankOf(b, shape, vaultOverrides),
    )

  const shadowedBy: CredentialOrigin | undefined =
    higher.length > 0 ? higher[0] : undefined

  if (shadowedBy) {
    notes.push(
      `Also set in ${ORIGIN_LABEL[shadowedBy]}, which wins on this provider shape — ` +
        `changing ${ORIGIN_LABEL[nominal]} alone will not take effect.`,
    )
  }
  if (unreadable.length > 0) {
    notes.push(`Could not read ${unreadable.join(', ')}.`)
  }

  return {
    key,
    scope,
    shape,
    origin: nominal,
    effectiveOrigin: shadowedBy ?? nominal,
    shadowedBy,
    unreadable: unreadable.length > 0 ? unreadable : undefined,
    detail: notes.length > 0 ? notes.join(' ') : undefined,
    provider: facts.provider,
    providerLabel: facts.providerLabel,
    preview: facts.preview,
  }
}

// ── Local stores the dashboard has no endpoint for ───────────────────────────

/**
 * Resolved per call, not captured at module load. `HERMES_HOME` can be
 * repointed at runtime (a profile switch, a test fixture), and a constant
 * frozen at import time silently reads and — far worse — WRITES to whichever
 * home happened to be set when the module was first required.
 */
function activeHome(): string {
  return (
    process.env.HERMES_HOME ??
    process.env.CLAUDE_HOME ??
    path.join(os.homedir(), '.hermes')
  )
}

/** Root Hermes home, ignoring any profile override. */
function rootHome(): string {
  const home = activeHome()
  // `HERMES_HOME` pointing INTO a profile is the normal shape for a
  // profile-scoped process; the root is the directory above `profiles/`.
  const marker = `${path.sep}profiles${path.sep}`
  const at = home.indexOf(marker)
  return at === -1 ? home : home.slice(0, at)
}

/** Directory holding `config.yaml`/`.env`/`auth.json` for a scope. */
export function homeForScope(scope: CredentialScope): string {
  if (scope === 'root') return activeHome()
  const profile = scope.slice('profile:'.length)
  return path.join(rootHome(), 'profiles', profile)
}

export type AuthStoreEntry = {
  /** Present in `auth.json` → `providers.<id>` (an OAuth/device-code grant). */
  oauth: boolean
  /** Present in `auth.json` → `credential_pool.<id>[]`. */
  pool: boolean
  /** Which file answered — a profile can fall back to the root store. */
  scope: CredentialScope
  /** Pool sources (`env:VAR`, `gh_cli`, `device_code`, …), never values. */
  poolSources: Array<string>
}

/**
 * Read `~/.hermes/auth.json`.
 *
 * The previous reader (`checkAuthStore` in `routes/api/claude-config.ts`)
 * opened **`auth-profiles.json`**, a file the gateway has never written, and
 * looked for a `profiles` map keyed `"<provider>:…"`, a shape it has never
 * used. It therefore returned `hasToken: false` for every provider, forever,
 * which is why every OAuth provider rendered as unconfigured.
 *
 * The real store (`hermes_cli/auth.py:891-1160`) is:
 *
 *     { "version": 1,
 *       "providers":       { "<id>": { …grant… } },
 *       "credential_pool": { "<id>": [ { source, auth_type, … } ] } }
 *
 * In profile mode a miss falls back to the ROOT store, read-only
 * (`_load_provider_state` / `_global_auth_file_path`, `auth.py:917-944`), so
 * the returned `scope` names the file that actually answered rather than the
 * one we asked about.
 */
export function readAuthStore(
  providerId: string,
  scope: CredentialScope = 'root',
): AuthStoreEntry | null {
  const attempts: Array<CredentialScope> =
    scope === 'root' ? ['root'] : [scope, 'root']

  let sawFile = false
  for (const attempt of attempts) {
    const storePath = path.join(homeForScope(attempt), 'auth.json')
    let store: Record<string, unknown>
    try {
      if (!fs.existsSync(storePath)) continue
      const parsed: unknown = JSON.parse(fs.readFileSync(storePath, 'utf-8'))
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        continue
      }
      store = parsed as Record<string, unknown>
      sawFile = true
    } catch {
      // A corrupt or unreadable store is "unknown", not "empty" — keep
      // looking, and report null if nothing answers.
      continue
    }

    const providers = store.providers
    const grant =
      providers && typeof providers === 'object' && !Array.isArray(providers)
        ? (providers as Record<string, unknown>)[providerId]
        : undefined
    const hasGrant =
      !!grant && typeof grant === 'object' && Object.keys(grant).length > 0

    const poolRoot = store.credential_pool
    const entries =
      poolRoot && typeof poolRoot === 'object' && !Array.isArray(poolRoot)
        ? (poolRoot as Record<string, unknown>)[providerId]
        : undefined
    const poolEntries = Array.isArray(entries) ? entries : []

    if (hasGrant || poolEntries.length > 0) {
      return {
        oauth: hasGrant,
        pool: poolEntries.length > 0,
        scope: attempt,
        poolSources: poolEntries
          .map((entry) =>
            entry && typeof entry === 'object'
              ? String((entry as Record<string, unknown>).source ?? '')
              : '',
          )
          .filter(Boolean),
      }
    }
  }

  // A store we could read and that simply has no entry is a definite "no".
  return sawFile ? { oauth: false, pool: false, scope, poolSources: [] } : null
}

export type InlineConfigFacts = {
  /** Provider ids (and `model`) whose config entry carries a literal key. */
  inlineKeyed: Array<string>
  /** Provider id → the shape its entry is written in. */
  shapes: Record<string, CredentialShape>
  /** Provider id → the `key_env` it declares, when it declares one. */
  keyEnv: Record<string, string>
  /** The literal inline values, so a rotation can scrub value-matched copies. */
  inlineValues: Record<string, string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Which providers in `config.yaml` hold a literal `api_key`, and in which
 * shape. Read from the RAW user config on disk rather than the dashboard's
 * `/api/config`, which serves the defaults-merged view — we need to know what
 * the *user* wrote, and only literal user entries can shadow.
 */
export function readInlineConfigFacts(
  scope: CredentialScope = 'root',
): InlineConfigFacts | null {
  const configPath = path.join(homeForScope(scope), 'config.yaml')
  let config: Record<string, unknown>
  try {
    const parsed: unknown = YAML.parse(fs.readFileSync(configPath, 'utf-8'))
    if (!isRecord(parsed))
      return { inlineKeyed: [], shapes: {}, keyEnv: {}, inlineValues: {} }
    config = parsed
  } catch (error) {
    // Missing file: the user has no config, which is a definite "no inline".
    // Anything else (permissions, malformed YAML) is genuinely unknown.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { inlineKeyed: [], shapes: {}, keyEnv: {}, inlineValues: {} }
    }
    return null
  }

  const facts: InlineConfigFacts = {
    inlineKeyed: [],
    shapes: {},
    keyEnv: {},
    inlineValues: {},
  }

  const note = (
    id: string,
    shape: CredentialShape,
    entry: Record<string, unknown>,
  ) => {
    facts.shapes[id] = shape
    const keyEnv = typeof entry.key_env === 'string' ? entry.key_env.trim() : ''
    if (keyEnv) facts.keyEnv[id] = keyEnv
    const inline =
      typeof entry.api_key === 'string'
        ? entry.api_key.trim()
        : typeof entry.api === 'string'
          ? entry.api.trim()
          : ''
    if (inline) {
      facts.inlineKeyed.push(id)
      facts.inlineValues[id] = inline
    }
  }

  // `model:` — the inline shape. `model.provider` names which provider the
  // inline key belongs to.
  if (isRecord(config.model)) {
    const id = String(config.model.provider ?? 'model').trim() || 'model'
    note(id, 'legacy-inline', config.model)
  }

  if (isRecord(config.providers)) {
    for (const [id, entry] of Object.entries(config.providers)) {
      if (!isRecord(entry)) continue
      // An inline `model:` block for the same provider keeps the legacy
      // (inline-first) precedence — the gateway reads that block, not this one.
      const shape: CredentialShape =
        facts.shapes[id] === 'legacy-inline' ? 'legacy-inline' : 'providers-map'
      note(id, shape, entry)
    }
  }

  const custom = config.custom_providers
  if (Array.isArray(custom)) {
    for (const entry of custom) {
      if (!isRecord(entry)) continue
      const id = String(entry.id ?? entry.name ?? '').trim()
      if (id) note(id, 'legacy-inline', entry)
    }
  } else if (isRecord(custom)) {
    for (const [id, entry] of Object.entries(custom)) {
      if (isRecord(entry)) note(id, 'legacy-inline', entry)
    }
  }

  if (isRecord(config.auxiliary)) {
    for (const [task, entry] of Object.entries(config.auxiliary)) {
      if (isRecord(entry)) note(`auxiliary.${task}`, 'legacy-inline', entry)
    }
  }

  return facts
}

// ── Collection ───────────────────────────────────────────────────────────────

export type EnvSnapshot = {
  /** Dashboard `/api/env`, or `null` when it could not be reached. */
  vars: Record<string, EnvVarInfo> | null
  /** Why it could not be reached, for the UI to show verbatim. */
  error?: string
}

/**
 * `/api/env` via the dashboard. Deliberately NOT a local `.env` parse: the
 * dashboard applies the gateway's own sanitiser (`load_env`, which splits
 * concatenated lines and drops stale placeholders), so a local parse and the
 * gateway can disagree about what is set.
 */
export async function readEnvSnapshot(
  profile?: string | null,
): Promise<EnvSnapshot> {
  try {
    const vars = await getEnvVars(profile ?? undefined)
    return { vars }
  } catch (error) {
    return {
      vars: null,
      error: error instanceof Error ? error.message : 'dashboard unreachable',
    }
  }
}

export type OAuthSnapshot = {
  /** Provider id → logged in. `null` when the dashboard could not answer. */
  loggedIn: Record<string, boolean> | null
  sources: Record<string, string>
  previews: Record<string, string | null>
  error?: string
}

/** `/api/providers/oauth` via the dashboard — the gateway's own login state. */
export async function readOAuthSnapshot(
  profile?: string | null,
): Promise<OAuthSnapshot> {
  try {
    const payload = await getOAuthProviders(profile ?? undefined)
    // The dashboard wraps the list in `{ providers: [...] }`; older builds
    // returned the bare array. Both shapes are accepted so a version skew
    // degrades to "no OAuth rows" rather than an exception.
    const rows: Array<unknown> = Array.isArray(payload)
      ? payload
      : Array.isArray(payload.providers)
        ? payload.providers
        : []
    const loggedIn: Record<string, boolean> = {}
    const sources: Record<string, string> = {}
    const previews: Record<string, string | null> = {}
    for (const row of rows) {
      if (!isRecord(row)) continue
      const id = String(row.id ?? '')
      if (!id) continue
      const status = isRecord(row.status) ? row.status : {}
      loggedIn[id] = status.logged_in === true
      sources[id] = String(status.source ?? '')
      previews[id] =
        typeof status.token_preview === 'string' ? status.token_preview : null
    }
    return { loggedIn, sources, previews }
  } catch (error) {
    return {
      loggedIn: null,
      sources: {},
      previews: {},
      error: error instanceof Error ? error.message : 'dashboard unreachable',
    }
  }
}

export type CredentialStatusReport = {
  scope: CredentialScope
  multiplex: boolean
  statuses: Array<CredentialStatus>
  /** Non-empty when a store could not be read; the UI must say so. */
  unreachable: Array<string>
}

export type CollectOptions = {
  scope?: CredentialScope
  multiplex?: boolean
  /** Only these env vars. Omit for every var the dashboard knows about. */
  keys?: Array<string>
  /** Injected in tests. */
  env?: EnvSnapshot
  oauth?: OAuthSnapshot
  inline?: InlineConfigFacts | null
  shellEnv?: Record<string, string | undefined>
  authStore?: (
    providerId: string,
    scope: CredentialScope,
  ) => AuthStoreEntry | null
}

/**
 * Build a `CredentialStatus` for every credential the dashboard knows about,
 * plus any inline-only credential that has no env var at all.
 */
export async function collectCredentialStatuses(
  options: CollectOptions = {},
): Promise<CredentialStatusReport> {
  const scope = options.scope ?? 'root'
  const profile = scope === 'root' ? null : scope.slice('profile:'.length)
  const multiplex = options.multiplex ?? false
  const shellEnv = options.shellEnv ?? process.env

  const env = options.env ?? (await readEnvSnapshot(profile))
  const oauth = options.oauth ?? (await readOAuthSnapshot(profile))
  const inline =
    options.inline !== undefined ? options.inline : readInlineConfigFacts(scope)
  const lookupAuth = options.authStore ?? readAuthStore

  const unreachable: Array<string> = []
  if (env.vars === null)
    unreachable.push(`/api/env (${env.error ?? 'unreachable'})`)
  if (oauth.loggedIn === null) {
    unreachable.push(`/api/providers/oauth (${oauth.error ?? 'unreachable'})`)
  }
  if (inline === null) unreachable.push('config.yaml (unreadable)')

  // Every env var the dashboard reports as a secret, plus explicit requests.
  const candidates = new Set<string>(options.keys ?? [])
  if (env.vars) {
    for (const [key, info] of Object.entries(env.vars)) {
      if (info.is_password === true || info.is_set === true) candidates.add(key)
    }
  }

  // `key_env` → provider, so an env row can be judged under the right table.
  const providerForKey = new Map<string, string>()
  if (inline) {
    for (const [providerId, keyEnv] of Object.entries(inline.keyEnv)) {
      if (!providerForKey.has(keyEnv)) providerForKey.set(keyEnv, providerId)
      candidates.add(keyEnv)
    }
  }

  const statuses: Array<CredentialStatus> = []

  for (const key of [...candidates].sort()) {
    const info = env.vars?.[key]
    const providerId =
      providerForKey.get(key) ?? (info?.provider ? String(info.provider) : '')
    const authEntry = providerId ? lookupAuth(providerId, scope) : null

    const shape: CredentialShape = providerId
      ? (inline?.shapes[providerId] ??
        (authEntry?.oauth ? 'oauth-provider' : 'providers-map'))
      : 'providers-map'

    statuses.push(
      resolveCredentialStatus({
        key,
        scope,
        shape,
        multiplex,
        inEnvFile: env.vars === null ? null : info?.is_set === true,
        inShellEnv: typeof shellEnv[key] === 'string' && shellEnv[key] !== '',
        inlineConfig:
          inline === null
            ? null
            : providerId
              ? inline.inlineKeyed.includes(providerId)
              : false,
        oauth:
          oauth.loggedIn === null && authEntry === null
            ? null
            : providerId
              ? (oauth.loggedIn?.[providerId] ?? authEntry?.oauth ?? false)
              : false,
        // With no provider association there is no pool bucket to look in —
        // that is "not applicable", not "could not read". Reporting unknown
        // here would paint every hand-added env var as indeterminate.
        pool: providerId ? (authEntry === null ? null : authEntry.pool) : false,
        provider: providerId || undefined,
        providerLabel: info?.provider_label
          ? String(info.provider_label)
          : undefined,
        preview: info?.redacted_value ?? null,
      }),
    )
  }

  // Inline-only credentials: a provider whose key lives in `config.yaml` and
  // has no env var at all would otherwise be invisible on an env-keyed page.
  if (inline) {
    for (const providerId of inline.inlineKeyed) {
      const keyEnv = inline.keyEnv[providerId]
      if (keyEnv && candidates.has(keyEnv)) continue
      const authEntry = lookupAuth(providerId, scope)
      statuses.push(
        resolveCredentialStatus({
          key: `inline:${providerId}`,
          scope,
          shape: inline.shapes[providerId] ?? 'legacy-inline',
          multiplex,
          inEnvFile: false,
          inShellEnv: false,
          inlineConfig: true,
          oauth: authEntry?.oauth ?? false,
          pool: authEntry === null ? null : authEntry.pool,
          provider: providerId,
        }),
      )
    }
  }

  return { scope, multiplex, statuses, unreachable }
}

// ── Writes ───────────────────────────────────────────────────────────────────

/** Owner-only. A credential file readable by every account on the box is not
 *  a credential file. Both the gateway (`config.py:_secure_file`) and this
 *  module converge on the same mode. */
export const SECRET_FILE_MODE = 0o600

/**
 * Create-or-tighten `filePath` to `0600`.
 *
 * Called after every write we perform ourselves. `fs.writeFileSync`'s `mode`
 * option only applies when it CREATES the file, so an existing world-readable
 * `.env` would keep its mode forever without the explicit `chmod`.
 */
export function secureFile(filePath: string): void {
  try {
    fs.chmodSync(filePath, SECRET_FILE_MODE)
  } catch {
    // Windows and some mounted volumes reject chmod. The write still
    // succeeded; refusing it over a mode we cannot set would be worse.
  }
}

/** The dashboard is live but serves a different Hermes home than we target. */
class WrongHomeError extends Error {
  constructor() {
    super(
      'the Hermes dashboard is serving a different HERMES_HOME, so delegating ' +
        'this write would edit the wrong .env',
    )
    this.name = 'WrongHomeError'
  }
}

export type CredentialWriteOutcome = CredentialWriteResult & {
  /** True when the reconciling dashboard path performed the write. */
  reconciled: boolean
  /**
   * Set when we had to fall back to a local write. The caller MUST surface
   * this — a local write cannot prune `auth.json` pool entries, so a stale
   * pooled copy may still shadow the new value.
   */
  warning?: string
}

type LocalWriteDeps = {
  scope?: CredentialScope
  /** Injected in tests. */
  setEnv?: typeof setEnvVar
  deleteEnv?: typeof deleteEnvVar
  /** Injected in tests; see {@link dashboardTargetsOurHome}. */
  homeCheck?: () => Promise<boolean>
}

/** Strip a trailing `/profiles/<name>` so two homes can be compared at root. */
function toRootHome(home: string): string {
  const normalized = home.replace(/[\\/]+$/, '')
  const marker = /[\\/]profiles[\\/][^\\/]+$/
  return normalized.replace(marker, '')
}

let homeMatchCache: { at: number; value: boolean } | null = null
const HOME_MATCH_TTL_MS = 30_000

/**
 * Does the dashboard write to the same Hermes home we are reasoning about?
 *
 * The dashboard mutates ITS OWN `HERMES_HOME`. Ours can differ — a test with a
 * temp home, a dev server started with `HERMES_HOME=…` pointing somewhere
 * else, a second workspace against a shared gateway. Delegating a credential
 * write in that state would edit a `.env` the caller never named, and a
 * DELETE would destroy a real key while the caller believed it was operating
 * on a scratch directory. That is not a hypothetical: it is what the
 * `claude-config` delete tests do, against a `mkdtemp` home, on a dev box
 * where the real dashboard is running.
 *
 * Only a *confirmed* mismatch blocks delegation. A failed probe does not:
 * the dashboard being unreachable is the common cause, and delegation will
 * then fail on its own and take the fallback path anyway.
 */
export async function dashboardTargetsOurHome(): Promise<boolean> {
  if (homeMatchCache && Date.now() - homeMatchCache.at < HOME_MATCH_TTL_MS) {
    return homeMatchCache.value
  }
  let value = true
  try {
    const status = await getStatus()
    const theirs =
      typeof status.claude_home === 'string' ? status.claude_home : ''
    if (theirs) {
      value = toRootHome(theirs) === toRootHome(rootHome())
    }
  } catch {
    // Unknown — allow, and let the write itself fail if the dashboard is down.
    value = true
  }
  homeMatchCache = { at: Date.now(), value }
  return value
}

/** Drop the cached home comparison — call after repointing the gateway. */
export function invalidateDashboardHomeCache(): void {
  homeMatchCache = null
}

const ENV_LINE_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/

function envPathFor(scope: CredentialScope): string {
  return path.join(homeForScope(scope), '.env')
}

function readEnvFile(scope: CredentialScope): Record<string, string> {
  const out: Record<string, string> = {}
  let raw: string
  try {
    raw = fs.readFileSync(envPathFor(scope), 'utf-8')
  } catch {
    return out
  }
  for (const line of raw.split('\n')) {
    const match = ENV_LINE_RE.exec(line)
    if (!match) continue
    let value = line.slice(line.indexOf('=') + 1).trim()
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    }
    out[match[1]] = value
  }
  return out
}

/**
 * Rewrite `.env` in place, preserving comments, blank lines and commented-out
 * examples. A `null` value deletes the line.
 *
 * Matches `export KEY=` as well as `KEY=`, because the gateway's `load_env`
 * parses export lines: missing them would append a second definition and a
 * later delete would silently resurrect the exported one (upstream #40041).
 */
function applyEnvFileUpdates(
  scope: CredentialScope,
  updates: Record<string, string | null>,
): void {
  const home = homeForScope(scope)
  fs.mkdirSync(home, { recursive: true })
  const envPath = envPathFor(scope)

  let existing = ''
  try {
    existing = fs.readFileSync(envPath, 'utf-8')
  } catch {
    existing = ''
  }

  const lines = existing ? existing.split('\n') : []
  const pending = new Map(Object.entries(updates))
  const kept: Array<string> = []

  for (const line of lines) {
    const key = ENV_LINE_RE.exec(line)?.[1]
    if (!key || !pending.has(key)) {
      kept.push(line)
      continue
    }
    const value = pending.get(key) ?? null
    pending.delete(key)
    if (value !== null && value !== '') kept.push(`${key}=${value}`)
  }

  const additions: Array<string> = []
  for (const [key, value] of pending) {
    if (value !== null && value !== '') additions.push(`${key}=${value}`)
  }
  if (additions.length > 0) {
    while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop()
    kept.push(...additions)
  }

  const body = kept.join('\n')
  fs.writeFileSync(envPath, body.endsWith('\n') ? body : `${body}\n`, {
    encoding: 'utf-8',
    mode: SECRET_FILE_MODE,
  })
  secureFile(envPath)
}

/**
 * Reconcile `config.yaml` mirrors that hold `oldValue`.
 *
 * A local mirror of `_scrub_config_yaml_mirrors`
 * (`hermes_cli/credential_lifecycle.py:110`), used ONLY on the offline
 * fallback path. Value-matched on purpose: we touch a config entry only when
 * it provably holds the same credential that just changed, so an unrelated key
 * the user configured for a different endpoint is left alone.
 *
 * Returns the dotted paths it rewrote — names only, never values.
 */
export function scrubConfigMirrors(
  oldValue: string,
  newValue: string | null,
  scope: CredentialScope = 'root',
): Array<string> {
  if (!oldValue) return []
  const configPath = path.join(homeForScope(scope), 'config.yaml')
  let config: Record<string, unknown>
  try {
    const parsed: unknown = YAML.parse(fs.readFileSync(configPath, 'utf-8'))
    if (!isRecord(parsed)) return []
    config = parsed
  } catch {
    return []
  }

  const touched: Array<string> = []
  const fix = (section: unknown, label: string) => {
    if (!isRecord(section)) return
    // `api` is the legacy alias for `model.api_key` kept by older configs.
    for (const field of ['api_key', 'api'] as const) {
      const current = section[field]
      if (typeof current === 'string' && current === oldValue) {
        if (newValue) section[field] = newValue
        else delete section[field]
        touched.push(`${label}.${field}`)
      }
    }
  }

  fix(config.model, 'model')
  if (isRecord(config.auxiliary)) {
    for (const [task, entry] of Object.entries(config.auxiliary)) {
      fix(entry, `auxiliary.${task}`)
    }
  }
  if (isRecord(config.providers)) {
    for (const [id, entry] of Object.entries(config.providers)) {
      fix(entry, `providers.${id}`)
    }
  }
  const custom = config.custom_providers
  if (Array.isArray(custom)) {
    custom.forEach((entry, index) => fix(entry, `custom_providers.${index}`))
  } else if (isRecord(custom)) {
    for (const [name, entry] of Object.entries(custom)) {
      fix(entry, `custom_providers.${name}`)
    }
  }

  if (touched.length > 0) {
    fs.writeFileSync(configPath, YAML.stringify(config), {
      encoding: 'utf-8',
      mode: SECRET_FILE_MODE,
    })
    secureFile(configPath)
  }
  return touched
}

/**
 * Save a credential through the reconciling path.
 *
 * Tries the dashboard first, always. Only when the dashboard cannot be reached
 * do we write locally — and then we do the one piece of reconciliation a local
 * process CAN do (scrubbing value-matched `config.yaml` mirrors), tighten the
 * file to `0600`, and hand back a warning naming what we could not do.
 *
 * The alternative designs are both worse: failing hard breaks first-run setup
 * on a box where the dashboard has not started yet, and writing `.env` silently
 * is the exact bug this module exists to kill.
 */
export async function saveCredential(
  key: string,
  value: string,
  deps: LocalWriteDeps = {},
): Promise<CredentialWriteOutcome> {
  const scope = deps.scope ?? 'root'
  const profile = scope === 'root' ? null : scope.slice('profile:'.length)
  const put = deps.setEnv ?? setEnvVar
  const homeCheck = deps.homeCheck ?? dashboardTargetsOurHome

  try {
    if (!(await homeCheck())) throw new WrongHomeError()
    const result = await put(key, value, profile)
    return { ...result, reconciled: true }
  } catch (dashboardError) {
    const previous = readEnvFile(scope)[key] ?? ''
    applyEnvFileUpdates(scope, { [key]: value })
    const configUpdates =
      previous && previous !== value
        ? scrubConfigMirrors(previous, value, scope)
        : []
    return {
      ok: true,
      key,
      config_updates: configUpdates,
      reconciled: false,
      warning:
        `The Hermes dashboard was unreachable (${
          dashboardError instanceof Error
            ? dashboardError.message
            : 'unknown error'
        }), so ${key} was written to .env directly. Inline config.yaml copies were ` +
        `reconciled, but credential-pool entries in auth.json could not be — if this ` +
        `provider still authenticates with the old key, restart the gateway and save again.`,
    }
  }
}

/** Remove a credential through the reconciling path. Same fallback contract. */
export async function removeCredential(
  key: string,
  deps: LocalWriteDeps = {},
): Promise<CredentialWriteOutcome> {
  const scope = deps.scope ?? 'root'
  const profile = scope === 'root' ? null : scope.slice('profile:'.length)
  const del = deps.deleteEnv ?? deleteEnvVar
  const homeCheck = deps.homeCheck ?? dashboardTargetsOurHome

  try {
    if (!(await homeCheck())) throw new WrongHomeError()
    const result = await del(key, profile)
    return { ...result, reconciled: true }
  } catch (dashboardError) {
    const previous = readEnvFile(scope)[key] ?? ''
    applyEnvFileUpdates(scope, { [key]: null })
    const scrubbed = previous ? scrubConfigMirrors(previous, null, scope) : []
    return {
      ok: true,
      key,
      removed: Boolean(previous),
      config_scrubbed: scrubbed,
      found: Boolean(previous) || scrubbed.length > 0,
      reconciled: false,
      warning:
        `The Hermes dashboard was unreachable (${
          dashboardError instanceof Error
            ? dashboardError.message
            : 'unknown error'
        }), so ${key} was removed from .env directly. Credential-pool entries in ` +
        `auth.json could not be pruned, so this provider may still appear configured ` +
        `until the gateway restarts.`,
    }
  }
}
