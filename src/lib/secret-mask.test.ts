import { describe, expect, it } from 'vitest'

import {
  isSecretKeyName,
  keyWords,
  looksLikeSecretValue,
  maskSecrets,
} from './secret-mask'

/**
 * The names here are the names that actually appear in a Hermes profile's
 * `config.yaml` — `OPENAI_API_KEY`, `GITHUB_TOKEN`, `BRAVE_API_KEY` (the two
 * `mcp-server-list.tsx` collects into `mcp_servers.<name>.env`),
 * `ANTHROPIC_AUTH_TOKEN`, `AWS_SECRET_ACCESS_KEY` — because those are exactly
 * the names the previous anchored `/^(api_?key|secret|token|password|
 * authorization)$/i` rule let through, and export puts that config in a file
 * the user hands to somebody else.
 */

const MASKED = /…••••$/

function masked(obj: unknown): Record<string, unknown> {
  return maskSecrets(obj) as Record<string, unknown>
}

// ── keyWords ─────────────────────────────────────────────────────────────────

describe('keyWords', () => {
  it('splits on underscores, hyphens, dots and camelCase alike', () => {
    expect(keyWords('OPENAI_API_KEY')).toEqual(['openai', 'api', 'key'])
    expect(keyWords('x-api-key')).toEqual(['x', 'api', 'key'])
    expect(keyWords('clientSecret')).toEqual(['client', 'secret'])
    expect(keyWords('AWSSecretKey')).toEqual(['aws', 'secret', 'key'])
    expect(keyWords('model.default')).toEqual(['model', 'default'])
  })
})

// ── Key names that must mask ─────────────────────────────────────────────────

describe('isSecretKeyName — the real key names the anchored regex missed', () => {
  const shouldMask = [
    'OPENAI_API_KEY',
    'GITHUB_TOKEN',
    'BRAVE_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'AWS_SECRET_ACCESS_KEY',
    'api_key',
    'apiKey',
    'APIKEY',
    'x-api-key',
    'client_secret',
    'clientSecret',
    'private_key',
    'PRIVATE_KEY',
    'password',
    'PASSPHRASE',
    'authorization',
    'Authorization',
    'bearer_token',
    'refreshToken',
    'SLACK_BOT_TOKEN',
    'db_password',
    'credentials',
    'auth',
  ]

  for (const key of shouldMask) {
    it(`masks on "${key}"`, () => {
      expect(isSecretKeyName(key)).toBe(true)
    })
  }
})

describe('isSecretKeyName — exemptions, so the preview stays useful', () => {
  const shouldNotMask: Array<[string, string]> = [
    ['key_env', 'names the env var the provider reads the key from'],
    ['api_key_env', 'same convention, longer name'],
    ['token_env', 'same convention for a token'],
    ['KEY_ENV', 'case-insensitive'],
    ['env_var', 'names a variable'],
    ['api_key_var', 'names a variable'],
    ['key_name', 'a label used to select a credential'],
    ['access_key_id', 'the public identifier half of a key pair'],
    ['private_key_id', 'ditto'],
    ['key_file', 'a filesystem location'],
    ['credential_path', 'a filesystem location'],
    ['key_ref', 'an indirection handle'],
    ['auth_type', 'a mode selector'],
    ['key_type', 'a mode selector'],
    ['auth_enabled', 'a boolean switch'],
    // Plain config fields that merely contain a secret-ish letter sequence.
    ['keyboard_layout', 'the word is "keyboard", not "key"'],
    ['monkey_patch', 'the word is "monkey", not "key"'],
    ['base_url', 'not secret-shaped at all'],
    ['provider', 'not secret-shaped at all'],
    ['max_turns', 'not secret-shaped at all'],
  ]

  for (const [key, why] of shouldNotMask) {
    it(`leaves "${key}" visible — ${why}`, () => {
      expect(isSecretKeyName(key)).toBe(false)
    })
  }

  it('only exempts a TRAILING qualifier', () => {
    expect(isSecretKeyName('key_env')).toBe(false)
    expect(isSecretKeyName('env_key')).toBe(true)
    expect(isSecretKeyName('name_key')).toBe(true)
  })
})

// ── Value shapes ─────────────────────────────────────────────────────────────

describe('looksLikeSecretValue — vendor prefixes', () => {
  const secrets = [
    'sk-proj-Ab12Cd34Ef56Gh78Ij90Kl12Mn34',
    'sk-ant-api03-3n7Xk2Lq9Vb4Tz8Rw1Ym5Pd6',
    'ghp_16C7e42F292c6912E7710c838347Ae178B4a',
    'gho_16C7e42F292c6912E7710c838347Ae178B4a',
    'github_pat_11ABCDEFG0abcdefghijkl_ABCDEFGHIJKLMNOP',
    'xoxb-2334-4567-abcdefGHIJKL',
    'AKIAIOSFODNN7EXAMPLE',
    'AIzaSyD-1234567890abcdefghijklmnopqrstu',
    '-----BEGIN RSA PRIVATE KEY-----\nMIIEow==\n-----END RSA PRIVATE KEY-----',
  ]

  for (const value of secrets) {
    it(`flags ${value.slice(0, 14)}…`, () => {
      expect(looksLikeSecretValue(value)).toBe(true)
    })
  }

  it('flags a vendor key embedded in a composite header value', () => {
    expect(looksLikeSecretValue('Bearer sk-proj-Ab12Cd34Ef56Gh78Ij90Kl12Mn34')).toBe(true)
  })

  it('flags a vendor key even under a digest-shaped key name', () => {
    // The digest guard only suppresses the entropy heuristics — a registered
    // vendor prefix is never a hash.
    expect(looksLikeSecretValue('AKIAIOSFODNN7EXAMPLE', 'access_key_id')).toBe(true)
  })
})

describe('looksLikeSecretValue — entropy heuristics', () => {
  it('flags a 32+ char single-case hex run', () => {
    expect(looksLikeSecretValue('deadbeefcafebabe0123456789abcdef0123')).toBe(true)
  })

  it('flags a 40+ char mixed-case base64url run', () => {
    expect(
      looksLikeSecretValue('Zk3Rq7Xa1Pd9Lm2Vt6Yb4Nc8Hj5Ws0Ge7Uf3Iq1Or5Az'),
    ).toBe(true)
  })

  it('does not flag a hex digest sitting under a digest-shaped key', () => {
    const sha = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    expect(looksLikeSecretValue(sha, 'sha256')).toBe(false)
    expect(looksLikeSecretValue(sha, 'commit')).toBe(false)
    expect(looksLikeSecretValue(sha, 'etag')).toBe(false)
    // …but the same run under no key at all is still treated as a credential.
    expect(looksLikeSecretValue(sha)).toBe(true)
  })
})

describe('looksLikeSecretValue — false-positive guards', () => {
  const survivors: Array<[string, string]> = [
    ['http://127.0.0.1:8642/v1', 'a base_url'],
    ['https://api.anthropic.com/v1/messages/very/long/path/segment', 'a long base_url'],
    ['claude-opus-4-20250514', 'a model id'],
    ['anthropic/claude-3-5-sonnet-20241022', 'a namespaced model id'],
    ['/home/rohit/.hermes/profiles/custom-agent/skills', 'a filesystem path'],
    ['/home/rohit/development/hermes-switchui/src/screens/profiles', 'a long path, no dots'],
    ['550e8400-e29b-41d4-a716-446655440000', 'a UUID'],
    ['CUSTOM_API_KEY', 'an env-var name'],
    ['A_VERY_LONG_CUSTOM_ENVIRONMENT_VARIABLE_NAME_1', 'a long env-var name (no lowercase)'],
    ['npx @modelcontextprotocol/server-filesystem .', 'an MCP command line'],
    [
      'you are a careful reviewer who reads the whole diff before commenting',
      'a system prompt',
    ],
    ['${OPENAI_API_KEY}', 'an env reference'],
    ['$OPENAI_API_KEY', 'a bare env reference'],
    ['', 'an empty string'],
  ]

  for (const [value, what] of survivors) {
    it(`leaves ${what} alone`, () => {
      expect(looksLikeSecretValue(value)).toBe(false)
    })
  }
})

// ── maskSecrets ──────────────────────────────────────────────────────────────

describe('maskSecrets — recursion into the shapes a profile config actually has', () => {
  it('reaches mcp_servers.<name>.env.* — where the wizard puts GITHUB_TOKEN', () => {
    const config = {
      mcp_servers: {
        github: {
          command: 'npx',
          args: ['@modelcontextprotocol/server-github'],
          env: {
            GITHUB_TOKEN: 'ghp_16C7e42F292c6912E7710c838347Ae178B4a',
          },
        },
        'brave-search': {
          command: 'npx',
          env: { BRAVE_API_KEY: 'BSA_realBraveKeyValue_1234' },
        },
      },
    }
    const out = masked(config)
    const servers = out.mcp_servers as Record<string, Record<string, unknown>>
    const githubEnv = servers.github.env as Record<string, string>
    const braveEnv = servers['brave-search'].env as Record<string, string>

    expect(githubEnv.GITHUB_TOKEN).toMatch(MASKED)
    expect(githubEnv.GITHUB_TOKEN).not.toContain('292c6912')
    expect(braveEnv.BRAVE_API_KEY).toMatch(MASKED)
    expect(braveEnv.BRAVE_API_KEY).not.toContain('realBraveKeyValue')
    // Non-secret siblings survive so the export still describes the server.
    expect(servers.github.command).toBe('npx')
    expect(servers.github.args).toEqual(['@modelcontextprotocol/server-github'])
  })

  it('keeps key_env readable while masking the key it points at', () => {
    const out = masked({
      model: { default: 'auto', provider: 'manifest' },
      providers: {
        manifest: {
          type: 'openai',
          base_url: 'http://127.0.0.1:8000/v1',
          key_env: 'CUSTOM_API_KEY',
          api_key: 'sk-proj-Ab12Cd34Ef56Gh78Ij90Kl12Mn34',
        },
      },
    })
    const manifest = (out.providers as Record<string, Record<string, string>>).manifest
    expect(manifest.key_env).toBe('CUSTOM_API_KEY')
    expect(manifest.base_url).toBe('http://127.0.0.1:8000/v1')
    expect(manifest.type).toBe('openai')
    expect(manifest.api_key).toMatch(MASKED)
    expect(manifest.api_key).not.toContain('Cd34Ef56')
  })

  it('masks the five key names the anchored regex used to miss', () => {
    const out = masked({
      env: {
        OPENAI_API_KEY: 'sk-proj-Ab12Cd34Ef56Gh78Ij90Kl12Mn34',
        GITHUB_TOKEN: 'ghp_16C7e42F292c6912E7710c838347Ae178B4a',
        BRAVE_API_KEY: 'BSA-plain-looking-value',
        ANTHROPIC_AUTH_TOKEN: 'sk-ant-api03-3n7Xk2Lq9Vb4Tz8Rw1Ym5Pd6',
        AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      },
    })
    for (const value of Object.values(out.env as Record<string, string>)) {
      expect(value).toMatch(MASKED)
    }
    const env = out.env as Record<string, string>
    expect(env.AWS_SECRET_ACCESS_KEY).not.toContain('bPxRfiCYEXAMPLEKEY')
  })

  it('masks inside arrays and preserves the parent key', () => {
    const out = masked({ tokens: ['first-token-value', 'second-token-value'] })
    expect(out.tokens).toEqual([expect.stringMatching(MASKED), expect.stringMatching(MASKED)])
  })

  it('catches a secret parked under an unguessable key name', () => {
    const out = masked({ blob: 'ghp_16C7e42F292c6912E7710c838347Ae178B4a' })
    expect(out.blob).toMatch(MASKED)
  })

  it('leaves an env reference readable even under a secret key name', () => {
    const out = masked({ api_key: '${OPENAI_API_KEY}', token: '$GITHUB_TOKEN' })
    expect(out.api_key).toBe('${OPENAI_API_KEY}')
    expect(out.token).toBe('$GITHUB_TOKEN')
  })

  it('never reveals more than a third of a short secret', () => {
    const out = masked({ api_key: 'abcdefgh' })
    expect(out.api_key).toBe('ab…••••')
  })

  it('leaves an empty secret empty rather than inventing a mask', () => {
    expect(masked({ api_key: '' }).api_key).toBe('')
  })

  it('passes non-string values through untouched', () => {
    const out = masked({
      agent: { max_turns: 200, reasoning_effort: 'medium' },
      memory: { memory_enabled: true, provider: 'hindsight' },
      nothing: null,
    })
    expect(out.agent).toEqual({ max_turns: 200, reasoning_effort: 'medium' })
    expect(out.memory).toEqual({ memory_enabled: true, provider: 'hindsight' })
    expect(out.nothing).toBeNull()
  })

  it('does not mutate its input', () => {
    const config = {
      mcp_servers: { github: { env: { GITHUB_TOKEN: 'ghp_abcdefghijklmnopqrstuvwxyz012345' } } },
      tags: ['alpha'],
    }
    const snapshot = JSON.parse(JSON.stringify(config)) as typeof config
    const out = masked(config)
    expect(config).toEqual(snapshot)
    expect(out).not.toBe(config)
    expect((out.mcp_servers as Record<string, unknown>).github).not.toBe(
      config.mcp_servers.github,
    )
    expect(out.tags).not.toBe(config.tags)
  })

  it('handles a top-level array and top-level primitives', () => {
    expect(maskSecrets(['plain', 42, null])).toEqual(['plain', 42, null])
    expect(maskSecrets('plain string')).toBe('plain string')
    expect(maskSecrets(7)).toBe(7)
    expect(maskSecrets(null)).toBeNull()
  })
})
