import { describe, expect, it } from 'vitest'

import {
  ProviderWriteError,
  buildEnvKeyRenamePatch,
  buildInlineProviderPatch,
  buildProviderPatch,
  buildSetActivePatch,
} from './write-paths'

describe('buildProviderPatch', () => {
  it('writes the providers block and the key the gateway reads', () => {
    expect(
      buildProviderPatch({
        id: 'openrouter',
        apiKey: 'sk-or-secret',
      }),
    ).toEqual({
      config: {
        providers: {
          openrouter: {
            type: 'openai',
            base_url: 'https://openrouter.ai/api/v1',
            key_env: 'OPENROUTER_API_KEY',
          },
        },
      },
      env: { OPENROUTER_API_KEY: 'sk-or-secret' },
    })
  })

  it('sets the active model only when asked, stripping the provider prefix', () => {
    const patch = buildProviderPatch({
      id: 'anthropic',
      apiKey: 'sk-ant',
      makeActive: true,
      defaultModel: 'anthropic/claude-sonnet-4-6',
    })
    expect(patch.config?.model).toEqual({
      provider: 'anthropic',
      default: 'claude-sonnet-4-6',
    })
  })

  it('omits the model block when not activating', () => {
    const patch = buildProviderPatch({ id: 'groq', apiKey: 'gsk' })
    expect(patch.config?.model).toBeUndefined()
  })

  it('omits env entirely when the key is blank, so an edit keeps the stored one', () => {
    expect(
      buildProviderPatch({ id: 'groq', apiKey: '   ' }).env,
    ).toBeUndefined()
    expect(buildProviderPatch({ id: 'groq' }).env).toBeUndefined()
  })

  it('honours an explicit base URL and env var over the catalog defaults', () => {
    const patch = buildProviderPatch({
      id: 'manifest',
      baseUrl: 'https://interstellar-llm.example/v1',
      envKey: 'MY_KEY',
      apiKey: 'abc',
    })
    expect(patch.config?.providers).toEqual({
      manifest: {
        type: 'openai',
        base_url: 'https://interstellar-llm.example/v1',
        key_env: 'MY_KEY',
      },
    })
    expect(patch.env).toEqual({ MY_KEY: 'abc' })
  })

  it('rejects the reserved id the gateway cannot resolve', () => {
    expect(() => buildProviderPatch({ id: 'custom' })).toThrow(
      ProviderWriteError,
    )
    expect(() => buildProviderPatch({ id: 'CUSTOM' })).toThrow(/manifest/)
  })

  it('rejects malformed and empty ids', () => {
    expect(() => buildProviderPatch({ id: '' })).toThrow(ProviderWriteError)
    expect(() => buildProviderPatch({ id: 'has space' })).toThrow(
      ProviderWriteError,
    )
    expect(() => buildProviderPatch({ id: '-leading' })).toThrow(
      ProviderWriteError,
    )
  })

  it('refuses to drop a key on the floor when no env var name is known', () => {
    expect(() =>
      buildProviderPatch({ id: 'vertex', apiKey: 'secret' }),
    ).toThrow(/env var/i)
  })
})

describe('buildInlineProviderPatch', () => {
  it('patches the model block in place rather than adding a providers entry', () => {
    const patch = buildInlineProviderPatch({
      id: 'custom',
      baseUrl: 'https://interstellar-llm.example/v1',
      apiKey: 'sk-inline',
      defaultModel: 'auto',
    })
    expect(patch).toEqual({
      config: {
        model: {
          provider: 'custom',
          base_url: 'https://interstellar-llm.example/v1',
          api_key: 'sk-inline',
          default: 'auto',
        },
      },
    })
    // Adding one would leave two definitions, and the gateway reads the inline one.
    expect(patch.config?.providers).toBeUndefined()
    expect(patch.env).toBeUndefined()
  })

  it('leaves the stored key alone when none is supplied', () => {
    const patch = buildInlineProviderPatch({
      id: 'custom',
      baseUrl: 'https://x/v1',
    })
    expect(patch.config?.model).toEqual({
      provider: 'custom',
      base_url: 'https://x/v1',
    })
  })

  it('allows the reserved id, which works in this shape', () => {
    expect(() => buildInlineProviderPatch({ id: 'custom' })).not.toThrow()
  })
})

describe('buildEnvKeyRenamePatch', () => {
  it('writes the new var and clears the old one', () => {
    expect(buildEnvKeyRenamePatch('OLD_KEY', 'NEW_KEY', 'sk-live')).toEqual({
      env: { NEW_KEY: 'sk-live', OLD_KEY: '' },
    })
  })

  it('does not clear the var when the name is unchanged', () => {
    expect(buildEnvKeyRenamePatch('SAME', 'SAME', 'sk-live')).toEqual({
      env: { SAME: 'sk-live' },
    })
  })

  it('requires a value, since a rename cannot recover the old secret', () => {
    expect(() => buildEnvKeyRenamePatch('OLD', 'NEW', '')).toThrow(
      ProviderWriteError,
    )
  })
})

describe('buildSetActivePatch', () => {
  it('defaults to auto', () => {
    expect(buildSetActivePatch('ollama')).toEqual({
      config: { model: { provider: 'ollama', default: 'auto' } },
    })
  })

  it('strips a known provider prefix but leaves unrelated slashes alone', () => {
    expect(
      buildSetActivePatch('openrouter', 'openrouter/nvidia/nemotron'),
    ).toEqual({
      config: {
        model: { provider: 'openrouter', default: 'nvidia/nemotron' },
      },
    })
    expect(buildSetActivePatch('openrouter', 'nvidia/nemotron')).toEqual({
      config: { model: { provider: 'openrouter', default: 'nvidia/nemotron' } },
    })
  })
})
