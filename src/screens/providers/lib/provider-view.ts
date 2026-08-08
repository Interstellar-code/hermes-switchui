/**
 * provider-view.ts — the view model behind the Providers inventory screen.
 *
 * A provider's truth is spread across four endpoints and a static catalog.
 * These types name the shape of each source and the single merged row the UI
 * renders, so the merge itself (build-provider-views.ts) stays pure and
 * testable with no React or fetch in sight.
 */
import type { ProviderAuthType, ProviderOrigin } from '@/lib/provider-catalog'

export type ProviderStatus =
  /** The provider the gateway will actually use. */
  | 'active'
  /** In config.yaml with a credential present. */
  | 'ready'
  /** In config.yaml but no credential found. */
  | 'needs-key'
  /** Local runtime that is configured but not answering. */
  | 'offline'
  /** Known to the catalog, not yet added to config.yaml. */
  | 'available'

export type ProviderModel = {
  id: string
  name: string
  contextLength?: number
}

/**
 * How this provider is expressed in config.yaml. Real installs use both, and
 * an edit has to write back to the shape that is already there — adding a
 * `providers:` entry beside an inline `model:` block would create a second
 * definition the gateway does not read.
 */
export type ProviderConfigShape =
  /** `providers: { <id>: { type, base_url, key_env } }` — the documented shape. */
  | 'providers-map'
  /** `model: { provider, base_url, api_key, default }` — key inline in config.yaml. */
  | 'inline-model'
  /** Not in config.yaml at all. */
  | 'none'

export type ProviderView = {
  id: string
  name: string
  description: string
  docsUrl: string | null
  origin: ProviderOrigin
  authKind: ProviderAuthType

  /** Defined in config.yaml — i.e. the user has added it. */
  inConfig: boolean
  configShape: ProviderConfigShape
  type: string | null
  baseUrl: string | null
  keyEnv: string | null

  /** A credential was found — in `.env`, the auth store, or config.yaml. */
  configured: boolean
  authSource: 'env' | 'claude-auth-store' | 'config-inline' | 'none'
  envKey: string | null
  maskedKey: string | null

  models: Array<ProviderModel>
  modelCount: number
  /**
   * True when the gateway reports only the synthetic `auto` entry, which
   * means "configured but the model list is unknown" — typically a gateway
   * that has not been restarted since the provider was added.
   */
  modelsUnknown: boolean

  /** Local runtimes only; null for hosted providers. */
  online: boolean | null

  isActive: boolean
  activeModel: string | null
  status: ProviderStatus
}

// ── Source payload shapes (only the fields the merge reads) ─────────────────

export type ClaudeConfigProviderStatus = {
  id?: string
  name?: string
  authType?: string
  envKeys?: Array<string>
  configured?: boolean
  authSource?: string
  maskedKeys?: Record<string, string>
}

export type ClaudeConfigPayload = {
  config?: Record<string, unknown>
  providers?: Array<ClaudeConfigProviderStatus>
  activeProvider?: string
  activeModel?: string
}

export type ModelsPayload = {
  models?: Array<{
    id?: string
    name?: string
    provider?: string
    contextLength?: number
  }>
  configuredProviders?: Array<string>
}

export type LocalProvidersPayload = {
  providers?: Array<{ id?: string; online?: boolean }>
}

/** Shape of `GET /api/env` — see EnvVarInfo in src/lib/hermes-client.ts. */
export type EnvPayload = Record<string, { is_set?: boolean }>

export type BuildProviderViewsInput = {
  claudeConfig?: ClaudeConfigPayload | null
  models?: ModelsPayload | null
  localProviders?: LocalProvidersPayload | null
  env?: EnvPayload | null
}
