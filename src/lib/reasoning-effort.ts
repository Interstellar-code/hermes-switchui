/**
 * The composer's reasoning-effort picker, and the ONE place its labels are
 * translated into the parameter the gateway actually accepts.
 *
 * ── The gateway contract (verified against the installed agent, v0.19.16) ────
 *
 * `POST /api/sessions/{id}/chat` and `.../chat/stream` both accept a
 * `reasoning_effort` string (gateway/platforms/api_server.py:3674 and :3748).
 * It is parsed by `_requested_reasoning_effort` (api_server.py:587) which
 * delegates to `hermes_constants.parse_reasoning_effort` (hermes_constants.py:867)
 * so the HTTP surface cannot drift from the CLI/config parser:
 *
 *   * valid levels — `VALID_REASONING_EFFORTS` (hermes_constants.py:862):
 *     minimal, low, medium, high, xhigh, max, ultra;
 *   * plus the disable aliases none / false / disabled, of which the HTTP
 *     surface advertises `none`.
 *
 * Anything else is a **400 naming the valid levels**, raised before the SSE
 * response is committed — never a silently-ignored default and never a
 * mid-stream error frame. Omitting the field (or sending null) means "use the
 * configured default" (`agent.reasoning_effort`).
 *
 * It is **per-request, not sticky** — deliberately unlike the `model`
 * override, which is installed on the session. `_create_agent`
 * (api_server.py:2452, docstring at :2474) applies the level to that agent
 * instance only, so a turn that omits the field does NOT inherit the previous
 * turn's level. The client must therefore send it on EVERY turn.
 *
 * ── Why the mapping lives here ──────────────────────────────────────────────
 *
 * `ThinkingLevel` is a SwitchUI display vocabulary and only partly overlaps
 * the agent's. Keeping the level list and its translation in one module means
 * a new picker entry cannot be added without the `Record` below failing to
 * compile, and the server route cannot invent a spelling the picker never
 * offers.
 */

/**
 * The composer picker's levels, in display order
 * (src/screens/chat/components/v2/session-selectors-v2.tsx).
 */
export const THINKING_LEVELS = [
  'off',
  'low',
  'medium',
  'high',
  'adaptive',
] as const

export type ThinkingLevel = (typeof THINKING_LEVELS)[number]

/** Levels `reasoning_effort` accepts on the wire, as advertised by its own 400. */
export const GATEWAY_REASONING_EFFORTS = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
  'none',
] as const

export type GatewayReasoningEffort = (typeof GATEWAY_REASONING_EFFORTS)[number]

/**
 * Picker label → wire value. `null` means "send no `reasoning_effort` at all",
 * which the gateway reads as "use the configured default".
 *
 * `adaptive` is the one entry with no agent equivalent, and it maps to `null`
 * rather than to a fixed level. `parse_reasoning_effort` has no adaptive-like
 * value: every level it accepts is a fixed effort. Pinning `adaptive` to
 * `medium` would be a per-turn override that overrides nothing the user asked
 * for — it would silently clamp a model that does vary its own effort, and it
 * would stomp the operator's `agent.reasoning_effort` for every session that
 * lands on `adaptive` (which the Claude-4.6 auto-select in `use-thinking-level`
 * does without the user touching the picker). Omitting the field is the only
 * behaviour here that does not assert a level the user never chose.
 */
export const THINKING_LEVEL_TO_REASONING_EFFORT: Record<
  ThinkingLevel,
  GatewayReasoningEffort | null
> = {
  off: 'none',
  low: 'low',
  medium: 'medium',
  high: 'high',
  adaptive: null,
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return (
    typeof value === 'string' &&
    (THINKING_LEVELS as ReadonlyArray<string>).includes(value)
  )
}

/**
 * Normalize an untrusted wire value (`body.thinking`) into a level the picker
 * actually offers. Unknown values are dropped rather than forwarded: a
 * mangled label is not a level the user selected, and forwarding it would turn
 * a client bug into a 400 on the user's turn.
 */
export function normalizeThinkingLevel(
  value: unknown,
): ThinkingLevel | undefined {
  return isThinkingLevel(value) ? value : undefined
}

/**
 * The value to put on the wire for a picker level, or `undefined` when the
 * turn should carry no `reasoning_effort` at all.
 */
export function toReasoningEffort(
  value: unknown,
): GatewayReasoningEffort | undefined {
  const level = normalizeThinkingLevel(value)
  if (!level) return undefined
  return THINKING_LEVEL_TO_REASONING_EFFORT[level] ?? undefined
}
