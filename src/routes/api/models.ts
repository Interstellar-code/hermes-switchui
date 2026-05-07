import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import YAML from 'yaml'
import { json } from '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import {
  ensureGatewayProbed,
  getGatewayCapabilities,
} from '../../server/claude-api'
import { BEARER_TOKEN, CLAUDE_API } from '../../server/gateway-capabilities'
import {
  ensureDiscovery,
  getDiscoveredModels,
  ensureProviderInConfig,
} from '../../server/local-provider-discovery'

const CLAUDE_HOME = process.env.HERMES_HOME ?? process.env.CLAUDE_HOME ?? path.join(os.homedir(), '.hermes')
const MODELS_PATH = path.join(CLAUDE_HOME, 'models.json')
const MODELS_DEV_CACHE_PATH = path.join(os.homedir(), '.hermes', 'models_dev_cache.json')
const CONFIG_PATH = path.join(CLAUDE_HOME, 'config.yaml')

type ModelEntry = {
  provider?: string
  id?: string
  name?: string
  contextLength?: number
  outputLength?: number
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

function readPositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined
}

function normalizeModel(entry: unknown): ModelEntry | null {
  if (typeof entry === 'string') {
    const id = entry.trim()
    if (!id) return null
    return {
      id,
      name: id,
      provider: id.includes('/') ? id.split('/')[0] : 'unknown',
    }
  }
  const record = asRecord(entry)
  const id =
    readString(record.id) || readString(record.name) || readString(record.model)
  if (!id) return null
  return {
    ...record,
    id,
    name:
      readString(record.name) ||
      readString(record.display_name) ||
      readString(record.label) ||
      id,
    provider:
      readString(record.provider) ||
      readString(record.owned_by) ||
      (id.includes('/') ? id.split('/')[0] : 'unknown'),
  }
}

type ModelLimit = {
  contextLength?: number
  outputLength?: number
}

function modelLimitKeys(provider: string, id: string): Array<string> {
  const keys = new Set<string>()
  const normalizedProvider = provider.toLowerCase()
  const normalizedId = id.toLowerCase()
  if (normalizedId) keys.add(normalizedId)
  if (normalizedProvider && normalizedId) {
    keys.add(`${normalizedProvider}/${normalizedId}`)
  }
  const idParts = normalizedId.split('/')
  const lastIdPart = idParts[idParts.length - 1]
  if (lastIdPart) keys.add(lastIdPart)
  return Array.from(keys)
}

function readModelLimitsCache(): Map<string, ModelLimit> {
  const limits = new Map<string, ModelLimit>()
  try {
    if (!fs.existsSync(MODELS_DEV_CACHE_PATH)) return limits
    const cache = asRecord(JSON.parse(fs.readFileSync(MODELS_DEV_CACHE_PATH, 'utf-8')))
    for (const [providerKey, providerValue] of Object.entries(cache)) {
      const provider = asRecord(providerValue)
      const models = asRecord(provider.models)
      for (const [modelKey, modelValue] of Object.entries(models)) {
        const model = asRecord(modelValue)
        const limit = asRecord(model.limit)
        const contextLength = readPositiveNumber(limit.context)
        const outputLength = readPositiveNumber(limit.output)
        if (!contextLength && !outputLength) continue
        const id = readString(model.id) || modelKey
        const entry: ModelLimit = {}
        if (contextLength) entry.contextLength = contextLength
        if (outputLength) entry.outputLength = outputLength
        for (const key of modelLimitKeys(providerKey, id)) {
          limits.set(key, entry)
        }
      }
    }
  } catch {
    return limits
  }
  return limits
}

function enrichModelLimits(
  models: Array<ModelEntry>,
  limits: Map<string, ModelLimit>,
): Array<ModelEntry> {
  if (limits.size === 0) return models
  return models.map((model) => {
    const provider = readString(model.provider)
    const ids = [
      readString(model.id),
      readString(model.model),
      readString(model.name),
    ].filter(Boolean)
    for (const id of ids) {
      for (const key of modelLimitKeys(provider, id)) {
        const limit = limits.get(key)
        if (limit) return { ...model, ...limit }
      }
    }
    return model
  })
}

/**
 * Read user-configured models from active profile's models.json.
 */
function readClaudeModelsJson(): Array<ModelEntry> {
  try {
    if (!fs.existsSync(MODELS_PATH)) return []
    const raw = fs.readFileSync(MODELS_PATH, 'utf-8')
    const entries = JSON.parse(raw)
    if (!Array.isArray(entries)) return []
    return entries
      .map((entry: unknown): ModelEntry | null => {
        const record = asRecord(entry)
        // models.json uses "model" field for the model ID
        const modelId = readString(record.model) || readString(record.id)
        if (!modelId) return null
        return {
          id: modelId,
          name: readString(record.name) || modelId,
          provider: readString(record.provider) || 'unknown',
        }
      })
      .filter((entry): entry is ModelEntry => entry !== null)
  } catch {
    return []
  }
}

const DEFAULT_ACCEPTED_TIMEOUT_S = 120
const DEFAULT_HANDOFF_TIMEOUT_S = 300

function readStreamTimeouts(): { streamAcceptedTimeoutMs: number; streamHandoffTimeoutMs: number } {
  let acceptedS = DEFAULT_ACCEPTED_TIMEOUT_S
  let handoffS = DEFAULT_HANDOFF_TIMEOUT_S
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const parsed = YAML.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
      const ws =
        parsed && typeof parsed === 'object' && typeof (parsed as Record<string, unknown>).workspace === 'object'
          ? ((parsed as Record<string, unknown>).workspace as Record<string, unknown>)
          : {}
      if (typeof ws.stream_accepted_timeout === 'number' && ws.stream_accepted_timeout > 0)
        acceptedS = ws.stream_accepted_timeout
      if (typeof ws.stream_handoff_timeout === 'number' && ws.stream_handoff_timeout > 0)
        handoffS = ws.stream_handoff_timeout
    }
  } catch {
    // fall through to defaults
  }
  const envAccepted = parseInt(process.env.STREAM_ACCEPTED_TIMEOUT_MS ?? '', 10)
  const envHandoff = parseInt(process.env.STREAM_HANDOFF_TIMEOUT_MS ?? '', 10)
  return {
    streamAcceptedTimeoutMs: Number.isFinite(envAccepted) && envAccepted > 0 ? envAccepted : acceptedS * 1000,
    streamHandoffTimeoutMs: Number.isFinite(envHandoff) && envHandoff > 0 ? envHandoff : handoffS * 1000,
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

/**
 * Fallback: fetch models from the hermes-agent /v1/models endpoint.
 */
async function fetchClaudeModels(): Promise<Array<ModelEntry>> {
  const headers: Record<string, string> = {}
  if (BEARER_TOKEN) headers['Authorization'] = `Bearer ${BEARER_TOKEN}`
  const response = await fetch(`${CLAUDE_API}/v1/models`, { headers })
  if (!response.ok)
    throw new Error(`Hermes models request failed (${response.status})`)
  const payload = asRecord(await response.json())
  const rawModels = Array.isArray(payload.data)
    ? payload.data
    : Array.isArray(payload.models)
      ? payload.models
      : []
  return rawModels
    .map(normalizeModel)
    .filter((e): e is ModelEntry => e !== null)
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
          // Primary: read user-configured models from ~/.hermes/models.json
          let models = readClaudeModelsJson()
          let source = 'models.json'

          // Ensure the default model from config.yaml is always first
          const defaultModel = readClaudeDefaultModel()
          if (defaultModel) {
            models = models.filter((m) => m.id !== defaultModel.id)
            models.unshift(defaultModel)
          }

          // Fallback: if no models.json, fetch from hermes-agent /v1/models
          if (models.length === 0 && getGatewayCapabilities().models) {
            models = await fetchClaudeModels()
            source = 'hermes-agent'
          }

          // Merge auto-discovered local models (Ollama, Atomic Chat, etc.)
          await ensureDiscovery()
          const localModels = getDiscoveredModels()
          const existingIds = new Set(models.map((m) => m.id))
          for (const m of localModels) {
            if (!existingIds.has(m.id)) {
              models.push(m)
              existingIds.add(m.id)
              ensureProviderInConfig(m.provider)
            }
          }
          models = enrichModelLimits(models, readModelLimitsCache())

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
