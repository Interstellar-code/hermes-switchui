import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ProfilesBootstrapModule from './profiles-bootstrap'

const PROFILE_DIR_ENTRIES = [
  'config.yaml',
  'SOUL.md',
  'MEMORY.md',
  'USER.md',
  '.env',
  'memory',
  'sessions',
  'skills',
]

function withTempHome<T>(fn: (home: string) => Promise<T> | T): Promise<T> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'switchui-bootstrap-'))
  const prev = {
    HERMES_HOME: process.env.HERMES_HOME,
    HERMES_SKIP_PROFILE_BOOTSTRAP: process.env.HERMES_SKIP_PROFILE_BOOTSTRAP,
    HERMES_BUILTIN_PROFILES_FILE: process.env.HERMES_BUILTIN_PROFILES_FILE,
  }
  process.env.HERMES_HOME = path.join(home, '.hermes')
  return Promise.resolve()
    .then(() => fn(home))
    .finally(() => {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
      fs.rmSync(home, { recursive: true, force: true })
    })
}

async function freshBootstrap(): Promise<typeof ProfilesBootstrapModule> {
  // Bust module cache so the internal `bootstrapped` flag resets each test.
  vi.resetModules()
  return await import('./profiles-bootstrap')
}

describe('ensureBuiltinProfiles env opt-outs', () => {
  beforeEach(() => {
    delete process.env.HERMES_SKIP_PROFILE_BOOTSTRAP
    delete process.env.HERMES_BUILTIN_PROFILES_FILE
  })
  afterEach(() => {
    delete process.env.HERMES_SKIP_PROFILE_BOOTSTRAP
    delete process.env.HERMES_BUILTIN_PROFILES_FILE
  })

  it('seeds builtin profiles by default', async () => {
    await withTempHome(async (home) => {
      const mod = await freshBootstrap()
      mod.ensureBuiltinProfiles()
      const profilesRoot = path.join(home, '.hermes', 'profiles')
      expect(fs.existsSync(profilesRoot)).toBe(true)
      const dirs = fs.readdirSync(profilesRoot)
      expect(dirs).toContain('hermes-switch')
      for (const entry of PROFILE_DIR_ENTRIES) {
        expect(
          fs.existsSync(path.join(profilesRoot, 'hermes-switch', entry)),
        ).toBe(true)
      }
    })
  })

  it('HERMES_SKIP_PROFILE_BOOTSTRAP=1 skips all seeding', async () => {
    await withTempHome(async (home) => {
      process.env.HERMES_SKIP_PROFILE_BOOTSTRAP = '1'
      const mod = await freshBootstrap()
      mod.ensureBuiltinProfiles()
      const profilesRoot = path.join(home, '.hermes', 'profiles')
      expect(fs.existsSync(profilesRoot)).toBe(false)
    })
  })

  it('HERMES_BUILTIN_PROFILES_FILE overrides the compiled list', async () => {
    await withTempHome(async (home) => {
      const override = path.join(home, 'agents.json')
      fs.writeFileSync(
        override,
        JSON.stringify([
          {
            tier: 1,
            id: 'construct-second-brain',
            glyph: 'CB',
            name: 'The Construct Second Brain',
            role: 'Second Brain',
            description: 'Single curated profile.',
            tags: ['second-brain'],
            status: 'active',
            builtin: true,
          },
        ]),
      )
      process.env.HERMES_BUILTIN_PROFILES_FILE = override
      const mod = await freshBootstrap()
      mod.ensureBuiltinProfiles()
      const profilesRoot = path.join(home, '.hermes', 'profiles')
      const dirs = fs.readdirSync(profilesRoot).sort()
      expect(dirs).toEqual(['construct-second-brain'])
    })
  })

  it('invalid override file falls back to compiled defaults', async () => {
    await withTempHome(async (home) => {
      const override = path.join(home, 'broken.json')
      fs.writeFileSync(override, '{ not: an array }')
      process.env.HERMES_BUILTIN_PROFILES_FILE = override
      const mod = await freshBootstrap()
      mod.ensureBuiltinProfiles()
      const profilesRoot = path.join(home, '.hermes', 'profiles')
      const dirs = fs.readdirSync(profilesRoot)
      expect(dirs).toContain('hermes-switch')
    })
  })
})
