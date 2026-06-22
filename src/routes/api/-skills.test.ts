import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const dashboardFetch = vi.fn()
const listProfiles = vi.fn()
const getActiveProfileName = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => opts,
}))

vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: () => true,
}))

vi.mock('../../server/rate-limit', () => ({
  requireJsonContentType: () => null,
}))

vi.mock('../../server/gateway-capabilities', () => ({
  BEARER_TOKEN: '',
  CLAUDE_API: 'http://127.0.0.1:8642',
  CLAUDE_UPGRADE_INSTRUCTIONS: 'upgrade',
  dashboardFetch,
  ensureGatewayProbed: () => Promise.resolve({ skills: true }),
  getCapabilities: () => ({ dashboard: { available: true } }),
}))

vi.mock('../../server/profiles-browser', () => ({
  listProfiles,
  getActiveProfileName,
}))

function writeSkill(root: string, category: string, slug: string, description: string) {
  const dir = path.join(root, category, slug)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${slug}\ndescription: ${description}\ntags:\n  - ${category}\n---\n# ${slug}\n`,
    'utf-8',
  )
}

async function getHandler() {
  vi.resetModules()
  const mod = await import('./skills')
  return (mod as unknown as {
    Route: {
      server: {
        handlers: {
          GET: (ctx: { request: Request }) => Promise<Response>
        }
      }
    }
  }).Route.server.handlers.GET
}

describe('GET /api/skills — profile filtering', () => {
  let tempRoot: string
  let sharedSkillsRoot: string
  let hermesSwitchRoot: string
  let morpheusRoot: string
  let neoRoot: string
  let trinityRoot: string

  beforeEach(() => {
    vi.clearAllMocks()
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'switchui-skills-route-'))
    sharedSkillsRoot = path.join(tempRoot, 'shared-skills')
    hermesSwitchRoot = path.join(tempRoot, 'profiles', 'hermes-switch')
    morpheusRoot = path.join(tempRoot, 'profiles', 'morpheus')
    neoRoot = path.join(tempRoot, 'profiles', 'neo')
    trinityRoot = path.join(tempRoot, 'profiles', 'trinity')

    writeSkill(sharedSkillsRoot, 'shared', 'shared-skill', 'Shared across profiles')
    writeSkill(sharedSkillsRoot, 'data', 'jupyter-live-kernel', 'Shared runtime skill')
    writeSkill(path.join(hermesSwitchRoot, 'skills'), 'coding', 'switch-only-skill', 'Only for hermes-switch')
    writeSkill(path.join(morpheusRoot, 'skills'), 'research', 'morpheus-only-skill', 'Only for morpheus')
    writeSkill(path.join(neoRoot, 'skills'), 'research', 'neo-only-skill', 'Only for neo')
    writeSkill(path.join(morpheusRoot, 'skills'), 'shared', 'duo-skill', 'Shared by morpheus and neo')
    writeSkill(path.join(neoRoot, 'skills'), 'shared', 'duo-skill', 'Shared by morpheus and neo')
    writeSkill(path.join(morpheusRoot, 'skills'), 'data', 'jupyter-live-kernel', 'Runtime skill copy for morpheus')
    writeSkill(path.join(neoRoot, 'skills'), 'data', 'jupyter-live-kernel', 'Runtime skill copy for neo')

    process.env.HERMES_SKILLS_DIR = sharedSkillsRoot

    listProfiles.mockReturnValue([
      {
        name: 'hermes-switch',
        path: hermesSwitchRoot,
        active: true,
        skillCount: 1,
        agent_ui: { tier: 1 },
      },
      {
        name: 'morpheus',
        path: morpheusRoot,
        active: false,
        skillCount: 3,
        agent_ui: { tier: 2 },
      },
      {
        name: 'neo',
        path: neoRoot,
        active: false,
        skillCount: 3,
        agent_ui: { tier: 2 },
      },
      {
        name: 'trinity',
        path: trinityRoot,
        active: false,
        skillCount: 0,
        agent_ui: { tier: 2 },
      },
    ])
    getActiveProfileName.mockReturnValue('hermes-switch')

    dashboardFetch.mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: 'switch-only-skill',
            name: 'switch-only-skill',
            description: 'Runtime active skill payload',
            installed: true,
            enabled: true,
          },
          {
            id: 'jupyter-live-kernel',
            name: 'jupyter-live-kernel',
            description: 'Installed in the active runtime from shared storage',
            installed: true,
            enabled: true,
            sourcePath: path.join(sharedSkillsRoot, 'data', 'jupyter-live-kernel'),
          },
        ]),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )
  })

  afterEach(() => {
    delete process.env.HERMES_SKILLS_DIR
    fs.rmSync(tempRoot, { recursive: true, force: true })
  })

  it('defaults to the active runtime profile when no profile param is provided', async () => {
    const handler = await getHandler()
    const res = await handler({
      request: new Request('http://localhost/api/skills?tab=installed&limit=50'),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      selectedProfile: string
      activeProfile: string
      total: number
      skills: Array<{ id: string; profileNames?: Array<string>; shared?: boolean }>
    }

    expect(body.activeProfile).toBe('hermes-switch')
    expect(body.selectedProfile).toBe('hermes-switch')
    expect(body.skills.map((skill) => skill.id)).toContain('switch-only-skill')
    expect(body.skills.map((skill) => skill.id)).toContain('shared-skill')
    expect(body.skills.map((skill) => skill.id)).not.toContain('morpheus-only-skill')
    expect(body.skills.find((skill) => skill.id === 'shared-skill')?.shared).toBe(true)
  })

  it('filters to a tier-2 profile and keeps shared skills visible', async () => {
    const handler = await getHandler()
    const res = await handler({
      request: new Request('http://localhost/api/skills?tab=installed&limit=50&profile=morpheus'),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      selectedProfile: string
      skills: Array<{ id: string; profileNames?: Array<string>; shared?: boolean }>
    }

    expect(body.selectedProfile).toBe('morpheus')
    expect(body.skills.map((skill) => skill.id)).toContain('morpheus-only-skill')
    expect(body.skills.map((skill) => skill.id)).toContain('shared-skill')
    expect(body.skills.map((skill) => skill.id)).toContain('duo-skill')
    expect(body.skills.map((skill) => skill.id)).not.toContain('switch-only-skill')
    expect(body.skills.find((skill) => skill.id === 'duo-skill')?.profileNames).toEqual(
      ['morpheus', 'neo'],
    )
  })

  it('supports the all-profiles union view', async () => {
    const handler = await getHandler()
    const res = await handler({
      request: new Request('http://localhost/api/skills?tab=installed&limit=50&profile=all'),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      selectedProfile: string
      total: number
      allProfilesTotal: number
      profiles: Array<{ name: string; skillCount: number; localSkillCount: number }>
      skills: Array<{ id: string }>
    }

    expect(body.selectedProfile).toBe('all')
    expect(body.total).toBe(body.allProfilesTotal)
    expect(body.skills.map((skill) => skill.id)).toEqual(
      expect.arrayContaining([
        'switch-only-skill',
        'morpheus-only-skill',
        'neo-only-skill',
        'shared-skill',
        'duo-skill',
      ]),
    )
    expect(body.profiles.find((profile) => profile.name === 'morpheus')).toMatchObject({
      skillCount: expect.any(Number),
      localSkillCount: 3,
    })
  })

  it('attributes active-runtime shared skills to the active profile without leaking them to unrelated profiles', async () => {
    const handler = await getHandler()

    const activeRes = await handler({
      request: new Request(
        'http://localhost/api/skills?tab=installed&limit=50&category=Data%20%26%20Analytics&profile=hermes-switch',
      ),
    })
    expect(activeRes.status).toBe(200)
    const activeBody = (await activeRes.json()) as {
      skills: Array<{ id: string; profileNames?: Array<string>; shared?: boolean }>
      profiles: Array<{ name: string; skillCount: number }>
    }

    expect(activeBody.skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'jupyter-live-kernel',
          shared: true,
          profileNames: ['hermes-switch', 'morpheus', 'neo'],
        }),
      ]),
    )
    expect(activeBody.profiles.find((profile) => profile.name === 'hermes-switch')?.skillCount).toBe(1)
    expect(activeBody.profiles.find((profile) => profile.name === 'morpheus')?.skillCount).toBe(1)
    expect(activeBody.profiles.find((profile) => profile.name === 'neo')?.skillCount).toBe(1)
    expect(activeBody.profiles.find((profile) => profile.name === 'trinity')?.skillCount).toBe(0)
  })
})
