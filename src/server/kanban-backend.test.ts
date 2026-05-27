import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.resetModules()
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

const LOCAL_FAKE_CARDS = JSON.stringify([{
  id: 'local-1',
  title: 'Local task',
  spec: '',
  acceptanceCriteria: [],
  assignedWorker: null,
  reviewer: null,
  status: 'backlog',
  missionId: null,
  reportPath: null,
  createdBy: 'local',
  createdAt: 1,
  updatedAt: 1,
}])

type RunCall = { sql: string; args: unknown[] }

/**
 * Create a minimal better-sqlite3 Database mock.
 * `rows` is the per-call return for `.prepare().all()` / `.prepare().get()`.
 */
function makeBetterSqliteMock(options: {
  rows?: () => unknown[]
  statements?: string[]
  runCalls?: RunCall[]
}) {
  const stmts: string[] = options.statements ?? []
  const runCalls: RunCall[] = options.runCalls ?? []
  const mockDb = {
    pragma: vi.fn(),
    prepare: vi.fn((sql: string) => {
      stmts.push(sql)
      return {
        all: vi.fn(() => options.rows?.() ?? []),
        get: vi.fn((id?: string) => {
          const rows = options.rows?.() ?? []
          if (id !== undefined) return rows.find((r: unknown) => (r as Record<string,unknown>)['id'] === id) ?? rows[0]
          return rows[0]
        }),
        run: vi.fn((...args: unknown[]) => {
          runCalls.push({ sql, args })
        }),
      }
    }),
  }
  return { mockDb, runCalls }
}

async function loadKanbanBackend(options?: {
  existsSync?: (path: string) => boolean
  execFileSync?: (command: string, args?: Array<string>) => string
  dbRows?: () => unknown[]
  dbStatements?: string[]
  dbRunCalls?: RunCall[]
}) {
  const stmts: string[] = options?.dbStatements ?? []
  const runCalls: RunCall[] = options?.dbRunCalls ?? []
  const { mockDb } = makeBetterSqliteMock({ rows: options?.dbRows, statements: stmts, runCalls })

  vi.doMock('node:fs', () => ({
    existsSync: vi.fn((p: string) => options?.existsSync?.(p) ?? false),
    readFileSync: vi.fn(() => LOCAL_FAKE_CARDS),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  }))

  vi.doMock('node:child_process', () => ({
    execFileSync: vi.fn((command: string, args?: Array<string>) => options?.execFileSync?.(command, args) ?? ''),
  }))

  vi.doMock('better-sqlite3', () => ({
    default: vi.fn(() => mockDb),
  }))

  return import('./kanban-backend')
}

describe('kanban-backend', () => {
  it('auto-detect prefers Hermes backend when Hermes CLI and canonical storage are present', async () => {
    vi.stubEnv('CLAUDE_HOME', '/Users/aurora/.claude/profiles/swarm2')
    const stmts: string[] = []
    const rows = [
      {
        id: 't_12345678',
        title: 'Hermes task',
        body: 'Backed by sqlite',
        status: 'running',
        assignee: 'swarm2',
        created_at: 1777527540,
        updated_at: 1777527644,
      },
    ]
    const mod = await loadKanbanBackend({
      existsSync: (target) => target === '/Users/aurora/.claude/kanban.db' || target === '/Users/aurora/.claude/kanban',
      execFileSync: (command, args = []) => {
        if (command === 'which' && args[0] === 'claude') return '/Users/aurora/.local/bin/claude\n'
        if (command === '/Users/aurora/.local/bin/claude' && args[0] === '--version') return 'claude 1.0.0\n'
        throw new Error(`Unexpected command: ${command} ${args.join(' ')}`)
      },
      dbRows: () => rows,
      dbStatements: stmts,
    })

    expect(mod.getKanbanBackendMeta()).toMatchObject({
      id: 'claude',
      detected: true,
      writable: true,
      path: '/Users/aurora/.claude/kanban.db',
    })

    const cards = mod.listKanbanCards()
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      id: 't_12345678',
      title: 'Hermes task',
      status: 'running',
      assignedWorker: 'swarm2',
      createdBy: 'claude-kanban',
    })
  })

  it('auto-detect uses Hermes storage directly when the CLI is unavailable', async () => {
    vi.stubEnv('CLAUDE_HOME', '/Users/aurora/.claude/profiles/swarm2')
    const rows = [
      {
        id: 't_direct',
        title: 'Direct Hermes task',
        body: '',
        status: 'ready',
        assignee: null,
        created_at: 1777527540,
        updated_at: 1777527644,
      },
    ]
    const mod = await loadKanbanBackend({
      existsSync: (target) => target === '/Users/aurora/.claude/kanban.db',
      execFileSync: (command, args = []) => {
        if (command === 'which' && args[0] === 'claude') throw new Error('not found')
        throw new Error(`Unexpected command: ${command} ${args.join(' ')}`)
      },
      dbRows: () => rows,
    })

    expect(mod.getKanbanBackendMeta()).toMatchObject({
      id: 'claude',
      detected: true,
      writable: true,
      path: '/Users/aurora/.claude/kanban.db',
    })
    expect(mod.getKanbanBackendMeta().details).toContain('direct local storage access')
    expect(mod.listKanbanCards()[0]).toMatchObject({ id: 't_direct', status: 'ready' })
  })

  it('resolves canonical Kanban paths from legacy profile-home env fallback too', async () => {
    vi.stubEnv('CLAUDE_HOME', '/Users/aurora/.claude/profiles/swarm5/home')
    const mod = await loadKanbanBackend({
      existsSync: (target) => target === '/Users/aurora/.claude/kanban.db',
      execFileSync: (command, args = []) => {
        if (command === 'which' && args[0] === 'claude') throw new Error('not found')
        throw new Error(`Unexpected command: ${command} ${args.join(' ')}`)
      },
      dbRows: () => [],
    })

    expect(mod.getKanbanBackendMeta()).toMatchObject({
      id: 'claude',
      detected: true,
      path: '/Users/aurora/.claude/kanban.db',
    })
  })

  it('auto-detect falls back to local when canonical Hermes storage is missing', async () => {
    vi.stubEnv('CLAUDE_HOME', '/Users/aurora/.claude/profiles/swarm2')
    const mod = await loadKanbanBackend({
      existsSync: () => false,
      execFileSync: (command, args = []) => {
        if (command === 'which' && args[0] === 'claude') return '/Users/aurora/.local/bin/claude\n'
        if (command === '/Users/aurora/.local/bin/claude' && args[0] === '--version') return 'claude 1.0.0\n'
        throw new Error(`Unexpected command: ${command} ${args.join(' ')}`)
      },
    })

    expect(mod.getKanbanBackendMeta()).toMatchObject({
      id: 'local',
      detected: true,
      writable: true,
    })
    expect(Array.isArray(mod.listKanbanCards())).toBe(true)
  })

  it('creates and updates Hermes tasks through canonical kanban.db path', async () => {
    vi.stubEnv('CLAUDE_HOME', '/Users/aurora/.claude/profiles/swarm2')
    const stmts: string[] = []
    const runCalls: RunCall[] = []
    let readCount = 0
    const mod = await loadKanbanBackend({
      existsSync: (target) => target === '/Users/aurora/.claude/kanban.db' || target === '/Users/aurora/.claude/kanban',
      execFileSync: (command, args = []) => {
        if (command === 'which' && args[0] === 'claude') return '/Users/aurora/.local/bin/claude\n'
        if (command === '/Users/aurora/.local/bin/claude' && args[0] === '--version') return 'claude 1.0.0\n'
        throw new Error(`Unexpected command: ${command} ${args.join(' ')}`)
      },
      dbRows: () => {
        readCount += 1
        return [
          {
            id: 't_deadbeef',
            title: readCount === 1 ? 'Created Hermes task' : 'Updated Hermes task',
            body: 'Task body',
            status: readCount === 1 ? 'queued' : 'done',
            assignee: 'swarm6',
            created_at: 1777527540,
            updated_at: 1777527644,
          },
        ]
      },
      dbStatements: stmts,
      dbRunCalls: runCalls,
    })

    const created = mod.createKanbanCard({ title: 'Created Hermes task', spec: 'Task body', assignedWorker: 'swarm6', status: 'backlog' })
    const updated = mod.updateKanbanCard('t_deadbeef', { title: 'Updated Hermes task', status: 'done', assignedWorker: 'swarm6' })

    expect(created).toMatchObject({ id: 't_deadbeef', title: 'Created Hermes task', status: 'backlog', assignedWorker: 'swarm6', createdBy: 'claude-kanban' })
    expect(updated).toMatchObject({ id: 't_deadbeef', title: 'Updated Hermes task', status: 'done', assignedWorker: 'swarm6' })

    // Verify INSERT and UPDATE statements were issued via better-sqlite3 parameterized queries
    expect(stmts.some((s) => /insert into tasks/i.test(s))).toBe(true)
    expect(stmts.some((s) => /update tasks set/i.test(s))).toBe(true)

    // Pre-flight regression: backlog must bind 'triage' not 'queued' as the status parameter.
    // With parameterized queries the status value is in runCalls args, not the SQL string.
    const insertRun = runCalls.find((c) => /insert into tasks/i.test(c.sql))
    expect(insertRun).toBeDefined()
    // status is the 5th positional param (id, title, body, assignee, status, ...)
    expect(insertRun?.args[4]).toBe('triage')
    expect(insertRun?.args[4]).not.toBe('queued')
  })
})
