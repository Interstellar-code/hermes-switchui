import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => opts as object,
}))

const mocks = vi.hoisted(
  (): {
    authed: boolean
    platforms: Array<Record<string, unknown>>
    activeRun: unknown
  } => ({
    authed: true,
    platforms: [],
    activeRun: null,
  }),
)

vi.mock('../../../server/auth-middleware', () => ({
  isAuthenticated: () => mocks.authed,
}))
vi.mock('../../../server/gateway-capabilities', () => ({
  dashboardFetch: vi.fn(async () =>
    Response.json({ platforms: mocks.platforms }),
  ),
}))
vi.mock('../../../server/profile-scope', () => ({
  readProfile: (v: unknown) =>
    typeof v === 'string' && v.trim() ? v.trim() : null,
  getGatewayMode: vi.fn(async () => ({ mode: 'single', activeProfile: 'p1' })),
}))
vi.mock('../../../server/run-store', () => ({
  getActiveRunForSession: vi.fn(async () => mocks.activeRun),
}))

const TELEGRAM_OK = {
  id: 'telegram',
  name: 'Telegram',
  enabled: true,
  configured: true,
  state: 'connected',
  home_channel: { platform: 'telegram', chat_id: '42', name: 'Home' },
}

let root: string
let dbPath: string

function seed(handoffState: string | null, { targetColumn = true } = {}) {
  const db = new Database(dbPath)
  db.exec(`CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, source TEXT, chat_id TEXT, thread_id TEXT, title TEXT,
    handoff_state TEXT, handoff_platform TEXT, handoff_error TEXT,
    handoff_requested_at REAL, started_at REAL, last_activity_at REAL
    ${targetColumn ? ', handoff_target TEXT' : ''})`)
  db.prepare(
    `INSERT INTO sessions (id, source, title, handoff_state, handoff_error)
     VALUES ('s1', 'api_server', 'Chat', ?, 'old error')`,
  ).run(handoffState)
  const tg = db.prepare(
    `INSERT INTO sessions (id, source, chat_id, thread_id, title, started_at, last_activity_at)
     VALUES (?, 'telegram', '42', ?, ?, ?, ?)`,
  )
  tg.run('t1-old', '100', 'Older title', 10, 20)
  tg.run('t1-new', '100', null, 30, 500) // newest, untitled → label from t1-old
  tg.run('t2', '200', 'Second topic', 5, 300)
  db.close()
  writeFileSync(
    join(root, 'profiles', 'p1', 'channel_directory.json'),
    JSON.stringify({
      updated_at: 'x',
      platforms: {
        telegram: [
          {
            id: '42:100',
            name: 'Home / topic 100',
            type: 'dm',
            thread_id: '100',
          },
          {
            id: '42:200',
            name: 'Home / topic 200',
            type: 'dm',
            thread_id: '200',
          },
          {
            id: '42:300',
            name: 'Home / topic 300',
            type: 'thread',
            thread_id: '300',
          },
          { id: '42', name: 'Home', type: 'dm' },
        ],
      },
    }),
  )
}

async function get(sessionKey = 's1', profile = 'p1') {
  return (await handlers()).GET({
    request: new Request(
      `http://localhost/api/sessions/${sessionKey}/channel?profile=${encodeURIComponent(profile)}`,
    ),
    params: { sessionKey },
  })
}

function readRow() {
  const db = new Database(dbPath, { readonly: true })
  const row = db
    .prepare('SELECT * FROM sessions WHERE id = ?')
    .get('s1') as Record<string, unknown>
  db.close()
  return row
}

type Handler = (ctx: {
  request: Request
  params: { sessionKey: string }
}) => Promise<Response>

async function handlers() {
  const route = (await import('./$sessionKey.channel')).Route as unknown as {
    server: { handlers: { GET: Handler; POST: Handler } }
  }
  return route.server.handlers
}

async function post(
  sessionKey: string,
  body: unknown = { platform: 'telegram' },
) {
  return (await handlers()).POST({
    request: new Request(
      `http://localhost/api/sessions/${sessionKey}/channel?profile=p1`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    ),
    params: { sessionKey },
  })
}

describe('/api/sessions/$sessionKey/channel', () => {
  beforeEach(() => {
    vi.resetModules()
    root = mkdtempSync(join(tmpdir(), 'channel-test-'))
    mkdirSync(join(root, 'profiles', 'p1'), { recursive: true })
    dbPath = join(root, 'profiles', 'p1', 'state.db')
    vi.stubEnv('HERMES_HOME', root)
    mocks.authed = true
    mocks.platforms = [TELEGRAM_OK]
    mocks.activeRun = null
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    rmSync(root, { recursive: true, force: true })
  })

  it('401 when unauthenticated', async () => {
    mocks.authed = false
    const res = await (
      await handlers()
    ).GET({
      request: new Request('http://localhost/api/sessions/s1/channel'),
      params: { sessionKey: 's1' },
    })
    expect(res.status).toBe(401)
    expect((await post('s1')).status).toBe(401)
  })

  it('GET reports the row and handoff-capable platforms', async () => {
    seed(null)
    mocks.platforms = [
      TELEGRAM_OK,
      { id: 'api_server', enabled: true, configured: true },
    ]
    const res = await (
      await handlers()
    ).GET({
      request: new Request(
        'http://localhost/api/sessions/s1/channel?profile=p1',
      ),
      params: { sessionKey: 's1' },
    })
    const body = (await res.json()) as {
      session: { source: string }
      platforms: Array<{ id: string; unavailableReason: string | null }>
    }
    expect(body.session.source).toBe('api_server')
    expect(body.platforms).toEqual([
      expect.objectContaining({ id: 'telegram', unavailableReason: null }),
    ])
  })

  it('arms a pending handoff exactly like request_handoff_status', async () => {
    seed(null)
    const res = await post('s1')
    expect(res.status).toBe(200)
    const row = readRow()
    expect(row.handoff_state).toBe('pending')
    expect(row.handoff_platform).toBe('telegram')
    expect(row.handoff_error).toBeNull()
    expect(typeof row.handoff_requested_at).toBe('number')
  })

  it.each(['pending', 'running'])(
    '409 and no re-arm when already %s',
    async (state) => {
      seed(state)
      const res = await post('s1')
      expect(res.status).toBe(409)
      expect(readRow().handoff_state).toBe(state)
      expect(readRow().handoff_requested_at).toBeNull()
    },
  )

  it('re-arms after a failed handoff', async () => {
    seed('failed')
    expect((await post('s1')).status).toBe(200)
    expect(readRow().handoff_state).toBe('pending')
  })

  it('409 when the platform is not enabled', async () => {
    seed(null)
    mocks.platforms = [{ ...TELEGRAM_OK, enabled: false }]
    const res = await post('s1')
    expect(res.status).toBe(409)
    expect(readRow().handoff_state).toBeNull()
  })

  it('409 when the session has an active run', async () => {
    seed(null)
    mocks.activeRun = { runId: 'r1' }
    expect((await post('s1')).status).toBe(409)
    expect(readRow().handoff_state).toBeNull()
  })

  it('404 for a session with no row', async () => {
    seed(null)
    expect((await post('missing')).status).toBe(404)
  })

  it('GET lists existing topics, labelled and newest first', async () => {
    seed(null)
    const body = (await (await get()).json()) as {
      targets: Array<Record<string, unknown>>
    }
    expect(body.targets).toEqual([
      {
        target: 'telegram:42:100',
        platform: 'telegram',
        chatId: '42',
        threadId: '100',
        label: 'Older title',
        lastActive: 500,
      },
      expect.objectContaining({
        target: 'telegram:42:200',
        label: 'Second topic',
      }),
      expect.objectContaining({
        target: 'telegram:42:300',
        label: 'Home / topic 300',
        lastActive: null,
      }),
    ])
  })

  it('GET excludes the topic the session is already in', async () => {
    seed(null)
    const db = new Database(dbPath)
    db.exec(
      `UPDATE sessions SET source='telegram', chat_id='42', thread_id='200' WHERE id='s1'`,
    )
    db.close()
    const body = (await (await get()).json()) as {
      targets: Array<{ target: string }>
    }
    expect(body.targets.map((t) => t.target)).not.toContain('telegram:42:200')
  })

  it('GET hides targets on an unpatched hermes (no handoff_target column)', async () => {
    seed(null, { targetColumn: false })
    expect(
      ((await (await get()).json()) as { targets: Array<unknown> }).targets,
    ).toEqual([])
  })

  it('GET tolerates a missing channel_directory.json', async () => {
    seed(null)
    rmSync(join(root, 'profiles', 'p1', 'channel_directory.json'))
    const res = await get()
    expect(res.status).toBe(200)
    expect(((await res.json()) as { targets: Array<unknown> }).targets).toEqual(
      [],
    )
  })

  it('GET 200 with session null when state.db is missing', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(((await res.json()) as { session: unknown }).session).toBeNull()
  })

  it('400 for an invalid profile', async () => {
    expect((await get('s1', '../etc')).status).toBe(400)
    expect((await get('s1', 'Bad Name')).status).toBe(400)
  })

  it('writes an existing-topic target', async () => {
    seed(null)
    expect(
      (await post('s1', { platform: 'telegram', target: 'telegram:42:200' }))
        .status,
    ).toBe(200)
    expect(readRow()).toMatchObject({
      handoff_state: 'pending',
      handoff_target: 'telegram:42:200',
    })
  })

  it('accepts the home chat as a target (new topic there)', async () => {
    seed(null)
    expect(
      (await post('s1', { platform: 'telegram', target: 'telegram:42' }))
        .status,
    ).toBe(200)
    expect(readRow().handoff_target).toBe('telegram:42')
  })

  it('writes NULL target for a new-topic handoff', async () => {
    seed(null)
    expect((await post('s1')).status).toBe(200)
    expect(readRow().handoff_target).toBeNull()
  })

  it.each(['discord:42:200', 'telegram:abc', 'telegram:42:200; DROP'])(
    '400 for malformed target %s',
    async (target) => {
      seed(null)
      expect((await post('s1', { platform: 'telegram', target })).status).toBe(
        400,
      )
      expect(readRow().handoff_state).toBeNull()
    },
  )

  it('409 for a target not in the directory', async () => {
    seed(null)
    expect(
      (await post('s1', { platform: 'telegram', target: 'telegram:99:1' }))
        .status,
    ).toBe(409)
    expect(readRow().handoff_state).toBeNull()
  })

  it('409 for a target when the handoff_target column is missing', async () => {
    seed(null, { targetColumn: false })
    expect(
      (await post('s1', { platform: 'telegram', target: 'telegram:42:200' }))
        .status,
    ).toBe(409)
    expect((await post('s1')).status).toBe(200)
  })

  it('400 without a platform', async () => {
    expect((await post('s1', {})).status).toBe(400)
  })
})
