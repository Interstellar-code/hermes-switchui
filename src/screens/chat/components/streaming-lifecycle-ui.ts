export type StreamingLifecycleEvent = {
  text: string
  emoji: string
  timestamp: number
  isError: boolean
}

const NOTEWORTHY_LIFECYCLE_PATTERN =
  /compact|handoff|handed off|stall|recover|resume|reconcile/i

export function selectVisibleLifecycleEvents(
  events: Array<StreamingLifecycleEvent>,
  maxVisible = 3,
): Array<StreamingLifecycleEvent> {
  if (events.length <= maxVisible) return events

  const noteworthy = events.filter(
    (event) =>
      event.isError ||
      event.emoji === '🗜️' ||
      NOTEWORTHY_LIFECYCLE_PATTERN.test(event.text),
  )

  if (noteworthy.length > 0) return noteworthy.slice(-maxVisible)
  return events.slice(-maxVisible)
}

export function buildCompactionNotice({
  compactionCount,
  messagesBefore,
  messagesAfter,
}: {
  compactionCount: number
  messagesBefore: number | null
  messagesAfter: number | null
}): string | null {
  if (compactionCount <= 0) return null

  if (
    typeof messagesBefore === 'number' &&
    Number.isFinite(messagesBefore) &&
    messagesBefore > 0 &&
    typeof messagesAfter === 'number' &&
    Number.isFinite(messagesAfter) &&
    messagesAfter >= 0
  ) {
    return `Context compacted • ${messagesBefore} → ${messagesAfter} messages kept`
  }

  if (compactionCount === 1) return 'Context compacted during this chat'
  return `Context compacted ${compactionCount} times during this chat`
}
