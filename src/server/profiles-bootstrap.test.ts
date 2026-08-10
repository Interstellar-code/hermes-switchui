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

// ── Regression: an already-configured install must not be adopted away ─────
//
// The first shipped version of `adoptDefaultProfileOnce` treated an absent
// `active_profile` as "never configured". On a working install it means
// "running on the root ~/.hermes config" — and a bare seeded profile inherits
// neither the root config.yaml nor the root .env, so adoption killed
// API_SERVER_ENABLED and with it the gateway's HTTP API.
describe('ensureBuiltinProfiles skips adoption on an install already in use', () => {
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

  function hermesHome(home: string): string {
    return path.join(home, '.hermes')
  }

  function readActiveProfile(home: string): string | null {
    const p = path.join(hermesHome(home), 'active_profile')
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8').trim() : null
  }

  function readMarker(home: string): { adoptedProfile: string | null } | null {
    const p = path.join(hermesHome(home), '.profiles-bootstrap')
    if (!fs.existsSync(p)) return null
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as {
      adoptedProfile: string | null
    }
  }

  /** Each signal, on its own, must be enough to veto adoption. */
  const SIGNALS: Array<{ name: string; seed: (home: string) => void }> = [
    {
      name: 'root config.yaml carries user settings',
      seed: (home) => {
        fs.mkdirSync(hermesHome(home), { recursive: true })
        fs.writeFileSync(
          path.join(hermesHome(home), 'config.yaml'),
          YAML.stringify({
            _config_version: 33,
            model: { provider: 'custom', base_url: 'https://llm.example/v1' },
          }),
        )
      },
    },
    {
      name: 'root .env carries user values',
      seed: (home) => {
        fs.mkdirSync(hermesHome(home), { recursive: true })
        fs.writeFileSync(
          path.join(hermesHome(home), '.env'),
          '# comment\n\nOPENAI_API_KEY=sk-real-key\n',
        )
      },
    },
    {
      name: 'root sessions/ has history',
      seed: (home) => {
        const sessions = path.join(hermesHome(home), 'sessions')
        fs.mkdirSync(sessions, { recursive: true })
        fs.writeFileSync(path.join(sessions, 'abc.jsonl'), '{}\n')
      },
    },
    {
      name: 'a user-created profile exists',
      seed: (home) => {
        fs.mkdirSync(path.join(hermesHome(home), 'profiles', 'my-agent'), {
          recursive: true,
        })
      },
    },
  ]

  for (const signal of SIGNALS) {
    it(`does not adopt when ${signal.name}`, async () => {
      await withTempHome(async (home) => {
        signal.seed(home)

        const mod = await freshBootstrap()
        mod.ensureBuiltinProfiles()

        // active_profile is left alone → the gateway keeps using ~/.hermes.
        expect(readActiveProfile(home)).toBeNull()
        // …but the decision is still recorded, so it is never revisited.
        expect(readMarker(home)?.adoptedProfile).toBeNull()
      })
    })
  }

  it('still seeds the builtin profiles even when adoption is skipped', async () => {
    await withTempHome(async (home) => {
      SIGNALS[0].seed(home)
      const mod = await freshBootstrap()
      mod.ensureBuiltinProfiles()

      expect(
        fs.existsSync(path.join(hermesHome(home), 'profiles', 'hermes-switch')),
      ).toBe(true)
      expect(readActiveProfile(home)).toBeNull()
    })
  })

  it('an unparsable root config.yaml counts as "in use" (fail safe)', async () => {
    await withTempHome(async (home) => {
      fs.mkdirSync(hermesHome(home), { recursive: true })
      fs.writeFileSync(
        path.join(hermesHome(home), 'config.yaml'),
        '{ not: valid: yaml',
      )

      const mod = await freshBootstrap()
      mod.ensureBuiltinProfiles()

      expect(readActiveProfile(home)).toBeNull()
    })
  })

  it('a root config.yaml with only bookkeeping/empty keys is NOT "in use"', async () => {
    await withTempHome(async (home) => {
      fs.mkdirSync(hermesHome(home), { recursive: true })
      fs.writeFileSync(
        path.join(hermesHome(home), 'config.yaml'),
        YAML.stringify({
          _config_version: 33,
          model: '',
          providers: {},
          fallback_providers: [],
        }),
      )

      const mod = await freshBootstrap()
      mod.ensureBuiltinProfiles()

      expect(readActiveProfile(home)).toBe('hermes-switch')
    })
  })

  it('a root .env holding only gateway bootstrap keys is NOT "in use"', async () => {
    await withTempHome(async (home) => {
      // What install.sh / the Docker image write on a brand-new machine.
      fs.mkdirSync(hermesHome(home), { recursive: true })
      fs.writeFileSync(
        path.join(hermesHome(home), '.env'),
        '# Hermes\nAPI_SERVER_ENABLED=true\nAPI_SERVER_KEY=generated\n',
      )

      const mod = await freshBootstrap()
      mod.ensureBuiltinProfiles()

      expect(readActiveProfile(home)).toBe('hermes-switch')
    })
  })

  it('the seeded builtin profiles themselves do not count as user-created', async () => {
    await withTempHome(async (home) => {
      // First run seeds hermes-switch/neo/trinity/morpheus and adopts.
      const mod1 = await freshBootstrap()
      mod1.ensureBuiltinProfiles()
      // Wipe the decision and the pointer, as if the feature shipped fresh
      // against an install that already has the seeds on disk.
      fs.rmSync(path.join(hermesHome(home), '.profiles-bootstrap'), {
        force: true,
      })
      fs.rmSync(path.join(hermesHome(home), 'active_profile'), { force: true })

      const mod2 = await freshBootstrap()
      mod2.ensureBuiltinProfiles()

      expect(readActiveProfile(home)).toBe('hermes-switch')
    })
  })
})

// ── Adoption must leave the profile viable: .env has no root fallback ──────
describe('ensureBuiltinProfiles seeds the adopted profile .env from root', () => {
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

  function profileEnvPath(home: string, profile = 'hermes-switch'): string {
    return path.join(home, '.hermes', 'profiles', profile, '.env')
  }

  it('copies the root .env into the profile it adopts', async () => {
    await withTempHome(async (home) => {
      const hermesHome = path.join(home, '.hermes')
      fs.mkdirSync(hermesHome, { recursive: true })
      const rootEnv = 'API_SERVER_ENABLED=true\nAPI_SERVER_KEY=abc123\n'
      fs.writeFileSync(path.join(hermesHome, '.env'), rootEnv)

      const mod = await freshBootstrap()
      mod.ensureBuiltinProfiles()

      expect(
        fs.readFileSync(path.join(hermesHome, 'active_profile'), 'utf-8').trim(),
      ).toBe('hermes-switch')
      // Without this copy the gateway boots with HERMES_HOME pointed at the
      // profile, loses API_SERVER_ENABLED (load_hermes_dotenv has no root
      // fallback) and never binds :8642.
      expect(fs.readFileSync(profileEnvPath(home), 'utf-8')).toBe(rootEnv)
    })
  })

  it('only the adopted profile gets the copy; the other builtins stay empty', async () => {
    await withTempHome(async (home) => {
      const hermesHome = path.join(home, '.hermes')
      fs.mkdirSync(hermesHome, { recursive: true })
      fs.writeFileSync(path.join(hermesHome, '.env'), 'API_SERVER_ENABLED=true\n')

      const mod = await freshBootstrap()
      mod.ensureBuiltinProfiles()

      expect(fs.readFileSync(profileEnvPath(home), 'utf-8')).not.toBe('')
      expect(fs.readFileSync(profileEnvPath(home, 'neo'), 'utf-8')).toBe('')
    })
  })

  it('never overwrites a profile .env that already has content', async () => {
    await withTempHome(async (home) => {
      const hermesHome = path.join(home, '.hermes')
      fs.mkdirSync(path.join(hermesHome, 'profiles', 'hermes-switch'), {
        recursive: true,
      })
      fs.writeFileSync(path.join(hermesHome, '.env'), 'API_SERVER_ENABLED=true\n')
      fs.writeFileSync(profileEnvPath(home), 'PROFILE_OWN_KEY=keepme\n')

      const mod = await freshBootstrap()
      mod.ensureBuiltinProfiles()

      expect(fs.readFileSync(profileEnvPath(home), 'utf-8')).toBe(
        'PROFILE_OWN_KEY=keepme\n',
      )
    })
  })

  it('writes nothing when there is no root .env at all', async () => {
    await withTempHome(async (home) => {
      const mod = await freshBootstrap()
      mod.ensureBuiltinProfiles()

      expect(fs.readFileSync(profileEnvPath(home), 'utf-8')).toBe('')
    })
  })
})

// ── One-time repair of installs the previous rule already broke ────────────
describe('ensureBuiltinProfiles one-time repair of a harmful adoption', () => {
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

  type MarkerShape = {
    version: number
    adoptedProfile: string | null
    revertedAdoption?: { profile: string; at: string; reason: string }
  }

  function hermesHome(home: string): string {
    return path.join(home, '.hermes')
  }
  function markerPath(home: string): string {
    return path.join(hermesHome(home), '.profiles-bootstrap')
  }
  function activeProfilePath(home: string): string {
    return path.join(hermesHome(home), 'active_profile')
  }
  function readActiveProfile(home: string): string | null {
    const p = activeProfilePath(home)
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8').trim() : null
  }
  function readMarker(home: string): MarkerShape | null {
    const p = markerPath(home)
    if (!fs.existsSync(p)) return null
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as MarkerShape
  }

  /**
   * Reproduce the exact on-disk shape the previous release left behind:
   * a v1 marker naming the adopted profile, `active_profile` still pointing
   * at it, a populated root `.env`, and a 0-byte profile `.env`.
   *
   * Written in adoption order (pointer, then marker) so the marker's mtime is
   * >= the pointer's — the "the user has not re-selected this since" check.
   */
  function seedBrokenAdoption(
    home: string,
    options?: {
      rootEnv?: string | null
      profileEnv?: string | null
      activeProfile?: string | null
      adoptedProfile?: string | null
      marker?: Partial<MarkerShape>
    },
  ): void {
    const root = hermesHome(home)
    const profileDir = path.join(root, 'profiles', 'hermes-switch')
    fs.mkdirSync(profileDir, { recursive: true })

    const rootEnv = options?.rootEnv
    if (rootEnv !== null) {
      fs.writeFileSync(
        path.join(root, '.env'),
        rootEnv ?? 'API_SERVER_ENABLED=true\nAPI_SERVER_KEY=abc123\n',
      )
    }

    const profileEnv = options?.profileEnv
    if (profileEnv !== null) {
      fs.writeFileSync(path.join(profileDir, '.env'), profileEnv ?? '')
    }

    const active =
      options?.activeProfile === undefined
        ? 'hermes-switch'
        : options.activeProfile
    if (active !== null) fs.writeFileSync(activeProfilePath(home), `${active}\n`)

    const adopted =
      options?.adoptedProfile === undefined
        ? 'hermes-switch'
        : options.adoptedProfile
    fs.writeFileSync(
      markerPath(home),
      JSON.stringify({
        version: 1,
        adoptedProfile: adopted,
        ...(options?.marker ?? {}),
      }),
    )
  }

  it('reverts to the root config on the exact broken shape', async () => {
    await withTempHome(async (home) => {
      seedBrokenAdoption(home)

      const mod = await freshBootstrap()
      mod.ensureBuiltinProfiles()

      // active_profile removed → gateway boots on ~/.hermes again.
      expect(readActiveProfile(home)).toBeNull()
      const marker = readMarker(home)
      expect(marker?.adoptedProfile).toBeNull()
      expect(marker?.revertedAdoption?.profile).toBe('hermes-switch')
      expect(marker?.revertedAdoption?.reason).toBe(
        'adopted-profile-had-empty-env-while-root-env-was-populated',
      )
      // The profile itself is untouched — nothing is deleted.
      expect(
        fs.existsSync(path.join(hermesHome(home), 'profiles', 'hermes-switch')),
      ).toBe(true)
    })
  })

  it('does not re-adopt after repairing (the marker still gates adoption)', async () => {
    await withTempHome(async (home) => {
      seedBrokenAdoption(home)

      const mod = await freshBootstrap()
      mod.ensureBuiltinProfiles()

      expect(readActiveProfile(home)).toBeNull()
    })
  })

  it('is idempotent — a second run does not touch anything', async () => {
    await withTempHome(async (home) => {
      seedBrokenAdoption(home)

      const mod1 = await freshBootstrap()
      mod1.ensureBuiltinProfiles()
      const firstMarker = readMarker(home)

      const mod2 = await freshBootstrap()
      mod2.ensureBuiltinProfiles()

      expect(readActiveProfile(home)).toBeNull()
      expect(readMarker(home)).toEqual(firstMarker)
    })
  })

  it('does NOT fire when the user has since chosen a different profile', async () => {
    await withTempHome(async (home) => {
      seedBrokenAdoption(home, { activeProfile: 'neo' })

      const mod = await freshBootstrap()
      mod.ensureBuiltinProfiles()

      expect(readActiveProfile(home)).toBe('neo')
      expect(readMarker(home)?.revertedAdoption).toBeUndefined()
    })
  })

  it('does NOT fire when the user has since reverted to default themselves', async () => {
    await withTempHome(async (home) => {
      seedBrokenAdoption(home, { activeProfile: null })

      const mod = await freshBootstrap()
      mod.ensureBuiltinProfiles()

      expect(readActiveProfile(home)).toBeNull()
      expect(readMarker(home)?.revertedAdoption).toBeUndefined()
    })
  })

  it('does NOT fire when the marker records no adoptedProfile', async () => {
    await withTempHome(async (home) => {
      // Marker says "evaluated, adopted nothing" — whatever active_profile
      // names was the user's own doing.
      seedBrokenAdoption(home, { adoptedProfile: null })

      const mod = await freshBootstrap()
      mod.ensureBuiltinProfiles()

      expect(readActiveProfile(home)).toBe('hermes-switch')
      expect(readMarker(home)?.revertedAdoption).toBeUndefined()
    })
  })

  it('does NOT fire when the adopted profile has its own .env', async () => {
    await withTempHome(async (home) => {
      seedBrokenAdoption(home, { profileEnv: 'API_SERVER_ENABLED=true\n' })

      const mod = await freshBootstrap()
      mod.ensureBuiltinProfiles()

      expect(readActiveProfile(home)).toBe('hermes-switch')
      expect(readMarker(home)?.revertedAdoption).toBeUndefined()
    })
  })

  it('still fires when the profile .env holds only comments and blank lines', async () => {
    await withTempHome(async (home) => {
      // Comments-only is still "no assignments", so this SHOULD repair —
      // asserting the parser ignores comments rather than counting lines.
      seedBrokenAdoption(home, { profileEnv: '# nothing here\n\n' })

      const mod = await freshBootstrap()
      mod.ensureBuiltinProfiles()

      expect(readActiveProfile(home)).toBeNull()
    })
  })

  it('does NOT fire when the root .env is empty', async () => {
    await withTempHome(async (home) => {
      seedBrokenAdoption(home, { rootEnv: '' })

      const mod = await freshBootstrap()
      mod.ensureBuiltinProfiles()

      expect(readActiveProfile(home)).toBe('hermes-switch')
      expect(readMarker(home)?.revertedAdoption).toBeUndefined()
    })
  })

  it('does NOT fire when there is no root .env at all', async () => {
    await withTempHome(async (home) => {
      seedBrokenAdoption(home, { rootEnv: null })

      const mod = await freshBootstrap()
      mod.ensureBuiltinProfiles()

      expect(readActiveProfile(home)).toBe('hermes-switch')
    })
  })

  it('does NOT fire when active_profile was re-written after the marker', async () => {
    await withTempHome(async (home) => {
      seedBrokenAdoption(home)
      // The user re-selected the same profile through the UI after adoption.
      // Identical file contents; the only evidence is the mtime ordering.
      const later = new Date(Date.now() + 60_000)
      fs.utimesSync(activeProfilePath(home), later, later)

      const mod = await freshBootstrap()
      mod.ensureBuiltinProfiles()

      expect(readActiveProfile(home)).toBe('hermes-switch')
      expect(readMarker(home)?.revertedAdoption).toBeUndefined()
    })
  })

  it('does NOT fire when the marker already records a revert', async () => {
    await withTempHome(async (home) => {
      seedBrokenAdoption(home, {
        marker: {
          revertedAdoption: {
            profile: 'hermes-switch',
            at: '2026-01-01T00:00:00.000Z',
            reason: 'already-done',
          },
        },
      })

      const mod = await freshBootstrap()
      mod.ensureBuiltinProfiles()

      expect(readActiveProfile(home)).toBe('hermes-switch')
      expect(readMarker(home)?.revertedAdoption?.reason).toBe('already-done')
    })
  })

  it('HERMES_SKIP_PROFILE_BOOTSTRAP=1 disables the repair too', async () => {
    await withTempHome(async (home) => {
      seedBrokenAdoption(home)
      process.env.HERMES_SKIP_PROFILE_BOOTSTRAP = '1'

      const mod = await freshBootstrap()
      mod.ensureBuiltinProfiles()

      expect(readActiveProfile(home)).toBe('hermes-switch')
      expect(readMarker(home)?.revertedAdoption).toBeUndefined()
    })
  })
})
