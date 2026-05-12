import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { getClaudeRoot, getWorkspaceClaudeHome } from './claude-paths'

// ── Inline kanban card types (formerly swarm-kanban-store) ───────────────────

export type KanbanCardStatus = 'backlog' | 'ready' | 'running' | 'review' | 'blocked' | 'done' | 'archived'

export type LocalKanbanCard = {
  id: string
  title: string
  spec: string
  acceptanceCriteria: string[]
  assignedWorker: string | null
  reviewer: string | null
  status: KanbanCardStatus
  missionId: string | null
  reportPath: string | null
  createdBy: string
  createdAt: number
  updatedAt: number
}

export type CreateLocalKanbanCardInput = {
  title: string
  spec?: string
  acceptanceCriteria?: string[]
  assignedWorker?: string | null
  reviewer?: string | null
  status?: KanbanCardStatus
  missionId?: string | null
  reportPath?: string | null
  createdBy?: string
}

export type UpdateLocalKanbanCardInput = Partial<Omit<LocalKanbanCard, 'id' | 'createdAt' | 'createdBy'>>

const KANBAN_FILE_NAME = 'kanban-board.json'

function getLocalKanbanFile(): string {
  try {
    const home = getWorkspaceClaudeHome()
    return path.join(home, KANBAN_FILE_NAME)
  } catch {
    return path.join(process.env.HOME ?? '/tmp', '.hermes', KANBAN_FILE_NAME)
  }
}

export const LOCAL_KANBAN_FILE = getLocalKanbanFile()

function readLocalCards(): LocalKanbanCard[] {
  const file = getLocalKanbanFile()
  if (!fs.existsSync(file)) return []
  try {
    const raw = fs.readFileSync(file, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as LocalKanbanCard[]) : []
  } catch {
    return []
  }
}

function writeLocalCards(cards: LocalKanbanCard[]): void {
  const file = getLocalKanbanFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(cards, null, 2), 'utf8')
}

function listLocalKanbanCards(): LocalKanbanCard[] {
  return readLocalCards()
}

function createLocalKanbanCard(input: CreateLocalKanbanCardInput): LocalKanbanCard {
  const cards = readLocalCards()
  const card: LocalKanbanCard = {
    id: `k_${randomUUID().replace(/-/g, '').slice(0, 8)}`,
    title: input.title,
    spec: input.spec ?? '',
    acceptanceCriteria: input.acceptanceCriteria ?? [],
    assignedWorker: input.assignedWorker ?? null,
    reviewer: input.reviewer ?? null,
    status: input.status ?? 'backlog',
    missionId: input.missionId ?? null,
    reportPath: input.reportPath ?? null,
    createdBy: input.createdBy ?? 'claude-kanban',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  cards.push(card)
  writeLocalCards(cards)
  return card
}

function updateLocalKanbanCard(cardId: string, updates: UpdateLocalKanbanCardInput): LocalKanbanCard | null {
  const cards = readLocalCards()
  const idx = cards.findIndex((c) => c.id === cardId)
  if (idx === -1) return null
  cards[idx] = { ...cards[idx], ...updates, updatedAt: Date.now() }
  writeLocalCards(cards)
  return cards[idx]
}

export type KanbanBackendId = 'local' | 'claude'

export type KanbanBackendMeta = {
  id: KanbanBackendId
  label: string
  detected: boolean
  writable: boolean
  details?: string | null
  path?: string | null
}

type KanbanBackend = {
  meta(): KanbanBackendMeta
  list(): LocalKanbanCard[]
  create(input: CreateLocalKanbanCardInput): LocalKanbanCard
  update(cardId: string, updates: UpdateLocalKanbanCardInput): LocalKanbanCard | null
}

type ClaudeTaskRow = {
  id: string
  title: string
  body?: string | null
  status?: string | null
  assignee?: string | null
  created_at?: number | string | null
  updated_at?: number | string | null
}

type ClaudeDetection = {
  available: boolean
  cliPath?: string | null
  dbPath: string
  workspacePath: string
  reason?: string
}

function env(name: string): string | null {
  const value = process.env[name]
  return value && value.trim() ? value.trim() : null
}

function claudeProfileRoot(): string {
  return getWorkspaceClaudeHome()
}

function claudeDbPath(): string {
  return path.join(getClaudeRoot(), 'kanban.db')
}

function claudeWorkspacePath(): string {
  return path.join(getClaudeRoot(), 'kanban')
}

function claudeCliPath(): string | null {
  try {
    const output = execFileSync('which', ['claude'], { encoding: 'utf8', timeout: 5_000 }).trim()
    return output || null
  } catch {
    return null
  }
}

function checkClaudeCli(): { ok: boolean; path?: string | null; reason?: string } {
  const cli = claudeCliPath()
  if (!cli) return { ok: false, reason: 'claude CLI not found on PATH' }
  try {
    execFileSync(cli, ['--version'], { encoding: 'utf8', timeout: 10_000, env: { ...process.env, CLAUDE_HOME: claudeProfileRoot() } })
    return { ok: true, path: cli }
  } catch (error) {
    return { ok: false, path: cli, reason: error instanceof Error ? error.message : String(error) }
  }
}

function detectClaudeKanban(): ClaudeDetection {
  const dbPath = claudeDbPath()
  const workspacePath = claudeWorkspacePath()
  const hasDb = fs.existsSync(dbPath)
  const hasWorkspace = fs.existsSync(workspacePath)

  if (!hasDb && !hasWorkspace) {
    return {
      available: false,
      cliPath: null,
      dbPath,
      workspacePath,
      reason: 'Hermes Kanban storage not found; using the local board fallback.',
    }
  }

  const cli = checkClaudeCli()
  return {
    available: true,
    cliPath: cli.ok ? cli.path ?? null : null,
    dbPath,
    workspacePath,
    reason: cli.ok ? undefined : 'Hermes Kanban storage detected; CLI unavailable, using direct local storage access.',
  }
}

function sqliteQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function runSqlite(dbPath: string, sql: string): string {
  return execFileSync('sqlite3', [dbPath, '-json', sql], {
    encoding: 'utf8',
    timeout: 15_000,
  }).trim()
}

function readClaudeTasks(): ClaudeTaskRow[] {
  const detection = detectClaudeKanban()
  if (!detection.available) return []
  const query = [
    'select',
    'id,',
    'title,',
    'body,',
    'status,',
    'assignee,',
    'created_at,',
    'coalesce(last_heartbeat_at, completed_at, started_at, created_at) as updated_at',
    'from tasks',
    'order by created_at desc, id desc;',
  ].join(' ')
  const raw = runSqlite(detection.dbPath, query)
  const parsed = raw ? (JSON.parse(raw) as ClaudeTaskRow[]) : []
  return Array.isArray(parsed) ? parsed : []
}

function readClaudeTask(taskId: string): ClaudeTaskRow | null {
  const detection = detectClaudeKanban()
  if (!detection.available) return null
  const raw = runSqlite(
    detection.dbPath,
    `select id, title, body, status, assignee, created_at, coalesce(last_heartbeat_at, completed_at, started_at, created_at) as updated_at from tasks where id = ${sqliteQuote(taskId)} limit 1;`,
  )
  const parsed = raw ? (JSON.parse(raw) as ClaudeTaskRow[]) : []
  return Array.isArray(parsed) && parsed[0] ? parsed[0] : null
}

/**
 * Permanently hard-delete a task row from the kanban SQLite database.
 * The gateway REST API has no DELETE endpoint, so we go directly to SQLite.
 * Safety guard: only tasks with status='archived' are eligible.
 */
export function hardDeleteKanbanTask(taskId: string): { ok: boolean; error?: string } {
  const detection = detectClaudeKanban()
  if (!detection.available) {
    return { ok: false, error: 'Kanban database not available' }
  }
  // Safety: confirm the task exists and is archived before deleting
  const task = readClaudeTask(taskId)
  if (!task) {
    return { ok: false, error: `Task ${taskId} not found` }
  }
  if (task.status !== 'archived') {
    return { ok: false, error: 'Only archived tasks can be permanently deleted' }
  }
  try {
    // sqlite3 CLI exits 0 for DELETE even when no rows are returned as JSON
    execFileSync('sqlite3', [detection.dbPath, `DELETE FROM tasks WHERE id = ${sqliteQuote(taskId)} AND status = 'archived';`], {
      encoding: 'utf8',
      timeout: 10_000,
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'SQLite delete failed' }
  }
}

function normalizeTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? value : Math.round(value * 1000)
  }
  if (typeof value === 'string' && value.trim()) {
    const asNum = Number(value)
    if (Number.isFinite(asNum)) return normalizeTimestamp(asNum)
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return Date.now()
}

function mapClaudeStatus(status: string | null | undefined): LocalKanbanCard['status'] {
  switch ((status ?? '').toLowerCase()) {
    case 'queued':
    case 'todo':
    case 'triage':
      return 'backlog'
    case 'ready':
      return 'ready'
    case 'running':
    case 'claimed':
    case 'in_progress':
      return 'running'
    case 'review':
      return 'review'
    case 'blocked':
      return 'blocked'
    case 'done':
    case 'complete':
    case 'completed':
      return 'done'
    default:
      return 'backlog'
  }
}

function mapBoardStatus(status: LocalKanbanCard['status'] | null | undefined): string {
  switch (status) {
    case 'backlog':
      return 'triage'
    case 'ready':
      return 'ready'
    case 'running':
      return 'running'
    case 'review':
      return 'review'
    case 'blocked':
      return 'blocked'
    case 'done':
      return 'done'
    default:
      return 'triage'
  }
}

function claudeTaskToCard(task: ClaudeTaskRow): LocalKanbanCard {
  const createdAt = normalizeTimestamp(task.created_at)
  const updatedAt = normalizeTimestamp(task.updated_at ?? task.created_at)
  return {
    id: task.id,
    title: task.title,
    spec: task.body ?? '',
    acceptanceCriteria: [],
    assignedWorker: task.assignee ?? null,
    reviewer: null,
    status: mapClaudeStatus(task.status),
    missionId: null,
    reportPath: null,
    createdBy: 'claude-kanban',
    createdAt,
    updatedAt,
  }
}

const localBackend: KanbanBackend = {
  meta() {
    return {
      id: 'local',
      label: 'Local board',
      detected: true,
      writable: true,
      path: LOCAL_KANBAN_FILE,
      details: 'Using local board JSON store.',
    }
  },
  list() {
    return listLocalKanbanCards()
  },
  create(input) {
    return createLocalKanbanCard(input)
  },
  update(cardId, updates) {
    return updateLocalKanbanCard(cardId, updates)
  },
}

const claudeBackend: KanbanBackend = {
  meta() {
    const detection = detectClaudeKanban()
    return {
      id: 'claude',
      label: 'Hermes Kanban',
      detected: detection.available,
      writable: detection.available,
      path: fs.existsSync(detection.dbPath) ? detection.dbPath : null,
      details: detection.available
        ? detection.reason ?? `Hermes Kanban storage detected (${detection.cliPath ?? 'direct sqlite'}, ${detection.dbPath})`
        : detection.reason ?? 'Hermes Kanban not detected.',
    }
  },
  list() {
    return readClaudeTasks().map(claudeTaskToCard)
  },
  create(input) {
    const detection = detectClaudeKanban()
    if (!detection.available) throw new Error(detection.reason ?? 'Hermes Kanban not detected')
    const nowSeconds = Math.floor(Date.now() / 1000)
    const taskId = `t_${randomUUID().replace(/-/g, '').slice(0, 8)}`
    const status = mapBoardStatus(input.status ?? 'backlog')
    const statements = [
      'insert into tasks (',
      'id, title, body, assignee, status, priority, created_by, created_at, workspace_kind, workspace_path',
      ') values (',
      [
        sqliteQuote(taskId),
        sqliteQuote(input.title.trim()),
        sqliteQuote((input.spec ?? '').trim()),
        input.assignedWorker?.trim() ? sqliteQuote(input.assignedWorker.trim()) : 'NULL',
        sqliteQuote(status),
        '0',
        sqliteQuote(input.createdBy?.trim() || 'claude-kanban'),
        String(nowSeconds),
        sqliteQuote('scratch'),
        sqliteQuote(path.join(detection.workspacePath, 'workspaces', taskId)),
      ].join(', '),
      ');',
    ].join(' ')
    runSqlite(detection.dbPath, statements)
    const created = readClaudeTask(taskId)
    if (!created) throw new Error(`Created Hermes task ${taskId} but could not read it back`)
    return claudeTaskToCard(created)
  },
  update(cardId, updates) {
    const detection = detectClaudeKanban()
    if (!detection.available) return null
    const assignments: string[] = []
    if (typeof updates.title === 'string' && updates.title.trim()) assignments.push(`title = ${sqliteQuote(updates.title.trim())}`)
    if (typeof updates.spec === 'string') assignments.push(`body = ${sqliteQuote(updates.spec)}`)
    if (updates.assignedWorker !== undefined) assignments.push(`assignee = ${updates.assignedWorker?.trim() ? sqliteQuote(updates.assignedWorker.trim()) : 'NULL'}`)
    if (updates.status) {
      const status = mapBoardStatus(updates.status)
      assignments.push(`status = ${sqliteQuote(status)}`)
      if (status === 'running') assignments.push(`started_at = coalesce(started_at, ${Math.floor(Date.now() / 1000)})`)
      if (status === 'done') assignments.push(`completed_at = ${Math.floor(Date.now() / 1000)}`)
      if (status !== 'done') assignments.push('completed_at = NULL')
    }
    if (assignments.length === 0) {
      const current = readClaudeTask(cardId)
      return current ? claudeTaskToCard(current) : null
    }
    runSqlite(detection.dbPath, `update tasks set ${assignments.join(', ')} where id = ${sqliteQuote(cardId)};`)
    const updated = readClaudeTask(cardId)
    return updated ? claudeTaskToCard(updated) : null
  },
}

export function resolveKanbanBackend(): KanbanBackend {
  const preference = (env('CLAUDE_KANBAN_BACKEND') ?? 'auto').toLowerCase()
  if (preference === 'local') return localBackend
  const claudeMeta = claudeBackend.meta()
  if (preference === 'claude') return claudeMeta.detected ? claudeBackend : localBackend
  return claudeMeta.detected ? claudeBackend : localBackend
}

export function getKanbanBackendMeta(): KanbanBackendMeta {
  return resolveKanbanBackend().meta()
}

export function listKanbanCards(): LocalKanbanCard[] {
  return resolveKanbanBackend().list()
}

export function createKanbanCard(input: CreateLocalKanbanCardInput): LocalKanbanCard {
  return resolveKanbanBackend().create(input)
}

export function updateKanbanCard(cardId: string, updates: UpdateLocalKanbanCardInput): LocalKanbanCard | null {
  return resolveKanbanBackend().update(cardId, updates)
}
