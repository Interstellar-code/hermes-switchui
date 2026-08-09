import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createProfile,
  deleteProfile,
  listProfiles,
  readProfile,
  renameProfile,
  setActiveProfile,
  writeProfile,
} from './profiles-browser'

describe('listProfiles', () => {
  let tempHome: string

  beforeEach(() => {
    tempHome = fs.mkdtempSync(
      path.join(os.tmpdir(), 'hermes-switchui-profiles-'),
    )
    vi.spyOn(os, 'homedir').mockReturnValue(tempHome)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(tempHome, { recursive: true, force: true })
  })

  it('shows the active named profile without duplicating the synthetic default profile', () => {
    const hermesRoot = path.join(tempHome, '.hermes')
    const profilesRoot = path.join(hermesRoot, 'profiles')
    const namedProfileRoot = path.join(profilesRoot, 'jarvis')

    fs.mkdirSync(namedProfileRoot, { recursive: true })
    fs.writeFileSync(
      path.join(hermesRoot, 'active_profile'),
      'jarvis\n',
      'utf-8',
    )
    fs.writeFileSync(
      path.join(hermesRoot, 'config.yaml'),
      'model: default-model\n',
      'utf-8',
    )
    fs.writeFileSync(
      path.join(namedProfileRoot, 'config.yaml'),
      'model: named-model\n',
      'utf-8',
    )

    const profiles = listProfiles()
    const names = profiles.map((profile) => profile.name)

    expect(names).not.toContain('default')
    expect(names).toContain('jarvis')
    expect(profiles.find((profile) => profile.name === 'jarvis')?.active).toBe(
      true,
    )
  })

  it('invalidates the cached listing when reverting to the default profile', () => {
    const hermesRoot = path.join(tempHome, '.hermes')
    const namedProfileRoot = path.join(hermesRoot, 'profiles', 'jarvis')

    fs.mkdirSync(namedProfileRoot, { recursive: true })
    fs.writeFileSync(
      path.join(hermesRoot, 'config.yaml'),
      'model: default-model\n',
      'utf-8',
    )
    fs.writeFileSync(
      path.join(namedProfileRoot, 'config.yaml'),
      'model: named-model\n',
      'utf-8',
    )

    setActiveProfile('jarvis')
    const before = listProfiles()
    expect(before.map((profile) => profile.name)).not.toContain('default')
    expect(before.find((profile) => profile.name === 'jarvis')?.active).toBe(
      true,
    )

    // Reverting to default must reset the cache like every other mutation —
    // this second listProfiles() lands well inside the 5s TTL.
    setActiveProfile('default')
    const after = listProfiles()
    expect(after.map((profile) => profile.name)).toContain('default')
    expect(after.find((profile) => profile.name === 'default')?.active).toBe(
      true,
    )
    expect(after.find((profile) => profile.name === 'jarvis')?.active).toBe(
      false,
    )
  })
})

describe('listProfiles — derived status and lastRunAt (P-06 / P-12)', () => {
  let tempHome: string
  let hermesRoot: string
  let profilesRoot: string

  // Fixed, deliberately-past timestamps so the seconds assertions are exact.
  const OLD_MS = Date.UTC(2026, 0, 1, 12, 0, 0)
  const MID_MS = Date.UTC(2026, 1, 2, 9, 15, 0)
  const NEW_MS = Date.UTC(2026, 2, 15, 8, 30, 0)

  beforeEach(() => {
    tempHome = fs.mkdtempSync(
      path.join(os.tmpdir(), 'hermes-profiles-derived-'),
    )
    hermesRoot = path.join(tempHome, '.hermes')
    profilesRoot = path.join(hermesRoot, 'profiles')
    fs.mkdirSync(profilesRoot, { recursive: true })
    vi.spyOn(os, 'homedir').mockReturnValue(tempHome)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(tempHome, { recursive: true, force: true })
  })

  function makeProfile(
    name: string,
    yamlContent = 'model:\n  default: auto\n',
  ) {
    const root = path.join(profilesRoot, name)
    fs.mkdirSync(root, { recursive: true })
    fs.writeFileSync(path.join(root, 'config.yaml'), yamlContent, 'utf-8')
    return root
  }

  /** Write a file under the profile (creating parents) and stamp its mtime. */
  function writeFileAt(root: string, relPath: string, mtimeMs?: number) {
    const full = path.join(root, relPath)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, '{}\n', 'utf-8')
    if (mtimeMs !== undefined) {
      fs.utimesSync(full, new Date(mtimeMs), new Date(mtimeMs))
    }
    return full
  }

  /**
   * setActiveProfile() resets the 5s listProfiles cache, so routing every
   * listing through it keeps these tests independent of each other.
   */
  function listAfterActivating(active: string) {
    setActiveProfile(active)
    const profiles = listProfiles()
    return (name: string) => {
      const found = profiles.find((profile) => profile.name === name)
      if (!found) throw new Error(`profile ${name} missing from listing`)
      return found
    }
  }

  it('derives active / idle / draft from reality, ignoring agent_ui.status on disk', () => {
    // `alpha` is the selected profile but its config claims `draft`.
    makeProfile(
      'alpha',
      'model:\n  default: auto\nagent_ui:\n  status: draft\n',
    )
    // `beta` has run before but its config claims `active`.
    const betaRoot = makeProfile(
      'beta',
      'model:\n  default: auto\nagent_ui:\n  status: active\n',
    )
    writeFileAt(betaRoot, path.join('sessions', 'run.jsonl'))
    // `gamma` has never run but its config also claims `active`.
    makeProfile(
      'gamma',
      'model:\n  default: auto\nagent_ui:\n  status: active\n',
    )

    const get = listAfterActivating('alpha')

    expect(get('alpha').status).toBe('active')
    expect(get('beta').status).toBe('idle')
    expect(get('gamma').status).toBe('draft')

    // `active: boolean` is untouched — several consumers still read it.
    expect(get('alpha').active).toBe(true)
    expect(get('beta').active).toBe(false)
  })

  it('leaves the legacy agent_ui.status untouched on disk', () => {
    makeProfile(
      'gamma',
      'model:\n  default: auto\nagent_ui:\n  status: active\n',
    )
    makeProfile('alpha')

    const get = listAfterActivating('alpha')
    expect(get('gamma').status).toBe('draft')
    // Surfaced as inert legacy data, not rewritten.
    expect(get('gamma').agent_ui?.status).toBe('active')
    expect(
      fs.readFileSync(path.join(profilesRoot, 'gamma', 'config.yaml'), 'utf-8'),
    ).toContain('status: active')
  })

  it('flips a profile from idle to active when it is selected', () => {
    makeProfile('alpha')
    const betaRoot = makeProfile('beta')
    writeFileAt(betaRoot, path.join('sessions', 'run.jsonl'))

    expect(listAfterActivating('alpha')('beta').status).toBe('idle')
    expect(listAfterActivating('beta')('beta').status).toBe('active')
  })

  it('reports lastRunAt as null when the profile has no sessions', () => {
    makeProfile('alpha')
    const betaRoot = makeProfile('beta')
    fs.mkdirSync(path.join(betaRoot, 'sessions'), { recursive: true })

    const get = listAfterActivating('alpha')
    // No sessions/ directory at all…
    expect(get('alpha').lastRunAt).toBeNull()
    // …and an empty one.
    expect(get('beta').lastRunAt).toBeNull()
  })

  it('reports lastRunAt as the newest session mtime in UNIX SECONDS', () => {
    makeProfile('alpha')
    const betaRoot = makeProfile('beta')
    writeFileAt(betaRoot, path.join('sessions', 'older.jsonl'), OLD_MS)
    writeFileAt(betaRoot, path.join('sessions', 'newest.jsonl'), NEW_MS)
    writeFileAt(betaRoot, path.join('sessions', 'middle.jsonl'), MID_MS)

    const beta = listAfterActivating('alpha')('beta')

    expect(beta.lastRunAt).toBe(Math.floor(NEW_MS / 1000))
    // Guard the unit: the client computes `Date.now() / 1000 - ts`, so a
    // millisecond value here would render as a far-future timestamp.
    expect(beta.lastRunAt).toBeLessThan(Date.now() / 1000)
    expect(beta.lastRunAt).toBeLessThan(NEW_MS)
  })

  it('finds the newest session inside nested subdirectories', () => {
    makeProfile('alpha')
    const betaRoot = makeProfile('beta')
    writeFileAt(betaRoot, path.join('sessions', 'top.jsonl'), OLD_MS)
    writeFileAt(
      betaRoot,
      path.join('sessions', '2026', '03', 'deep.jsonl'),
      NEW_MS,
    )

    const beta = listAfterActivating('alpha')('beta')
    expect(beta.lastRunAt).toBe(Math.floor(NEW_MS / 1000))
    expect(beta.sessionCount).toBe(2)
  })

  it('ignores non-session files when deriving lastRunAt and sessionCount', () => {
    makeProfile('alpha')
    const betaRoot = makeProfile('beta')
    writeFileAt(betaRoot, path.join('sessions', 'run.jsonl'), OLD_MS)
    // Newest file in the tree, but not a session artefact.
    writeFileAt(betaRoot, path.join('sessions', 'README.txt'), NEW_MS)

    const beta = listAfterActivating('alpha')('beta')
    expect(beta.sessionCount).toBe(1)
    expect(beta.lastRunAt).toBe(Math.floor(OLD_MS / 1000))
  })

  it('still counts sessions and skills correctly after the traversal refactor', () => {
    makeProfile('alpha')
    const betaRoot = makeProfile('beta')
    // Sessions: 4 matching extensions, nested, plus 2 non-matching files.
    writeFileAt(betaRoot, path.join('sessions', 'a.jsonl'))
    writeFileAt(betaRoot, path.join('sessions', 'b.json'))
    writeFileAt(betaRoot, path.join('sessions', 'nested', 'c.sqlite'))
    writeFileAt(betaRoot, path.join('sessions', 'nested', 'deep', 'd.db'))
    writeFileAt(betaRoot, path.join('sessions', 'notes.md'))
    writeFileAt(betaRoot, path.join('sessions', 'nested', 'notes.txt'))
    // Skills: only files literally named SKILL.md count, at any depth.
    writeFileAt(betaRoot, path.join('skills', 'one', 'SKILL.md'))
    writeFileAt(betaRoot, path.join('skills', 'two', 'nested', 'SKILL.md'))
    writeFileAt(betaRoot, path.join('skills', 'two', 'README.md'))
    writeFileAt(betaRoot, path.join('skills', 'three', 'skill.md'))

    const beta = listAfterActivating('alpha')('beta')
    expect(beta.sessionCount).toBe(4)
    expect(beta.skillCount).toBe(2)
  })

  it('derives status and lastRunAt for the synthetic default profile too', () => {
    fs.mkdirSync(hermesRoot, { recursive: true })
    fs.writeFileSync(
      path.join(hermesRoot, 'config.yaml'),
      'model:\n  default: auto\n',
      'utf-8',
    )
    writeFileAt(hermesRoot, path.join('sessions', 'root-run.jsonl'), MID_MS)
    makeProfile('alpha')

    // Reverting to 'default' is what surfaces the synthetic row.
    const get = listAfterActivating('default')
    expect(get('default').status).toBe('active')
    expect(get('default').lastRunAt).toBe(Math.floor(MID_MS / 1000))
    expect(get('default').sessionCount).toBe(1)
    expect(get('alpha').status).toBe('draft')
  })
})

describe('profile name validation (P-09)', () => {
  let tempHome: string
  let profilesRoot: string

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-profiles-names-'))
    profilesRoot = path.join(tempHome, '.hermes', 'profiles')
    fs.mkdirSync(profilesRoot, { recursive: true })
    vi.spyOn(os, 'homedir').mockReturnValue(tempHome)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(tempHome, { recursive: true, force: true })
  })

  function makeRawProfileDir(name: string) {
    const root = path.join(profilesRoot, name)
    fs.mkdirSync(root, { recursive: true })
    fs.writeFileSync(
      path.join(root, 'config.yaml'),
      'model:\n  default: auto\n',
      'utf-8',
    )
    return root
  }

  it.each([
    ['My Agent!!'],
    ['-leading'],
    ['UPPER'],
    ['has space'],
    ['dot.name'],
    ['a'.repeat(65)],
  ])('createProfile rejects %j', (name) => {
    expect(() => createProfile(name)).toThrow(/Invalid profile name/)
    expect(fs.existsSync(path.join(profilesRoot, name))).toBe(false)
  })

  it.each([['hermes-switch-copy'], ['neo2'], ['a_b-c'], ['a'.repeat(64)]])(
    'createProfile accepts %j',
    (name) => {
      expect(() => createProfile(name)).not.toThrow()
      expect(fs.existsSync(path.join(profilesRoot, name, 'config.yaml'))).toBe(
        true,
      )
    },
  )

  it('createProfile still rejects an empty name and reserved names', () => {
    expect(() => createProfile('   ')).toThrow(/Profile name is required/)
    expect(() => createProfile('default')).toThrow(
      /Default profile cannot be modified here/,
    )
    expect(() => createProfile('hermes-switch')).toThrow(
      /reserved for built-in agents/,
    )
  })

  it('renameProfile rejects an invalid target name and leaves the source in place', () => {
    createProfile('good-name')

    expect(() => renameProfile('good-name', 'Bad Name')).toThrow(
      /Invalid profile name/,
    )
    expect(() => renameProfile('good-name', '-nope')).toThrow(
      /Invalid profile name/,
    )

    expect(fs.existsSync(path.join(profilesRoot, 'good-name'))).toBe(true)
    expect(fs.readdirSync(profilesRoot)).toEqual(['good-name'])
  })

  it('renameProfile accepts a canonical target name', () => {
    createProfile('good-name')
    const renamed = renameProfile('good-name', 'better_name-2')
    expect(renamed.name).toBe('better_name-2')
    expect(fs.existsSync(path.join(profilesRoot, 'better_name-2'))).toBe(true)
    expect(fs.existsSync(path.join(profilesRoot, 'good-name'))).toBe(false)
  })

  it('keeps an already-on-disk oddly-named profile readable, renamable and deletable', () => {
    // Created before the rule existed (or by hand). The write-path rule must
    // not strand it: reading, renaming and deleting all still work.
    makeRawProfileDir('My Agent!!')

    const detail = readProfile('My Agent!!')
    expect(detail.name).toBe('My Agent!!')
    expect((detail.config.model as Record<string, unknown>).default).toBe(
      'auto',
    )

    renameProfile('My Agent!!', 'my-agent')
    expect(fs.existsSync(path.join(profilesRoot, 'my-agent'))).toBe(true)

    makeRawProfileDir('Another Bad One')
    expect(() => deleteProfile('Another Bad One')).not.toThrow()
    expect(fs.existsSync(path.join(profilesRoot, 'Another Bad One'))).toBe(
      false,
    )
  })

  it.each([['../evil'], ['a/b'], ['a\\b'], ['..'], ['../../etc/passwd']])(
    'rejects the path-traversal name %j on every entry point',
    (name) => {
      expect(() => createProfile(name)).toThrow(/Invalid profile name/)
      expect(() => readProfile(name)).toThrow(/Invalid profile name/)
      expect(() => setActiveProfile(name)).toThrow(/Invalid profile name/)
      expect(() => deleteProfile(name)).toThrow(/Invalid profile name/)
      expect(() => renameProfile(name, 'ok-name')).toThrow(
        /Invalid profile name/,
      )
      expect(() => renameProfile('ok-name', name)).toThrow(
        /Invalid profile name/,
      )
    },
  )
})

describe('readProfile — built-in read-only contract (P-17)', () => {
  let tempHome: string
  let profilesRoot: string

  beforeEach(() => {
    tempHome = fs.mkdtempSync(
      path.join(os.tmpdir(), 'hermes-profiles-builtin-'),
    )
    profilesRoot = path.join(tempHome, '.hermes', 'profiles')
    fs.mkdirSync(path.join(profilesRoot, 'neo'), { recursive: true })
    fs.writeFileSync(
      path.join(profilesRoot, 'neo', 'config.yaml'),
      'model:\n  default: auto\n',
      'utf-8',
    )
    vi.spyOn(os, 'homedir').mockReturnValue(tempHome)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(tempHome, { recursive: true, force: true })
  })

  it('flags a built-in as builtin without claiming it is read-only', () => {
    const config = readProfile('neo').config as Record<string, unknown>
    expect(config.builtin).toBe(true)
    // The `readonly` flag contradicted updateProfileConfig, which deliberately
    // allows built-ins to be edited. Nothing consumed it; it must stay gone.
    expect('readonly' in config).toBe(false)
  })

  it('lets a built-in be edited, but never created, renamed or deleted', () => {
    writeProfile('neo', { description: 'Tuned in place' })
    expect(readProfile('neo').config.description).toBe('Tuned in place')

    expect(() => createProfile('neo')).toThrow(/reserved for built-in agents/)
    expect(() => renameProfile('neo', 'neo-2')).toThrow(
      /reserved for built-in agents/,
    )
    expect(() => deleteProfile('neo')).toThrow(/reserved for built-in agents/)
  })
})

describe('readProfile / writeProfile — new fields (PR-04)', () => {
  let tempHome: string

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-profiles-pr04-'))
    vi.spyOn(os, 'homedir').mockReturnValue(tempHome)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(tempHome, { recursive: true, force: true })
  })

  function makeProfile(name: string, yamlContent: string): void {
    const profilePath = path.join(tempHome, '.hermes', 'profiles', name)
    fs.mkdirSync(profilePath, { recursive: true })
    fs.writeFileSync(
      path.join(profilePath, 'config.yaml'),
      yamlContent,
      'utf-8',
    )
  }

  it('reads a legacy profile (no agent_ui block) — new fields are undefined', () => {
    makeProfile('legacy', 'model:\n  default: auto\n  provider: manifest\n')
    const detail = readProfile('legacy')
    expect(detail.config.agent_ui).toBeUndefined()
    expect(detail.config.agent).toBeUndefined()
    expect(detail.config.mcp_servers).toBeUndefined()
    expect(detail.config.skills).toBeUndefined()
  })

  it('read+write round-trip with agent_ui + mcp_servers + skills.external_dirs', () => {
    makeProfile('agent1', 'model:\n  default: auto\n  provider: manifest\n')

    writeProfile('agent1', {
      description: 'Test Agent',
      system_prompt: 'You are a test agent.',
      agent_ui: {
        tier: 3,
        glyph: 'TA',
        role: 'Tester',
        status: 'draft',
        tags: ['test', 'review'],
        persona_id: 'engineering-test',
        last_run: null,
      },
      mcp_servers: {
        filesystem: {
          command: 'npx',
          args: ['@modelcontextprotocol/server-filesystem', '/tmp'],
        },
      },
      skills: { external_dirs: ['/shared/skills'] },
    })

    const detail = readProfile('agent1')
    expect(detail.config.description).toBe('Test Agent')
    expect(detail.config.system_prompt).toBe('You are a test agent.')
    expect(detail.config.agent_ui?.tier).toBe(3)
    expect(detail.config.agent_ui?.glyph).toBe('TA')
    expect(detail.config.agent_ui?.tags).toEqual(['test', 'review'])
    expect(detail.config.agent_ui?.persona_id).toBe('engineering-test')
    expect(detail.config.mcp_servers?.filesystem.command).toBe('npx')
    expect(detail.config.skills?.external_dirs).toEqual(['/shared/skills'])
    // original model preserved
    expect((detail.config.model as Record<string, unknown>).default).toBe(
      'auto',
    )
  })

  it('partial update of agent_ui.tags — only the patched key changes', () => {
    makeProfile('agent2', 'model:\n  default: auto\n  provider: manifest\n')

    writeProfile('agent2', {
      agent_ui: {
        tier: 3,
        glyph: 'AG',
        role: 'Analyst',
        status: 'idle',
        tags: ['initial'],
        persona_id: null,
        last_run: null,
      },
    })

    // Partial update — only tags
    writeProfile('agent2', {
      agent_ui: { tags: ['updated', 'new-tag'] },
    })

    const detail = readProfile('agent2')
    expect(detail.config.agent_ui?.tags).toEqual(['updated', 'new-tag'])
    // Other agent_ui keys preserved
    expect(detail.config.agent_ui?.glyph).toBe('AG')
    expect(detail.config.agent_ui?.role).toBe('Analyst')
  })

  it('replaces mcp_servers wholesale so a deselected server is removed', () => {
    makeProfile('agent3', 'model:\n  default: auto\n  provider: manifest\n')

    writeProfile('agent3', {
      mcp_servers: {
        alpha: { command: 'alpha-cmd' },
        bravo: { command: 'bravo-cmd' },
      },
    })
    expect(
      Object.keys(readProfile('agent3').config.mcp_servers ?? {}).sort(),
    ).toEqual(['alpha', 'bravo'])

    // The wizard always posts the complete map, so one save can add, overwrite
    // and remove at once. A deep merge could never drop `bravo`.
    writeProfile('agent3', {
      mcp_servers: {
        alpha: { command: 'alpha-cmd-v2' },
        charlie: { url: 'http://charlie.local/mcp' },
      },
    })

    const config = readProfile('agent3').config
    expect(Object.keys(config.mcp_servers ?? {}).sort()).toEqual([
      'alpha',
      'charlie',
    ])
    expect(config.mcp_servers?.alpha.command).toBe('alpha-cmd-v2')
    expect(config.mcp_servers?.bravo).toBeUndefined()
    // Unrelated top-level keys are untouched by the replace-whole path
    expect((config.model as Record<string, unknown>).default).toBe('auto')
  })

  it('keeps agent_ui deep-merged — tier and status survive a patch that omits them', () => {
    makeProfile('agent4', 'model:\n  default: auto\n  provider: manifest\n')

    writeProfile('agent4', {
      agent_ui: {
        tier: 3,
        glyph: 'A4',
        role: 'Builder',
        status: 'active',
        tags: ['initial'],
        persona_id: 'engineering-builder',
        last_run: 1234,
      },
    })

    // Mirrors the wizard's edit payload, which deliberately omits `tier` and
    // `status` because the update route rejects them.
    writeProfile('agent4', {
      agent_ui: { glyph: 'B4', role: 'Reviewer', tags: ['updated'] },
    })

    const agentUi = readProfile('agent4').config.agent_ui
    expect(agentUi?.tier).toBe(3)
    expect(agentUi?.status).toBe('active')
    expect(agentUi?.last_run).toBe(1234)
    expect(agentUi?.persona_id).toBe('engineering-builder')
    expect(agentUi?.glyph).toBe('B4')
    expect(agentUi?.role).toBe('Reviewer')
    expect(agentUi?.tags).toEqual(['updated'])
  })
})

describe('createProfile — cloning (P-04)', () => {
  let tempHome: string
  let profilesRoot: string

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-profiles-clone-'))
    profilesRoot = path.join(tempHome, '.hermes', 'profiles')
    fs.mkdirSync(profilesRoot, { recursive: true })
    vi.spyOn(os, 'homedir').mockReturnValue(tempHome)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(tempHome, { recursive: true, force: true })
  })

  function makeSourceProfile(name: string, config: string): string {
    const root = path.join(profilesRoot, name)
    fs.mkdirSync(root, { recursive: true })
    fs.writeFileSync(path.join(root, 'config.yaml'), config, 'utf-8')
    return root
  }

  const BUILTIN_CONFIG = [
    'model:',
    '  default: auto',
    '  provider: manifest',
    'agent_ui:',
    '  tier: 1',
    '  glyph: HS',
    '  role: Orchestrator',
    '  status: active',
    '  tags:',
    '    - core',
    '    - orchestrator',
    '  persona_id: engineering-orchestrator',
    '  last_run: 1700000000000',
    '',
  ].join('\n')

  it('normalises tier/status/last_run when cloning a built-in, preserving identity fields', () => {
    makeSourceProfile('hermes-switch', BUILTIN_CONFIG)

    const clone = createProfile('hermes-switch-copy', {
      cloneFrom: 'hermes-switch',
    })

    expect(clone.config.agent_ui?.tier).toBe(3)
    expect(clone.config.agent_ui?.status).toBe('draft')
    expect(clone.config.agent_ui?.last_run).toBeNull()
    // Authored identity survives the clone
    expect(clone.config.agent_ui?.glyph).toBe('HS')
    expect(clone.config.agent_ui?.role).toBe('Orchestrator')
    expect(clone.config.agent_ui?.tags).toEqual(['core', 'orchestrator'])
    expect(clone.config.agent_ui?.persona_id).toBe('engineering-orchestrator')
    // ...and so does the rest of the config
    expect((clone.config.model as Record<string, unknown>).default).toBe('auto')

    // Persisted, not just returned
    const onDisk = readProfile('hermes-switch-copy')
    expect(onDisk.config.agent_ui?.tier).toBe(3)
    expect(onDisk.config.agent_ui?.status).toBe('draft')
  })

  it('normalises agent_ui even when the source profile has none', () => {
    makeSourceProfile('legacy-source', 'model:\n  default: auto\n')

    const clone = createProfile('legacy-copy', { cloneFrom: 'legacy-source' })

    expect(clone.config.agent_ui?.tier).toBe(3)
    expect(clone.config.agent_ui?.status).toBe('draft')
    expect(clone.config.agent_ui?.last_run).toBeNull()
  })

  it('copies SOUL.md and skills/ but not sessions/, memories/, memory/ or .env', () => {
    const sourceRoot = makeSourceProfile('rich-source', BUILTIN_CONFIG)
    fs.writeFileSync(
      path.join(sourceRoot, 'SOUL.md'),
      '# Source soul\n',
      'utf-8',
    )
    fs.mkdirSync(path.join(sourceRoot, 'skills', 'demo'), { recursive: true })
    fs.writeFileSync(
      path.join(sourceRoot, 'skills', 'demo', 'SKILL.md'),
      '# Demo skill\n',
      'utf-8',
    )
    fs.mkdirSync(path.join(sourceRoot, 'sessions'), { recursive: true })
    fs.writeFileSync(
      path.join(sourceRoot, 'sessions', 'past.jsonl'),
      '{}\n',
      'utf-8',
    )
    fs.mkdirSync(path.join(sourceRoot, 'memories'), { recursive: true })
    fs.writeFileSync(
      path.join(sourceRoot, 'memories', 'MEMORY.md'),
      'remembered\n',
      'utf-8',
    )
    fs.mkdirSync(path.join(sourceRoot, 'memory'), { recursive: true })
    fs.writeFileSync(
      path.join(sourceRoot, 'memory', 'store.db'),
      'blob',
      'utf-8',
    )
    fs.writeFileSync(
      path.join(sourceRoot, '.env'),
      'CUSTOM_API_KEY=secret\n',
      'utf-8',
    )

    createProfile('rich-copy', { cloneFrom: 'rich-source' })
    const cloneRoot = path.join(profilesRoot, 'rich-copy')

    // Authored assets come along
    expect(fs.readFileSync(path.join(cloneRoot, 'SOUL.md'), 'utf-8')).toBe(
      '# Source soul\n',
    )
    expect(
      fs.readFileSync(
        path.join(cloneRoot, 'skills', 'demo', 'SKILL.md'),
        'utf-8',
      ),
    ).toBe('# Demo skill\n')

    // History and secrets do not
    expect(fs.existsSync(path.join(cloneRoot, 'sessions', 'past.jsonl'))).toBe(
      false,
    )
    expect(fs.readdirSync(path.join(cloneRoot, 'sessions'))).toEqual([])
    expect(fs.existsSync(path.join(cloneRoot, 'memories'))).toBe(false)
    expect(fs.existsSync(path.join(cloneRoot, 'memory'))).toBe(false)
    expect(fs.existsSync(path.join(cloneRoot, '.env'))).toBe(false)
  })

  it('clones a source with no SOUL.md and no skills/ without failing', () => {
    makeSourceProfile('bare-source', 'model:\n  default: auto\n')

    expect(() =>
      createProfile('bare-copy', { cloneFrom: 'bare-source' }),
    ).not.toThrow()

    const cloneRoot = path.join(profilesRoot, 'bare-copy')
    expect(fs.existsSync(path.join(cloneRoot, 'SOUL.md'))).toBe(false)
    // The scaffolded (empty) subdirectories are still created
    expect(fs.readdirSync(path.join(cloneRoot, 'skills'))).toEqual([])
    expect(fs.readdirSync(path.join(cloneRoot, 'sessions'))).toEqual([])
  })
})
