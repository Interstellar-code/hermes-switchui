export type ProviderAuthType = 'api-key' | 'oauth' | 'local' | 'cli-token'

export type ProviderInfo = {
  id: string
  name: string
  description: string
  authTypes: Array<ProviderAuthType>
  docsUrl: string
  configExample: string
}

export const CLAUDE_CONFIG_PATH = '~/.hermes/config.yaml'

export const PROVIDER_CATALOG: Array<ProviderInfo> = [
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
    description: 'Local LLMs via Atomic Chat — run Llama, Gemma, Qwen and more on your machine.',
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
]

export const CANONICAL_PROVIDER_IDS = PROVIDER_CATALOG.map((provider) => provider.id)

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
