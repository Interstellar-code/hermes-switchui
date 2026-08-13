import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The two standing-goal events, at the hop where they used to die.
 *
 * `streamChat` (`server/hermes-api.ts`) is generic — it hands every SSE frame
 * to `onEvent` — so nothing upstream had to change. The route's `onEvent` is
 * where an event either gets a translation or is silently dropped, and before
 * this it had no branch for either goal event: the gateway emitted them, the
 * server read them, and the browser never heard about it.
 *
 * These are source-shape assertions because the handler is an inline closure
 * inside the route's `createFileRoute` block, with no seam to drive. The
 * behavioural half of the contract — that the browser turns these frames into
 * separate assistant turns and a judge card — is covered against the real hook
 * in `screens/chat/hooks/use-streaming-message.goal.test.ts`, and the two
 * halves are joined by the event NAMES asserted in both files.
 */
describe('send-stream — goal continuation events', () => {
  const source = readFileSync(
    new URL('./send-stream.ts', import.meta.url),
    'utf8',
  )

  it('translates both gateway goal events for the browser', () => {
    expect(source).toContain("if (event === 'goal.status')")
    expect(source).toContain("if (event === 'goal.continuation')")
    expect(source).toContain("sendEvent('goal_status', {")
    expect(source).toContain("sendEvent('goal_continuation', {")
  })

  it('carries the fields the card and the turn boundary need', () => {
    // The judge's line and its turn counter are the card; `should_continue`
    // and `capped` are what separate "finished" from "stopped".
    for (const field of [
      'data.message',
      'data.status',
      'data.verdict',
      'data.should_continue',
      'data.capped',
      'data.turns_used',
      'data.max_turns',
      'data.message_id',
    ]) {
      expect(source).toContain(field)
    }
    // `turn` is what makes a continuation countable in the activity log.
    expect(source).toContain('turn: Number(data.turn)')
  })

  it('never forwards the continuation prompt to the browser', () => {
    // The agent sends itself a ~400-character restatement of the goal. It is
    // not something the user wrote, and shipping it invites rendering it as if
    // they had.
    expect(source).not.toContain('continuationPrompt')
    expect(source).not.toContain('data.continuation_prompt')
  })

  it('keeps the goal branches out of the way of an ordinary turn', () => {
    // Both branches are gated on their own event name and return, so a session
    // with no goal — which is every session by default — takes exactly the path
    // it always did.
    const statusIndex = source.indexOf("if (event === 'goal.status')")
    const deltaIndex = source.indexOf("if (event === 'assistant.delta')")
    expect(statusIndex).toBeGreaterThan(-1)
    expect(deltaIndex).toBeGreaterThan(statusIndex)
  })
})
