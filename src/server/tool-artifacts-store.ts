import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'

export const INLINE_TOOL_OUTPUT_LIMIT = 4_000
const DATA_DIR = join(process.cwd(), '.runtime', 'tool-artifacts')
const INDEX_FILE = join(DATA_DIR, 'index.json')
const PREVIEW_LIMIT = 1_000
export const MAX_ARTIFACTS = 500

export type ToolArtifactKind =
  | 'tool_output'
  | 'file_read'
  | 'terminal_log'
  | 'diff'
  | 'skill_doc'

export type ToolArtifact = {
  id: string
  sessionId: string
  messageId?: string
  toolCallId?: string
  toolName?: string
  kind: ToolArtifactKind
  title: string
  summary: string
  preview: string
  contentSize: number
  contentPath: string
  createdAt: number
}

type ArtifactIndex = {
  artifacts: Record<string, ToolArtifact>
}

let index: ArtifactIndex = { artifacts: {} }

function atomicWriteFile(file: string, content: string): void {
  const tmp = join(
    dirname(file),
    `.tmp.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`,
  )
  try {
    writeFileSync(tmp, content, 'utf-8')
    renameSync(tmp, file)
  } catch (err) {
    try { unlinkSync(tmp) } catch { /* ignore */ }
    throw err
  }
}

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
}

function loadIndex(): void {
  try {
    if (!existsSync(INDEX_FILE)) return
    const parsed = JSON.parse(readFileSync(INDEX_FILE, 'utf-8')) as ArtifactIndex
    if (parsed && typeof parsed === 'object' && parsed.artifacts) {
      index = parsed
    }
  } catch {
    index = { artifacts: {} }
  }
}

function saveIndex(): void {
  ensureDataDir()
  atomicWriteFile(INDEX_FILE, JSON.stringify(index, null, 2))
}

loadIndex()

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 160) || 'unknown'
}

function hashString(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function artifactContentPath(sessionId: string, artifactId: string): string {
  return join(DATA_DIR, sanitizePathSegment(sessionId), `${artifactId}.json`)
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} chars`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}k chars`
  return `${(size / (1024 * 1024)).toFixed(1)}m chars`
}

function previewText(content: string): string {
  const cleaned = content.replace(/\r\n/g, '\n').trim()
  if (cleaned.length <= PREVIEW_LIMIT) return cleaned
  return `${cleaned.slice(0, PREVIEW_LIMIT)}…`
}

function inferArtifactKind(toolName?: string, text?: string): ToolArtifactKind {
  const name = (toolName || '').toLowerCase()
  if (name.includes('read_file') || name === 'read' || name === 'file_read') {
    return 'file_read'
  }
  if (name.includes('terminal') || name.includes('exec') || name.includes('bash')) {
    return 'terminal_log'
  }
  if (name.includes('skill')) return 'skill_doc'
  if (name.includes('patch') || /^diff --git/m.test(text || '')) return 'diff'
  return 'tool_output'
}

export function listToolArtifacts(sessionId?: string): Array<ToolArtifact> {
  return Object.values(index.artifacts)
    .filter((artifact) => !sessionId || artifact.sessionId === sessionId)
    .sort((a, b) => b.createdAt - a.createdAt)
}

export function deleteSessionArtifacts(sessionId: string): void {
  const toDelete = Object.values(index.artifacts).filter(
    (artifact) => artifact.sessionId === sessionId,
  )
  for (const artifact of toDelete) {
    delete index.artifacts[artifact.id]
    try { unlinkSync(artifact.contentPath) } catch { /* ignore if already gone */ }
  }
  if (toDelete.length > 0) saveIndex()
}

export function getToolArtifact(artifactId: string): (ToolArtifact & { content: string }) | null {
  const artifact = index.artifacts[artifactId]
  if (!artifact) return null
  try {
    const raw = readFileSync(artifact.contentPath, 'utf-8')
    const parsed = JSON.parse(raw) as { content?: unknown }
    return {
      ...artifact,
      content: typeof parsed.content === 'string' ? parsed.content : '',
    }
  } catch {
    return { ...artifact, content: '' }
  }
}

type CreateArtifactInput = {
  sessionId: string
  messageId?: string
  toolCallId?: string
  toolName?: string
  content: string
  title?: string
  summary?: string
  kind?: ToolArtifactKind
}

export function createOrUpdateToolArtifact(input: CreateArtifactInput): ToolArtifact {
  const stableKey = [
    input.sessionId,
    input.messageId || '',
    input.toolCallId || '',
    input.toolName || '',
    hashString(input.content),
  ].join('\n')
  const id = `toolout_${hashString(stableKey).slice(0, 16)}`
  const contentPath = artifactContentPath(input.sessionId, id)
  const createdAt = index.artifacts[id]?.createdAt ?? Date.now()
  const kind = input.kind ?? inferArtifactKind(input.toolName, input.content)
  const title = input.title ?? `${input.toolName || 'tool'} output`
  const summary =
    input.summary ??
    `${title} externalized (${formatBytes(input.content.length)}). Full output stored as artifact ${id}.`
  const artifact: ToolArtifact = {
    id,
    sessionId: input.sessionId,
    messageId: input.messageId,
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    kind,
    title,
    summary,
    preview: previewText(input.content),
    contentSize: input.content.length,
    contentPath,
    createdAt,
  }

  const dir = join(DATA_DIR, sanitizePathSegment(input.sessionId))
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  atomicWriteFile(
    contentPath,
    JSON.stringify(
      {
        artifact: { ...artifact, contentPath: undefined },
        content: input.content,
      },
      null,
      2,
    ),
  )
  index.artifacts[id] = artifact

  // Evict oldest artifacts when the index exceeds MAX_ARTIFACTS.
  const keys = Object.keys(index.artifacts)
  if (keys.length > MAX_ARTIFACTS) {
    const sorted = keys.sort((a, b) => index.artifacts[a].createdAt - index.artifacts[b].createdAt)
    const toEvict = sorted.slice(0, keys.length - MAX_ARTIFACTS)
    for (const evictId of toEvict) {
      const evicted = index.artifacts[evictId]
      delete index.artifacts[evictId]
      try { unlinkSync(evicted.contentPath) } catch { /* ignore if already gone */ }
    }
  }

  saveIndex()
  return artifact
}

function readMessageText(message: Record<string, unknown>): string {
  const content = message.content
  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (!part || typeof part !== 'object') return ''
        const record = part as Record<string, unknown>
        if (record.type === 'text' || record.type === 'tool_result') {
          return typeof record.text === 'string' ? record.text : ''
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
    if (text.trim()) return text
  }
  if (typeof message.text === 'string') return message.text
  return ''
}

function compactContentForMessage(
  originalContent: unknown,
  compactText: string,
): Array<Record<string, unknown>> {
  if (!Array.isArray(originalContent) || originalContent.length === 0) {
    return [{ type: 'text', text: compactText }]
  }
  return originalContent.map((part) => {
    if (!part || typeof part !== 'object') return part as Record<string, unknown>
    const record = part as Record<string, unknown>
    if (record.type === 'text') return { ...record, text: compactText }
    if (record.type === 'tool_result') return { ...record, text: compactText }
    return record
  })
}

export function externalizeLargeToolOutput<T extends Record<string, unknown>>(
  sessionId: string,
  message: T,
  limit = INLINE_TOOL_OUTPUT_LIMIT,
): T & Record<string, unknown> {
  const role = typeof message.role === 'string' ? message.role : ''
  const normalizedRole = role.toLowerCase()
  if (!['tool', 'toolresult', 'tool_result'].includes(normalizedRole)) {
    return message
  }

  const outputText = readMessageText(message)
  if (outputText.length <= limit) return message

  const toolName =
    typeof message.toolName === 'string'
      ? message.toolName
      : typeof message.tool_name === 'string'
        ? message.tool_name
        : 'tool'
  const messageId = typeof message.id === 'string' ? message.id : undefined
  const toolCallId =
    typeof message.toolCallId === 'string'
      ? message.toolCallId
      : typeof message.tool_call_id === 'string'
        ? message.tool_call_id
        : undefined
  const artifact = createOrUpdateToolArtifact({
    sessionId,
    messageId,
    toolCallId,
    toolName,
    content: outputText,
    title: `${toolName} output`,
  })
  const compactText = `${artifact.summary}\n\nPreview:\n${artifact.preview}`

  return {
    ...message,
    text: compactText,
    content: compactContentForMessage(message.content, compactText),
    artifactId: artifact.id,
    artifactKind: artifact.kind,
    artifactSummary: artifact.summary,
    artifactContentSize: artifact.contentSize,
    artifactPreview: artifact.preview,
    details: {
      ...((message.details && typeof message.details === 'object'
        ? message.details
        : {}) as Record<string, unknown>),
      artifact: {
        id: artifact.id,
        kind: artifact.kind,
        title: artifact.title,
        summary: artifact.summary,
        contentSize: artifact.contentSize,
      },
    },
  }
}
