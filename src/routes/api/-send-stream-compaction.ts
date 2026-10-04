// Compaction signals on the agent → BFF stream (#364).
//
// Two jobs, both pure so they can be unit-tested without the SSE plumbing:
//  1. `buildUsageUpdatePayload` — translate agent `usage.update` into the
//     client's `usage_update`. A compaction event must survive even when the
//     agent omits `context_percent`; gating the forward on the percent used to
//     drop `compacted: true` on the floor.
//  2. `isCompactionStartSignal` — spot the agent saying "compacting now" so the
//     chat can show a live chip while the aux-model summary is generated.

export type UsageUpdatePayload = {
  contextPercent: number | undefined
  compacted: boolean
  messagesBefore: number | undefined
  messagesAfter: number | undefined
  sessionKey: string
  runId: string | undefined
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function buildUsageUpdatePayload(
  data: Record<string, unknown>,
  sessionKey: string,
  runId: string | undefined,
): UsageUpdatePayload | null {
  const contextPercent = readFiniteNumber(data.context_percent)
  const compacted = data.compacted === true
  // Nothing to tell the client: no percent and no compaction.
  if (contextPercent === undefined && !compacted) return null
  return {
    contextPercent,
    compacted,
    messagesBefore: readFiniteNumber(data.messages_before),
    messagesAfter: readFiniteNumber(data.messages_after),
    sessionKey,
    runId,
  }
}

// Agent status lines while compaction runs: "🗜️ Compacting context…",
// "Compressing context (42 messages)…", "Context compaction started".
// Deliberately NOT matched: "Pre-compaction memory flush" (routine heartbeat)
// and the past-tense completion line, which `usage.update` already covers.
const COMPACTION_START_TEXT =
  /\b(compacting|compressing) (the )?(context|conversation)\b|\bcontext compaction (started|starting|in progress)\b/i

const COMPACTION_START_EVENTS = new Set([
  'compaction.started',
  'compaction.start',
  'context.compacting',
  'context.compaction.started',
  'compression.started',
])

const STATUS_EVENTS = new Set([
  'status',
  'lifecycle',
  'agent.status',
  'run.status',
  'tool.progress',
])

function readStatusText(data: Record<string, unknown>): string {
  for (const key of ['message', 'text', 'status', 'delta', 'content']) {
    const value = data[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return ''
}

export function isCompactionStartText(text: string): boolean {
  return COMPACTION_START_TEXT.test(text)
}

export function isCompactionStartSignal(
  event: string,
  data: Record<string, unknown>,
): boolean {
  if (COMPACTION_START_EVENTS.has(event)) return true
  if (!STATUS_EVENTS.has(event)) return false
  return isCompactionStartText(readStatusText(data))
}
