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
      buildProviderPatch({
        id: 'vertex',
        baseUrl: 'https://vertex.example/v1',
        apiKey: 'secret',
      }),
    ).toThrow(/env var/i)
  })

  // The gateway drops a `providers.<id>` entry whose URL does not parse
  // (config.py:5075 returns None), so a save without one is a no-op that
  // reports success. For a custom endpoint the URL is the whole point.
  it('refuses a custom endpoint with no base URL at all', () => {
    expect(() => buildProviderPatch({ id: 'manifest' })).toThrow(
      /needs a base URL/i,
    )
  })

  // …but a gateway built-in resolves from its own registry and IGNORES a
  // same-named user entry (runtime_provider.py:640-655), so writing one was
  // never doing anything. Configure it by env key + model.provider.
  it('writes no providers entry for a built-in with no base URL', () => {
    const patch = buildProviderPatch({
      id: 'zai',
      apiKey: 'sk-zai',
      makeActive: true,
    })
    expect(patch.config?.providers).toBeUndefined()
    expect(patch.config?.model).toEqual({ provider: 'zai', default: 'auto' })
    expect(patch.env).toEqual({ GLM_API_KEY: 'sk-zai' })
  })

  it('refuses an inline fallback for a built-in, which has nowhere to put it', () => {
    expect(() =>
      buildProviderPatch({ id: 'zai', apiKey: 'sk-zai', inlineFallback: true }),
    ).toThrow(/nowhere to store an inline key/i)
  })

  it('refuses a base URL with no scheme or host', () => {
    expect(() =>
      buildProviderPatch({ id: 'manifest', baseUrl: 'localhost:8080/v1' }),
    ).toThrow(/scheme and a host/i)
  })

  // `type:` is read by no gateway code path — see the header comment in
  // write-paths.ts. Writing it made the entry look more configured than it was.
  it('does not write a type key', () => {
    const patch = buildProviderPatch({ id: 'openrouter' })
    const entry = (patch.config?.providers as Record<string, unknown>)
      .openrouter as Record<string, unknown>
    expect(entry).not.toHaveProperty('type')
  })

  // The wizard's recovery path after a live prompt proves `key_env` did not
  // resolve. Both copies are written: env still wins on this shape the moment
  // it resolves, so the fallback is not a one-way door.
  it('writes the key inline as well as to key_env under the inline fallback', () => {
    const patch = buildProviderPatch({
      id: 'manifest',
      baseUrl: 'https://x.example/v1',
      envKey: 'MY_KEY',
      apiKey: 'sk-live',
      inlineFallback: true,
    })
    expect(patch.config?.providers).toEqual({
      manifest: {
        base_url: 'https://x.example/v1',
        key_env: 'MY_KEY',
        api_key: 'sk-live',
      },
    })
    expect(patch.env).toEqual({ MY_KEY: 'sk-live' })
  })

  it('refuses an inline fallback with no key to fall back to', () => {
    expect(() =>
      buildProviderPatch({
        id: 'manifest',
        baseUrl: 'https://x.example/v1',
        envKey: 'MY_KEY',
        inlineFallback: true,
      }),
    ).toThrow(/needs the key value/i)
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
