import type {
  A2AFleetConversationSummary,
  A2AFleetPeer,
} from '@/lib/hermes-client'

/**
 * A2A fleet peers as office characters. The a2a_fleet plugin exposes no busy
 * flag, so "busy" is INFERRED from the peer's newest conversation line:
 *  - Hermes sent the last line (`hermes->X`): the peer owes a reply, or
 *  - the peer's last line is its `[queued]` ack: accepted, reply pending
 *    (an ack is not completion);
 * and that line is less than 10 minutes old. Anything else is idle.
 */

export const A2A_PEER_ID_PREFIX = 'a2a:'
const BUSY_WINDOW_MS = 10 * 60_000
const BUBBLE_MAX_LENGTH = 96

export type Matrix3DFleetPeer = {
  id: string
  /** `peer · repo` */
  name: string
  peer: string
  repo: string | null
  mode: string | null
  busy: boolean
  /** last_text trimmed; only while busy. */
  bubble: string | null
  lastAt: number | null
}

/** The plugin writes tz-less local "YYYY-MM-DD HH:MM:SS"; numbers are epoch s/ms. */
export function parseFleetTimestamp(
  value: string | number | null | undefined,
): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value
  }
  if (typeof value !== 'string') return null
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
      value.trim(),
    )
  if (!match) {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  const [, y, mo, d, h, mi, s] = match
  return new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s || '0'),
  ).getTime()
}

const QUEUED_MARKER = '[queued]'
const CLOCK_SKEW_MS = 60_000

/**
 * The receivers' ack is e.g. "Message received; … Reply will follow. [queued]"
 * — the marker sits at an END of the line (upstream templates append it), so
 * match the trimmed line's start/end rather than any mention mid-reply.
 */
export function isQueuedAck(text: string | null | undefined): boolean {
  const line = (text ?? '').trim().toLowerCase()
  return line.startsWith(QUEUED_MARKER) || line.endsWith(QUEUED_MARKER)
}

export function isPeerBusy(
  conversation: Pick<
    A2AFleetConversationSummary,
    'last_dir' | 'last_text' | 'last_ts'
  >,
  nowMs: number,
): boolean {
  const at = parseFleetTimestamp(conversation.last_ts)
  if (at === null) return false
  const age = nowMs - at
  // Beyond clock skew, a future timestamp is bogus, not "just now".
  if (age > BUSY_WINDOW_MS || age < -CLOCK_SKEW_MS) return false
  const awaitingReply = (conversation.last_dir ?? '').startsWith('hermes->')
  return awaitingReply || isQueuedAck(conversation.last_text)
}

function repoBasename(path: string | null): string | null {
  const base = path?.replace(/\/+$/, '').split('/').pop()
  return base || null
}

function bubbleText(text: string | null): string | null {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim()
  if (!clean) return null
  return clean.length <= BUBBLE_MAX_LENGTH
    ? clean
    : `${clean.slice(0, BUBBLE_MAX_LENGTH - 1).trimEnd()}…`
}

export function buildFleetPresence(
  peers: Array<A2AFleetPeer>,
  conversations: Array<A2AFleetConversationSummary>,
  nowMs = Date.now(),
): Array<Matrix3DFleetPeer> {
  return peers.map((peer) => {
    let latest: A2AFleetConversationSummary | null = null
    let latestAt = Number.NEGATIVE_INFINITY
    for (const conversation of conversations) {
      if (conversation.peer !== peer.name) continue
      const at = parseFleetTimestamp(conversation.last_ts) ?? -1
      if (at > latestAt) {
        latest = conversation
        latestAt = at
      }
    }
    const busy = latest ? isPeerBusy(latest, nowMs) : false
    const repo = repoBasename(peer.repo_path)
    return {
      id: `${A2A_PEER_ID_PREFIX}${peer.name}`,
      name: repo ? `${peer.name} · ${repo}` : peer.name,
      peer: peer.name,
      repo,
      mode: peer.mode ?? latest?.mode ?? null,
      busy,
      bubble: busy ? bubbleText(latest?.last_text ?? null) : null,
      lastAt: latestAt >= 0 ? latestAt : null,
    }
  })
}
