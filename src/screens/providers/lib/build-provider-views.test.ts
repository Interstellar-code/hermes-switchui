import { describe, expect, it } from 'vitest'

import { buildProviderViews } from './build-provider-views'
import type { BuildProviderViewsInput } from './provider-view'

function viewsById(input: BuildProviderViewsInput) {
  return new Map(buildProviderViews(input).map((view) => [view.id, view]))
}

describe('buildProviderViews', () => {
  it('lists every catalog provider as available when nothing is configured', () => {
    const views = buildProviderViews({})
    expect(views.length).toBeGreaterThan(18)
    expect(views.every((view) => view.status === 'available')).toBe(true)
    expect(views.every((view) => !view.inConfig)).toBe(true)
  })

  it('reads the providers block as the source of truth for "added"', () => {
    const view = viewsById({
      claudeConfig: {
        config: {
          providers: {
            manifest: {
              type: 'openai',
              base_url: 'https://interstellar-llm.example/v1',
              key_env: 'CUSTOM_API_KEY',
            },
          },
        },
      },
    }).get('manifest')

    expect(view).toMatchObject({
      inConfig: true,
      type: 'openai',
      baseUrl: 'https://interstellar-llm.example/v1',
      keyEnv: 'CUSTOM_API_KEY',
      status: 'needs-key',
    })
  })

  it('marks a configured provider ready once a credential is found', () => {
    const view = viewsById({
      claudeConfig: {
        config: {
          providers: { openrouter: { key_env: 'OPENROUTER_API_KEY' } },
        },
        providers: [
          {
            id: 'openrouter',
            configured: true,
            authSource: 'env',
            envKeys: ['OPENROUTER_API_KEY'],
            maskedKeys: { OPENROUTER_API_KEY: 'sk-o...1234' },
          },
        ],
      },
    }).get('openrouter')

    expect(view).toMatchObject({
      status: 'ready',
      configured: true,
      authSource: 'env',
      maskedKey: 'sk-o...1234',
    })
  })

  it('resolves credentials from /api/env for ids the config route does not cover', () => {
    // groq is absent from the server route's provider status list, so without
    // the env fallback it would render as needs-key despite having a key.
    const view = viewsById({
      claudeConfig: { config: { providers: { groq: {} } }, providers: [] },
      env: { GROQ_API_KEY: { is_set: true } },
    }).get('groq')

    expect(view).toMatchObject({
      status: 'ready',
      configured: true,
      authSource: 'env',
      envKey: 'GROQ_API_KEY',
    })
  })

  it('treats a lone synthetic `auto` row as an unknown model list, not one model', () => {
    const view = viewsById({
      claudeConfig: { config: { providers: { manifest: {} } } },
      models: {
        models: [{ id: 'auto', name: 'auto', provider: 'manifest' }],
        configuredProviders: ['manifest'],
      },
    }).get('manifest')

    expect(view?.modelsUnknown).toBe(true)
    expect(view?.modelCount).toBe(0)
    expect(view?.models).toEqual([])
  })

  it('counts real models and keeps their metadata', () => {
    const view = viewsById({
      claudeConfig: { config: { providers: { openrouter: {} } } },
      models: {
        models: [
          {
            id: 'glm-4.6',
            name: 'GLM 4.6',
            provider: 'openrouter',
            contextLength: 200_000,
          },
          { id: 'kimi-k2', provider: 'openrouter' },
        ],
      },
    }).get('openrouter')

    expect(view?.modelsUnknown).toBe(false)
    expect(view?.modelCount).toBe(2)
    expect(view?.models[0]).toEqual({
      id: 'glm-4.6',
      name: 'GLM 4.6',
      contextLength: 200_000,
    })
    // Falls back to the id when the payload carries no display name.
    expect(view?.models[1]).toEqual({ id: 'kimi-k2', name: 'kimi-k2' })
  })

  it('reports an unreachable local runtime as offline, outranking ready', () => {
    const views = viewsById({
      claudeConfig: { config: { providers: { ollama: {} } } },
      localProviders: { providers: [{ id: 'ollama', online: false }] },
    })
    expect(views.get('ollama')).toMatchObject({
      status: 'offline',
      origin: 'local',
      online: false,
      // Local runtimes authenticate by being reachable, not by holding a key.
      configured: true,
    })
  })

  it('reports a reachable local runtime as ready', () => {
    const view = viewsById({
      claudeConfig: { config: { providers: { ollama: {} } } },
      localProviders: { providers: [{ id: 'ollama', online: true }] },
    }).get('ollama')
    expect(view).toMatchObject({ status: 'ready', online: true })
  })

  it('active outranks every other status and carries the active model', () => {
    const view = viewsById({
      claudeConfig: {
        config: { providers: { manifest: {} } },
        activeProvider: 'manifest',
        activeModel: 'glm-4.6',
      },
    }).get('manifest')

    // Still credential-less, but "active" is what the user needs to see.
    expect(view).toMatchObject({
      status: 'active',
      isActive: true,
      activeModel: 'glm-4.6',
    })
  })

  it('normalizes ids so a mixed-case config key does not create a second row', () => {
    const views = buildProviderViews({
      claudeConfig: {
        config: {
          providers: { OpenRouter: { key_env: 'OPENROUTER_API_KEY' } },
        },
        activeProvider: 'OPENROUTER',
      },
      models: { models: [{ id: 'x', provider: 'openrouter' }] },
    })
    expect(views.filter((view) => view.id === 'openrouter')).toHaveLength(1)
    expect(views.find((view) => view.id === 'openrouter')?.status).toBe(
      'active',
    )
  })

  it('accepts custom_providers keyed by id or by name', () => {
    const views = viewsById({
      claudeConfig: {
        config: {
          custom_providers: [
            { id: 'by-id', base_url: 'https://a.example/v1' },
            { name: 'by-name', base_url: 'https://b.example/v1' },
          ],
        },
      },
    })
    expect(views.get('by-id')?.inConfig).toBe(true)
    expect(views.get('by-name')?.baseUrl).toBe('https://b.example/v1')
  })

  // Real installs define their provider inside the `model` block, with the key
  // stored inline in config.yaml rather than .env. Reading only `providers:`
  // reported such a setup as having no credential at all.
  describe('inline model-block providers', () => {
    const inlineConfig = {
      claudeConfig: {
        config: {
          model: {
            provider: 'custom',
            base_url: 'https://interstellar-llm.example/v1',
            api_key: 'sk-inline-secret',
            default: 'auto',
          },
        },
        activeProvider: 'custom',
        activeModel: 'auto',
        providers: [{ id: 'custom', configured: false, authSource: 'none' }],
      },
      models: {
        models: [{ id: 'auto', provider: 'custom' }],
        configuredProviders: ['custom'],
      },
    }

    it('treats the model block as a provider definition', () => {
      const view = viewsById(inlineConfig).get('custom')
      expect(view).toMatchObject({
        inConfig: true,
        configShape: 'inline-model',
        baseUrl: 'https://interstellar-llm.example/v1',
        status: 'active',
      })
    })

    it('recognises the inline api_key as a real credential', () => {
      const view = viewsById(inlineConfig).get('custom')
      expect(view?.configured).toBe(true)
      expect(view?.authSource).toBe('config-inline')
    })

    it('does not invent a credential when the inline key is absent', () => {
      const view = viewsById({
        claudeConfig: {
          config: { model: { provider: 'custom', base_url: 'https://x/v1' } },
        },
      }).get('custom')
      expect(view?.inConfig).toBe(true)
      expect(view?.configured).toBe(false)
      expect(view?.status).toBe('needs-key')
    })

    it('prefers the documented providers-map shape when both are present', () => {
      const view = viewsById({
        claudeConfig: {
          config: {
            providers: { manifest: { key_env: 'CUSTOM_API_KEY' } },
            model: { provider: 'manifest', api_key: 'sk-inline' },
          },
        },
      }).get('manifest')
      expect(view?.configShape).toBe('providers-map')
    })
  })

  it('sorts the most actionable rows first', () => {
    const order = buildProviderViews({
      claudeConfig: {
        config: {
          providers: { manifest: {}, ollama: {}, openrouter: {} },
        },
        providers: [{ id: 'openrouter', configured: true, authSource: 'env' }],
        activeProvider: 'openrouter',
      },
      localProviders: { providers: [{ id: 'ollama', online: false }] },
    })
      .slice(0, 3)
      .map((view) => view.status)

    expect(order).toEqual(['active', 'needs-key', 'offline'])
  })
})
