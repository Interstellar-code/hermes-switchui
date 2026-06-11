/**
 * Route handler tests for /api/self-improve/scenarios* and profiles pause/resume routes.
 * Mirrors the -experiments.test.ts pattern.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { isAuthenticated } from '../../../server/auth-middleware'
import {
  createScenario,
  deleteScenario,
  listScenarios,
  pauseProfile,
  resumeProfile,
} from '../../../server/self-improve-client'
import { Route as ScenariosRoute } from './scenarios'
import { Route as ScenarioIdRoute } from './scenarios.$id'
import { Route as PauseRoute } from './profiles.$profile.pause'
import { Route as ResumeRoute } from './profiles.$profile.resume'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (path: string) => (options: unknown) => ({ path, options }),
}))

vi.mock('../../../server/auth-middleware', () => ({
  isAuthenticated: vi.fn(),
}))

vi.mock('../../../server/rate-limit', () => ({
  requireJsonContentType: vi.fn().mockReturnValue(null),
}))

vi.mock('../../../server/self-improve-client', () => ({
  listScenarios: vi.fn(),
  createScenario: vi.fn(),
  deleteScenario: vi.fn(),
  pauseProfile: vi.fn(),
  resumeProfile: vi.fn(),
}))

const scenariosHandlers = (ScenariosRoute as any).options.server.handlers
const scenarioIdHandlers = (ScenarioIdRoute as any).options.server.handlers
const pauseHandlers = (PauseRoute as any).options.server.handlers
const resumeHandlers = (ResumeRoute as any).options.server.handlers

const mockIsAuthenticated = vi.mocked(isAuthenticated)
const mockListScenarios = vi.mocked(listScenarios)
const mockCreateScenario = vi.mocked(createScenario)
const mockDeleteScenario = vi.mocked(deleteScenario)
const mockPauseProfile = vi.mocked(pauseProfile)
const mockResumeProfile = vi.mocked(resumeProfile)

function makeRequest(method: string, url: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

const baseScenario = {
  id: 1,
  profile: 'default',
  name: 'greeting',
  input: 'Hello',
  checks: '["contains hello"]',
  holdout: 0 as const,
  created_at: '2026-01-01T00:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsAuthenticated.mockReturnValue(false)
})

// ── GET /scenarios ─────────────────────────────────────────────────────────────

describe('GET /api/self-improve/scenarios', () => {
  it('returns 401 when not authenticated', async () => {
    mockIsAuthenticated.mockReturnValue(false)
    const req = makeRequest('GET', 'http://localhost/api/self-improve/scenarios?profile=default')
    const res: Response = await scenariosHandlers.GET({ request: req, params: {} })
    expect(res.status).toBe(401)
  })

  it('returns 400 when profile param is missing', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    const req = makeRequest('GET', 'http://localhost/api/self-improve/scenarios')
    const res: Response = await scenariosHandlers.GET({ request: req, params: {} })
    expect(res.status).toBe(400)
  })

  it('returns scenarios list on success', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockListScenarios.mockResolvedValue([baseScenario])
    const req = makeRequest('GET', 'http://localhost/api/self-improve/scenarios?profile=default')
    const res: Response = await scenariosHandlers.GET({ request: req, params: {} })
    expect(res.status).toBe(200)
    const body = await res.json() as { scenarios: Array<typeof baseScenario> }
    expect(body.scenarios).toHaveLength(1)
    expect(body.scenarios[0].name).toBe('greeting')
  })

  it('passes include_holdout param through to client', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockListScenarios.mockResolvedValue([])
    const req = makeRequest('GET', 'http://localhost/api/self-improve/scenarios?profile=default&include_holdout=1')
    await scenariosHandlers.GET({ request: req, params: {} })
    expect(mockListScenarios).toHaveBeenCalledWith('default', true)
  })
})

// ── POST /scenarios ────────────────────────────────────────────────────────────

describe('POST /api/self-improve/scenarios', () => {
  it('returns 401 when not authenticated', async () => {
    mockIsAuthenticated.mockReturnValue(false)
    const req = makeRequest('POST', 'http://localhost/api/self-improve/scenarios', { profile: 'p', name: 'n' })
    const res: Response = await scenariosHandlers.POST({ request: req, params: {} })
    expect(res.status).toBe(401)
  })

  it('returns 400 when profile or name is missing', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    const req = makeRequest('POST', 'http://localhost/api/self-improve/scenarios', { name: 'n' })
    const res: Response = await scenariosHandlers.POST({ request: req, params: {} })
    expect(res.status).toBe(400)
  })

  it('creates scenario and returns 201', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockCreateScenario.mockResolvedValue({ scenario_id: 42 })
    const req = makeRequest('POST', 'http://localhost/api/self-improve/scenarios', { profile: 'default', name: 'greeting' })
    const res: Response = await scenariosHandlers.POST({ request: req, params: {} })
    expect(res.status).toBe(201)
    const body = await res.json() as { scenario_id: number }
    expect(body.scenario_id).toBe(42)
  })

  it('returns 503 on client error', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockCreateScenario.mockRejectedValue(new Error('plugin down'))
    const req = makeRequest('POST', 'http://localhost/api/self-improve/scenarios', { profile: 'default', name: 'test' })
    const res: Response = await scenariosHandlers.POST({ request: req, params: {} })
    expect(res.status).toBe(503)
  })
})

// ── DELETE /scenarios/{id} ─────────────────────────────────────────────────────

describe('DELETE /api/self-improve/scenarios/$id', () => {
  it('returns 401 when not authenticated', async () => {
    mockIsAuthenticated.mockReturnValue(false)
    const req = makeRequest('DELETE', 'http://localhost/api/self-improve/scenarios/1')
    const res: Response = await scenarioIdHandlers.DELETE({ request: req, params: { id: '1' } })
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid id', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    const req = makeRequest('DELETE', 'http://localhost/api/self-improve/scenarios/abc')
    const res: Response = await scenarioIdHandlers.DELETE({ request: req, params: { id: 'abc' } })
    expect(res.status).toBe(400)
  })

  it('deletes and returns ok', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockDeleteScenario.mockResolvedValue({ ok: true })
    const req = makeRequest('DELETE', 'http://localhost/api/self-improve/scenarios/5')
    const res: Response = await scenarioIdHandlers.DELETE({ request: req, params: { id: '5' } })
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean }
    expect(body.ok).toBe(true)
    expect(mockDeleteScenario).toHaveBeenCalledWith(5)
  })

  it('returns 404 when scenario not found', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockDeleteScenario.mockRejectedValue(new Error('Self-Improve API error 404: not found'))
    const req = makeRequest('DELETE', 'http://localhost/api/self-improve/scenarios/99')
    const res: Response = await scenarioIdHandlers.DELETE({ request: req, params: { id: '99' } })
    expect(res.status).toBe(404)
  })
})

// ── POST /profiles/{profile}/pause ────────────────────────────────────────────

describe('POST /api/self-improve/profiles/$profile/pause', () => {
  it('returns 401 when not authenticated', async () => {
    mockIsAuthenticated.mockReturnValue(false)
    const req = makeRequest('POST', 'http://localhost/api/self-improve/profiles/default/pause', {})
    const res: Response = await pauseHandlers.POST({ request: req, params: { profile: 'default' } })
    expect(res.status).toBe(401)
  })

  it('pauses profile and returns ok + paused=true', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockPauseProfile.mockResolvedValue({ ok: true, profile: 'default', paused: true })
    const req = makeRequest('POST', 'http://localhost/api/self-improve/profiles/default/pause', {})
    const res: Response = await pauseHandlers.POST({ request: req, params: { profile: 'default' } })
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; paused: boolean }
    expect(body.ok).toBe(true)
    expect(body.paused).toBe(true)
    expect(mockPauseProfile).toHaveBeenCalledWith('default')
  })

  it('returns 503 on client error', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockPauseProfile.mockRejectedValue(new Error('plugin unavailable'))
    const req = makeRequest('POST', 'http://localhost/api/self-improve/profiles/default/pause', {})
    const res: Response = await pauseHandlers.POST({ request: req, params: { profile: 'default' } })
    expect(res.status).toBe(503)
  })
})

// ── POST /profiles/{profile}/resume ───────────────────────────────────────────

describe('POST /api/self-improve/profiles/$profile/resume', () => {
  it('returns 401 when not authenticated', async () => {
    mockIsAuthenticated.mockReturnValue(false)
    const req = makeRequest('POST', 'http://localhost/api/self-improve/profiles/default/resume', {})
    const res: Response = await resumeHandlers.POST({ request: req, params: { profile: 'default' } })
    expect(res.status).toBe(401)
  })

  it('resumes profile and returns ok + paused=false', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockResumeProfile.mockResolvedValue({ ok: true, profile: 'default', paused: false })
    const req = makeRequest('POST', 'http://localhost/api/self-improve/profiles/default/resume', {})
    const res: Response = await resumeHandlers.POST({ request: req, params: { profile: 'default' } })
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; paused: boolean }
    expect(body.ok).toBe(true)
    expect(body.paused).toBe(false)
    expect(mockResumeProfile).toHaveBeenCalledWith('default')
  })
})
