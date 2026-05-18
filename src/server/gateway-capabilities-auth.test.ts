import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_ENV = { ...process.env }

describe('gateway bearer token resolution', () => {
  afterEach(() => {
    vi.resetModules()
    process.env = { ...ORIGINAL_ENV }
  })

  it('uses API_SERVER_KEY from Hermes .env when explicit token env is absent', async () => {
    const home = mkdtempSync(join(tmpdir(), 'hermes-home-'))
    try {
      process.env.HERMES_HOME = home
      delete process.env.HERMES_API_TOKEN
      delete process.env.CLAUDE_API_TOKEN
      writeFileSync(join(home, '.env'), 'API_SERVER_KEY="server-key"\n')

      const mod = await import('./gateway-capabilities')

      expect(mod.BEARER_TOKEN).toBe('server-key')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('does not treat OPENAI_API_KEY as a Hermes gateway bearer token', async () => {
    const home = mkdtempSync(join(tmpdir(), 'hermes-home-'))
    try {
      process.env.HERMES_HOME = home
      process.env.OPENAI_API_KEY = 'not-a-hermes-gateway-token'
      delete process.env.HERMES_API_TOKEN
      delete process.env.CLAUDE_API_TOKEN

      const mod = await import('./gateway-capabilities')

      expect(mod.BEARER_TOKEN).toBe('')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('prefers explicit Hermes token env over API_SERVER_KEY file', async () => {
    const home = mkdtempSync(join(tmpdir(), 'hermes-home-'))
    try {
      process.env.HERMES_HOME = home
      process.env.HERMES_API_TOKEN = 'explicit-token'
      delete process.env.CLAUDE_API_TOKEN
      writeFileSync(join(home, '.env'), 'API_SERVER_KEY="server-key"\n')

      const mod = await import('./gateway-capabilities')

      expect(mod.BEARER_TOKEN).toBe('explicit-token')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
