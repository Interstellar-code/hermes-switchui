import type { ClaudeSession } from './hermes-api'

const DEFAULT_MAIN_RESOLUTION_TTL_MS = 15_000

let mainResolutionCache: { id: string | null; expiresAt: number } | null = null

function isInternalSessionKey(id: string): boolean {
  return (
    id.startsWith('cron_') ||
    id.startsWith('cron:') ||
    id.startsWith('agent:main:ops-')
  )
}

function hasRealTitle(session: { id: string; title?: string | null }): boolean {
  const title = (session.title ?? '').trim()
  return title.length > 0 && title !== session.id
}

export function selectMainSessionId(
  sessions: Array<ClaudeSession>,
): string | null {
  const titled = sessions.find(
    (session) => !isInternalSessionKey(session.id) && hasRealTitle(session),
  )
  const fallback = titled
    ? null
    : sessions.find(
        (session) =>
          !isInternalSessionKey(session.id) &&
          typeof session.message_count === 'number' &&
          session.message_count > 0,
      )

  return (titled ?? fallback)?.id ?? null
}

export function clearMainSessionResolutionCache(): void {
  mainResolutionCache = null
}

export async function resolveMainSessionId(options: {
  listSessions: (limit?: number, offset?: number) => Promise<Array<ClaudeSession>>
  ttlMs?: number
}): Promise<string | null> {
  const now = Date.now()
  const ttlMs = options.ttlMs ?? DEFAULT_MAIN_RESOLUTION_TTL_MS
  if (mainResolutionCache && mainResolutionCache.expiresAt > now) {
    return mainResolutionCache.id
  }

  const sessions = await options.listSessions(30, 0)
  const resolvedId = selectMainSessionId(sessions)
  mainResolutionCache = { id: resolvedId, expiresAt: now + ttlMs }
  return resolvedId
}
