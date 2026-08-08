export type ProviderAuthType = 'api-key' | 'oauth' | 'local' | 'cli-token'

export type ProviderOrigin = 'hosted' | 'local'

export type ProviderInfo = {
  id: string
  name: string
  description: string
  authTypes: Array<ProviderAuthType>
  docsUrl: string
  configExample: string
  /**
   * Canonical env var holding this provider's credential, written to
   * `~/.hermes/.env` and referenced from `providers.<id>.key_env`.
   * Absent for OAuth/CLI-token/local providers, which carry no key.
   */
  envKey?: string
  /** Legacy env var names still honoured when detecting an existing key. */
  envKeyAliases?: Array<string>
  /** Default `providers.<id>.base_url`. Omitted where there is no stable default. */
  baseUrl?: string
  origin?: ProviderOrigin
}

export const CLAUDE_CONFIG_PATH = '~/.hermes/config.yaml'

/**
 * Connection facts, kept in one table rather than sprinkled through the
 * catalog literals below — this is the data the provider UI and the server
 * config route both read, and it is the part most likely to need edits.
 *
 * A provider is deliberately absent from `baseUrl` when there is no single
 * stable default; the UI then shows an empty field rather than a wrong guess.
 */
const PROVIDER_CONNECTION: Record<
  string,
  Pick<ProviderInfo, 'envKey' | 'envKeyAliases' | 'baseUrl' | 'origin'>
> = {
  anthropic: {
    envKey: 'ANTHROPIC_API_KEY',
    baseUrl: 'https://api.anthropic.com/v1',
  },
  openai: { envKey: 'OPENAI_API_KEY', baseUrl: 'https://api.openai.com/v1' },
  google: {
    envKey: 'GEMINI_API_KEY',
    envKeyAliases: ['GOOGLE_API_KEY'],
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  },
  openrouter: {
    envKey: 'OPENROUTER_API_KEY',
    baseUrl: 'https://openrouter.ai/api/v1',
  },
  'github-copilot': {},
  mistral: { envKey: 'MISTRAL_API_KEY', baseUrl: 'https://api.mistral.ai/v1' },
  deepseek: {
    envKey: 'DEEPSEEK_API_KEY',
    baseUrl: 'https://api.deepseek.com/v1',
  },
  minimax: { envKey: 'MINIMAX_API_KEY' },
  groq: { envKey: 'GROQ_API_KEY', baseUrl: 'https://api.groq.com/openai/v1' },
  xai: { envKey: 'XAI_API_KEY', baseUrl: 'https://api.x.ai/v1' },
  perplexity: {
    envKey: 'PERPLEXITY_API_KEY',
    baseUrl: 'https://api.perplexity.ai',
  },
  cohere: { envKey: 'COHERE_API_KEY' },
  together: {
    envKey: 'TOGETHER_API_KEY',
    baseUrl: 'https://api.together.xyz/v1',
  },
  fireworks: {
    envKey: 'FIREWORKS_API_KEY',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
  },
  'openai-codex': {},
  vertex: {},
  ollama: { origin: 'local', baseUrl: 'http://127.0.0.1:11434/v1' },
  'atomic-chat': { origin: 'local', baseUrl: 'http://127.0.0.1:1337/v1' },
  nous: {},
  zai: { envKey: 'GLM_API_KEY' },
  'kimi-coding': { envKey: 'KIMI_API_KEY' },
  'minimax-cn': { envKey: 'MINIMAX_CN_API_KEY' },
  xiaomi: { envKey: 'XIAOMI_API_KEY' },
  manifest: { envKey: 'CUSTOM_API_KEY' },
}

/** Config snippet in the shape the gateway actually reads. */
function buildProvidersExample(id: string, keyEnv: string): string {
  return JSON.stringify(
    {
      model: { provider: id, default: 'auto' },
      providers: {
        [id]: {
          type: 'openai',
          base_url: 'https://your-endpoint/v1',
          key_env: keyEnv,
        },
      },
    },
    null,
    2,
  )
}

const RAW_PROVIDER_CATALOG: Array<ProviderInfo> = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude models — Haiku, Sonnet, and Opus.',
    authTypes: ['api-key', 'cli-token'],
    docsUrl: 'https://console.anthropic.com/settings/keys',
    configExample: JSON.stringify(
      {
        auth: {
          profiles: {
            'anthropic:default': {
              provider: 'anthropic',
              apiKey: 'sk-your-key-here',
            },
          },
        },
      },
      null,
      2,
    ),
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT and reasoning models for chat and tools.',
    authTypes: ['api-key'],
    docsUrl: 'https://platform.openai.com/api-keys',
    configExample: JSON.stringify(
      {
        auth: {
          profiles: {
            'openai:default': {
              provider: 'openai',
              apiKey: 'sk-your-key-here',
            },
          },
        },
      },
      null,
      2,
    ),
  },
  {
    id: 'google',
    name: 'Google',
    description: 'Gemini models with API key or OAuth.',
    authTypes: ['api-key', 'oauth'],
    docsUrl: 'https://aistudio.google.com/app/apikey',
    configExample: JSON.stringify(
      {
        auth: {
          profiles: {
            'google:default': {
              provider: 'google',
              apiKey: 'sk-your-key-here',
            },
          },
        },
      },
      null,
      2,
    ),
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Unified access to many providers through one API.',
    authTypes: ['api-key'],
    docsUrl: 'https://openrouter.ai/keys',
    configExample: JSON.stringify(
      {
        auth: {
          profiles: {
            'openrouter:default': {
              provider: 'openrouter',
              apiKey: 'sk-your-key-here',
            },
          },
        },
      },
      null,
      2,
    ),
  },
  {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    description: 'Copilot chat/model access through your GitHub account token.',
    authTypes: ['cli-token'],
    docsUrl: 'https://github.com/features/copilot',
    configExample: JSON.stringify(
      {
        auth: {
          profiles: {
            'github-copilot:default': {
              provider: 'github-copilot',
              token: 'ghu_your_token_here',
            },
          },
        },
      },
      null,
      2,
    ),
  },
  {
    id: 'mistral',
    name: 'Mistral',
    description: 'Mistral chat and coding models.',
    authTypes: ['api-key'],
    docsUrl: 'https://console.mistral.ai/api-keys/',
    configExample: JSON.stringify(
      {
        auth: {
          profiles: {
            'mistral:default': {
              provider: 'mistral',
              apiKey: 'sk-your-key-here',
            },
          },
        },
      },
      null,
      2,
    ),
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    description: 'DeepSeek reasoning and chat models.',
    authTypes: ['api-key'],
    docsUrl: 'https://platform.deepseek.com/api_keys',
    configExample: JSON.stringify(
      {
        auth: {
          profiles: {
            'deepseek:default': {
              provider: 'deepseek',
              apiKey: 'sk-your-key-here',
            },
          },
        },
      },
      null,
      2,
    ),
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    description: 'MiniMax foundation models and multimodal APIs.',
    authTypes: ['api-key'],
    docsUrl: 'https://www.minimax.io/platform',
    configExample: JSON.stringify(
      {
        auth: {
          profiles: {
            'minimax:default': {
              provider: 'minimax',
              apiKey: 'sk-your-key-here',
            },
          },
        },
      },
      null,
      2,
    ),
  },
  {
    id: 'groq',
    name: 'Groq',
    description: 'Fast hosted inference for Llama, Mixtral, and more.',
    authTypes: ['api-key'],
    docsUrl: 'https://console.groq.com/keys',
    configExample: JSON.stringify(
      {
        auth: {
          profiles: {
            'groq:default': {
              provider: 'groq',
              apiKey: 'gsk_your_key_here',
            },
          },
        },
      },
      null,
      2,
    ),
  },
  {
    id: 'xai',
    name: 'xAI',
    description: 'Grok models from xAI.',
    authTypes: ['api-key'],
    docsUrl: 'https://console.x.ai/',
    configExample: JSON.stringify(
      {
        auth: {
          profiles: {
            'xai:default': {
              provider: 'xai',
              apiKey: 'xai-your-key-here',
            },
          },
        },
      },
      null,
      2,
    ),
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    description: 'Perplexity Sonar search-augmented models.',
    authTypes: ['api-key'],
    docsUrl: 'https://www.perplexity.ai/settings/api',
    configExample: JSON.stringify(
      {
        auth: {
          profiles: {
            'perplexity:default': {
              provider: 'perplexity',
              apiKey: 'pplx-your-key-here',
            },
          },
        },
      },
      null,
      2,
    ),
  },
  {
    id: 'cohere',
    name: 'Cohere',
    description: 'Cohere Command models and embeddings.',
    authTypes: ['api-key'],
    docsUrl: 'https://dashboard.cohere.com/api-keys',
    configExample: JSON.stringify(
      {
        auth: {
          profiles: {
            'cohere:default': {
              provider: 'cohere',
              apiKey: 'co-your-key-here',
            },
          },
        },
      },
      null,
      2,
    ),
  },
  {
    id: 'together',
    name: 'Together AI',
    description: 'Hosted open-weight models through Together.',
    authTypes: ['api-key'],
    docsUrl: 'https://api.together.ai/settings/api-keys',
    configExample: JSON.stringify(
      {
        auth: {
          profiles: {
            'together:default': {
              provider: 'together',
              apiKey: 'your-key-here',
            },
          },
        },
      },
      null,
      2,
    ),
  },
  {
    id: 'fireworks',
    name: 'Fireworks',
    description: 'Hosted fast open models through Fireworks AI.',
    authTypes: ['api-key'],
    docsUrl: 'https://fireworks.ai/account/api-keys',
    configExample: JSON.stringify(
      {
        auth: {
          profiles: {
            'fireworks:default': {
              provider: 'fireworks',
              apiKey: 'fw-your-key-here',
            },
          },
        },
      },
      null,
      2,
    ),
  },
  {
    id: 'openai-codex',
    name: 'OpenAI Codex',
    description: 'Codex-specific OpenAI routing surface used by Hermes.',
    authTypes: ['cli-token'],
    docsUrl: 'https://platform.openai.com/',
    configExample: JSON.stringify(
      {
        auth: {
          profiles: {
            'openai-codex:default': {
              provider: 'openai-codex',
              token: 'sk-your-token-here',
            },
          },
        },
      },
      null,
      2,
    ),
  },
  {
    id: 'vertex',
    name: 'Vertex AI',
    description: 'Google Vertex AI hosted Gemini access.',
    authTypes: ['oauth'],
    docsUrl: 'https://cloud.google.com/vertex-ai',
    configExample: JSON.stringify(
      {
        auth: {
          profiles: {
            'vertex:default': {
              provider: 'vertex',
              oauth: {
                enabled: true,
              },
            },
          },
        },
      },
      null,
      2,
    ),
  },
  {
    id: 'ollama',
    name: 'Ollama',
    description: 'Local models running on your machine via Ollama.',
    authTypes: ['local'],
    docsUrl: 'https://ollama.com/download',
    configExample: JSON.stringify(
      {
        auth: {
          profiles: {
            'ollama:local': {
              provider: 'ollama',
            },
          },
        },
      },
      null,
      2,
    ),
  },
  {
    id: 'atomic-chat',
    name: 'Atomic Chat',
    description:
      'Local LLMs via Atomic Chat — run Llama, Gemma, Qwen and more on your machine.',
    authTypes: ['local'],
    docsUrl: 'https://atomic.chat',
    configExample: JSON.stringify(
      {
        auth: {
          profiles: {
            'atomic-chat:local': {
              provider: 'atomic-chat',
            },
          },
        },
      },
      null,
      2,
    ),
  },
  // ── Providers the gateway has always known but the catalog did not ──────
  // These ids were previously hardcoded server-side in
  // src/routes/api/claude-config.ts, which left them nameless in the UI.
  // Their configExample uses the `providers.<id>` shape the gateway actually
  // reads (see CLAUDE.md), not the legacy `auth.profiles` shape above.
  {
    id: 'nous',
    name: 'Nous Portal',
    description: 'Hermes models via Nous Portal — free with a browser sign-in.',
    authTypes: ['oauth'],
    docsUrl: 'https://portal.nousresearch.com',
    configExample: JSON.stringify({ model: { provider: 'nous' } }, null, 2),
  },
  {
    id: 'zai',
    name: 'Z.AI / GLM',
    description: 'GLM models from Z.AI.',
    authTypes: ['api-key'],
    docsUrl: 'https://open.bigmodel.cn',
    configExample: buildProvidersExample('zai', 'GLM_API_KEY'),
  },
  {
    id: 'kimi-coding',
    name: 'Kimi / Moonshot',
    description: 'Moonshot Kimi models tuned for coding.',
    authTypes: ['api-key'],
    docsUrl: 'https://platform.moonshot.cn',
    configExample: buildProvidersExample('kimi-coding', 'KIMI_API_KEY'),
  },
  {
    id: 'minimax-cn',
    name: 'MiniMax (China)',
    description: 'MiniMax models on the mainland-China endpoint.',
    authTypes: ['api-key'],
    docsUrl: 'https://platform.minimaxi.com',
    configExample: buildProvidersExample('minimax-cn', 'MINIMAX_CN_API_KEY'),
  },
  {
    id: 'xiaomi',
    name: 'Xiaomi MiMo',
    description: 'Xiaomi MiMo models.',
    authTypes: ['api-key'],
    docsUrl: 'https://xiaomimimo.com',
    configExample: buildProvidersExample('xiaomi', 'XIAOMI_API_KEY'),
  },
  {
    id: 'manifest',
    name: 'Custom (OpenAI-compatible)',
    description:
      'Any OpenAI-compatible endpoint. Named `manifest` because the gateway ' +
      'reserves `custom` as a type name and will not resolve a provider called that.',
    authTypes: ['api-key'],
    docsUrl: 'https://platform.openai.com/docs/api-reference',
    configExample: buildProvidersExample('manifest', 'CUSTOM_API_KEY'),
  },
]

/**
 * The catalog as consumed everywhere: literals above merged with the
 * connection table. Kept separate so connection facts stay in one readable
 * place instead of scattered across 24 object literals.
 */
export const PROVIDER_CATALOG: Array<ProviderInfo> = RAW_PROVIDER_CATALOG.map(
  (provider) => ({ ...provider, ...PROVIDER_CONNECTION[provider.id] }),
)

export const CANONICAL_PROVIDER_IDS = PROVIDER_CATALOG.map(
  (provider) => provider.id,
)

/**
 * Provider id the gateway refuses to resolve — `_get_named_custom_provider`
 * returns None for it. Use `manifest` instead. See CLAUDE.md.
 */
export const RESERVED_PROVIDER_ID = 'custom'

export function normalizeProviderId(value: string): string {
  return value.trim().toLowerCase()
}

export function getProviderInfo(providerId: string): ProviderInfo | null {
  const normalized = normalizeProviderId(providerId)
  for (const provider of PROVIDER_CATALOG) {
    if (provider.id === normalized) return provider
  }
  return null
}

export function getProviderDisplayName(providerId: string): string {
  const provider = getProviderInfo(providerId)
  if (provider) return provider.name

  const normalized = normalizeProviderId(providerId)
  if (!normalized) return 'Unknown Provider'

  return normalized
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(function mapChunk(chunk) {
      return chunk.slice(0, 1).toUpperCase() + chunk.slice(1)
    })
    .join(' ')
}

/** Canonical env var for a provider's credential, or null if it needs none. */
export function getProviderEnvKey(providerId: string): string | null {
  return getProviderInfo(providerId)?.envKey ?? null
}

/** Every env var that may hold this provider's credential, newest name first. */
export function getProviderEnvKeys(providerId: string): Array<string> {
  const provider = getProviderInfo(providerId)
  if (!provider?.envKey) return []
  return [provider.envKey, ...(provider.envKeyAliases ?? [])]
}

/** Default base URL, or null where the provider has no stable default. */
export function getProviderBaseUrl(providerId: string): string | null {
  return getProviderInfo(providerId)?.baseUrl ?? null
}

/**
 * Strip the provider prefix hermes-agent adds internally via litellm:
 *   "openrouter/nvidia/nemotron-x" → "nvidia/nemotron-x"
 *   "anthropic/claude-sonnet-4-6"  → "claude-sonnet-4-6"
 * Only the first segment is removed, and only when it names a known provider —
 * so a bare "nvidia/model" is left intact.
 */
export function stripProviderPrefix(model: string): string {
  if (!model) return model
  const slash = model.indexOf('/')
  if (slash === -1) return model
  const prefix = normalizeProviderId(model.slice(0, slash))
  return CANONICAL_PROVIDER_IDS.includes(prefix)
    ? model.slice(slash + 1)
    : model
}

export function getAuthTypeLabel(authType: ProviderAuthType): string {
  if (authType === 'api-key') return 'API Key'
  if (authType === 'oauth') return 'OAuth'
  if (authType === 'cli-token') return 'CLI Token'
  return 'Local'
}

export function buildConfigExample(
  provider: ProviderInfo,
  authType: ProviderAuthType,
): string {
  const profileKey =
    authType === 'local' ? `${provider.id}:local` : `${provider.id}:default`

  if (authType === 'oauth') {
    return JSON.stringify(
      {
        auth: {
          profiles: {
            [profileKey]: {
              provider: provider.id,
              oauth: {
                enabled: true,
              },
            },
          },
        },
      },
      null,
      2,
    )
  }

  if (authType === 'local') {
    return JSON.stringify(
      {
        auth: {
          profiles: {
            [profileKey]: {
              provider: provider.id,
            },
          },
        },
      },
      null,
      2,
    )
  }

  return provider.configExample
}
