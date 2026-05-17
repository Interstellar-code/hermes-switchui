import { createHash } from 'node:crypto'
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import Database from 'better-sqlite3'

const HERMES_DIR = join(homedir(), '.hermes')
const CURRENT_PROCESS_STARTED_AT_MS = Date.now() - process.uptime() * 1000

function safeCheckoutToken(cwd: string): string {
  const base = basename(cwd) || 'checkout'
  const safeBase = base.replace(/[^A-Za-z0-9_.-]/g, '-')
  const hash = createHash('sha1').update(cwd).digest('hex').slice(0, 8)
  return `${safeBase}-${hash}`
}

export function defaultWorkflowDbPath(
  env: Partial<
    Pick<
      NodeJS.ProcessEnv,
      'HERMES_WORKFLOW_DB_PATH' | 'SWITCHUI_WORKFLOW_DB_PATH' | 'NODE_ENV'
    >
  > = process.env,
  cwd = process.cwd(),
): string {
  const explicit = env.HERMES_WORKFLOW_DB_PATH || env.SWITCHUI_WORKFLOW_DB_PATH
  if (explicit?.trim()) return explicit.trim()

  if (env.NODE_ENV === 'production') {
    return join(HERMES_DIR, 'switchui-workflows.db')
  }

  return join(
    HERMES_DIR,
    'dev',
    safeCheckoutToken(cwd),
    'switchui-workflows.db',
  )
}

export const DEFAULT_DB_PATH = defaultWorkflowDbPath()
const LOCK_PATH = `${DEFAULT_DB_PATH}.lock`

let dbInstance: Database.Database | null = null
let lockFd: number | null = null
let lockPath: string | null = null

function releaseLock(): void {
  if (lockFd !== null) {
    try {
      closeSync(lockFd)
    } catch {
      /* ignore */
    }
    lockFd = null
  }
  if (lockPath !== null) {
    try {
      unlinkSync(lockPath)
    } catch {
      /* ignore */
    }
    lockPath = null
  }
}

interface LockRecord {
  pid: number
  startedAt: number
}

function readLockRecord(path: string): LockRecord | null | undefined {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    // Lock file disappeared between EEXIST and read — caller retries.
    return undefined
  }
  try {
    const obj = JSON.parse(raw) as Partial<LockRecord>
    if (typeof obj.pid === 'number' && typeof obj.startedAt === 'number') {
      return { pid: obj.pid, startedAt: obj.startedAt }
    }
  } catch {
    // Unparseable lock — treat as stale.
  }
  return null
}

function currentProcessOwnsLock(record: LockRecord): boolean {
  return (
    record.pid === process.pid &&
    record.startedAt >= CURRENT_PROCESS_STARTED_AT_MS - 5_000
  )
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    // EPERM means the process exists but we lack permission — treat as alive.
    return code === 'EPERM'
  }
}

function reapStaleLock(path: string): boolean {
  const parsed = readLockRecord(path)
  if (parsed === undefined) return true
  if (parsed === null) {
    try {
      unlinkSync(path)
    } catch {
      /* ignore */
    }
    return true
  }
  if (pidAlive(parsed.pid)) return false
  try {
    unlinkSync(path)
  } catch {
    /* ignore */
  }
  return true
}

function acquireLock(currentLockPath: string): void {
  const record: LockRecord = { pid: process.pid, startedAt: Date.now() }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      lockFd = openSync(currentLockPath, 'wx')
      lockPath = currentLockPath
      writeFileSync(lockFd, JSON.stringify(record))
      return
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      const existing = readLockRecord(currentLockPath)
      if (existing && currentProcessOwnsLock(existing)) {
        // Vite/TanStack dev SSR can hot-reload this module without exiting the
        // process. The previous module instance already owns the engine lock.
        lockPath = currentLockPath
        return
      }
      // EEXIST — see if the holder is dead and reap.
      const reaped = reapStaleLock(currentLockPath)
      if (!reaped) {
        throw new Error(
          `Switch UI workflow engine: another instance holds ${currentLockPath} (live pid). Refusing to start.`,
        )
      }
      // reaped — loop and retry once.
    }
  }
  throw new Error(
    `Switch UI workflow engine: could not acquire ${currentLockPath} after stale-lock reap. Refusing to start.`,
  )
}

export function openDb(dbPath: string = DEFAULT_DB_PATH): Database.Database {
  // :memory: paths skip the singleton — each call creates a fresh DB so
  // multiple test fixtures in the same test file don't share state.
  if (dbPath === ':memory:') {
    const memDb = new Database(':memory:')
    memDb.pragma('journal_mode = WAL')
    memDb.pragma('foreign_keys = ON')
    memDb.pragma('busy_timeout = 5000')
    return memDb
  }

  if (dbInstance) return dbInstance

  mkdirSync(dirname(dbPath), { recursive: true })

  if (dbPath !== ':memory:') {
    const currentLockPath = `${dbPath}.lock`
    acquireLock(currentLockPath)
    process.on('exit', releaseLock)
    process.on('SIGINT', () => {
      releaseLock()
      process.exit(0)
    })
    process.on('SIGTERM', () => {
      releaseLock()
      process.exit(0)
    })
  }

  dbInstance = new Database(dbPath)
  dbInstance.pragma('journal_mode = WAL')
  dbInstance.pragma('foreign_keys = ON')
  dbInstance.pragma('busy_timeout = 5000')
  return dbInstance
}

export function getDb(): Database.Database {
  if (!dbInstance) {
    throw new Error('DB not opened. Call openDb() first.')
  }
  return dbInstance
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close()
    dbInstance = null
  }
  releaseLock()
}

// Re-export lock path for testing
export { LOCK_PATH }
