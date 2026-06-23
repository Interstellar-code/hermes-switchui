/**
 * Pure helper for resolving orphaned tool cards on stream end.
 *
 * When the Responses API path emits `tool.completed` but never follows up
 * with `tool.output` (gateway crash, network drop, run aborted), any tool
 * card that received `tool.completed` stays in a perpetually-pending state.
 *
 * The stream handler tracks such callIds in `awaitingOutput`. On stream end
 * it calls `resolveOrphanedToolCards` to synthesise terminal `phase:'complete'`
 * events for every still-pending card so no spinner is left orphaned.
 *
 * Happy path: `awaitingOutput` is empty by the time the stream ends (every
 * `tool.completed` was followed by `tool.output`), so this function returns
 * an empty array and is a no-op.
 */

export type OrphanToolState = {
  name: string
  args: Record<string, unknown> | string | null
}

export type OrphanToolEvent = {
  phase: 'complete'
  name: string
  toolCallId: string
  args?: Record<string, unknown>
  result: undefined
  sessionKey: string
  runId?: string
}

export function resolveOrphanedToolCards({
  awaitingOutput,
  toolStateByCallId,
  sessionKey,
  runId,
}: {
  awaitingOutput: ReadonlySet<string>
  toolStateByCallId: ReadonlyMap<string, OrphanToolState>
  sessionKey: string
  runId?: string
}): Array<OrphanToolEvent> {
  const events: Array<OrphanToolEvent> = []
  for (const callId of awaitingOutput) {
    const state = toolStateByCallId.get(callId)
    const name = state?.name ?? 'tool'
    const argsForCard =
      state?.args && typeof state.args === 'object'
        ? (state.args)
        : undefined
    events.push({
      phase: 'complete',
      name,
      toolCallId: callId,
      args: argsForCard,
      result: undefined,
      sessionKey,
      runId,
    })
  }
  return events
}
