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
    it('emits the providers block with type, base_url, and key_env', () => {
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
          '    type: openai',
          '    base_url: https://openrouter.ai/api/v1',
          '    key_env: OPENROUTER_API_KEY',
        ].join('\n'),
      )
    })

    it('omits base_url and key_env when blank', () => {
      expect(
        buildYamlPreview({
          id: 'openrouter',
          baseUrl: '',
          envKey: '',
          makeActive: false,
          defaultModel: '',
          inline: false,
        }),
      ).toBe(['providers:', '  openrouter:', '    type: openai'].join('\n'))
    })

    it('appends the model block with provider and default when makeActive is set', () => {
      expect(
        buildYamlPreview({
          id: 'openrouter',
          baseUrl: '',
          envKey: '',
          makeActive: true,
          defaultModel: 'anthropic/claude-sonnet-4-6',
          inline: false,
        }),
      ).toBe(
        [
          'providers:',
          '  openrouter:',
          '    type: openai',
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
          baseUrl: '',
          envKey: '',
          makeActive: true,
          defaultModel: '',
          inline: false,
        }),
      ).toBe(
        [
          'providers:',
          '  openrouter:',
          '    type: openai',
          'model:',
          '  provider: openrouter',
          '  default: auto',
        ].join('\n'),
      )
    })

    it('does not append the model block when makeActive is false', () => {
      const preview = buildYamlPreview({
        id: 'openrouter',
        baseUrl: '',
        envKey: '',
        makeActive: false,
        defaultModel: 'gpt-4o',
        inline: false,
      })
      expect(preview).not.toContain('model:')
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
