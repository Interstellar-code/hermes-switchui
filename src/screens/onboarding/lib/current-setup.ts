/**
 * current-setup.ts — "what is already true of this workspace".
 *
 * Reopening the wizard on a configured install used to render every step as
 * though nothing existed: 24 provider cards with no hint which one was live,
 * a theme grid that never said which theme was applied, a key field that never
 * admitted a key was already stored. This module is the single derivation of
 * that missing half — one `CurrentSetup` assembled in `onboarding-screen.tsx`,
 * and `factsForStep` deciding what each step should lead with.
 *
 * Every input is `unknown` or possibly-empty on purpose. `config` is whatever
 * `/api/claude-config` handed back, which on a bad day is `null`, a 401 body,
 * or a shape that differs by backend (a `providers:` map, a `custom_providers:`
 * array, or an inline `model:` block — real installs use all three). Nothing
 * here may throw, and nothing here may read a credential: the payload carries a
 * plaintext `model.api_key` on inline-model installs, so this file reads env
 * *names* only, never a key value, masked or otherwise.
 */
import { activeProfileLabel, buildProfileChoices } from './profile-choices'
import type { ThemeId } from '@/lib/theme'
import type { VerifyOutcome } from '@/screens/providers/lib/verify-provider'
import type { CorePluginRow } from './core-plugins'
import type { OnboardingStepId } from './onboarding-steps'
import type { ProfileChoice } from './profile-choices'
import type { SystemCheck } from './system-checks'
import { THEMES } from '@/lib/theme'
import { getMemoryProviderInfo } from '@/lib/memory-provider-catalog'
import {
  RESERVED_PROVIDER_ID,
  getProviderDisplayName,
  normalizeProviderId,
  stripProviderPrefix,
} from '@/lib/provider-catalog'

export type SetupFactState = 'active' | 'set' | 'unset'

export type SetupFact = {
  id: string
  label: string
  value: string
  state: SetupFactState
}

export type CurrentSetup = {
  activeProviderId: string | null
  activeProviderName: string | null
  activeModel: string | null
  configuredProviderIds: Array<string>
  /** providerId → the env var holding its key, when one is already stored. */
  storedKeyEnvs: Record<string, string>
  /** providerId → the base URL the config currently names for it. */
  providerBaseUrls: Record<string, string>
  /** providerId → the default model the config currently names for it. */
  providerModels: Record<string, string>
  themeId: ThemeId
  themeLabel: string
  enabledPlugins: Array<string>
  corePluginCount: number
  gatewayUrl: string | null
  connectionLabel: string | null
  verifiedModelCount: number | null
  /**
   * The display name of the agent profile the gateway will boot into. A
   * fresh install now bootstraps `active_profile` to point at the
   * `hermes-switch` builtin (overridable via `HERMES_DEFAULT_PROFILE`), so
   * the synthetic `Default` is no longer the common case — it only shows up
   * when `~/.hermes/active_profile` explicitly names `default`. Deliberately
   * *not* part of `anythingConfigured`: every install has an active profile,
   * so counting it would grow a "Currently configured" strip on a genuinely
   * fresh one.
   */
  activeProfileName: string | null
  /**
   * The display label of the memory provider named in `config.memory.provider`
   * — the catalog's label when this workspace knows the plugin, the raw name
   * when it does not, and `null` when the config selects no external provider
   * at all (built-in `MEMORY.md` / `USER.md` only).
   *
   * Like `activeProfileName`, deliberately *not* part of `anythingConfigured`:
   * the agent ships a `memory:` block in its default config, so counting it
   * would grow a "Currently configured" strip on a genuinely fresh install.
   */
  activeMemoryProvider: string | null
  /**
   * Whether *anything* about this workspace has been set up yet. A genuinely
   * fresh install must not grow a "Currently configured" box, and a theme is
   * always applied (matrix by default), so the theme fact alone would defeat
   * that. `factsForStep` therefore returns `[]` for every step while this is
   * false.
   *
   * Gateway reachability deliberately does not count: a running gateway on a
   * brand-new install is not something the *user* configured, and the
   * system-check step already lists it row by row.
   */
  anythingConfigured: boolean
}

/**
 * The gateway's reserved `custom` provider id names the same OpenAI-compatible
 * endpoint the UI writes as `manifest` (see CLAUDE.md — `custom` is refused by
 * `_get_named_custom_provider`, and `assertWritableProvider` refuses to write
 * it). The provider picker consequently has no `custom` card at all, so an
 * install whose config still says `provider: custom` would show nothing as
 * active. Collapsing the legacy id onto its replacement is what lets the card
 * the user would pick be the card that is marked.
 */
const PROVIDER_ID_ALIASES: Readonly<Record<string, string>> = {
  [RESERVED_PROVIDER_ID]: 'manifest',
}

function canonicalProviderId(raw: string): string {
  const id = normalizeProviderId(raw)
  return PROVIDER_ID_ALIASES[id] ?? id
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function str(rec: Record<string, unknown> | null, key: string): string | null {
  const value = rec?.[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function list(value: unknown): Array<unknown> {
  return Array.isArray(value) ? value : []
}

/**
 * The env var name holding this row's credential — the *name*, never the
 * value. `maskedKeys` is keyed by env var (plus the synthetic `auth-store`
 * entry for OAuth credentials the gateway holds), so its keys are the whole
 * answer. A row that is `configured` with no `maskedKeys` needs no credential
 * at all (ollama, atomic-chat), and must not be reported as holding a key.
 */
function storedKeyEnvOf(row: Record<string, unknown>): string | null {
  const masked = record(row.maskedKeys)
  if (!masked) return null
  const names = Object.keys(masked)
  return names.length > 0 ? names[0] : null
}

function isConfiguredRow(row: Record<string, unknown>): boolean {
  if (row.configured === true) return true
  const masked = record(row.maskedKeys)
  return masked !== null && Object.keys(masked).length > 0
}

/**
 * `buildSystemChecks` writes the capability summary as prose
 * ("6 of 6 enhanced capabilities are on: …"), which is the only place the
 * count exists. Reading the leading numbers back out keeps this module from
 * having to re-probe anything, and degrades to a plain reachability sentence
 * when the summary is missing or the shape changed.
 */
function connectionLabelFrom(checks: Array<SystemCheck>): string | null {
  const capabilities = checks.find((check) => check.id === 'capabilities')
  if (capabilities?.status === 'ok') {
    const match = /^(\d+) of (\d+)/.exec(capabilities.detail)
    if (match) {
      return `Hermes gateway · ${match[1]} of ${match[2]} capabilities`
    }
  }
  const gateway = checks.find((check) => check.id === 'gateway')
  if (gateway?.status === 'ok') return 'Hermes gateway · reachable'
  if (gateway?.status === 'fail') return 'Hermes gateway · not responding'
  return null
}

/**
 * The memory provider's display label. Falls back to the raw config value
 * rather than to `null` for a plugin the catalog has not caught up with — a
 * name the user can look up beats an em dash that says the field is unset.
 */
function memoryProviderLabel(
  memoryBlock: Record<string, unknown> | null,
): string | null {
  const provider = str(memoryBlock, 'provider')
  if (!provider) return null
  return getMemoryProviderInfo(provider)?.label ?? provider
}

export function buildCurrentSetup(input: {
  /** The `/api/claude-config` payload, which may be null. */
  config: unknown
  pluginRows: Array<CorePluginRow>
  checks: Array<SystemCheck>
  themeId: ThemeId
  verifyOutcome: VerifyOutcome | null
  /**
   * The gateway the workspace is talking to. Not part of the config payload —
   * `useSystemChecks` reads it off `/api/gateway-status`, which is the only
   * response that carries it.
   */
  gatewayUrl?: string | null
  /**
   * Either the already-parsed `Array<ProfileChoice>` from
   * `useOnboardingProfiles`, or the raw `/api/profiles/list` body. Both are
   * accepted because the wizard holds the parsed list while an out-of-wizard
   * caller has only the payload; an array is the former, anything else is fed
   * through `buildProfileChoices` (which never throws on garbage). An empty
   * array is "nothing has landed yet" and yields no profile name.
   */
  profiles?: unknown
}): CurrentSetup {
  const payload = record(input.config)
  const yaml = record(payload?.config)
  const modelBlock = record(yaml?.model)

  const rawActive = payload ? str(payload, 'activeProvider') : null
  const activeProviderId = rawActive ? canonicalProviderId(rawActive) : null
  const rawModel = payload ? str(payload, 'activeModel') : null
  const activeModel = rawModel ? stripProviderPrefix(rawModel) : null

  const configuredProviderIds: Array<string> = []
  const storedKeyEnvs: Record<string, string> = {}
  for (const entry of list(payload?.providers)) {
    const row = record(entry)
    if (!row) continue
    const id = canonicalProviderId(str(row, 'id') ?? '')
    if (!id) continue
    if (isConfiguredRow(row) && !configuredProviderIds.includes(id)) {
      configuredProviderIds.push(id)
    }
    const env = storedKeyEnvOf(row)
    if (env && !storedKeyEnvs[id]) storedKeyEnvs[id] = env
  }

  const providerBaseUrls: Record<string, string> = {}
  const providerModels: Record<string, string> = {}

  const yamlProviders = record(yaml?.providers)
  for (const [key, value] of Object.entries(yamlProviders ?? {})) {
    const entry = record(value)
    const id = canonicalProviderId(key)
    if (!entry || !id) continue
    const base = str(entry, 'base_url') ?? str(entry, 'baseUrl')
    if (base) providerBaseUrls[id] = base
    const model = str(entry, 'model') ?? str(entry, 'default')
    if (model) providerModels[id] = stripProviderPrefix(model)
  }

  for (const value of list(yaml?.custom_providers)) {
    const entry = record(value)
    if (!entry) continue
    const id = canonicalProviderId(str(entry, 'id') ?? str(entry, 'name') ?? '')
    if (!id) continue
    const base = str(entry, 'base_url') ?? str(entry, 'baseUrl')
    if (base && !providerBaseUrls[id]) providerBaseUrls[id] = base
    const model = str(entry, 'model') ?? str(entry, 'default')
    if (model && !providerModels[id]) {
      providerModels[id] = stripProviderPrefix(model)
    }
  }

  // The inline `model:` block is the third config shape, and the one this
  // workspace actually uses: it describes the active provider and nothing else.
  if (activeProviderId) {
    const base = str(modelBlock, 'base_url') ?? str(modelBlock, 'baseUrl')
    if (base && !providerBaseUrls[activeProviderId]) {
      providerBaseUrls[activeProviderId] = base
    }
    if (activeModel && !providerModels[activeProviderId]) {
      providerModels[activeProviderId] = activeModel
    }
  }

  // `self` is this app's own row — counting it would leave the tally stuck one
  // short of the total forever.
  const coreRows = input.pluginRows.filter((row) => row.state !== 'self')
  const enabledPlugins = coreRows
    .filter((row) => row.state === 'enabled')
    .map((row) => row.name)

  const gatewayUrl = input.gatewayUrl?.trim() || null

  const profileChoices: Array<ProfileChoice> = Array.isArray(input.profiles)
    ? (input.profiles as Array<ProfileChoice>)
    : input.profiles === undefined
      ? []
      : buildProfileChoices(input.profiles)

  return {
    activeProviderId,
    activeProviderName: activeProviderId
      ? getProviderDisplayName(activeProviderId)
      : null,
    activeModel,
    configuredProviderIds,
    storedKeyEnvs,
    providerBaseUrls,
    providerModels,
    themeId: input.themeId,
    themeLabel:
      THEMES.find((theme) => theme.id === input.themeId)?.label ??
      input.themeId,
    enabledPlugins,
    corePluginCount: coreRows.length,
    gatewayUrl,
    connectionLabel: connectionLabelFrom(input.checks),
    verifiedModelCount:
      input.verifyOutcome?.status === 'confirmed'
        ? input.verifyOutcome.modelCount
        : null,
    activeProfileName: activeProfileLabel(profileChoices),
    activeMemoryProvider: memoryProviderLabel(record(yaml?.memory)),
    anythingConfigured:
      activeProviderId !== null ||
      configuredProviderIds.length > 0 ||
      enabledPlugins.length > 0,
  }
}

const EM_DASH = '—'

function fact(
  id: string,
  label: string,
  value: string | null,
  state: Exclude<SetupFactState, 'unset'> = 'set',
): SetupFact {
  return value
    ? { id, label, value, state }
    : { id, label, value: EM_DASH, state: 'unset' }
}

/** A strip of nothing-but-dashes is noise, not context. */
function meaningful(facts: Array<SetupFact>): Array<SetupFact> {
  return facts.some((entry) => entry.state !== 'unset') ? facts : []
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function credentialValue(env: string | undefined): string | null {
  if (!env) return null
  // The synthetic entry `/api/claude-config` uses for credentials the gateway
  // holds itself; it is not an env var and must not read like one.
  return env === 'auth-store'
    ? 'Stored in the gateway auth store'
    : `Stored in ${env}`
}

/**
 * What this step should lead with. An empty array means "nothing worth
 * reporting" and the strip renders nothing at all.
 */
export function factsForStep(
  stepId: OnboardingStepId,
  setup: CurrentSetup,
  options?: { providerId?: string },
): Array<SetupFact> {
  if (!setup.anythingConfigured) return []

  switch (stepId) {
    case 'system-check':
      return meaningful([
        fact('gateway-url', 'Gateway', setup.gatewayUrl),
        fact('connection', 'Connection', setup.connectionLabel, 'active'),
      ])

    case 'provider': {
      const others = setup.configuredProviderIds.filter(
        (id) => id !== setup.activeProviderId,
      ).length
      return meaningful([
        fact('provider', 'Active provider', setup.activeProviderName, 'active'),
        fact('model', 'Active model', setup.activeModel),
        fact(
          'others',
          'Also configured',
          others > 0 ? plural(others, 'provider') : null,
        ),
      ])
    }

    case 'connect': {
      const providerId = options?.providerId
        ? canonicalProviderId(options.providerId)
        : null
      if (!providerId) return []
      return meaningful([
        fact(
          'key',
          'API key',
          credentialValue(setup.storedKeyEnvs[providerId]),
        ),
        fact(
          'base-url',
          'Base URL',
          setup.providerBaseUrls[providerId] ?? null,
        ),
        fact('model', 'Model', setup.providerModels[providerId] ?? null),
      ])
    }

    case 'review':
      // Framed as a replacement, so the YAML below reads as a change to a
      // working setup rather than a first write.
      return meaningful([
        fact(
          'provider',
          'Replacing provider',
          setup.activeProviderName,
          'active',
        ),
        fact('model', 'Replacing model', setup.activeModel),
      ])

    case 'verify':
      return meaningful([
        fact('provider', 'Active provider', setup.activeProviderName, 'active'),
        fact(
          'models',
          'Verified',
          setup.verifiedModelCount === null
            ? null
            : plural(setup.verifiedModelCount, 'model'),
        ),
      ])

    case 'profile':
      return meaningful([
        fact('profile', 'Active profile', setup.activeProfileName, 'active'),
      ])

    case 'memory':
      return meaningful([
        fact('memory', 'Memory provider', setup.activeMemoryProvider, 'active'),
      ])

    case 'plugins':
      return meaningful([
        fact(
          'plugins',
          'Core plugins',
          setup.corePluginCount > 0
            ? `${setup.enabledPlugins.length} of ${setup.corePluginCount} enabled`
            : null,
          setup.enabledPlugins.length > 0 ? 'active' : 'set',
        ),
      ])

    case 'theme':
      return meaningful([fact('theme', 'Theme', setup.themeLabel, 'active')])

    // The three chromeless steps already lead with their own summaries.
    case 'summary':
    case 'welcome':
    case 'finish':
      return []
  }
}
