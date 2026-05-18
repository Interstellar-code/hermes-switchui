import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import YAML from 'yaml'
import { json } from '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { ensureGatewayProbed } from '../../server/hermes-api'
import {
  ensureDiscovery,
  getDiscoveredModels,
  ensureProviderInConfig,
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
function readProvidersFromConfig(): Array<ModelEntry> {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return []
    const parsed = YAML.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
    if (!parsed || typeof parsed !== 'object') return []
    const config = parsed as Record<string, unknown>

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
      const meta = metaByKey.get(key)
      const models = meta && Array.isArray(meta.models) ? meta.models : []
      if (models.length === 0) {
        // No model metadata in custom_providers → expose at least `auto`.
        entries.push({ id: 'auto', name: 'auto', provider: key })
        continue
      }
      for (const m of models) {
        const rec = asRecord(m)
        const modelId = readString(rec.id) || readString(rec.model)
        if (!modelId) continue
        entries.push({
          id: modelId,
          name: readString(rec.name) || modelId,
          provider: key,
          ...(typeof rec.context_length === 'number'
            ? { context_length: rec.context_length }
            : {}),
        })
      }
    }
    return entries
  } catch {
    return []
  }
}

const DEFAULT_ACCEPTED_TIMEOUT_S = 120
const DEFAULT_HANDOFF_TIMEOUT_S = 300

function readStreamTimeouts(): {
  streamAcceptedTimeoutMs: number
  streamHandoffTimeoutMs: number
} {
  let acceptedS = DEFAULT_ACCEPTED_TIMEOUT_S
  let handoffS = DEFAULT_HANDOFF_TIMEOUT_S
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const parsed = YAML.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
      const ws =
        parsed &&
        typeof parsed === 'object' &&
        typeof (parsed as Record<string, unknown>).workspace === 'object'
          ? ((parsed as Record<string, unknown>).workspace as Record<
              string,
              unknown
            >)
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
  } catch {
    // fall through to defaults
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
 * Read the default model from active profile's config.yaml using a proper YAML parser.
 */
function readClaudeDefaultModel(): ModelEntry | null {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return null
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
    const parsed = YAML.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const config = parsed as Record<string, unknown>
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
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        await ensureGatewayProbed()

        try {
          // Primary: read configured providers + models from ~/.hermes/config.yaml.
          // Hermes runtime reads only this file; mirror it for the picker so
          // dropdown stays in sync with what the agent actually uses.
          let gatewayModels = readProvidersFromConfig()
          let source = 'config.yaml'

          // Ensure the default model from `model.default` lands first in the list.
          const defaultModel = readClaudeDefaultModel()
          if (defaultModel) {
            gatewayModels = gatewayModels.filter(
              (m) =>
                !(m.id === defaultModel.id && m.provider === defaultModel.provider),
            )
            gatewayModels.unshift(defaultModel)
          }

          // Merge auto-discovered local models (Ollama, Atomic Chat, etc.)
          await ensureDiscovery()
          const localModels = getDiscoveredModels()
          for (const m of localModels) {
            ensureProviderInConfig(m.provider)
          }
          const models = mergeModelEntries(gatewayModels, localModels)

          const configuredProviders = Array.from(
            new Set(
              models
                .map((model) =>
                  typeof model.provider === 'string' ? model.provider : '',
                )
                .filter(Boolean),
            ),
          )

          const streamTimeouts = readStreamTimeouts()

          return json({
            ok: true,
            object: 'list',
            data: models,
            models,
            configuredProviders,
            source,
            ...streamTimeouts,
          })
        } catch (err) {
          return json(
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
