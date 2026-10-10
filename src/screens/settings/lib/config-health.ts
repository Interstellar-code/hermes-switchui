/**
 * config-health.ts — pure config-draft linting and preset application (P5A).
 *
 * No React, no fetch: `checkConfigHealth` inspects a settings draft (the flat
 * `Record<string, unknown>` shape `useSettingsStore` uses, hermes-config keys
 * prefixed `config.`, env/switchui-local keys bare) against the key metadata
 * and returns one `HealthFinding` per problem. Findings carry a `fix` patch in
 * the same draft-key shape so a UI (P5B) can offer one-click repair through
 * the normal save flow; `{}` means the finding is informational or needs a
 * human decision (e.g. deleting a dead key, which a value patch cannot
 * express).
 *
 * Rules come from `.omc/research/settings-recommended.md` §4 issues 1–9
 * (lines 132–155) plus the two extras the P5A brief names: required-key drift
 * and duplicate/dead keys. Thresholds mirror the settled values in
 * `data/key-meta.json` (recommended/default), not the live-config anecdotes in
 * the research prose.
 */

import { getPresets } from './key-meta'
import type { KeyMeta, Preset } from './key-meta-types'

export type HealthFinding = {
  id: string
  severity: 'error' | 'warn' | 'info'
  message: string
  /** Draft keys (`config.`-prefixed) → values that resolve the finding; `{}` = no automatic fix. */
  fix: Record<string, unknown>
}

const CONFIG_PREFIX = 'config.'

/** Draft key for a meta entry: `config.`-prefixed for hermes-config, bare otherwise. */
function draftKey(meta: KeyMeta): string {
  return meta.scope === 'hermes-config' ? `${CONFIG_PREFIX}${meta.id}` : meta.id
}

/** Value equality that also covers the list/map values config keys carry. */
function sameValue(a: unknown, b: unknown): boolean {
  if (
    typeof a === 'object' &&
    a !== null &&
    typeof b === 'object' &&
    b !== null
  ) {
    return JSON.stringify(a) === JSON.stringify(b)
  }
  return a === b
}

// Thresholds, each tied to its research issue / meta recommended value.
const APPROVALS_TIMEOUT_FLOOR = 300 // rec issue 1: upstream default 300 s
const RETRIES_FLOOR = 3 // rec issue 4: default/recommended retries
const CLARIFY_TIMEOUT_FLOOR = 1800 // rec issue 8: recommended clarify timeout (s)
const HYGIENE_DEFAULT = 5000 // rec issue 9: upstream default message limit

type Rule = (
  draft: Record<string, unknown>,
  meta: Array<KeyMeta>,
) => Array<HealthFinding>

/**
 * Issue 1 — `approvals.mode: manual` with a sub-300 s timeout. From a browser
 * tab the approval prompt is easy to miss; at 60 s it expires and denies, so
 * runs stall. Fix restores the upstream default pair smart/300.
 */
const approvalsManualShortTimeout: Rule = (draft) => {
  const mode = draft[`${CONFIG_PREFIX}approvals.mode`]
  const timeout = draft[`${CONFIG_PREFIX}approvals.timeout`]
  // A null/0 timeout (never expires / unset) fails safe: no finding below.
  if (
    mode === 'manual' &&
    typeof timeout === 'number' &&
    timeout < APPROVALS_TIMEOUT_FLOOR
  ) {
    return [
      {
        id: 'approvals-manual-short-timeout',
        severity: 'warn',
        message:
          `Approvals are manual but the prompt expires after ${timeout} s — ` +
          'easy to miss from a browser tab, so runs stall or get denied. Upstream default is smart with a 300 s timeout.',
        fix: {
          [`${CONFIG_PREFIX}approvals.mode`]: 'smart',
          [`${CONFIG_PREFIX}approvals.timeout`]: 300,
        },
      },
    ]
  }
  return []
}

/** Issue 2 — auto-prune disabled; nothing bounds state.db / snapshot growth. */
const autoPruneRules: Rule = (draft) => {
  const findings: Array<HealthFinding> = []
  for (const [id, label, what] of [
    ['sessions', 'sessions-auto-prune-off', 'session history'],
    ['checkpoints', 'checkpoints-auto-prune-off', 'checkpoints'],
  ] as const) {
    if (draft[`${CONFIG_PREFIX}${id}.auto_prune`] === false) {
      findings.push({
        id: label,
        severity: 'warn',
        message: `Auto-prune for ${what} is off, so ${what === 'checkpoints' ? 'snapshots' : 'the store'} grows without bound. Both default to on.`,
        fix: { [`${CONFIG_PREFIX}${id}.auto_prune`]: true },
      })
    }
  }
  return findings
}

/**
 * Issue 3 — whole model catalog disabled when only one provider needed
 * excluding; the refreshed catalog also feeds every other provider's metadata.
 */
const modelCatalogDisabled: Rule = (draft) => {
  if (draft[`${CONFIG_PREFIX}model_catalog.enabled`] === false) {
    return [
      {
        id: 'model-catalog-disabled',
        severity: 'warn',
        message:
          'The model catalog refresh is off. If this was to hide one provider, model_catalog.excluded_providers does that without losing metadata for the rest.',
        fix: { [`${CONFIG_PREFIX}model_catalog.enabled`]: true },
      },
    ]
  }
  return []
}

/** Issue 4 — retries below 3: one transient proxy error fails the whole turn. */
const apiMaxRetriesLow: Rule = (draft) => {
  const retries = draft[`${CONFIG_PREFIX}agent.api_max_retries`]
  if (typeof retries === 'number' && retries < RETRIES_FLOOR) {
    return [
      {
        id: 'api-max-retries-low',
        severity: 'warn',
        message: `API calls retry only ${retries} time${retries === 1 ? '' : 's'} before the turn fails; a single transient provider error is enough. Default is 3.`,
        fix: { [`${CONFIG_PREFIX}agent.api_max_retries`]: RETRIES_FLOOR },
      },
    ]
  }
  return []
}

/**
 * Issue 5 / brief extra — dead & duplicate keys. A value patch cannot delete a
 * key, so these findings carry no automatic fix; the save review (P6) is where
 * a removal lands.
 */
const deadKeyRules: Rule = (draft) => {
  const findings: Array<HealthFinding> = []

  const legacyFallback = draft[`${CONFIG_PREFIX}fallback_model`]
  const providers = draft[`${CONFIG_PREFIX}fallback_providers`]
  // "Set" mirrors the agent's legacy shapes: a non-empty string, dict, or
  // chain list (hermes_cli/config.py:_validate_fallback_model).
  const legacyFallbackSet =
    (typeof legacyFallback === 'string' && legacyFallback !== '') ||
    (typeof legacyFallback === 'object' &&
      legacyFallback !== null &&
      Object.keys(legacyFallback).length > 0)
  if (legacyFallbackSet && Array.isArray(providers) && providers.length > 0) {
    findings.push({
      id: 'legacy-fallback-model',
      severity: 'warn',
      message:
        'Legacy top-level fallback_model is set alongside fallback_providers; the legacy value is appended after the fallback_providers chain, so the effective fallback order is not what the providers list alone shows.',
      fix: {},
    })
  }

  const flatHost = draft[`${CONFIG_PREFIX}platforms.api_server.host`]
  const flatPort = draft[`${CONFIG_PREFIX}platforms.api_server.port`]
  const extraHost = draft[`${CONFIG_PREFIX}platforms.api_server.extra.host`]
  const extraPort = draft[`${CONFIG_PREFIX}platforms.api_server.extra.port`]
  const flatAlongsideExtra =
    (flatHost !== undefined && extraHost !== undefined) ||
    (flatPort !== undefined && extraPort !== undefined)
  if (flatAlongsideExtra) {
    findings.push({
      id: 'legacy-flat-api-server-keys',
      severity: 'warn',
      message:
        'Flat platforms.api_server.host/port exist alongside platforms.api_server.extra.host/port. The gateway reads extra.* — the flat copies are dead and silently diverge when edited.',
      fix: {},
    })
  }

  return findings
}

/** Issue 6 — cdp_url pinned to a Chrome instance's ephemeral debugger UUID. */
const browserCdpUrlPinned: Rule = (draft) => {
  const cdpUrl = draft[`${CONFIG_PREFIX}browser.cdp_url`]
  if (typeof cdpUrl === 'string' && cdpUrl.includes('devtools/browser/')) {
    return [
      {
        id: 'browser-cdp-url-pinned',
        severity: 'warn',
        message:
          'browser.cdp_url is pinned to a devtools/browser/<uuid> endpoint. The UUID changes whenever Chrome restarts, breaking browser tools until it is re-pointed (usually at the stable endpoint, e.g. http://127.0.0.1:9222).',
        fix: {},
      },
    ]
  }
  return []
}

/** Issue 7 — updates without a pre-update backup; the fork carries runtime patches. */
const preUpdateBackupOff: Rule = (draft) => {
  const value = draft[`${CONFIG_PREFIX}updates.pre_update_backup`]
  if (value === false || value === 'off') {
    return [
      {
        id: 'pre-update-backup-off',
        severity: 'warn',
        message:
          "Updates run without a pre-update backup. This fork carries runtime patches (~/.hermes/patches), so an unbacked update is riskier than for stock — 'quick' is the default.",
        fix: { [`${CONFIG_PREFIX}updates.pre_update_backup`]: 'quick' },
      },
    ]
  }
  return []
}

/**
 * Issue 8 — clarify cards timing out while interactive clarify is on. The
 * floor is the recommended 1800 s (what the balanced/safe presets set), not
 * the 3600 default, so a healthy preset-applied draft stays quiet.
 */
const clarifyTimeoutLow: Rule = (draft) => {
  const timeout = draft[`${CONFIG_PREFIX}agent.clarify_timeout`]
  if (
    draft[`${CONFIG_PREFIX}api_server.interactive_clarify`] === true &&
    typeof timeout === 'number' &&
    timeout < CLARIFY_TIMEOUT_FLOOR
  ) {
    return [
      {
        id: 'clarify-timeout-low',
        severity: 'warn',
        message:
          `agent.clarify_timeout is ${timeout} s while interactive clarify is on — an unanswered clarify card fails the turn after that. ` +
          `Recommended floor is ${CLARIFY_TIMEOUT_FLOOR} s.`,
        fix: {
          [`${CONFIG_PREFIX}agent.clarify_timeout`]: CLARIFY_TIMEOUT_FLOOR,
        },
      },
    ]
  }
  return []
}

/**
 * Issue 9 — hygiene limit tuned below the 5000 default. Research calls this
 * "probably intentional, and OK": informational only, with the default made
 * visible; no automatic fix would respect a deliberate choice. Values the
 * meta recommends or a shipped preset sets are intended tuning by definition,
 * so they stay quiet (same reasoning as the clarify floor).
 */
const HYGIENE_KEY = 'compression.hygiene_hard_message_limit'
const HYGIENE_PRESET_VALUES = new Set<unknown>(
  getPresets().flatMap((preset) => {
    const value = preset.values[HYGIENE_KEY]
    return value === undefined ? [] : [value]
  }),
)
const hygieneLimitTuned: Rule = (draft, meta) => {
  const limit = draft[`${CONFIG_PREFIX}${HYGIENE_KEY}`]
  if (typeof limit !== 'number' || limit >= HYGIENE_DEFAULT) return []
  const recommended = meta.find((m) => m.id === HYGIENE_KEY)?.recommended
  if (recommended !== undefined && sameValue(limit, recommended)) return []
  if (HYGIENE_PRESET_VALUES.has(limit)) return []
  return [
    {
      id: 'hygiene-limit-tuned',
      severity: 'info',
      message: `${HYGIENE_KEY} is tuned to ${limit} (default ${HYGIENE_DEFAULT}). Fine if intentional — shown so the tuning is visible.`,
      fix: {},
    },
  ]
}

/**
 * Brief extra — required keys (board C locks). Any drift, including absence,
 * is an error: SwitchUI features depend on these values. One finding per key
 * (`required-<bare-id>`), fix restores the locked value.
 */
const requiredKeyDrift: Rule = (draft, meta) => {
  const findings: Array<HealthFinding> = []
  for (const m of meta) {
    if (!m.required) continue
    const key = draftKey(m)
    const value = draft[key]
    if (!sameValue(value, m.required.value)) {
      findings.push({
        id: `required-${m.id}`,
        severity: 'error',
        message: `${m.label} is required for SwitchUI: ${m.required.reason} Restoring the locked value ${JSON.stringify(m.required.value)}.`,
        fix: { [key]: m.required.value },
      })
    }
  }
  return findings
}

const RULES: Array<Rule> = [
  approvalsManualShortTimeout,
  autoPruneRules,
  modelCatalogDisabled,
  apiMaxRetriesLow,
  deadKeyRules,
  browserCdpUrlPinned,
  preUpdateBackupOff,
  clarifyTimeoutLow,
  hygieneLimitTuned,
  requiredKeyDrift,
]

/** Lint a settings draft; every rule runs, findings are concatenated. */
export function checkConfigHealth(
  draft: Record<string, unknown>,
  meta: Array<KeyMeta>,
): Array<HealthFinding> {
  return RULES.flatMap((rule) => rule(draft, meta))
}

/**
 * Patch of draft keys that applies a preset. Constraints (P5A brief):
 *  - never includes a key whose meta is `required` — presets are judgment
 *    values and must not fight the board-C locks;
 *  - never includes a key the preset does not list;
 *  - plus: keys whose draft value already equals the preset value are left
 *    out, so applying a preset twice (or over an already-tuned draft) writes
 *    nothing and marks no rows dirty.
 * Key ids in `preset.values` are bare; the patch uses draft keys
 * (`config.`-prefixed for hermes-config scope, bare otherwise).
 */
export function applyPreset(
  draft: Record<string, unknown>,
  preset: Preset,
  meta: Array<KeyMeta>,
): Record<string, unknown> {
  const byId = new Map(meta.map((m) => [m.id, m]))
  const patch: Record<string, unknown> = {}
  for (const [id, value] of Object.entries(preset.values)) {
    const m = byId.get(id)
    if (m?.required) continue
    const key = m ? draftKey(m) : `${CONFIG_PREFIX}${id}`
    if (sameValue(draft[key], value)) continue
    patch[key] = value
  }
  return patch
}
