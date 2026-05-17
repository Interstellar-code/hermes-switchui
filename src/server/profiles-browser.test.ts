import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { listProfiles, readProfile, writeProfile } from './profiles-browser'

describe('listProfiles', () => {
  let tempHome: string

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-switchui-profiles-'))
    vi.spyOn(os, 'homedir').mockReturnValue(tempHome)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(tempHome, { recursive: true, force: true })
  })

  it('always includes the default profile even when a named profile is active', () => {
    const hermesRoot = path.join(tempHome, '.hermes')
    const profilesRoot = path.join(hermesRoot, 'profiles')
    const namedProfileRoot = path.join(profilesRoot, 'jarvis')

    fs.mkdirSync(namedProfileRoot, { recursive: true })
    fs.writeFileSync(path.join(hermesRoot, 'active_profile'), 'jarvis\n', 'utf-8')
    fs.writeFileSync(path.join(hermesRoot, 'config.yaml'), 'model: default-model\n', 'utf-8')
    fs.writeFileSync(path.join(namedProfileRoot, 'config.yaml'), 'model: named-model\n', 'utf-8')

    const profiles = listProfiles()
    const names = profiles.map((profile) => profile.name)

    expect(names).toContain('default')
    expect(names).toContain('jarvis')
    expect(profiles.find((profile) => profile.name === 'default')?.active).toBe(false)
    expect(profiles.find((profile) => profile.name === 'jarvis')?.active).toBe(true)
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
    fs.writeFileSync(path.join(profilePath, 'config.yaml'), yamlContent, 'utf-8')
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
        filesystem: { command: 'npx', args: ['@modelcontextprotocol/server-filesystem', '/tmp'] },
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
    expect(detail.config.mcp_servers?.filesystem?.command).toBe('npx')
    expect(detail.config.skills?.external_dirs).toEqual(['/shared/skills'])
    // original model preserved
    expect((detail.config.model as Record<string, unknown>)?.default).toBe('auto')
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
})
