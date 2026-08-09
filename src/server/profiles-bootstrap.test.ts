import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import YAML from 'yaml'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ProfilesBootstrapModule from './profiles-bootstrap'

const PROFILE_DIR_ENTRIES = [
  'config.yaml',
  'SOUL.md',
  '.env',
  'memory',
  'memories/MEMORY.md',
  'memories/USER.md',
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

describe('ensureBuiltinProfiles config.yaml shape (P-15)', () => {
  beforeEach(() => {
    delete process.env.HERMES_SKIP_PROFILE_BOOTSTRAP
    delete process.env.HERMES_BUILTIN_PROFILES_FILE
  })
  afterEach(() => {
    delete process.env.HERMES_SKIP_PROFILE_BOOTSTRAP
    delete process.env.HERMES_BUILTIN_PROFILES_FILE
  })

  it('omits model.provider and providers so resolution falls through to auto', async () => {
    await withTempHome(async (home) => {
      const mod = await freshBootstrap()
      mod.ensureBuiltinProfiles()
      const configPath = path.join(
        home,
        '.hermes',
        'profiles',
        'hermes-switch',
        'config.yaml',
      )
      const config = YAML.parse(fs.readFileSync(configPath, 'utf-8')) as {
        model?: { default?: string; provider?: string }
        providers?: unknown
      }
      // See ensureConfigYaml's comment: `provider: 'manifest'` with an empty
      // providers.manifest.base_url shadows the root's already-working
      // provider config instead of inheriting it. Omitting both lets the
      // gateway's "auto" resolution chain (env vars, credential pool, the
      // root auth.json fallback) take over.
      expect(config.model?.default).toBe('auto')
      expect(config.model?.provider).toBeUndefined()
      expect(config.providers).toBeUndefined()
    })
  })
})

describe('ensureBuiltinProfiles terminal: inheritance-gap emulation', () => {
  beforeEach(() => {
    delete process.env.HERMES_SKIP_PROFILE_BOOTSTRAP
    delete process.env.HERMES_BUILTIN_PROFILES_FILE
  })
  afterEach(() => {
    delete process.env.HERMES_SKIP_PROFILE_BOOTSTRAP
    delete process.env.HERMES_BUILTIN_PROFILES_FILE
  })

  function seededConfigPath(home: string, profile = 'hermes-switch'): string {
    return path.join(home, '.hermes', 'profiles', profile, 'config.yaml')
  }

  it('copies the root terminal: block into a freshly-seeded profile', async () => {
    await withTempHome(async (home) => {
      const hermesHome = path.join(home, '.hermes')
      fs.mkdirSync(hermesHome, { recursive: true })
      fs.writeFileSync(
        path.join(hermesHome, 'config.yaml'),
        YAML.stringify({ terminal: { cwd: '/srv/project', backend: 'local' } }),
      )

      const mod = await freshBootstrap()
      mod.ensureBuiltinProfiles()

      const config = YAML.parse(
        fs.readFileSync(seededConfigPath(home), 'utf-8'),
      ) as { terminal?: { cwd?: string; backend?: string } }
      expect(config.terminal?.cwd).toBe('/srv/project')
      expect(config.terminal?.backend).toBe('local')
    })
  })

  it('writes no terminal: key when root config.yaml has none', async () => {
    await withTempHome(async (home) => {
      const hermesHome = path.join(home, '.hermes')
      fs.mkdirSync(hermesHome, { recursive: true })
      fs.writeFileSync(
        path.join(hermesHome, 'config.yaml'),
        YAML.stringify({ model: { default: 'auto' } }),
      )

      const mod = await freshBootstrap()
      mod.ensureBuiltinProfiles()

      const config = YAML.parse(
        fs.readFileSync(seededConfigPath(home), 'utf-8'),
      ) as { terminal?: unknown }
      expect(config.terminal).toBeUndefined()
    })
  })

  it('writes no terminal: key when root config.yaml does not exist at all', async () => {
    await withTempHome(async (home) => {
      const mod = await freshBootstrap()
      mod.ensureBuiltinProfiles()

      const config = YAML.parse(
        fs.readFileSync(seededConfigPath(home), 'utf-8'),
      ) as { terminal?: unknown }
      expect(config.terminal).toBeUndefined()
    })
  })

  it('never overwrites an already-seeded profile config.yaml, even if root terminal: appears later', async () => {
    await withTempHome(async (home) => {
      const hermesHome = path.join(home, '.hermes')

      // First run: no root terminal: block yet.
      const mod1 = await freshBootstrap()
      mod1.ensureBuiltinProfiles()
      const before = YAML.parse(
        fs.readFileSync(seededConfigPath(home), 'utf-8'),
      ) as { terminal?: unknown }
      expect(before.terminal).toBeUndefined()

      // Root gains a terminal: block after the profile already exists.
      fs.writeFileSync(
        path.join(hermesHome, 'config.yaml'),
        YAML.stringify({ terminal: { cwd: '/late/addition' } }),
      )

      const mod2 = await freshBootstrap()
      mod2.ensureBuiltinProfiles()

      // The existing profile config.yaml must be untouched (the per-file
      // fs.existsSync guard), matching the gateway's own non-inheritance.
      const after = YAML.parse(
        fs.readFileSync(seededConfigPath(home), 'utf-8'),
      ) as { terminal?: unknown }
      expect(after.terminal).toBeUndefined()
    })
  })

  it('a malformed root config.yaml is treated as "no terminal: block", not a crash', async () => {
    await withTempHome(async (home) => {
      const hermesHome = path.join(home, '.hermes')
      fs.mkdirSync(hermesHome, { recursive: true })
      fs.writeFileSync(path.join(hermesHome, 'config.yaml'), '{ not: valid: yaml')

      const mod = await freshBootstrap()
      expect(() => mod.ensureBuiltinProfiles()).not.toThrow()

      const config = YAML.parse(
        fs.readFileSync(seededConfigPath(home), 'utf-8'),
      ) as { terminal?: unknown }
      expect(config.terminal).toBeUndefined()
    })
  })
})

describe('ensureBuiltinProfiles default-profile adoption', () => {
  const ORIGINAL_ENV = {
    HERMES_SKIP_PROFILE_BOOTSTRAP: process.env.HERMES_SKIP_PROFILE_BOOTSTRAP,
    HERMES_BUILTIN_PROFILES_FILE: process.env.HERMES_BUILTIN_PROFILES_FILE,
    HERMES_DEFAULT_PROFILE: process.env.HERMES_DEFAULT_PROFILE,
  }

  beforeEach(() => {
    delete process.env.HERMES_SKIP_PROFILE_BOOTSTRAP
    delete process.env.HERMES_BUILTIN_PROFILES_FILE
    delete process.env.HERMES_DEFAULT_PROFILE
  })
  afterEach(() => {
    for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  function activeProfilePath(home: string): string {
    return path.join(home, '.hermes', 'active_profile')
  }

  function markerPath(home: string): string {
    return path.join(home, '.hermes', '.profiles-bootstrap')
  }

  function readActiveProfile(home: string): string | null {
    const p = activeProfilePath(home)
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8').trim() : null
  }

  function readMarker(home: string): { version: number; adoptedProfile: string | null } | null {
    const p = markerPath(home)
    if (!fs.existsSync(p)) return null
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as {
      version: number
      adoptedProfile: string | null
    }
  }

  it('fresh install (no marker, no active_profile) adopts hermes-switch and writes the marker', async () => {
    await withTempHome(async (home) => {
      const mod = await freshBootstrap()
      mod.ensureBuiltinProfiles()

      expect(readActiveProfile(home)).toBe('hermes-switch')
      const marker = readMarker(home)
      expect(marker).not.toBeNull()
      expect(marker?.version).toBe(1)
      expect(marker?.adoptedProfile).toBe('hermes-switch')
    })
  })

  it('marker present + active_profile absent does NOT adopt (deliberate-revert case)', async () => {
    await withTempHome(async (home) => {
      fs.mkdirSync(path.join(home, '.hermes'), { recursive: true })
      fs.writeFileSync(
        markerPath(home),
        JSON.stringify({ version: 1, adoptedProfile: 'hermes-switch' }),
      )

      const mod = await freshBootstrap()
      mod.ensureBuiltinProfiles()

      expect(readActiveProfile(home)).toBeNull()
    })
  })

  it('existing active_profile (e.g. neo) is never overwritten', async () => {
    await withTempHome(async (home) => {
      // Seed profiles first so `neo` exists on disk, then point active_profile
      // at it before running bootstrap again (simulating a pre-existing,
      // already-configured installation).
      const mod = await freshBootstrap()
      mod.ensureBuiltinProfiles()
      fs.rmSync(markerPath(home), { force: true })
      fs.writeFileSync(activeProfilePath(home), 'neo\n')

      const mod2 = await freshBootstrap()
      mod2.ensureBuiltinProfiles()

      expect(readActiveProfile(home)).toBe('neo')
      const marker = readMarker(home)
      expect(marker?.adoptedProfile).toBeNull()
    })
  })

  it('HERMES_DEFAULT_PROFILE=trinity adopts trinity', async () => {
    await withTempHome(async (home) => {
      process.env.HERMES_DEFAULT_PROFILE = 'trinity'
      const mod = await freshBootstrap()
      mod.ensureBuiltinProfiles()

      expect(readActiveProfile(home)).toBe('trinity')
      expect(readMarker(home)?.adoptedProfile).toBe('trinity')
    })
  })

  it('unknown HERMES_DEFAULT_PROFILE falls back to the first tier-1 agent', async () => {
    await withTempHome(async (home) => {
      process.env.HERMES_DEFAULT_PROFILE = 'does-not-exist'
      const mod = await freshBootstrap()
      mod.ensureBuiltinProfiles()

      // hermes-switch is the only tier-1 agent in BUILTIN_AGENTS.
      expect(readActiveProfile(home)).toBe('hermes-switch')
      expect(readMarker(home)?.adoptedProfile).toBe('hermes-switch')
    })
  })

  it('HERMES_SKIP_PROFILE_BOOTSTRAP=1 writes neither marker nor active_profile', async () => {
    await withTempHome(async (home) => {
      process.env.HERMES_SKIP_PROFILE_BOOTSTRAP = '1'
      const mod = await freshBootstrap()
      mod.ensureBuiltinProfiles()

      expect(fs.existsSync(activeProfilePath(home))).toBe(false)
      expect(fs.existsSync(markerPath(home))).toBe(false)
    })
  })

  it('adoption is idempotent across repeated calls', async () => {
    await withTempHome(async (home) => {
      const mod1 = await freshBootstrap()
      mod1.ensureBuiltinProfiles()
      expect(readActiveProfile(home)).toBe('hermes-switch')

      // Simulate a second process/request (fresh module = fresh
      // `bootstrapped` flag) re-running bootstrap against the same home.
      const mod2 = await freshBootstrap()
      mod2.ensureBuiltinProfiles()

      expect(readActiveProfile(home)).toBe('hermes-switch')
      expect(readMarker(home)?.adoptedProfile).toBe('hermes-switch')
    })
  })
})
