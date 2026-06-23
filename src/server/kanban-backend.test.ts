import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
      // openDb() health probe — must not be treated as a real row read.
      if (/^\s*select\s+1\b/i.test(sql)) {
        return {
          all: vi.fn(() => [{ '1': 1 }]),
          get: vi.fn(() => ({ '1': 1 })),
          run: vi.fn(),
        }
      }
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
    renameSync: vi.fn(),
    unlinkSync: vi.fn(),
    mkdirSync: vi.fn(),
  }))

  vi.doMock('node:child_process', () => ({
    execFileSync: vi.fn((command: string, args?: Array<string>) => options?.execFileSync?.(command, args) ?? ''),
  }))

  vi.doMock('better-sqlite3', () => ({
    default: vi.fn(function DatabaseMock() {
      return mockDb
    }),
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

  it('normalizes ISO-8601 Hermes task timestamps without numeric coercion errors', async () => {
    vi.stubEnv('CLAUDE_HOME', '/Users/aurora/.claude/profiles/swarm2')
    const mod = await loadKanbanBackend({
      existsSync: (target) => target === '/Users/aurora/.claude/kanban.db',
      execFileSync: (command, args = []) => {
        if (command === 'which' && args[0] === 'claude') throw new Error('not found')
        throw new Error(`Unexpected command: ${command} ${args.join(' ')}`)
      },
      dbRows: () => [{
        id: 't_iso',
        title: 'ISO timestamp task',
        body: '',
        status: 'ready',
        assignee: null,
        created_at: '2026-05-10T15:00:00Z',
        updated_at: '2026-05-10T16:30:00Z',
      }],
    })

    expect(mod.listKanbanCards()[0]).toMatchObject({
      id: 't_iso',
      createdAt: Date.parse('2026-05-10T15:00:00Z'),
      updatedAt: Date.parse('2026-05-10T16:30:00Z'),
    })
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

describe('kanban-backend — openDb health-check and handle recreation', () => {
  /**
   * Verify the fix for issue #177:
   * When a cached Database handle's probe (`SELECT 1`) throws, openDb must
   * evict the broken handle, close it (swallowing errors), and open a fresh
   * connection — not reuse the dead one.
   */
  it('recreates a fresh handle when the cached handle probe throws', async () => {
    vi.stubEnv('CLAUDE_HOME', '/Users/aurora/.claude/profiles/swarm2')

    // Two distinct mock DB objects so we can assert which one is returned.
    const deadDb = {
      pragma: vi.fn(),
      close: vi.fn(),
      prepare: vi.fn(() => ({
        all: vi.fn(() => []),
        // SELECT 1 probe always throws — simulates a dead/corrupted handle.
        get: vi.fn(() => { throw new Error('SQLITE_ERROR: database disk image is malformed') }),
        run: vi.fn(),
      })),
    }

    const freshRows = [{
      id: 't_fresh',
      title: 'Fresh task',
      body: '',
      status: 'ready',
      assignee: null,
      created_at: 1777527540,
      updated_at: 1777527644,
    }]
    const freshDb = {
      pragma: vi.fn(),
      close: vi.fn(),
      prepare: vi.fn(() => ({
        all: vi.fn(() => freshRows),
        get: vi.fn(() => freshRows[0]),
        run: vi.fn(),
      })),
    }

    // The Database constructor is called twice: first produces the dead handle,
    // second produces the fresh handle.
    let constructorCallCount = 0
    vi.doMock('node:fs', () => ({
      existsSync: vi.fn((p: string) => p === '/Users/aurora/.claude/kanban.db'),
      readFileSync: vi.fn(() => LOCAL_FAKE_CARDS),
      writeFileSync: vi.fn(),
      renameSync: vi.fn(),
      unlinkSync: vi.fn(),
      mkdirSync: vi.fn(),
    }))
    vi.doMock('node:child_process', () => ({
      execFileSync: vi.fn((command: string, args: string[] = []) => {
        if (command === 'which' && args[0] === 'claude') throw new Error('not found')
        return ''
      }),
    }))
    vi.doMock('better-sqlite3', () => ({
      default: vi.fn(function DatabaseMock() {
        constructorCallCount += 1
        return constructorCallCount === 1 ? deadDb : freshDb
      }),
    }))

    const mod = await import('./kanban-backend')

    // First call: populates cache with deadDb.
    // (listKanbanCards internally calls openDb which runs the probe SELECT 1 — but
    // at first-open there is no cached handle yet so the probe is skipped; deadDb
    // is inserted into the cache.)
    mod.listKanbanCards()
    expect(constructorCallCount).toBe(1)

    // Second call: deadDb is now in cache; probe throws → evict → construct freshDb.
    const cards = mod.listKanbanCards()
    expect(constructorCallCount).toBe(2)

    // The dead handle's close() should have been attempted.
    expect(deadDb.close).toHaveBeenCalledOnce()

    // The result comes from freshDb, not deadDb.
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ id: 't_fresh', status: 'ready' })

    // Third call: freshDb probe succeeds → no additional constructor call.
    mod.listKanbanCards()
    expect(constructorCallCount).toBe(2)
  })

  it('returns the cached handle on the fast path when the probe succeeds', async () => {
    vi.stubEnv('CLAUDE_HOME', '/Users/aurora/.claude/profiles/swarm2')

    let constructorCallCount = 0
    const healthyDb = {
      pragma: vi.fn(),
      close: vi.fn(),
      prepare: vi.fn(() => ({
        all: vi.fn(() => []),
        get: vi.fn(() => ({ '1': 1 })), // probe succeeds
        run: vi.fn(),
      })),
    }

    vi.doMock('node:fs', () => ({
      existsSync: vi.fn((p: string) => p === '/Users/aurora/.claude/kanban.db'),
      readFileSync: vi.fn(() => LOCAL_FAKE_CARDS),
      writeFileSync: vi.fn(),
      renameSync: vi.fn(),
      unlinkSync: vi.fn(),
      mkdirSync: vi.fn(),
    }))
    vi.doMock('node:child_process', () => ({
      execFileSync: vi.fn((command: string, args: string[] = []) => {
        if (command === 'which' && args[0] === 'claude') throw new Error('not found')
        return ''
      }),
    }))
    vi.doMock('better-sqlite3', () => ({
      default: vi.fn(function DatabaseMock() {
        constructorCallCount += 1
        return healthyDb
      }),
    }))

    const mod = await import('./kanban-backend')

    // Warm the cache.
    mod.listKanbanCards()
    expect(constructorCallCount).toBe(1)

    // Multiple subsequent calls must not create new connections.
    mod.listKanbanCards()
    mod.listKanbanCards()
    expect(constructorCallCount).toBe(1)

    // close() is never called on a healthy handle.
    expect(healthyDb.close).not.toHaveBeenCalled()
  })
})

describe('kanban-backend — writeLocalCards atomic write', () => {
  let tempDir: string
  let origClaudeHome: string | undefined
  let origHermesHome: string | undefined
  let origKanbanBackend: string | undefined

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-kanban-atomic-'))
    origClaudeHome = process.env.CLAUDE_HOME
    origHermesHome = process.env.HERMES_HOME
    origKanbanBackend = process.env.CLAUDE_KANBAN_BACKEND
    // Force local backend; getWorkspaceClaudeHome() reads HERMES_HOME or CLAUDE_HOME
    process.env.CLAUDE_KANBAN_BACKEND = 'local'
    process.env.CLAUDE_HOME = tempDir
    delete process.env.HERMES_HOME
    // Remove all doMock registrations from the prior describe block so real fs is used
    vi.doUnmock('node:fs')
    vi.doUnmock('node:child_process')
    vi.doUnmock('better-sqlite3')
    vi.resetModules()
  })

  afterEach(() => {
    if (origClaudeHome === undefined) delete process.env.CLAUDE_HOME
    else process.env.CLAUDE_HOME = origClaudeHome
    if (origHermesHome === undefined) delete process.env.HERMES_HOME
    else process.env.HERMES_HOME = origHermesHome
    if (origKanbanBackend === undefined) delete process.env.CLAUDE_KANBAN_BACKEND
    else process.env.CLAUDE_KANBAN_BACKEND = origKanbanBackend
    fs.rmSync(tempDir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('createKanbanCard round-trips via real fs and leaves no .tmp file behind', async () => {
    const { createKanbanCard, listKanbanCards } = await import('./kanban-backend')

    const card = createKanbanCard({ title: 'Atomic card', spec: 'atomic spec', createdBy: 'test' })
    expect(card.title).toBe('Atomic card')

    // Read back via a fresh list call to confirm the file was flushed correctly
    const cards = listKanbanCards()
    expect(cards.find((c) => c.id === card.id)).toBeDefined()
    expect(cards.find((c) => c.id === card.id)!.title).toBe('Atomic card')

    // No leftover .tmp files under tempDir
    const walk = (dir: string): string[] => {
      if (!fs.existsSync(dir)) return []
      return fs.readdirSync(dir).flatMap((name) => {
        const full = path.join(dir, name)
        return fs.statSync(full).isDirectory() ? walk(full) : [full]
      })
    }
    const tmpFiles = walk(tempDir).filter((f) => f.endsWith('.tmp'))
    expect(tmpFiles).toHaveLength(0)
  })
})
