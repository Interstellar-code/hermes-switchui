import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  parseModelErrorEnvelope,
  parseReasoningErrorEnvelope,
} from './send-stream'
import { streamChat } from '@/server/hermes-api'
import {
  GATEWAY_REASONING_EFFORTS,
  THINKING_LEVELS,
  THINKING_LEVEL_TO_REASONING_EFFORT,
  normalizeThinkingLevel,
  toReasoningEffort,
} from '@/lib/reasoning-effort'

/**
 * The composer sends two per-request agent parameters. Exactly one of them has
 * somewhere to land:
 *
 *   * `thinking` — the reasoning-*effort label* ('low', 'adaptive', …).
 *     Forwarded, since hermes-agent 0.19.15, as the gateway's per-request
 *     `reasoning_effort` (gateway/platforms/api_server.py:3748 for the stream,
 *     :3674 for `/chat`; validated at :587 against
 *     `hermes_constants.parse_reasoning_effort`, hermes_constants.py:867).
 *     Three separate defects had to be fixed before it could be: the label was
 *     echoed to the client as the model's reasoning text, written into the
 *     final message's thinking block, and handed to the gateway as
 *     `system_message` — which the agent applies as the turn's ephemeral
 *     system prompt. Those regressions are still guarded below.
 *   * `fastMode` — still has no consumer, because `api_server.py` still has no
 *     `service_tier` on any surface.
 */
describe('send-stream reasoning/effort wiring', () => {
  const source = readFileSync(
    new URL('./send-stream.ts', import.meta.url),
    'utf8',
  )

  it('streams the model reasoning, not the effort label, on the thinking event', () => {
    expect(source).toContain(
      "sendEvent('thinking', {\n                        text: chatThinking,",
    )
    // The old, defective form must be gone.
    expect(source).not.toContain(
      "sendEvent('thinking', {\n                        text: thinking,",
    )
  })

  it('puts the accumulated reasoning into the final assistant message', () => {
    expect(source).toContain("? [{ type: 'thinking', thinking: chatThinking }]")
    expect(source).not.toContain(
      "...(thinking ? [{ type: 'thinking', thinking }] : []),",
    )
  })

  it('never sends the effort label to the gateway as a system prompt', () => {
    expect(source).not.toContain('system_message: thinking')
    expect(source).not.toMatch(/system_message:\s*thinking\b/)
  })

  it('forwards the level as reasoning_effort, mapped in the shared module', () => {
    // Mapped, never passed through raw: the picker's vocabulary is not the
    // gateway's, and `off`/`adaptive` are not levels the gateway accepts.
    expect(source).toContain('const reasoningEffort = toReasoningEffort(')
    expect(source).toContain('reasoning_effort: reasoningEffort,')
    expect(source).not.toMatch(/reasoning_effort:\s*body\.thinking/)
  })

  it('documents that fastMode has no gateway parameter to forward to', () => {
    // Matched as object keys, not as prose, so the explanatory comment in the
    // route does not satisfy its own assertion. If a consumer is ever added it
    // must be a deliberate change made against a gateway that accepts one.
    expect(source).not.toMatch(
      /^\s*(service_tier|serviceTier|fastMode)\s*[,:]/m,
    )
    expect(source).toContain('* Fast mode')
  })
})

describe('ThinkingLevel → reasoning_effort mapping', () => {
  it('maps every picker level, so a new one cannot ship unmapped', () => {
    expect(Object.keys(THINKING_LEVEL_TO_REASONING_EFFORT).sort()).toEqual(
      [...THINKING_LEVELS].sort(),
    )
  })

  it('only ever produces a level the gateway advertises', () => {
    for (const level of THINKING_LEVELS) {
      const wire = THINKING_LEVEL_TO_REASONING_EFFORT[level]
      if (wire === null) continue
      expect(GATEWAY_REASONING_EFFORTS).toContain(wire)
    }
  })

  it('maps "off" to the gateway\'s `none` disable alias, not to omission', () => {
    // Omitting would mean "use agent.reasoning_effort", i.e. None that still
    // thinks.
    expect(toReasoningEffort('off')).toBe('none')
  })

  it('passes the three shared levels straight through', () => {
    expect(toReasoningEffort('low')).toBe('low')
    expect(toReasoningEffort('medium')).toBe('medium')
    expect(toReasoningEffort('high')).toBe('high')
  })

  it('sends nothing for "adaptive", which has no agent equivalent', () => {
    // Every level `parse_reasoning_effort` accepts is a FIXED effort; pinning
    // adaptive to one would assert a level the user never chose (and would
    // stomp agent.reasoning_effort for every session the Claude-4.6
    // auto-select puts on adaptive). Omission = the configured default.
    expect(toReasoningEffort('adaptive')).toBeUndefined()
    expect(THINKING_LEVEL_TO_REASONING_EFFORT.adaptive).toBeNull()
  })

  it('drops values that are not levels the picker offers', () => {
    // A mangled label is not a user selection; forwarding it would turn a
    // client bug into a 400 on the user's turn.
    expect(toReasoningEffort('turbo')).toBeUndefined()
    expect(toReasoningEffort('xhigh')).toBeUndefined()
    expect(toReasoningEffort(undefined)).toBeUndefined()
    expect(toReasoningEffort(3)).toBeUndefined()
    expect(normalizeThinkingLevel('medium')).toBe('medium')
    expect(normalizeThinkingLevel('turbo')).toBeUndefined()
  })
})

describe('streamChat puts the level on the wire', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function sseOk(): Response {
    return new Response('data: {}\n\n', {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }

  async function wireBody(
    reasoningEffort: string | undefined,
  ): Promise<Record<string, unknown>> {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(sseOk())
    await streamChat(
      'session-1',
      { message: 'hi', reasoning_effort: reasoningEffort },
      { onEvent: vi.fn() },
    )
    // Last call, not first: re-spying an already-spied fetch keeps the
    // existing call log, so calls[0] would be a previous assertion's body.
    const calls = fetchSpy.mock.calls
    const init = calls[calls.length - 1][1] as RequestInit
    return JSON.parse(String(init.body)) as Record<string, unknown>
  }

  it('serializes reasoning_effort into the POST body', async () => {
    expect(await wireBody(toReasoningEffort('high'))).toMatchObject({
      reasoning_effort: 'high',
    })
    expect(await wireBody(toReasoningEffort('off'))).toMatchObject({
      reasoning_effort: 'none',
    })
  })

  it('omits the key entirely when there is no level to send', async () => {
    // JSON.stringify drops undefined — the gateway reads an absent field as
    // "use the configured default", which is exactly what `adaptive` means.
    expect(await wireBody(toReasoningEffort('adaptive'))).not.toHaveProperty(
      'reasoning_effort',
    )
  })
})

describe('parseReasoningErrorEnvelope', () => {
  // Verbatim from the live gateway (v0.19.16) for reasoning_effort='turbo'.
  const LIVE_400 =
    '{"error": {"message": "Invalid reasoning_effort \'turbo\'; expected one of: minimal, low, medium, high, xhigh, max, ultra, none", "type": "invalid_request_error", "param": "reasoning_effort", "code": "invalid_reasoning_effort"}}'

  it('recovers the gateway message from the streamChat transport wrapper', () => {
    const parsed = parseReasoningErrorEnvelope(
      `Hermes chat stream: 400 ${LIVE_400}`,
    )
    expect(parsed?.code).toBe('invalid_reasoning_effort')
    expect(parsed?.param).toBe('reasoning_effort')
    // The valid levels must survive into the message the user sees.
    expect(parsed?.message).toContain('minimal, low, medium, high')
  })

  it('does not claim a model refusal, which would roll the model picker back', () => {
    expect(parseModelErrorEnvelope(`Hermes chat stream: 400 ${LIVE_400}`)).toBe(
      null,
    )
  })

  it('ignores model refusals and non-JSON transport failures', () => {
    expect(
      parseReasoningErrorEnvelope(
        '{"error":{"message":"nope","param":"model","code":"model_not_available"}}',
      ),
    ).toBe(null)
    expect(parseReasoningErrorEnvelope('<html>502</html>')).toBe(null)
  })
})
