/**
 * write-paths.ts — builds the exact `PATCH /api/claude-config` bodies the
 * provider screen sends. Pure functions so the payload shape is pinned by
 * unit tests rather than discovered in production.
 *
 * Why this shape: the gateway reads `model.{provider,default}` and
 * `providers.<id>.{type,base_url,key_env}`, with the credential living in
 * `~/.hermes/.env` (CLAUDE.md). The `auth.profiles.*` shape the old wizard
 * wrote is read by nothing.
 */
import {
  RESERVED_PROVIDER_ID,
  getProviderBaseUrl,
  getProviderEnvKey,
  normalizeProviderId,
  stripProviderPrefix,
} from '@/lib/provider-catalog'

export type ClaudeConfigPatch = {
  config?: Record<string, unknown>
  env?: Record<string, string>
}

export type ProviderDraft = {
  id: string
  baseUrl?: string
  /** Env var to hold the key. Defaults to the catalog's canonical name. */
  envKey?: string
  /** Omit or leave blank to keep the existing credential untouched. */
  apiKey?: string
  /** Provider type the gateway dispatches on. Practically always `openai`. */
  type?: string
  makeActive?: boolean
  defaultModel?: string
}

export class ProviderWriteError extends Error {}

function requireValidId(
  rawId: string,
  options: { allowReserved?: boolean } = {},
): string {
  const id = normalizeProviderId(rawId)
  if (!id) throw new ProviderWriteError('Provider id is required')
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id)) {
    throw new ProviderWriteError(`Invalid provider id: ${rawId}`)
  }
  if (id === RESERVED_PROVIDER_ID && !options.allowReserved) {
    // Only the named-provider lookup rejects this id: `providers: { custom: … }`
    // resolves to None in the gateway. The inline `model.provider: custom`
    // form is a different code path and works — existing installs rely on it —
    // so edits to those are allowed through.
    throw new ProviderWriteError(
      'The id "custom" is reserved by the gateway — use "manifest" instead.',
    )
  }
  return id
}

/**
 * Add or update a provider. Used for both create and edit: the merge is
 * additive, so an edit that omits `apiKey` leaves the stored credential alone.
 */
export function buildProviderPatch(draft: ProviderDraft): ClaudeConfigPatch {
  const id = requireValidId(draft.id)
  const envKey = draft.envKey?.trim() || getProviderEnvKey(id) || undefined
  const baseUrl = draft.baseUrl?.trim() || getProviderBaseUrl(id) || undefined

  const providerEntry: Record<string, unknown> = {
    type: draft.type ?? 'openai',
  }
  if (baseUrl) providerEntry.base_url = baseUrl
  if (envKey) providerEntry.key_env = envKey

  const config: Record<string, unknown> = { providers: { [id]: providerEntry } }

  if (draft.makeActive) {
    config.model = {
      provider: id,
      default: stripProviderPrefix(draft.defaultModel?.trim() || 'auto'),
    }
  }

  const patch: ClaudeConfigPatch = { config }

  // A blank key means "don't touch it" — sending an empty string would delete
  // the existing var (see the env handling in claude-config.ts).
  const apiKey = draft.apiKey?.trim()
  if (apiKey) {
    if (!envKey) {
      throw new ProviderWriteError(
        `No env var name for provider "${id}" — supply one to store the key.`,
      )
    }
    patch.env = { [envKey]: apiKey }
  }

  return patch
}

/**
 * Update a provider that lives inline in the `model` block rather than in the
 * `providers` map. Writing a `providers.<id>` entry for one of these would
 * leave two definitions in config.yaml, and the gateway reads the inline one.
 *
 * The credential stays where it already is — inline `model.api_key` — because
 * moving it to `.env` mid-edit would silently change which value the gateway
 * picks up.
 */
export function buildInlineProviderPatch(
  draft: ProviderDraft,
): ClaudeConfigPatch {
  const id = requireValidId(draft.id, { allowReserved: true })
  const model: Record<string, unknown> = { provider: id }

  const baseUrl = draft.baseUrl?.trim()
  if (baseUrl) model.base_url = baseUrl

  const apiKey = draft.apiKey?.trim()
  if (apiKey) model.api_key = apiKey

  const defaultModel = draft.defaultModel?.trim()
  if (defaultModel) model.default = stripProviderPrefix(defaultModel)

  return { config: { model } }
}

/**
 * Rename the env var holding a provider's key: write the new one and clear the
 * old. `''` is the documented delete signal for the env map.
 */
export function buildEnvKeyRenamePatch(
  oldKey: string,
  newKey: string,
  value: string,
): ClaudeConfigPatch {
  const from = oldKey.trim()
  const to = newKey.trim()
  if (!to) throw new ProviderWriteError('New env var name is required')
  if (!value.trim()) {
    throw new ProviderWriteError('Renaming an env var needs the key value')
  }
  const env: Record<string, string> = { [to]: value.trim() }
  if (from && from !== to) env[from] = ''
  return { env }
}

/**
 * Point the gateway at a provider/model pair. Reserved ids are allowed here:
 * this activates a provider that already exists rather than creating one, and
 * installs using the inline `model.provider: custom` form must stay switchable.
 */
export function buildSetActivePatch(
  providerId: string,
  model?: string,
): ClaudeConfigPatch {
  const id = requireValidId(providerId, { allowReserved: true })
  return {
    config: {
      model: {
        provider: id,
        default: stripProviderPrefix(model?.trim() || 'auto'),
      },
    },
  }
}
