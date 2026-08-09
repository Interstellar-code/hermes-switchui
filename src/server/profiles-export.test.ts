import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { invalidateProfilesCache, readProfile, writeProfile } from './profiles-browser'
import {
  MAX_SKILLS_FILE_COUNT,
  MAX_SKILLS_TOTAL_BYTES,
  PROFILE_BUNDLE_SCHEMA_VERSION,
  exportProfile,
  importProfile,
} from './profiles-export'
import type { ProfileExportBundle } from './profiles-export'

describe('profiles-export', () => {
  let tempHome: string
  let profilesRoot: string

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-profiles-export-'))
    profilesRoot = path.join(tempHome, '.hermes', 'profiles')
    fs.mkdirSync(profilesRoot, { recursive: true })
    vi.spyOn(os, 'homedir').mockReturnValue(tempHome)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    invalidateProfilesCache()
    fs.rmSync(tempHome, { recursive: true, force: true })
  })

  function makeProfile(name: string): string {
    const root = path.join(profilesRoot, name)
    fs.mkdirSync(root, { recursive: true })
    fs.writeFileSync(
      path.join(root, 'config.yaml'),
      'model:\n  default: auto\n  provider: manifest\n',
      'utf-8',
    )
    return root
  }

  // ── exportProfile ───────────────────────────────────────────────────────

  describe('exportProfile', () => {
    it('produces the documented bundle shape with schemaVersion, name, config, skills', () => {
      makeProfile('agent1')
      const bundle = exportProfile('agent1')
      expect(bundle.schemaVersion).toBe(PROFILE_BUNDLE_SCHEMA_VERSION)
      expect(bundle.name).toBe('agent1')
      expect(bundle.config).toBeTypeOf('object')
      expect(bundle.skills).toEqual({})
      expect(bundle.soul).toBeUndefined()
      expect(bundle.memoryMd).toBeUndefined()
      expect(bundle.identityMd).toBeUndefined()
    })

    it('includes SOUL.md, memories/MEMORY.md and memory/IDENTITY.md when present', () => {
      const root = makeProfile('agent2')
      fs.writeFileSync(path.join(root, 'SOUL.md'), '# Soul\n', 'utf-8')
      fs.mkdirSync(path.join(root, 'memories'), { recursive: true })
      fs.writeFileSync(path.join(root, 'memories', 'MEMORY.md'), '# Memory\n', 'utf-8')
      fs.mkdirSync(path.join(root, 'memory'), { recursive: true })
      fs.writeFileSync(path.join(root, 'memory', 'IDENTITY.md'), '# Identity\n', 'utf-8')

      const bundle = exportProfile('agent2')
      expect(bundle.soul).toBe('# Soul\n')
      expect(bundle.memoryMd).toBe('# Memory\n')
      expect(bundle.identityMd).toBe('# Identity\n')
    })

    it('walks the skills/ tree into relative-path -> contents', () => {
      const root = makeProfile('agent3')
      fs.mkdirSync(path.join(root, 'skills', 'one'), { recursive: true })
      fs.writeFileSync(path.join(root, 'skills', 'one', 'SKILL.md'), 'do a thing', 'utf-8')
      fs.mkdirSync(path.join(root, 'skills', 'two', 'nested'), { recursive: true })
      fs.writeFileSync(
        path.join(root, 'skills', 'two', 'nested', 'SKILL.md'),
        'do another thing',
        'utf-8',
      )

      const bundle = exportProfile('agent3')
      expect(bundle.skills).toEqual({
        'one/SKILL.md': 'do a thing',
        'two/nested/SKILL.md': 'do another thing',
      })
    })

    it('never includes .env or sessions/', () => {
      const root = makeProfile('agent4')
      fs.writeFileSync(path.join(root, '.env'), 'CUSTOM_API_KEY=sk-super-secret\n', 'utf-8')
      fs.mkdirSync(path.join(root, 'sessions'), { recursive: true })
      fs.writeFileSync(path.join(root, 'sessions', 'run.jsonl'), '{"secret":true}', 'utf-8')

      const bundle = exportProfile('agent4')
      const serialized = JSON.stringify(bundle)
      expect(serialized).not.toContain('sk-super-secret')
      expect(serialized).not.toContain('"sessions"')
      expect(Object.keys(bundle.skills)).not.toContain('.env')
    })

    it('masks secret-shaped values found in config.yaml', () => {
      makeProfile('agent5')
      writeProfile('agent5', {
        mcp_servers: {
          myserver: { command: 'npx', args: [], headers: { authorization: 'Bearer sk-abcdef123456' } },
        },
      })

      const bundle = exportProfile('agent5')
      const headers = (bundle.config.mcp_servers as Record<string, { headers: Record<string, string> }>)
        .myserver.headers
      expect(headers.authorization).not.toBe('Bearer sk-abcdef123456')
      expect(headers.authorization).toMatch(/…••••$/)
    })

    it('strips the read-time `builtin` flag so it never round-trips through export', () => {
      makeProfile('neo')
      const bundle = exportProfile('neo')
      expect('builtin' in bundle.config).toBe(false)
    })

    it('refuses to export a skills/ tree over the size ceiling', () => {
      const root = makeProfile('agent6')
      fs.mkdirSync(path.join(root, 'skills'), { recursive: true })
      // One file just over the ceiling.
      fs.writeFileSync(
        path.join(root, 'skills', 'huge.md'),
        'x'.repeat(MAX_SKILLS_TOTAL_BYTES + 1),
        'utf-8',
      )
      expect(() => exportProfile('agent6')).toThrow(/exceeds export size limit/)
    })

    it('refuses to export a skills/ tree with too many files', () => {
      const root = makeProfile('agent7')
      const skillsDir = path.join(root, 'skills')
      fs.mkdirSync(skillsDir, { recursive: true })
      for (let i = 0; i < MAX_SKILLS_FILE_COUNT + 1; i++) {
        fs.writeFileSync(path.join(skillsDir, `f${i}.md`), 'x', 'utf-8')
      }
      expect(() => exportProfile('agent7')).toThrow(/exceeds export size limit/)
    })

    it('throws "Profile not found" for a missing profile', () => {
      expect(() => exportProfile('does-not-exist')).toThrow('Profile not found')
    })
  })

  // ── importProfile ─────────────────────────────────────────────────────────

  function validBundle(overrides: Partial<ProfileExportBundle> = {}): ProfileExportBundle {
    return {
      schemaVersion: PROFILE_BUNDLE_SCHEMA_VERSION,
      name: 'imported-agent',
      config: { description: 'An imported agent', model: { default: 'auto', provider: 'manifest' } },
      skills: {},
      ...overrides,
    }
  }

  describe('importProfile', () => {
    it('happy path: creates the profile with normalised agent_ui and imported files', () => {
      const bundle = validBundle({
        soul: '# Soul\n',
        memoryMd: '# Memory\n',
        identityMd: '# Identity\n',
        skills: { 'one/SKILL.md': 'contents' },
        config: {
          description: 'An imported agent',
          agent_ui: { tier: 1, status: 'active', glyph: 'IM', role: 'Imported', last_run: 999 },
        },
      })

      const detail = importProfile(bundle)
      expect(detail.name).toBe('imported-agent')
      expect(detail.config.description).toBe('An imported agent')
      expect(fs.readFileSync(path.join(detail.path, 'SOUL.md'), 'utf-8')).toBe('# Soul\n')
      expect(fs.readFileSync(path.join(detail.path, 'memories', 'MEMORY.md'), 'utf-8')).toBe(
        '# Memory\n',
      )
      expect(fs.readFileSync(path.join(detail.path, 'memory', 'IDENTITY.md'), 'utf-8')).toBe(
        '# Identity\n',
      )
      expect(fs.readFileSync(path.join(detail.path, 'skills', 'one', 'SKILL.md'), 'utf-8')).toBe(
        'contents',
      )
    })

    it('normalises agent_ui exactly like the clone path: tier 3, status draft, last_run null', () => {
      const bundle = validBundle({
        config: {
          agent_ui: { tier: 1, status: 'active', glyph: 'IM', role: 'Imported', last_run: 999, tags: ['x'] },
        },
      })
      const detail = importProfile(bundle)
      expect(detail.config.agent_ui?.tier).toBe(3)
      expect(detail.config.agent_ui?.status).toBe('draft')
      expect(detail.config.agent_ui?.last_run).toBeNull()
      // authored identity survives
      expect(detail.config.agent_ui?.glyph).toBe('IM')
      expect(detail.config.agent_ui?.role).toBe('Imported')
      expect(detail.config.agent_ui?.tags).toEqual(['x'])
    })

    it('rejects an unsupported schema version', () => {
      const bundle = validBundle({ schemaVersion: 999 as typeof PROFILE_BUNDLE_SCHEMA_VERSION })
      expect(() => importProfile(bundle)).toThrow('Unsupported profile bundle schema version')
    })

    it('rejects a name collision with a clear conflict error', () => {
      makeProfile('imported-agent')
      const bundle = validBundle()
      expect(() => importProfile(bundle)).toThrow('Profile already exists')
    })

    it('rejects a name that fails the canonical name rule', () => {
      const bundle = validBundle({ name: 'My Agent!!' })
      expect(() => importProfile(bundle)).toThrow('Invalid profile name')
    })

    it('rejects "default" as an import target', () => {
      const bundle = validBundle({ name: 'default' })
      expect(() => importProfile(bundle)).toThrow('Default profile cannot be modified here')
    })

    it('rejects a reserved built-in name', () => {
      const bundle = validBundle({ name: 'neo' })
      expect(() => importProfile(bundle)).toThrow(/reserved for built-in agents/)
    })

    it('honours the `name` option over the bundle\'s own name', () => {
      const bundle = validBundle({ name: 'original-name' })
      const detail = importProfile(bundle, { name: 'renamed-on-import' })
      expect(detail.name).toBe('renamed-on-import')
      expect(fs.existsSync(path.join(profilesRoot, 'original-name'))).toBe(false)
    })

    it('rejects a skills path that escapes the profile directory with ..', () => {
      const bundle = validBundle({ skills: { '../../etc/passwd': 'pwned' } })
      expect(() => importProfile(bundle)).toThrow(/Invalid skills path/)
      // Must not have created anything before or during the rejected write.
      expect(fs.existsSync(path.join(profilesRoot, 'imported-agent'))).toBe(false)
    })

    it('rejects an absolute skills path', () => {
      const bundle = validBundle({ skills: { '/etc/passwd': 'pwned' } })
      expect(() => importProfile(bundle)).toThrow(/Invalid skills path/)
    })

    it('rejects a Windows-style absolute skills path', () => {
      const bundle = validBundle({ skills: { 'C:\\Windows\\System32\\evil.dll': 'pwned' } })
      expect(() => importProfile(bundle)).toThrow(/Invalid skills path/)
    })

    it('rejects a malformed bundle (not an object)', () => {
      expect(() => importProfile('not a bundle')).toThrow('Invalid profile bundle')
      expect(() => importProfile(null)).toThrow('Invalid profile bundle')
      expect(() => importProfile(['array'])).toThrow('Invalid profile bundle')
    })

    it('rejects a bundle whose config is not an object', () => {
      const bundle = { ...validBundle(), config: 'not-an-object' }
      expect(() => importProfile(bundle)).toThrow(/config must be an object/)
    })

    it('rejects a bundle whose skills map has a non-string value', () => {
      const bundle = validBundle({ skills: { 'x.md': 123 as unknown as string } })
      expect(() => importProfile(bundle)).toThrow(/must be a string/)
    })

    it('refuses a skills tree over the size ceiling', () => {
      const bundle = validBundle({
        skills: { 'huge.md': 'x'.repeat(MAX_SKILLS_TOTAL_BYTES + 1) },
      })
      expect(() => importProfile(bundle)).toThrow(/exceeds export size limit/)
    })
  })

  // ── round-trip ────────────────────────────────────────────────────────────

  describe('export -> import round-trip', () => {
    it('produces a config that matches under a new name', () => {
      const root = makeProfile('source-agent')
      fs.writeFileSync(path.join(root, 'SOUL.md'), '# Soul\n', 'utf-8')
      writeProfile('source-agent', {
        description: 'Round trip test',
        agent_ui: { tier: 3, status: 'idle', glyph: 'RT', role: 'Round Tripper', tags: ['a', 'b'] },
        skills: { external_dirs: ['/shared'] },
      })
      fs.mkdirSync(path.join(root, 'skills', 'sub'), { recursive: true })
      fs.writeFileSync(path.join(root, 'skills', 'sub', 'SKILL.md'), 'roundtrip skill', 'utf-8')

      const bundle = exportProfile('source-agent')
      const imported = importProfile(bundle, { name: 'source-agent-copy' })

      expect(imported.config.description).toBe('Round trip test')
      expect(imported.config.skills).toEqual({ external_dirs: ['/shared'] })
      expect(imported.config.agent_ui?.glyph).toBe('RT')
      expect(imported.config.agent_ui?.role).toBe('Round Tripper')
      expect(imported.config.agent_ui?.tags).toEqual(['a', 'b'])
      // agent_ui.status is normalised on import, unlike the rest of config
      expect(imported.config.agent_ui?.status).toBe('draft')
      expect(fs.readFileSync(path.join(imported.path, 'SOUL.md'), 'utf-8')).toBe('# Soul\n')
      expect(
        fs.readFileSync(path.join(imported.path, 'skills', 'sub', 'SKILL.md'), 'utf-8'),
      ).toBe('roundtrip skill')

      // original untouched
      const original = readProfile('source-agent')
      expect(original.config.agent_ui?.status).toBe('idle')
    })
  })
})
