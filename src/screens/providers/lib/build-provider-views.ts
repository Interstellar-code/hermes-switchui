/**
 * build-provider-views.ts — merges the four provider data sources into the
 * rows the inventory screen renders. Pure: no fetch, no React, no clock.
 *
 * Merge order, weakest to strongest:
 *   catalog (names, docs, defaults)
 *     → config.providers        (authoritative for "the user added this")
 *     → claude-config providers[] (credential status for known ids)
 *     → GET /api/env            (credential status for everything else)
 *     → GET /api/models         (model lists)
 *     → GET /api/local-providers (liveness)
 */
import type {
  BuildProviderViewsInput,
  ProviderModel,
  ProviderStatus,
  ProviderView,
} from './provider-view'
import {
  PROVIDER_CATALOG,
  getProviderDisplayName,
  getProviderEnvKeys,
  getProviderInfo,
  normalizeProviderId,
} from '@/lib/provider-catalog'

/** Ranking used for the default sort — most actionable first. */
const STATUS_ORDER: Record<ProviderStatus, number> = {
  active: 0,
  'needs-key': 1,
  offline: 2,
  ready: 3,
  available: 4,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

type Draft = Omit<ProviderView, 'status'>

function emptyDraft(id: string): Draft {
  const info = getProviderInfo(id)
  return {
    id,
    name: info?.name ?? getProviderDisplayName(id),
    description:
      info?.description ?? 'Provider configured in your Hermes setup.',
    docsUrl: info?.docsUrl ?? null,
    origin: info?.origin ?? 'hosted',
    authKind: info?.authTypes[0] ?? 'api-key',
    inConfig: false,
    configShape: 'none',
    type: null,
    baseUrl: info?.baseUrl ?? null,
    keyEnv: null,
    configured: false,
    authSource: 'none',
    envKey: info?.envKey ?? null,
    maskedKey: null,
    models: [],
    modelCount: 0,
    modelsUnknown: false,
    online: null,
    isActive: false,
    activeModel: null,
  }
}

function resolveStatus(draft: Draft): ProviderStatus {
  if (draft.isActive) return 'active'
  if (draft.origin === 'local' && draft.online === false) return 'offline'
  if (!draft.inConfig) return 'available'
  return draft.configured ? 'ready' : 'needs-key'
}

export function buildProviderViews(
  input: BuildProviderViewsInput,
): Array<ProviderView> {
  const drafts = new Map<string, Draft>()
  const draftFor = (rawId: string): Draft | null => {
    const id = normalizeProviderId(rawId)
    if (!id) return null
    const existing = drafts.get(id)
    if (existing) return existing
    const created = emptyDraft(id)
    drafts.set(id, created)
    return created
  }

  const config = input.claudeConfig?.config ?? {}

  // 1. config.providers — the set of providers the user has actually added.
  if (isRecord(config.providers)) {
    for (const [key, value] of Object.entries(config.providers)) {
      const draft = draftFor(key)
      if (!draft) continue
      draft.inConfig = true
      draft.configShape = 'providers-map'
      if (isRecord(value)) {
        draft.type = asString(value.type)
        draft.baseUrl = asString(value.base_url) ?? draft.baseUrl
        draft.keyEnv = asString(value.key_env)
        if (draft.keyEnv) draft.envKey = draft.keyEnv
      }
    }
  }

  // 1b. The inline `model` block is a provider definition in its own right —
  //     `model: { provider, base_url, api_key, default }` with the credential
  //     stored in config.yaml rather than .env. Installs in the wild use this
  //     shape, and reading only `providers:` reports their one working
  //     provider as unconfigured.
  if (isRecord(config.model)) {
    const inlineId =
      asString(config.model.provider) ?? asString(config.provider)
    const draft = inlineId ? draftFor(inlineId) : null
    if (draft) {
      draft.inConfig = true
      if (draft.configShape === 'none') draft.configShape = 'inline-model'
      draft.baseUrl = asString(config.model.base_url) ?? draft.baseUrl
      if (asString(config.model.api_key)) {
        draft.configured = true
        draft.authSource = 'config-inline'
      }
    }
  }

  // custom_providers carries model metadata; models.ts indexes it by `id`,
  // local-provider-discovery writes `name` — accept either.
  if (Array.isArray(config.custom_providers)) {
    for (const entry of config.custom_providers) {
      if (!isRecord(entry)) continue
      const id = asString(entry.id) ?? asString(entry.name)
      const draft = id ? draftFor(id) : null
      if (!draft) continue
      draft.inConfig = true
      if (draft.configShape === 'none') draft.configShape = 'providers-map'
      draft.baseUrl = asString(entry.base_url) ?? draft.baseUrl
    }
  }

  // 2. Credential status for the ids the server route knows about.
  for (const entry of input.claudeConfig?.providers ?? []) {
    const draft = draftFor(entry.id ?? '')
    if (!draft) continue
    if (entry.configured) draft.configured = true
    if (
      draft.authSource === 'none' &&
      (entry.authSource === 'env' || entry.authSource === 'claude-auth-store')
    ) {
      draft.authSource = entry.authSource
    }
    const masked = Object.values(entry.maskedKeys ?? {})[0]
    if (masked) draft.maskedKey = masked
    if (!draft.envKey && entry.envKeys?.length) {
      draft.envKey = entry.envKeys[0]
    }
  }

  // 3. Anything the server route does not cover falls back to /api/env, so a
  //    provider outside its known list still reports its key correctly.
  const env = input.env ?? {}
  for (const draft of drafts.values()) {
    if (draft.configured) continue
    const candidates = [
      ...(draft.keyEnv ? [draft.keyEnv] : []),
      ...getProviderEnvKeys(draft.id),
    ]
    const present = candidates.find((key) => {
      const info = env[key] as { is_set?: boolean } | undefined
      return info?.is_set === true
    })
    if (present) {
      draft.configured = true
      draft.authSource = 'env'
      if (!draft.envKey) draft.envKey = present
    }
  }

  // Local runtimes authenticate by being reachable, not by holding a key.
  for (const draft of drafts.values()) {
    if (draft.origin === 'local' || draft.authKind === 'local') {
      draft.origin = 'local'
      draft.configured = true
    }
  }

  // 4. Models. `models.ts` emits a synthetic `auto` row for any configured
  //    provider lacking metadata, so a lone `auto` means "unknown", not "one".
  const grouped = new Map<string, Array<ProviderModel>>()
  for (const entry of input.models?.models ?? []) {
    const providerId = normalizeProviderId(entry.provider ?? '')
    const modelId = asString(entry.id)
    if (!providerId || !modelId) continue
    const list = grouped.get(providerId) ?? []
    list.push({
      id: modelId,
      name: asString(entry.name) ?? modelId,
      ...(typeof entry.contextLength === 'number'
        ? { contextLength: entry.contextLength }
        : {}),
    })
    grouped.set(providerId, list)
  }
  for (const [providerId, models] of grouped) {
    const draft = draftFor(providerId)
    if (!draft) continue
    const onlyAuto = models.length === 1 && models[0].id === 'auto'
    draft.models = onlyAuto ? [] : models
    draft.modelCount = onlyAuto ? 0 : models.length
    draft.modelsUnknown = onlyAuto
  }
  for (const id of input.models?.configuredProviders ?? []) {
    draftFor(id)
  }

  // 5. Liveness for local runtimes.
  for (const entry of input.localProviders?.providers ?? []) {
    const draft = draftFor(entry.id ?? '')
    if (!draft) continue
    draft.origin = 'local'
    draft.online = entry.online === true
  }

  // 6. Catalog rows the user has not added yet — the "available" shelf the
  //    wizard adds from.
  for (const provider of PROVIDER_CATALOG) {
    draftFor(provider.id)
  }

  // 7. Which one is live.
  const activeProvider = normalizeProviderId(
    input.claudeConfig?.activeProvider ?? '',
  )
  const activeModel = asString(input.claudeConfig?.activeModel)
  if (activeProvider) {
    const draft = drafts.get(activeProvider)
    if (draft) {
      draft.isActive = true
      draft.activeModel = activeModel
    }
  }

  return [...drafts.values()]
    .map((draft) => ({ ...draft, status: resolveStatus(draft) }))
    .sort(
      (left, right) =>
        STATUS_ORDER[left.status] - STATUS_ORDER[right.status] ||
        left.name.localeCompare(right.name),
    )
}
