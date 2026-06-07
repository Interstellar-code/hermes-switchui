import { randomUUID } from 'node:crypto'
import { getSwitchUiDb } from './switchui-db'

export type UserCommandRecord = {
  id: string
  name: string
  slash: string
  description: string
  prompt: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export type CreateUserCommandInput = {
  name?: unknown
  slash?: unknown
  description?: unknown
  prompt?: unknown
  enabled?: unknown
}

export type UpdateUserCommandInput = Partial<CreateUserCommandInput>

export const RESERVED_COMMAND_SLASHES = new Set([
  '/new',
  '/clear',
  '/model',
  '/save',
  '/skills',
  '/plugins',
  '/mcp',
  '/skin',
  '/help',
  '/fast',
])

const SLASH_RE = /^\/[a-z][a-z0-9-]{0,31}$/
const NAME_MAX = 80
const DESCRIPTION_MAX = 300
const PROMPT_MAX = 8_000

class CommandValidationError extends Error {
  status = 400
}

class CommandConflictError extends Error {
  status = 409
}

class CommandNotFoundError extends Error {
  status = 404
}

export function isCommandStoreError(
  error: unknown,
): error is Error & { status: number } {
  return (
    error instanceof Error &&
    typeof (error as { status?: unknown }).status === 'number'
  )
}

function nowIso(): string {
  return new Date().toISOString()
}

function ensureCommandsTable(): void {
  const db = getSwitchUiDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_commands (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slash TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      prompt TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_user_commands_enabled_slash
      ON user_commands(enabled, slash);
  `)
}

type CommandRow = {
  id: string
  name: string
  slash: string
  description: string | null
  prompt: string
  enabled: number
  created_at: string
  updated_at: string
}

function rowToCommand(row: CommandRow): UserCommandRecord {
  return {
    id: row.id,
    name: row.name,
    slash: row.slash,
    description: row.description ?? '',
    prompt: row.prompt,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function readString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    throw new CommandValidationError(`${field} must be a string`)
  }
  return value.trim()
}

function readBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') {
    throw new CommandValidationError(`${field} must be a boolean`)
  }
  return value
}

function normalizeSlash(value: string): string {
  const trimmed = value.trim().toLowerCase()
  if (!trimmed.startsWith('/')) return `/${trimmed}`
  return trimmed
}

function validateSlash(slash: string): string {
  const normalized = normalizeSlash(slash)
  if (!SLASH_RE.test(normalized)) {
    throw new CommandValidationError(
      'slash must match /name with lowercase letters, numbers, and hyphens',
    )
  }
  if (RESERVED_COMMAND_SLASHES.has(normalized)) {
    throw new CommandValidationError(`${normalized} is reserved by SwitchUI`)
  }
  return normalized
}

function validateName(
  value: string | undefined,
  fallbackSlash?: string,
): string {
  const name = value?.trim() || fallbackSlash?.replace(/^\//, '') || ''
  if (!name) throw new CommandValidationError('name is required')
  if (name.length > NAME_MAX) {
    throw new CommandValidationError(
      `name must be ${NAME_MAX} characters or fewer`,
    )
  }
  return name
}

function validateDescription(value: string | undefined): string {
  const description = value?.trim() ?? ''
  if (description.length > DESCRIPTION_MAX) {
    throw new CommandValidationError(
      `description must be ${DESCRIPTION_MAX} characters or fewer`,
    )
  }
  return description
}

function validatePrompt(value: string | undefined): string {
  const prompt = value?.trim() ?? ''
  if (!prompt) throw new CommandValidationError('prompt is required')
  if (prompt.length > PROMPT_MAX) {
    throw new CommandValidationError(
      `prompt must be ${PROMPT_MAX} characters or fewer`,
    )
  }
  return prompt
}

function ensureUniqueSlash(slash: string, excludeId?: string): void {
  ensureCommandsTable()
  const db = getSwitchUiDb()
  const row = db
    .prepare('SELECT id FROM user_commands WHERE slash = ? LIMIT 1')
    .get(slash) as { id: string } | undefined
  if (row && row.id !== excludeId) {
    throw new CommandConflictError(`${slash} already exists`)
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = (error as Error & { code?: string }).code
  return (
    code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    code === 'SQLITE_CONSTRAINT' ||
    error.message.includes('UNIQUE constraint failed')
  )
}

function makeCommandId(): string {
  return `cmd_${randomUUID().replace(/-/g, '').slice(0, 16)}`
}

export function listUserCommands(): Array<UserCommandRecord> {
  ensureCommandsTable()
  const rows = getSwitchUiDb()
    .prepare(
      'SELECT id, name, slash, description, prompt, enabled, created_at, updated_at FROM user_commands ORDER BY slash ASC',
    )
    .all() as Array<CommandRow>
  return rows.map(rowToCommand)
}

export function getUserCommand(commandId: string): UserCommandRecord | null {
  ensureCommandsTable()
  const row = getSwitchUiDb()
    .prepare(
      'SELECT id, name, slash, description, prompt, enabled, created_at, updated_at FROM user_commands WHERE id = ? LIMIT 1',
    )
    .get(commandId) as CommandRow | undefined
  return row ? rowToCommand(row) : null
}

export function getEnabledUserCommandBySlash(
  slash: string,
): UserCommandRecord | null {
  ensureCommandsTable()
  const row = getSwitchUiDb()
    .prepare(
      'SELECT id, name, slash, description, prompt, enabled, created_at, updated_at FROM user_commands WHERE slash = ? AND enabled = 1 LIMIT 1',
    )
    .get(normalizeSlash(slash)) as CommandRow | undefined
  return row ? rowToCommand(row) : null
}

export function createUserCommand(
  input: CreateUserCommandInput,
): UserCommandRecord {
  const slashInput = readString(input.slash, 'slash')
  if (!slashInput) throw new CommandValidationError('slash is required')
  const slash = validateSlash(slashInput)
  ensureUniqueSlash(slash)

  const name = validateName(readString(input.name, 'name'), slash)
  const description = validateDescription(
    readString(input.description, 'description'),
  )
  const prompt = validatePrompt(readString(input.prompt, 'prompt'))
  const enabled = readBoolean(input.enabled, 'enabled') ?? true
  const id = makeCommandId()
  const createdAt = nowIso()
  const updatedAt = createdAt

  ensureCommandsTable()
  try {
    getSwitchUiDb()
      .prepare(
        `INSERT INTO user_commands
          (id, name, slash, description, prompt, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        name,
        slash,
        description,
        prompt,
        enabled ? 1 : 0,
        createdAt,
        updatedAt,
      )
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new CommandConflictError(`${slash} already exists`)
    }
    throw error
  }

  const created = getUserCommand(id)
  if (!created)
    throw new Error(`Created command ${id} but could not read it back`)
  return created
}

export function updateUserCommand(
  commandId: string,
  input: UpdateUserCommandInput,
): UserCommandRecord {
  const existing = getUserCommand(commandId)
  if (!existing) throw new CommandNotFoundError('Command not found')

  const slashInput = readString(input.slash, 'slash')
  const slash =
    slashInput === undefined ? existing.slash : validateSlash(slashInput)
  ensureUniqueSlash(slash, commandId)

  const nameInput = readString(input.name, 'name')
  const descriptionInput = readString(input.description, 'description')
  const promptInput = readString(input.prompt, 'prompt')
  const enabledInput = readBoolean(input.enabled, 'enabled')

  const name =
    nameInput === undefined ? existing.name : validateName(nameInput, slash)
  const description =
    descriptionInput === undefined
      ? existing.description
      : validateDescription(descriptionInput)
  const prompt =
    promptInput === undefined ? existing.prompt : validatePrompt(promptInput)
  const enabled = enabledInput ?? existing.enabled
  const updatedAt = nowIso()

  try {
    getSwitchUiDb()
      .prepare(
        `UPDATE user_commands
         SET name = ?, slash = ?, description = ?, prompt = ?, enabled = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        name,
        slash,
        description,
        prompt,
        enabled ? 1 : 0,
        updatedAt,
        commandId,
      )
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new CommandConflictError(`${slash} already exists`)
    }
    throw error
  }

  const updated = getUserCommand(commandId)
  if (!updated) throw new CommandNotFoundError('Command not found')
  return updated
}

export function deleteUserCommand(commandId: string): boolean {
  ensureCommandsTable()
  const result = getSwitchUiDb()
    .prepare('DELETE FROM user_commands WHERE id = ?')
    .run(commandId)
  return result.changes > 0
}

export function __resetCommandsStoreForTests(): void {
  ensureCommandsTable()
  getSwitchUiDb().exec('DELETE FROM user_commands')
}
