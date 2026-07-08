export const HERMES_SESSION_KEY_HEADER = 'X-Hermes-Session-Key'
// The gateway reads X-Hermes-Session-Id to bind a /v1/chat/completions run to a
// state.db session (api_server.py). SwitchUI historically sent the value under
// X-Claude-Session-Id, which the gateway ignored — so portable transcripts were
// persisted under a fingerprint-derived id and lost on reload.
export const HERMES_SESSION_ID_HEADER = 'X-Hermes-Session-Id'
export const HERMES_FRIENDLY_ID_HEADER = 'X-Hermes-Friendly-Id'
export const LEGACY_CLAUDE_SESSION_KEY_HEADER = 'x-claude-session-key'
export const LEGACY_CLAUDE_FRIENDLY_ID_HEADER = 'x-claude-friendly-id'

type HeaderReader = {
  get: (name: string) => string | null
}

function normalizeHeaderValue(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function buildResolvedSessionHeaders(payload: {
  sessionKey: string
  friendlyId: string
}): Record<string, string> {
  return {
    [HERMES_SESSION_KEY_HEADER]: payload.sessionKey,
    [HERMES_FRIENDLY_ID_HEADER]: payload.friendlyId,
    [LEGACY_CLAUDE_SESSION_KEY_HEADER]: payload.sessionKey,
    [LEGACY_CLAUDE_FRIENDLY_ID_HEADER]: payload.friendlyId,
  }
}

export function readResolvedSessionHeaders(
  headers: HeaderReader,
  fallback: {
    sessionKey: string
    friendlyId: string
  },
): {
  sessionKey: string
  friendlyId: string
} {
  const sessionKey =
    normalizeHeaderValue(headers.get(HERMES_SESSION_KEY_HEADER)) ||
    normalizeHeaderValue(headers.get(LEGACY_CLAUDE_SESSION_KEY_HEADER)) ||
    fallback.sessionKey

  const resolvedFriendlyId =
    normalizeHeaderValue(headers.get(HERMES_FRIENDLY_ID_HEADER)) ||
    normalizeHeaderValue(headers.get(LEGACY_CLAUDE_FRIENDLY_ID_HEADER))

  const friendlyId = resolvedFriendlyId || sessionKey || fallback.friendlyId

  if (!resolvedFriendlyId) {
    console.warn(
      `[send-stream-session-headers] ${HERMES_FRIENDLY_ID_HEADER} / ${LEGACY_CLAUDE_FRIENDLY_ID_HEADER} header missing; falling back to "${friendlyId}"`,
    )
  }

  return {
    sessionKey,
    friendlyId,
  }
}
