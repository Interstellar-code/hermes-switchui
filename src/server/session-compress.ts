import { hermesRpc } from './hermes-rpc'
import { SLASH_EXEC_TIMEOUT_MS } from './hermes-slash-exec'
import {
  acquireSlashSession,
  releaseSlashSession,
} from './hermes-slash-session'

// Manual compress for one chat, run only from the context-full alert's
// Compress button — the general slash-exec policy still refuses bare
// `/compress`, so a typed command cannot reach this.
//
// `session.compress`, not `slash.exec '/compress'`: a freshly resumed binding
// builds its agent in the background, and slash.exec's compress mirror is a
// silent no-op until it exists ("(no output)", transcript untouched).
// session.compress waits for the agent (`_sess` → `_wait_agent`) and answers
// with counts plus `info.stored_session_id` — the continuation id when
// compression rotated the session (`compression.in_place: false`), else the
// same id (hermes-agent's default compacts in place).

export type CompressOutcome = {
  compressed: boolean
  beforeMessages: number | null
  afterMessages: number | null
  message: string
  /** Set when compression rotated to a continuation session. */
  continuationKey: string | null
}

type SessionCompressResult = {
  status?: string
  compressed?: boolean
  lock_held?: boolean
  message?: string
  before_messages?: number
  after_messages?: number
  info?: { stored_session_id?: string }
}

export async function compressChatSession(
  sessionKey: string,
): Promise<CompressOutcome> {
  // A cached binding snapshots the transcript when it opens — compressing
  // that would summarise a stale copy. Start fresh, and drop it after.
  await releaseSlashSession(sessionKey)
  let result: SessionCompressResult
  try {
    const handle = await acquireSlashSession(sessionKey)
    result = await hermesRpc<SessionCompressResult>(
      'session.compress',
      { session_id: handle },
      { timeoutMs: SLASH_EXEC_TIMEOUT_MS * 4 },
    )
  } finally {
    await releaseSlashSession(sessionKey)
  }

  const compressed = result.status === 'compressed'
  const stored = result.info?.stored_session_id?.trim() || ''
  const before = result.before_messages ?? null
  const after = result.after_messages ?? null
  return {
    compressed,
    beforeMessages: before,
    afterMessages: after,
    message: compressed
      ? `Compressed ${before ?? '?'} → ${after ?? '?'} messages`
      : result.message ||
        (result.lock_held
          ? 'Compression already running'
          : 'Nothing to compress yet'),
    continuationKey: stored && stored !== sessionKey ? stored : null,
  }
}
