import { describe, expect, it } from 'vitest'

import { buildYamlPreview } from './yaml-preview'

describe('buildYamlPreview', () => {
  describe('inline mode', () => {
    it('emits the model block with provider, base_url, default, and a masked key', () => {
      expect(
        buildYamlPreview({
          id: 'custom',
          baseUrl: 'https://interstellar-llm.example/v1',
          envKey: '',
          makeActive: false,
          defaultModel: 'gpt-4o',
          inline: true,
        }),
      ).toBe(
        [
          'model:',
          '  provider: custom',
          '  base_url: https://interstellar-llm.example/v1',
          '  default: gpt-4o',
          '  api_key: ********',
        ].join('\n'),
      )
    })

    it('omits base_url and default when blank, rather than emitting them empty', () => {
      expect(
        buildYamlPreview({
          id: 'custom',
          baseUrl: '',
          envKey: '',
          makeActive: false,
          defaultModel: '',
          inline: true,
        }),
      ).toBe(['model:', '  provider: custom', '  api_key: ********'].join('\n'))
    })

    it('never includes the API key in cleartext', () => {
      const preview = buildYamlPreview({
        id: 'custom',
        baseUrl: '',
        envKey: '',
        makeActive: false,
        defaultModel: '',
        inline: true,
      })
      const apiKeyLine = preview
        .split('\n')
        .find((line) => line.trim().startsWith('api_key:'))
      expect(apiKeyLine?.trim()).toBe('api_key: ********')
    })
  })

  describe('non-inline mode', () => {
    // No `type:` line: the gateway reads no such key off a providers entry,
    // and a preview that shows one teaches a field that does nothing.
    it('emits the providers block with base_url and key_env, and no type', () => {
      expect(
        buildYamlPreview({
          id: 'openrouter',
          baseUrl: 'https://openrouter.ai/api/v1',
          envKey: 'OPENROUTER_API_KEY',
          makeActive: false,
          defaultModel: '',
          inline: false,
        }),
      ).toBe(
        [
          'providers:',
          '  openrouter:',
          '    base_url: https://openrouter.ai/api/v1',
          '    key_env: OPENROUTER_API_KEY',
        ].join('\n'),
      )
    })

    // A providers block with no base_url is dropped whole by the gateway, so
    // previewing an empty `openrouter:` key promised a write that never
    // happened. Built-ins are configured by their env key instead.
    it('shows the env key instead of an empty providers block when there is no base URL', () => {
      expect(
        buildYamlPreview({
          id: 'openrouter',
          baseUrl: '',
          envKey: 'OPENROUTER_API_KEY',
          makeActive: false,
          defaultModel: '',
          inline: false,
        }),
      ).toBe('~/.hermes/.env → OPENROUTER_API_KEY')
    })

    it('appends the model block with provider and default when makeActive is set', () => {
      expect(
        buildYamlPreview({
          id: 'openrouter',
          baseUrl: 'https://openrouter.ai/api/v1',
          envKey: '',
          makeActive: true,
          defaultModel: 'anthropic/claude-sonnet-4-6',
          inline: false,
        }),
      ).toBe(
        [
          'providers:',
          '  openrouter:',
          '    base_url: https://openrouter.ai/api/v1',
          'model:',
          '  provider: openrouter',
          '  default: anthropic/claude-sonnet-4-6',
        ].join('\n'),
      )
    })

    it('defaults the model block default to auto when defaultModel is blank', () => {
      expect(
        buildYamlPreview({
          id: 'openrouter',
          baseUrl: 'https://openrouter.ai/api/v1',
          envKey: '',
          makeActive: true,
          defaultModel: '',
          inline: false,
        }),
      ).toBe(
        [
          'providers:',
          '  openrouter:',
          '    base_url: https://openrouter.ai/api/v1',
          'model:',
          '  provider: openrouter',
          '  default: auto',
        ].join('\n'),
      )
    })

    it('does not append the model block when makeActive is false', () => {
      const preview = buildYamlPreview({
        id: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        envKey: '',
        makeActive: false,
        defaultModel: 'gpt-4o',
        inline: false,
      })
      expect(preview).not.toContain('model:')
    })

    it('shows the inline copy the fallback adds, still masked', () => {
      const preview = buildYamlPreview({
        id: 'manifest',
        baseUrl: 'https://x.example/v1',
        envKey: 'MY_KEY',
        makeActive: false,
        defaultModel: '',
        inline: false,
        inlineFallback: true,
      })
      expect(preview).toContain('    key_env: MY_KEY')
      expect(preview).toContain('    api_key: ********')
    })

    it('never includes an API key anywhere in the output', () => {
      const preview = buildYamlPreview({
        id: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        envKey: 'OPENROUTER_API_KEY',
        makeActive: true,
        defaultModel: 'gpt-4o',
        inline: false,
      })
      expect(preview).not.toContain('api_key')
      expect(preview).not.toContain('sk-')
    })
  })
})
