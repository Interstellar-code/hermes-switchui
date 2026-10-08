/**
 * Node environment on purpose: the TanStack Start plugin strips route
 * `server` handlers from client (jsdom) transforms. The store and the scope
 * module only need `window` + `localStorage`, stubbed below before import.
 *
 * The migration end to end through the REAL `PATCH /api/sessions` handler:
 * only the backend client (`hermes-api`), the portable-session store and the
 * auth/profile probes are mocked — the route's status mapping is what decides
 * "gone" vs "failed" vs "local", so it must not be stubbed out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  resetBackendFlagsMigrationForTest,
  runBackendFlagsMigration,
} from './session-flags-migration'
import { useSessionsLocalStore } from './sessions-local-store'
import { setSessionProfile } from '@/lib/session-scope'

vi.hoisted(() => {
  const data = new Map<string, string>()
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() {
      return data.size
    },
  }
  Object.assign(globalThis, { window: globalThis, localStorage: storage })
})

const hermes = vi.hoisted(() => ({
  ensureGatewayProbed: vi.fn(),
  updateSession: vi.fn(),
}))
const localStore = vi.hoisted(() => ({ getLocalSession: vi.fn() }))

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createFileRoute: (_path: string) => (opts: unknown) => ({ options: opts }),
}))
vi.mock('@/server/auth-middleware', () => ({ isAuthenticated: () => true }))
vi.mock('@/server/hermes-api', () => ({
  SESSIONS_API_UNAVAILABLE_MESSAGE: 'unavailable',
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  ensureGatewayProbed: hermes.ensureGatewayProbed,
  getSession: vi.fn(),
  listSessions: vi.fn(),
  searchSessions: vi.fn(),
  toSessionSummary: (s: { id: string }) => ({ key: s.id }),
  updateSession: hermes.updateSession,
}))
vi.mock('@/server/local-session-store', () => ({
  deleteLocalSession: vi.fn(),
  getLocalSession: localStore.getLocalSession,
  listLocalSessions: () => [],
  updateLocalSessionTitle: vi.fn(),
}))
vi.mock('@/server/profile-scope', () => ({
  readProfile: (v: unknown) => (typeof v === 'string' && v ? v : null),
  assertProfileServed: vi.fn(async () => {}),
  isProfileScopeError: () => false,
  profileErrorStatus: () => 500,
}))

type Handler = (ctx: { request: Request }) => Promise<Response>
const patchBodies: Array<Record<string, unknown>> = []

beforeEach(async () => {
  patchBodies.length = 0
  hermes.ensureGatewayProbed.mockResolvedValue({
    sessions: true,
    dashboard: { available: true },
    enhancedChat: true,
  })
  hermes.updateSession.mockResolvedValue({ id: 'ok' })
  localStore.getLocalSession.mockReturnValue(undefined)
  const mod = await import('@/routes/api/sessions.ts')
  const handler = (
    mod.Route as unknown as {
      options: { server: { handlers: Record<string, Handler> } }
    }
  ).options.server.handlers.PATCH
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      patchBodies.push(JSON.parse(String(init.body)))
      return handler({
        request: new Request(`http://localhost${url}`, init),
      })
    }
    return new Response(JSON.stringify({ sessions: [] }), { status: 200 })
  })
  useSessionsLocalStore.setState({
    archived: [],
    pinned: [],
    starred: [],
    backendFlagsMigrated: false,
  })
})

afterEach(() => {
  resetBackendFlagsMigrationForTest()
  setSessionProfile(null)
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('backend flags migration through the real PATCH route', () => {
  it('keeps an id when a 500 names a 2026-04-04 session (not "gone")', async () => {
    useSessionsLocalStore.setState({ archived: ['chat:20260404_140412_ab'] })
    hermes.updateSession.mockRejectedValue(
      Object.assign(
        new Error(
          'Hermes Agent API PATCH /api/sessions/20260404_140412_ab: 500 boom',
        ),
        { status: 500 },
      ),
    )

    const result = await runBackendFlagsMigration()

    expect(result.failed).toBe(1)
    expect(result.gone).toBe(0)
    const state = useSessionsLocalStore.getState()
    expect(state.archived).toEqual(['chat:20260404_140412_ab'])
    expect(state.backendFlagsMigrated).toBe(false)
  })

  it('drops an id the backend reports as "Session not found"', async () => {
    useSessionsLocalStore.setState({ pinned: ['chat:gone-1'] })
    hermes.updateSession.mockRejectedValue(
      Object.assign(
        new Error(
          'Hermes Agent API PATCH /api/sessions/gone-1: 404 {"error":"Session not found: gone-1"}',
        ),
        { status: 404 },
      ),
    )

    const result = await runBackendFlagsMigration()

    expect(result.gone).toBe(1)
    expect(useSessionsLocalStore.getState().pinned).toEqual([])
    expect(useSessionsLocalStore.getState().backendFlagsMigrated).toBe(true)
  })

  it('sends the active profile with every PATCH', async () => {
    setSessionProfile('work')
    useSessionsLocalStore.setState({
      archived: ['chat:a1'],
      pinned: ['chat:p1'],
    })

    await runBackendFlagsMigration()

    expect(patchBodies).toHaveLength(2)
    for (const body of patchBodies) expect(body.profile).toBe('work')
    expect(hermes.updateSession).toHaveBeenCalledWith(
      'a1',
      { title: undefined, archived: true, pinned: undefined },
      'work',
    )
  })

  it('keeps a local portable session mark and still completes', async () => {
    useSessionsLocalStore.setState({ archived: ['chat:loc-1', 'chat:b1'] })
    localStore.getLocalSession.mockImplementation((key: string) =>
      key === 'loc-1' ? { id: 'loc-1', createdAt: 1, messageCount: 0 } : null,
    )

    const result = await runBackendFlagsMigration()

    expect(result).toEqual({ migrated: 1, gone: 0, failed: 0 })
    const state = useSessionsLocalStore.getState()
    expect(state.archived).toEqual(['chat:loc-1'])
    expect(state.backendFlagsMigrated).toBe(true)
    expect(hermes.updateSession).toHaveBeenCalledTimes(1)
  })
})
