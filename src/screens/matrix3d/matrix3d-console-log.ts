export type Matrix3DConsoleType =
  | 'sys'
  | 'route'
  | 'tool'
  | 'trace'
  | 'review'
  | 'dispatch'
  | 'err'

export type Matrix3DConsoleEntry = {
  id: string
  time: string
  agent: string
  agentKey: string | null
  source: 'agent' | 'gateway'
  color: string
  type: Matrix3DConsoleType
  message: string
  duration: string
  noisy: boolean
}

export const TYPE_LABELS: Record<Matrix3DConsoleType, string> = {
  sys: 'SYS',
  route: 'ROUTE',
  tool: 'TOOL',
  trace: 'TRACE',
  review: 'REVIEW',
  dispatch: 'DISP',
  err: 'ERR',
}

const QUIET_GATEWAY_ACCESS_PATHS = [
  /^\/api\/.+/i,
  /^\/health\b/i,
]

function readGatewayAccessLog(line: string): { path: string; status: string } | null {
  const match = line.match(/aiohttp\.access:.*"(?:GET|POST|PUT|PATCH|DELETE)\s+([^\s"]+)[^"]*"\s+(\d{3})\b/i)
  if (!match) return null
  const [, path = '', status = ''] = match
  if (!path || !status) return null
  return { path, status }
}

function isRoutineGatewayAccessLog(line: string): boolean {
  const access = readGatewayAccessLog(line)
  if (!access) return false
  if (!QUIET_GATEWAY_ACCESS_PATHS.some((pattern) => pattern.test(access.path))) return false
  return ['200', '204', '304', '401', '404'].includes(access.status)
}

export function shouldSuppressConsoleLine(line: string, source: 'agent' | 'gateway'): boolean {
  if (source !== 'gateway') return false

  if (/\bhealth report\b/i.test(line)) return true
  if (/\bnode health\b/i.test(line)) return true
  if (/\bheartbeat\b/i.test(line)) return true
  if (/\bhealthcheck\b/i.test(line)) return true
  if (isRoutineGatewayAccessLog(line)) return true

  return false
}

export function readLogLevel(line: string): Matrix3DConsoleType {
  const lower = line.toLowerCase()
  if (/\b(error|exception|traceback|failed|fatal)\b/.test(lower)) return 'err'
  if (/\b(warn|warning|deprecated)\b/.test(lower)) return 'review'
  if (/\b(tool|exec|command|shell)\b/.test(lower)) return 'tool'
  if (/\b(route|request|http|api)\b/.test(lower)) return 'route'
  if (/\b(trace|debug|stream)\b/.test(lower)) return 'trace'
  return 'sys'
}

export function colorForType(type: Matrix3DConsoleType): string {
  if (type === 'err') return '#ff5f6d'
  if (type === 'review') return '#a78bfa'
  if (type === 'tool') return '#d6ff5f'
  if (type === 'route') return '#00ff41'
  if (type === 'trace') return '#5fcfff'
  return 'rgba(216,255,227,.58)'
}

export function extractLogLines(raw: unknown): Array<string> {
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => {
        if (typeof entry === 'string') return entry
        if (entry && typeof entry === 'object') {
          const record = entry as Record<string, unknown>
          return typeof record.message === 'string'
            ? record.message
            : typeof record.line === 'string'
              ? record.line
              : JSON.stringify(record)
        }
        return ''
      })
      .filter(Boolean)
  }

  if (!raw || typeof raw !== 'object') return []
  const record = raw as Record<string, unknown>
  return Array.isArray(record.lines)
    ? record.lines.filter((line): line is string => typeof line === 'string')
    : []
}

export function inferAgentKey(
  agentLabel: string,
  message: string,
  agentMatchers: Array<{ id: string; name: string }>,
): string | null {
  const haystack = `${agentLabel} ${message}`.toLowerCase()
  for (const matcher of agentMatchers) {
    const id = matcher.id.toLowerCase()
    const name = matcher.name.toLowerCase()
    if (haystack.includes(id) || haystack.includes(name)) return matcher.id
  }
  return null
}

export function parseLogLine(
  line: string,
  index: number,
  source: 'agent' | 'gateway',
  agentMatchers: Array<{ id: string; name: string }>,
): Matrix3DConsoleEntry {
  const type = readLogLevel(line)
  const noisy = shouldSuppressConsoleLine(line, source)
  const timestamp =
    line.match(/\b\d{2}:\d{2}:\d{2}(?:\.\d+)?\b/)?.[0]?.slice(0, 8) ||
    line.match(/T(\d{2}:\d{2}:\d{2})/)?.[1] ||
    '—'
  const bracket = line.match(/\[([^\]\s]{2,24})\]/)?.[1]
  const agent = (bracket || (type === 'route' ? 'API' : type === 'tool' ? 'TOOL' : 'GATEWAY')).toUpperCase()
  const message = line
    .replace(/^\s*\d{4}-\d{2}-\d{2}T?/, '')
    .replace(/^\s*\d{2}:\d{2}:\d{2}(?:\.\d+)?\s*/, '')
    .trim()

  const normalizedMessage = message || line
  return {
    id: `log-${source}-${index}-${line.slice(0, 24)}`,
    time: timestamp,
    agent,
    agentKey: inferAgentKey(agent, normalizedMessage, agentMatchers),
    source,
    color: colorForType(type),
    type,
    message: normalizedMessage,
    duration: '',
    noisy,
  }
}

export function buildLogEntries(
  raw: unknown,
  source: 'agent' | 'gateway',
  agentMatchers: Array<{ id: string; name: string }>,
  options?: { includeNoise?: boolean },
): Array<Matrix3DConsoleEntry> {
  const includeNoise = options?.includeNoise === true
  return extractLogLines(raw)
    .map((line, index) => parseLogLine(line, index, source, agentMatchers))
    .filter((entry) => includeNoise || !entry.noisy)
    .slice(-80)
}
