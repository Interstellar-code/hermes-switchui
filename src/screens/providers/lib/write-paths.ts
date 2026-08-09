/**
 * write-paths.ts — builds the exact `PATCH /api/claude-config` bodies the
 * provider screen sends. Pure functions so the payload shape is pinned by
 * unit tests rather than discovered in production.
 *
 * Why this shape: the gateway reads `model.{provider,default}` and
 * `providers.<id>.{base_url,key_env}`, with the credential living in
 * `~/.hermes/.env` (CLAUDE.md). The `auth.profiles.*` shape the old wizard
 * wrote is read by nothing.
 *
 * Two things this used to write that the gateway silently discards, both
 * removed here because "silently discards" and "reports success" together are
 * the worst combination a setup wizard can produce:
 *
 *  - **`type: openai`.** No gateway code path reads a `type` key off a
 *    `providers.<id>` entry — `_get_named_custom_provider`
 *    (`runtime_provider.py:656`) and `_normalize_custom_provider_entry`
 *    (`config.py:5020`) between them read `name`, `base_url`/`api`/`url`,
 *    `key_env`, `api_key`, `default_model`, `api_mode`/`transport`,
 *    `extra_body`, `extra_headers`, `max_output_tokens` and `enabled`. `type`
 *    was decoration that made the config look more configured than it was.
 *  - **A missing or empty `base_url`.** An entry whose URL does not parse to a
 *    scheme AND a host is dropped whole (`config.py:5075` returns `None`;
 *    `runtime_provider.py:683` only builds a runtime `if base_url`). The
 *    provider then does not exist as far as the gateway is concerned, while
 *    sitting in config.yaml looking configured.
 *
 *    Two different fixes, because there are two different cases. For a custom
 *    endpoint (`manifest`, or any id the catalog does not know) the URL is the
 *    whole point, so a save without one is refused with the reason. For a
 *    gateway built-in — Z.AI, Kimi, Copilot, Vertex, … — no `providers:` entry
 *    is written at all: the gateway resolves those from its own registry and
 *    ignores a user entry of the same name outright
 *    (`runtime_provider.py:640-655`), so the entry was never doing anything.
 *    Those are configured by their env key plus `model.provider`.
 */
import {
  RESERVED_PROVIDER_ID,
  getProviderBaseUrl,
  getProviderEnvKey,
  getProviderInfo,
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
  makeActive?: boolean
  defaultModel?: string
  /**
   * Write the credential inline as `providers.<id>.api_key` **as well as** to
   * `key_env`. Set only by the wizard's recovery path, after a save whose
   * `key_env` provably failed to resolve on the live gateway.
   *
   * `key_env` stays the default because it keeps the secret out of
   * config.yaml, out of the config preview, and out of profile exports. But
   * "correct by default" is worth nothing if the user is left with a provider
   * that cannot authenticate, and on this shape inline is the documented
   * fallback the gateway itself applies (`runtime_provider.py:674-679`:
   * `key_env` first, inline `api_key` second) — so writing both is safe and
   * the env copy still wins once it resolves.
   */
  inlineFallback?: boolean
}

/**
 * Is this a provider the gateway resolves from its own built-in registry, so
 * it needs no endpoint from us?
 *
 * Catalog membership is the test, with `manifest` carved out: `manifest` is
 * the catalog's *entry for* "any OpenAI-compatible endpoint", so it has no
 * canonical URL of its own and is useless without one. An id absent from the
 * catalog is a user-invented endpoint and equally needs a URL.
 */
function providerNeedsNoBaseUrl(id: string): boolean {
  return id !== 'manifest' && getProviderInfo(id) !== null
}

/** A URL the gateway will accept: it needs a scheme AND a host, or the whole
 *  provider entry is dropped at normalisation time. */
function isResolvableBaseUrl(value: string): boolean {
  // `${VAR}` placeholders are expanded later and pass normalisation as-is.
  if (/\{[^}]+\}/.test(value)) return true
  try {
    const parsed = new URL(value)
    return Boolean(parsed.protocol && parsed.host)
  } catch {
    return false
  }
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

  if (baseUrl && !isResolvableBaseUrl(baseUrl)) {
    throw new ProviderWriteError(
      `"${baseUrl}" is not a usable base URL — it needs a scheme and a host ` +
        `(e.g. https://api.example.com/v1). The gateway skips entries whose ` +
        `URL does not parse.`,
    )
  }
  if (!baseUrl && !providerNeedsNoBaseUrl(id)) {
    throw new ProviderWriteError(
      `"${id}" needs a base URL. The gateway drops a providers entry that has ` +
        `no parseable URL, so saving without one would report success and ` +
        `change nothing.`,
    )
  }

  const providerEntry: Record<string, unknown> = {}
  const config: Record<string, unknown> = {}

  // A gateway built-in already knows its own endpoint, and
  // `_get_named_custom_provider` returns None for it outright
  // (runtime_provider.py:640-655: a name that resolves to itself defers to the
  // built-in). Writing a `providers.<id>` entry for one is inert clutter, and
  // an entry with no URL would be dropped anyway. Such a provider is
  // configured by its env key plus `model.provider`, which is what we write.
  if (baseUrl) {
    providerEntry.base_url = baseUrl
    if (envKey) providerEntry.key_env = envKey
    config.providers = { [id]: providerEntry }
  }

  if (draft.makeActive) {
    config.model = {
      provider: id,
      default: stripProviderPrefix(draft.defaultModel?.trim() || 'auto'),
    }
  }

  const patch: ClaudeConfigPatch =
    Object.keys(config).length > 0 ? { config } : {}

  // A blank key means "don't touch it" — sending an empty string would delete
  // the existing var (see the env handling in claude-config.ts).
  const apiKey = draft.apiKey?.trim()
  if (apiKey) {
    if (!envKey && !draft.inlineFallback) {
      throw new ProviderWriteError(
        `No env var name for provider "${id}" — supply one to store the key.`,
      )
    }
    if (envKey) patch.env = { [envKey]: apiKey }
    if (draft.inlineFallback) {
      if (!config.providers) {
        throw new ProviderWriteError(
          `"${id}" is a gateway built-in with no providers entry, so there is ` +
            `nowhere to store an inline key. Set ${envKey ?? 'its env var'} instead.`,
        )
      }
      providerEntry.api_key = apiKey
    }
  } else if (draft.inlineFallback) {
    throw new ProviderWriteError(
      'The inline fallback needs the key value — re-enter it and retry.',
    )
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
