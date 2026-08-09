import { describe, expect, it } from 'vitest'

import {
  HERMES_MIN_CONTEXT_TOKENS,
  detectOllamaContext,
  isOllamaEndpoint,
  readConfiguredContextLength,
  shouldWarnBeforeChat,
} from './ollama-context'

describe('isOllamaEndpoint', () => {
  it('matches the provider id', () => {
    expect(isOllamaEndpoint({ providerId: 'ollama' })).toBe(true)
    expect(isOllamaEndpoint({ providerId: 'OLLAMA' })).toBe(true)
  })

  it('matches an OpenAI-compatible entry pointed at the Ollama port', () => {
    // How most people actually wire it: a `manifest`/custom provider whose
    // base_url is the local Ollama.
    expect(
      isOllamaEndpoint({
        providerId: 'manifest',
        baseUrl: 'http://127.0.0.1:11434/v1',
      }),
    ).toBe(true)
  })

  it('does not match a hosted provider', () => {
    expect(
      isOllamaEndpoint({
        providerId: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
      }),
    ).toBe(false)
  })
})

describe('readConfiguredContextLength', () => {
  it('reads the providers map', () => {
    expect(
      readConfiguredContextLength(
        { providers: { ollama: { context_length: 64000 } } },
        'ollama',
      ),
    ).toBe(64000)
  })

  it('reads the legacy custom_providers list', () => {
    expect(
      readConfiguredContextLength(
        { custom_providers: [{ id: 'ollama', context_length: 8192 }] },
        'ollama',
      ),
    ).toBe(8192)
  })

  it('reads the inline model block when it names this provider', () => {
    expect(
      readConfiguredContextLength(
        { model: { provider: 'ollama', context_length: '32768' } },
        'ollama',
      ),
    ).toBe(32768)
  })

  it('returns null rather than throwing on anything unexpected', () => {
    expect(readConfiguredContextLength(null, 'ollama')).toBeNull()
    expect(readConfiguredContextLength({ providers: 3 }, 'ollama')).toBeNull()
    expect(readConfiguredContextLength({}, '')).toBeNull()
  })
})

describe('detectOllamaContext', () => {
  it('says nothing about a hosted provider', () => {
    expect(
      detectOllamaContext({ providerId: 'anthropic', config: {} }).kind,
    ).toBe('not-applicable')
  })

  it('says nothing about an Ollama that is not even running', () => {
    // An offline Ollama has a louder problem than its context window.
    expect(
      detectOllamaContext({ providerId: 'ollama', config: {}, online: false })
        .kind,
    ).toBe('not-applicable')
  })

  it('flags an undersized configured window', () => {
    const verdict = detectOllamaContext({
      providerId: 'ollama',
      config: { providers: { ollama: { context_length: 8192 } } },
    })
    expect(verdict.kind).toBe('below-minimum')
    expect(verdict.contextLength).toBe(8192)
    expect(verdict.message).toContain('8,192')
    expect(verdict.message).toContain('64,000')
    expect(shouldWarnBeforeChat(verdict)).toBe(true)
  })

  it('flags an absent window, because the runtime default is 2048', () => {
    // The case a live probe cannot answer: `/api/show` reports the model's
    // maximum, not the window the server is actually serving.
    const verdict = detectOllamaContext({ providerId: 'ollama', config: {} })
    expect(verdict.kind).toBe('unconfigured')
    expect(verdict.message).toContain('2,048')
    expect(verdict.message).toContain('cannot be detected — only declared')
    expect(shouldWarnBeforeChat(verdict)).toBe(true)
  })

  it('offers all three documented fixes', () => {
    const verdict = detectOllamaContext({ providerId: 'ollama', config: {} })
    expect(verdict.fixes.join(' ')).toContain('OLLAMA_CONTEXT_LENGTH')
    expect(verdict.fixes.join(' ')).toContain('num_ctx')
    expect(verdict.fixes.join(' ')).toContain('context_length')
  })

  it('passes a window at exactly the minimum', () => {
    const verdict = detectOllamaContext({
      providerId: 'ollama',
      config: {
        providers: { ollama: { context_length: HERMES_MIN_CONTEXT_TOKENS } },
      },
    })
    expect(verdict.kind).toBe('ok')
    expect(shouldWarnBeforeChat(verdict)).toBe(false)
  })

  it('catches an Ollama wired up under another provider id', () => {
    const verdict = detectOllamaContext({
      providerId: 'manifest',
      baseUrl: 'http://127.0.0.1:11434/v1',
      config: {},
    })
    expect(verdict.kind).toBe('unconfigured')
  })
})
