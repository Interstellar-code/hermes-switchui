import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import YAML from 'yaml'
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { ensureGatewayProbed } from '../../server/hermes-api'
import { readProfile } from '../../server/profiles-browser'
import {
  ensureDiscovery,
  ensureProviderInConfig,
  getDiscoveredModels,
} from '../../server/local-provider-discovery'

const CLAUDE_HOME =
  process.env.HERMES_HOME ??
  process.env.CLAUDE_HOME ??
  path.join(os.homedir(), '.hermes')
const CONFIG_PATH = path.join(CLAUDE_HOME, 'config.yaml')

export type ModelEntry = {
  provider?: string
  id?: string
  name?: string
  contextLength?: number
  [key: string]: unknown
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value))
    return value as Record<string, unknown>
  return {}
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Read configured providers + their models from config.yaml.
 * Source of truth: `providers` map (connection) joined with `custom_providers`
 * array (model metadata). models.json is ignored — it's a legacy cache the
 * Hermes runtime no longer reads.
 */
function readConfigOnce(
  configPath: string = CONFIG_PATH,
): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(configPath)) return null
    const parsed = YAML.parse(fs.readFileSync(configPath, 'utf-8'))
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function readProvidersFromConfig(
  config: Record<string, unknown> | null,
): Array<ModelEntry> {
  try {
    if (!config) return []

    const providers = asRecord(config.providers)
    const providerKeys = Object.keys(providers).filter(
      (k) => providers[k] && typeof providers[k] === 'object',
    )
    if (providerKeys.length === 0) return []

    // Build a lookup: provider id → its custom_providers entry (model metadata).
    const customProviders = Array.isArray(config.custom_providers)
      ? (config.custom_providers as Array<unknown>)
      : []
    const metaByKey = new Map<string, Record<string, unknown>>()
    for (const cp of customProviders) {
      const rec = asRecord(cp)
      const id = readString(rec.id)
      if (id) metaByKey.set(id, rec)
    }

    const entries: Array<ModelEntry> = []
    for (const key of providerKeys) {
      const providerRec = asRecord(providers[key])
      const providerContextLength =
        typeof providerRec.context_length === 'number'
          ? providerRec.context_length
          : undefined
      const meta = metaByKey.get(key)
      const models = meta && Array.isArray(meta.models) ? meta.models : []
      if (models.length === 0) {
        // No model metadata in custom_providers → expose at least `auto`.
        entries.push({
          id: 'auto',
          name: 'auto',
          provider: key,
          ...(providerContextLength !== undefined
            ? { contextLength: providerContextLength }
            : {}),
        })
        continue
      }
      for (const m of models) {
        const rec = asRecord(m)
        const modelId = readString(rec.id) || readString(rec.model)
        if (!modelId) continue
        const modelContextLength =
          typeof rec.context_length === 'number'
            ? rec.context_length
            : providerContextLength
        entries.push({
          id: modelId,
          name: readString(rec.name) || modelId,
          provider: key,
          ...(modelContextLength !== undefined
            ? { contextLength: modelContextLength }
            : {}),
        })
      }
    }
    return entries
  } catch {
    return []
  }
}

// -------------------------------------------------------------------
// Remote model discovery (model.base_url / discover_models)
// -------------------------------------------------------------------
//
// A config can point directly at an OpenAI-compatible endpoint via
// `model.base_url` (+ `model.api_key`, `model.discover_models: true`)
// instead of declaring a `custom_providers` array. `readProvidersFromConfig`
// only understands the latter, so on a config that only has `model.base_url`
// (the common case here — see the four named profiles, which declare an
// empty `providers.manifest.base_url` alongside a populated `model.base_url`)
// the catalog falls back to a single `auto` entry. This enumerates the real
// model list from that endpoint's `/models` route and merges it in.
//
// Cached per base_url (this route is hit on every composer render) and
// deliberately fail-soft: an unreachable endpoint must never empty the
// dropdown or turn into a 503 — it just falls back to the last-known-good
// list (or none), leaving the rest of the catalog untouched.
const REMOTE_MODELS_TTL_MS = 30_000
const REMOTE_MODELS_TIMEOUT_MS = 5_000

type RemoteModelsCacheEntry = {
  ts: number
  models: Array<ModelEntry>
}

const remoteModelsCache = new Map<string, RemoteModelsCacheEntry>()

type RemoteModelConfig = {
  baseUrl: string
  apiKey: string
  provider: string
  contextLength?: number
}

/**
 * Extract a directly-configured remote endpoint from `model:`. Only
 * `model.base_url` is required — `api_key` and `discover_models` are read
 * when present but are not gates, since every config observed here that has
 * a base_url also wants it enumerated.
 */
function readRemoteModelConfig(
  config: Record<string, unknown> | null,
): RemoteModelConfig | null {
  if (!config) return null
  const modelField = config.model
  if (!modelField || typeof modelField !== 'object' || Array.isArray(modelField))
    return null
  const rec = asRecord(modelField)
  const baseUrl = readString(rec.base_url)
  if (!baseUrl) return null
  return {
    baseUrl,
    apiKey: readString(rec.api_key),
    provider: readString(rec.provider) || 'custom',
    contextLength:
      typeof rec.context_length === 'number' ? rec.context_length : undefined,
  }
}

/**
 * Fetch + cache the model list from a directly-configured remote endpoint.
 * Never throws: network failure, timeout, or a non-2xx response all fall
 * back to the last cached result (or an empty list on a cold cache) so a
 * flaky endpoint degrades the catalog instead of breaking the route.
 */
async function fetchRemoteModels(
  remote: RemoteModelConfig,
): Promise<Array<ModelEntry>> {
  const cached = remoteModelsCache.get(remote.baseUrl)
  if (cached && Date.now() - cached.ts < REMOTE_MODELS_TTL_MS) {
    return cached.models
  }

  try {
    const url = `${remote.baseUrl.replace(/\/+$/, '')}/models`
    const response = await fetch(url, {
      signal: AbortSignal.timeout(REMOTE_MODELS_TIMEOUT_MS),
      headers: {
        Accept: 'application/json',
        ...(remote.apiKey
          ? { Authorization: `Bearer ${remote.apiKey}` }
          : {}),
      },
    })
    if (!response.ok) {
      return cached?.models ?? []
    }
    const payload = (await response.json()) as Record<string, unknown>
    const rawModels: Array<unknown> = Array.isArray(payload.data)
      ? payload.data
      : []
    const models: Array<ModelEntry> = rawModels.flatMap((entry) => {
      const rec = asRecord(entry)
      const id = readString(rec.id)
      if (!id) return []
      return [
        {
          id,
          name: id,
          provider: remote.provider,
          ...(remote.contextLength !== undefined
            ? { contextLength: remote.contextLength }
            : {}),
        },
      ]
    })
    remoteModelsCache.set(remote.baseUrl, { ts: Date.now(), models })
    return models
  } catch {
    return cached?.models ?? []
  }
}

const DEFAULT_ACCEPTED_TIMEOUT_S = 120
const DEFAULT_HANDOFF_TIMEOUT_S = 300

function readStreamTimeouts(config: Record<string, unknown> | null): {
  streamAcceptedTimeoutMs: number
  streamHandoffTimeoutMs: number
} {
  let acceptedS = DEFAULT_ACCEPTED_TIMEOUT_S
  let handoffS = DEFAULT_HANDOFF_TIMEOUT_S
  if (config) {
    const ws =
      typeof config.workspace === 'object'
        ? (config.workspace as Record<string, unknown>)
        : {}
    if (
      typeof ws.stream_accepted_timeout === 'number' &&
      ws.stream_accepted_timeout > 0
    )
      acceptedS = ws.stream_accepted_timeout
    if (
      typeof ws.stream_handoff_timeout === 'number' &&
      ws.stream_handoff_timeout > 0
    )
      handoffS = ws.stream_handoff_timeout
  }
  const envAccepted = parseInt(process.env.STREAM_ACCEPTED_TIMEOUT_MS ?? '', 10)
  const envHandoff = parseInt(process.env.STREAM_HANDOFF_TIMEOUT_MS ?? '', 10)
  return {
    streamAcceptedTimeoutMs:
      Number.isFinite(envAccepted) && envAccepted > 0
        ? envAccepted
        : acceptedS * 1000,
    streamHandoffTimeoutMs:
      Number.isFinite(envHandoff) && envHandoff > 0
        ? envHandoff
        : handoffS * 1000,
  }
}

/**
 * Read model_aliases entries from config.yaml. Each alias becomes a picker entry
 * exposed as `provider/alias-name`, surfaced under its declared provider.
 */
function readModelAliasesFromConfig(
  config: Record<string, unknown> | null,
): Array<ModelEntry> {
  try {
    if (!config) return []
    const aliases = asRecord(config.model_aliases)
    const entries: Array<ModelEntry> = []
    for (const [name, raw] of Object.entries(aliases)) {
      const rec = asRecord(raw)
      const provider = readString(rec.provider) || 'custom'
      // Use the alias name as the model id so the gateway's resolve_alias()
      // can map it back to the real model+base_url at request time.
      entries.push({ id: name, name, provider })
    }
    return entries
  } catch {
    return []
  }
}

/**
 * Read the default model from active profile's config.yaml using a proper YAML parser.
 */
function readClaudeDefaultModel(
  config: Record<string, unknown> | null,
): ModelEntry | null {
  try {
    if (!config) return null
    let modelId = ''
    let provider = ''
    const modelField = config.model
    if (typeof modelField === 'string') {
      modelId = modelField
      provider = (config.provider as string) || 'unknown'
    } else if (modelField && typeof modelField === 'object') {
      const modelObj = modelField as Record<string, unknown>
      modelId = (modelObj.default as string) || ''
      provider =
        (modelObj.provider as string) ||
        (config.provider as string) ||
        'unknown'
    }
    if (!modelId) return null
    return { id: modelId, name: modelId, provider }
  } catch {
    return null
  }
}

export function mergeModelEntries(
  ...sources: Array<Array<ModelEntry>>
): Array<ModelEntry> {
  const merged: Array<ModelEntry> = []
  const seen = new Set<string>()
  for (const source of sources) {
    for (const entry of source) {
      const id = entry.id ?? entry.name ?? ''
      if (!id) continue
      const provider =
        typeof entry.provider === 'string' && entry.provider
          ? entry.provider
          : ''
      const key = `${provider}::${id}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(entry)
    }
  }
  return merged
}

export const Route = createFileRoute('/api/models')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        try {
          // Probing lives inside the try now: it used to run before the try
          // block, so a rejection escaped as an unhandled 500 with no JSON
          // body instead of the structured error response below — and with
          // the client's `retry: false`, that meant one gateway hiccup wiped
          // the dropdown until next reload.
          await ensureGatewayProbed()

          // Primary: read configured providers + models from ~/.hermes/config.yaml.
          // Hermes runtime reads only this file; mirror it for the picker so
          // dropdown stays in sync with what the agent actually uses.
          // Parse the YAML once and thread it through every reader.
          //
          // `?profile=` reads a foreign profile's config.yaml directly off disk
          // (P2). Local-provider discovery below stays active-profile-only —
          // that lives in local-provider-discovery.ts, outside this lane.
          const url = new URL(request.url)
          const profile = url.searchParams.get('profile')?.trim() || null

          let configPath = CONFIG_PATH
          if (profile) {
            // Reuse profiles-browser.ts's own profile→path resolution (the
            // same one `GET /api/profiles/:name` uses) instead of
            // hand-rolling a `profile === 'default'` check here. It already
            // special-cases 'default' to the Hermes root (~/.hermes) rather
            // than profiles/default, which does not exist on disk — see
            // profiles-browser.ts readProfile(). It also throws when the
            // resolved profile directory itself is missing, which we treat
            // as a real error below rather than silently reporting an empty
            // catalog.
            let profileDir: string
            try {
              profileDir = readProfile(profile).path
            } catch (err) {
              return Response.json(
                {
                  ok: false,
                  error:
                    err instanceof Error
                      ? err.message
                      : `Profile "${profile}" not found`,
                  data: [],
                  models: [],
                },
                { status: 404 },
              )
            }
            configPath = path.join(profileDir, 'config.yaml')

            // The profile directory exists but has no config.yaml — a
            // specifically-requested profile that isn't configured is a real
            // problem (stale reference, half-created profile, deleted file),
            // unlike the no-`profile` case below where "nothing configured
            // yet" is the expected first-run state.
            if (!fs.existsSync(configPath)) {
              return Response.json(
                {
                  ok: false,
                  error: `Profile "${profile}" has no config.yaml`,
                  data: [],
                  models: [],
                },
                { status: 404 },
              )
            }
          }

          const parsedConfig = readConfigOnce(configPath)
          let gatewayModels = readProvidersFromConfig(parsedConfig)
          const source = 'config.yaml'

          // Ensure the default model from `model.default` lands first in the list.
          const defaultModel = readClaudeDefaultModel(parsedConfig)
          if (defaultModel) {
            gatewayModels = gatewayModels.filter(
              (m) =>
                !(m.id === defaultModel.id && m.provider === defaultModel.provider),
            )
            gatewayModels.unshift(defaultModel)
          }

          // Merge auto-discovered local models (Ollama, Atomic Chat, etc.)
          // and any directly-configured remote endpoint (model.base_url) in
          // parallel — both are network probes and neither depends on the
          // other.
          const remoteConfig = readRemoteModelConfig(parsedConfig)
          const [, remoteModels] = await Promise.all([
            ensureDiscovery(),
            remoteConfig
              ? fetchRemoteModels(remoteConfig)
              : Promise.resolve<Array<ModelEntry>>([]),
          ])
          const localModels = getDiscoveredModels()
          for (const m of localModels) {
            ensureProviderInConfig(m.provider)
          }
          const aliasModels = readModelAliasesFromConfig(parsedConfig)
          const models = mergeModelEntries(
            gatewayModels,
            aliasModels,
            localModels,
            remoteModels,
          )

          const configuredProviders = Array.from(
            new Set(
              models
                .map((model) =>
                  typeof model.provider === 'string' ? model.provider : '',
                )
                .filter(Boolean),
            ),
          )

          const streamTimeouts = readStreamTimeouts(parsedConfig)

          return Response.json({
            ok: true,
            object: 'list',
            data: models,
            models,
            configuredProviders,
            source,
            ...streamTimeouts,
          })
        } catch (err) {
          return Response.json(
            {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            },
            { status: 503 },
          )
        }
      },
    },
  },
})
