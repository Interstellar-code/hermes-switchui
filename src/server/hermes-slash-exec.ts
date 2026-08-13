/**
 * Execute one Hermes agent slash command and normalize the answer.
 *
 * Two RPCs are involved and they are not interchangeable:
 *
 *   • `slash.exec` — `{session_id, command}` → `{output, warning?}`. Runs
 *     registry commands. Requires a tui_gateway session (see
 *     `hermes-slash-session.ts`). Can answer `4018` for a few commands it
 *     refuses to run in the worker, which is the documented signal to retry on
 *     the other RPC (`docs/plans/hermes-slash-commands-in-switchui.md` §5.10).
 *   • `command.dispatch` — `{session_id, name, arg}` → a discriminated union.
 *     Note the parameter is **`name`, not `command`**: passing `command` makes
 *     it dispatch the empty string and answer
 *     `4018 not a quick/plugin/bundle/skill command: `. Verified live; this is
 *     easy to get wrong because `slash.exec` next door uses `command`.
 *
 * The union `command.dispatch` returns (`tui_gateway/server.py:13075-13619`):
 *
 *   {type:'exec',    output}            quick command / goal / snapshot notice
 *   {type:'alias',   target}            re-dispatch target
 *   {type:'plugin',  output}
 *   {type:'send',    message, notice?}  bundle, /queue, /learn, /moa, /retry
 *   {type:'skill',   message, name}     skill command — the 79-strong tail
 *   {type:'prefill', message, notice}   /undo
 */

import { HermesRpcError, hermesRpc } from './hermes-rpc'
import { getAgentVersion } from './hermes-agent-version'
import { evaluateSlashCommand } from './hermes-slash-policy'
import { withSlashSession } from './hermes-slash-session'
import type { EvaluateSlashOptions } from './hermes-slash-policy'

/** Per-request ceiling. The slowest allowlisted command measured live is
 *  `/tools` at ~5.7s; the agent's own worker timeout is 45s, which is longer
 *  than any browser should wait. */
export const SLASH_EXEC_TIMEOUT_MS = 30_000

/**
 * Per-command output ceiling, in UTF-8 bytes.
 *
 * `/debug local` is the reason this exists. Measured over the dashboard RPC on
 * a throwaway session against installed v0.19.16 (2026-08-13):
 * **1,152,725 characters / 1,153,097 bytes** in 1777ms — against **69 bytes**
 * for `/profile` on the same session. The bulk is the tail of `agent.log`, so
 * the size is a property of the host's logging, not of the command, and it has
 * only ever grown: the same command measured 863,549 chars a day earlier.
 *
 * Nothing else bounded it. The output card renders collapsed and
 * `command-output-store` keeps 20 entries per session in memory, but neither is
 * a limit on what crosses the wire, gets JSON-encoded, or is handed to a
 * `{type:'send'}` prompt.
 *
 * 64 KiB is ~950x the largest *useful* allowlisted output (`/insights`,
 * `/history`) and ~10x `/learn`'s ~6.0k-char prompt, so it never fires on a
 * command whose whole answer is the point — only on a dump.
 */
export const SLASH_OUTPUT_LIMIT_BYTES = 64 * 1024

export type SlashExecResult =
  | { type: 'exec'; output: string; warning?: string }
  | { type: 'plugin'; output: string; warning?: string }
  | { type: 'send'; message: string; notice?: string }
  | { type: 'skill'; message: string; name?: string }
  | { type: 'prefill'; message: string; notice?: string }
  | { type: 'alias'; target: string }

export type SlashExecOutcome =
  | { ok: true; command: string; result: SlashExecResult }
  | { ok: false; command: string; reason: string; refused: true }

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

// ── Output cap ────────────────────────────────────────────────────────────

const BYTES = new Intl.NumberFormat('en-US')

/**
 * Cut a string to at most `maxBytes` UTF-8 bytes **without splitting a
 * character**. `Buffer.subarray(0, n).toString('utf8')` would happily cut a
 * multi-byte sequence in half and hand the browser a U+FFFD; walking back off
 * the continuation bytes (`10xxxxxx`) lands on a lead byte, and everything
 * before a lead byte is a complete sequence.
 */
export function sliceUtf8(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, 'utf8')
  if (buf.length <= maxBytes) return text
  let end = maxBytes
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end -= 1
  return buf.subarray(0, end).toString('utf8')
}

/**
 * The truncation notice. It is appended to the text itself rather than carried
 * only in a side channel, so a truncated dump can never read as the whole
 * answer — whatever renders it. It says the real size, what was kept, that the
 * remainder was discarded rather than parked somewhere, and where the bulk of a
 * dump actually lives (`GET /api/logs`, which the Logs screen already tails).
 */
function truncationNotice(originalBytes: number): string {
  return (
    `\n\n── output truncated by SwitchUI ──\n` +
    `The agent returned ${BYTES.format(originalBytes)} bytes; the first ` +
    `${BYTES.format(SLASH_OUTPUT_LIMIT_BYTES)} are shown above and the rest was ` +
    `discarded, not stored anywhere. Most of a large dump is the tail of ` +
    `agent.log — read that in full on the Logs screen ` +
    `(GET /api/logs?file=agent&lines=500).`
  )
}

/** Short form for the card's warning strip, which shows while it is collapsed. */
function truncationWarning(originalBytes: number): string {
  return (
    `Output truncated: ${BYTES.format(originalBytes)} bytes returned, ` +
    `${BYTES.format(SLASH_OUTPUT_LIMIT_BYTES)} kept. See the note at the end of the output.`
  )
}

function capText(text: string): { text: string; originalBytes: number } | null {
  const originalBytes = Buffer.byteLength(text, 'utf8')
  if (originalBytes <= SLASH_OUTPUT_LIMIT_BYTES) return null
  return {
    text: sliceUtf8(text, SLASH_OUTPUT_LIMIT_BYTES) + truncationNotice(originalBytes),
    originalBytes,
  }
}

/**
 * Apply the cap to every text-bearing arm of the union.
 *
 * **Every** arm, including the `send`/`skill`/`prefill` messages that become
 * prompts: an unbounded prompt is the same defect as an unbounded card, and the
 * notice makes the cut visible in the composer too. In practice the largest
 * prompt on the allowlist is `/learn` at ~6.0k chars, so this only ever fires on
 * output. `alias.target` is a command name and is left alone.
 */
export function capSlashResult(result: SlashExecResult): SlashExecResult {
  switch (result.type) {
    case 'exec':
    case 'plugin': {
      const capped = capText(result.output)
      if (!capped) return result
      const warning = [result.warning, truncationWarning(capped.originalBytes)]
        .filter(Boolean)
        .join('\n')
      return { ...result, output: capped.text, warning }
    }
    case 'send':
    case 'skill':
    case 'prefill': {
      const capped = capText(result.message)
      return capped ? { ...result, message: capped.text } : result
    }
    default:
      return result
  }
}

/**
 * Turn a `command.dispatch` payload into the union, total and fail-closed:
 * an unrecognized `type` becomes an `exec` card carrying whatever text came
 * back, because showing the agent's answer is always better than dropping it.
 */
export function normalizeDispatchResult(raw: unknown): SlashExecResult {
  const payload = (raw ?? {}) as Record<string, unknown>
  const type = str(payload.type)

  switch (type) {
    case 'alias': {
      const target = str(payload.target).trim()
      if (target) return { type: 'alias', target }
      break
    }
    case 'plugin':
      return { type: 'plugin', output: str(payload.output) }
    case 'send': {
      const notice = str(payload.notice).trim()
      return {
        type: 'send',
        message: str(payload.message),
        ...(notice ? { notice } : {}),
      }
    }
    case 'skill': {
      const name = str(payload.name).trim()
      return {
        type: 'skill',
        message: str(payload.message),
        ...(name ? { name } : {}),
      }
    }
    case 'prefill': {
      const notice = str(payload.notice).trim()
      return {
        type: 'prefill',
        message: str(payload.message),
        ...(notice ? { notice } : {}),
      }
    }
    default:
      break
  }

  const output =
    str(payload.output) || str(payload.message) || (type ? `(${type})` : '')
  return { type: 'exec', output }
}

function normalizeExecResult(raw: unknown): SlashExecResult {
  const payload = (raw ?? {}) as Record<string, unknown>
  // `slash.exec` passes _PENDING_INPUT_COMMANDS and bundle commands straight
  // through from `command.dispatch`, so a `type` field can appear here too.
  if (typeof payload.type === 'string' && payload.type) {
    return normalizeDispatchResult(payload)
  }
  const warning = str(payload.warning).trim()
  return {
    type: 'exec',
    output: str(payload.output),
    ...(warning ? { warning } : {}),
  }
}

async function dispatch(
  handle: string,
  command: string,
  args: string,
): Promise<SlashExecResult> {
  const raw = await hermesRpc<unknown>(
    'command.dispatch',
    { session_id: handle, name: command, arg: args },
    { timeoutMs: SLASH_EXEC_TIMEOUT_MS },
  )
  return normalizeDispatchResult(raw)
}

/**
 * Everything `evaluateSlashCommand` takes **except** the agent version, which
 * is deliberately not a caller-supplied input: this function reads it itself
 * (see below), so no caller can hand the policy a version and unlock the
 * allowlist.
 */
export type RunSlashCommandOptions = Omit<EvaluateSlashOptions, 'agentVersion'> & {
  /** The caller's own chat session id; binds the tui_gateway session. */
  chatSessionId?: string | null
}

/**
 * Evaluate, then run. **Every** execution path goes through
 * `evaluateSlashCommand` first — the client is never trusted, and a command
 * the menu happens to list is not thereby allowed.
 */
export async function runSlashCommand(
  input: string,
  options: RunSlashCommandOptions = {},
): Promise<SlashExecOutcome> {
  // Read directly, per request, from the running agent — not from the catalog
  // entry's `runnable` flag, not from the capability probe, and not from the
  // caller. That is what makes the version floor a control here rather than a
  // picker filter: the same request the browser could hand-craft against this
  // route is checked against a version this process just read (cached 10s in
  // `hermes-agent-version.ts`). Unknown reads back as null and fails closed.
  const agentVersion = await getAgentVersion()

  const decision = evaluateSlashCommand(input, {
    agentVersion,
    aliases: options.aliases,
    skillCommands: options.skillCommands,
    bundleCommands: options.bundleCommands,
  })
  if (!decision.ok) {
    return {
      ok: false,
      command: decision.command,
      reason: decision.reason,
      refused: true,
    }
  }

  // Never the raw client string: `decision.args` is empty for a bare command,
  // the single permitted form for an argument-restricted one (`--preview`,
  // `local`), the validated digits for `/insights <n>`, and the caller's own
  // text only where the policy said arguments are the payload (`/learn`, skill
  // commands, bundle slugs). Sending `decision.command` alone would silently turn an allowed
  // `/compress --preview` into a bare `/compress` (which compresses), an
  // allowed `/debug local` into a bare `/debug` (which uploads to a public
  // paste), and `/insights 3` into the 30-day report.
  const args = decision.args
  const wireCommand = args ? `${decision.command} ${args}` : decision.command

  const result = await withSlashSession(options.chatSessionId, async (handle) => {
    // Three users of this route: skill commands, bundle slugs, and `/learn`.
    // All three answer with a `{type:'send'}`-shaped union member rather than
    // `{output}`, and all three carry their arguments as the payload — a
    // bundle's argument becomes the "User instruction:" line in the message
    // `build_bundle_invocation_message` returns. `/learn` could also be sent over
    // `slash.exec` — it is in `_PENDING_INPUT_COMMANDS`, which `slash.exec`
    // forwards straight back here — but going direct skips a hop and keeps the
    // answer shape predictable rather than sniffed.
    if (decision.route === 'dispatch') {
      return dispatch(handle, decision.command, args)
    }
    try {
      const raw = await hermesRpc<unknown>(
        'slash.exec',
        { session_id: handle, command: wireCommand },
        { timeoutMs: SLASH_EXEC_TIMEOUT_MS },
      )
      return normalizeExecResult(raw)
    } catch (error) {
      // 4018 is `slash.exec` saying "not mine" (e.g. a command it refuses to
      // run in the worker). §5.10: fall back to command.dispatch.
      if (error instanceof HermesRpcError && error.code === 4018) {
        return dispatch(handle, decision.command, args)
      }
      throw error
    }
  })

  return { ok: true, command: decision.command, result: capSlashResult(result) }
}

// ── Failure classification ────────────────────────────────────────────────

/**
 * What went wrong, from the caller's point of view.
 *
 * `invalid-input`/`unroutable`/`session-gone`/`busy`/`rate-limited` are the
 * caller's problem and carry the **agent's own message verbatim** — which is
 * routinely better than anything we would write (`"usage: /subgoal remove <n>"`,
 * `"<n> must be an integer"`, `"index out of range (1..1)"`). `agent-error` and
 * `timeout` are the gateway's problem.
 */
export type SlashFailureKind =
  | 'invalid-input'
  | 'unroutable'
  | 'session-gone'
  | 'busy'
  | 'rate-limited'
  | 'agent-error'
  | 'timeout'

export type SlashFailure = {
  /** HTTP status the exec route should answer with. */
  status: number
  kind: SlashFailureKind
  /** User-facing text. The agent's own message, except for a timeout. */
  message: string
  /** The agent's JSON-RPC code, or null when the failure never reached it. */
  agentCode: number | null
  /**
   * True when this is the caller's problem, so a client can render it as
   * guidance ("you typed it wrong") rather than an error ("the agent broke").
   */
  guidance: boolean
}

export const SLASH_TIMEOUT_MESSAGE =
  'The agent did not answer in time. The command may still be running inside the agent.'

/**
 * Map an agent JSON-RPC failure onto an HTTP status.
 *
 * ── The real error space, from installed hermes-agent v0.19.16 ────────────
 * `_err(rid, code, msg)` is `tui_gateway/server.py:1618` (the plan's `~:1456`
 * is against an older tree). It is a plain constructor — there is no code
 * table, no enum and no doc, so the space is whatever the ~265 call sites use.
 * Across the whole file that is **4000–4090** and **5000–5063**, and the split
 * is consistent: 4xxx is always a rejected request, 5xxx is always a thrown
 * exception or an absent subsystem. Hence the rule below is a **range** rule
 * with a handful of named refinements, not a lookup table — an unlisted 4xxx is
 * still the caller's problem and an unlisted 5xxx is still ours.
 *
 * The codes actually reachable through `slash.exec` (`server.py:15552`) and
 * `command.dispatch` (`:13654`), which are the only two RPCs this module runs:
 *
 *   4001  session not found (`:1891`, via `_sess_nowait`) — also "no active
 *         session" / "no session key" from the dispatch branches
 *         (`:13809 :13863 :13917 :13925 :13998 :14006 :14103 :14113 :14218`)
 *   4004  bad input — the fixable one. `"empty command"` (`:15559`),
 *         `"usage: /queue <prompt>"` (`:13787`), `"usage: /steer <prompt>"`
 *         (`:13897`), `"invalid goal: …"` (`:13970`),
 *         `"usage: /subgoal remove <n>"` (`:14047`), `"/subgoal remove: …"`
 *         (`:14059`), `"/subgoal clear: …"` (`:14069`), `"/subgoal: …"`
 *         (`:14083`), `"undo: invalid count …"` (`:14121`)
 *   4009  session busy — `"session busy — /interrupt the current turn before
 *         /retry|/undo|/compress"` (`:13866 :14106 :14221 :14238`)
 *   4018  unknown or unroutable — `"not a quick/plugin/bundle/skill command:
 *         <name>"` (`:14314`), `"no previous user message to retry"`
 *         (`:13870 :13878 :13887`), `"no user messages to undo"` (`:14129`),
 *         `"bundle dispatch failed"` (`:13737 :13740`). Note `runSlashCommand`
 *         already consumes the *routing* 4018 by retrying on `command.dispatch`
 *         (§5.10), so a 4018 that reaches here is a genuine dead end
 *   4090  active-session cap (`_claim_active_session_slot`, `:6135 :6570
 *         :6638 :6715 :9365`) — raised by `session.create`/`session.resume`
 *         inside `withSlashSession`, so it reaches this module too
 *   5008  undo failed to load history (`:14127 :14139`)
 *   5009  compress failed (`:14312`)
 *   5019  compute-host dispatch failed (`:14234`)
 *   5030  slash worker start/run failed (`:15668 :15684`), moa/goals
 *         unavailable (`:13838 :13859 :13921 :14002`)
 *
 * `/handoff` is off the allowlist but its codes are in the same 4xxx family and
 * fall out of the range rule correctly: 4024 unknown platform (`:7311`), 4025
 * platform not enabled (`:7327`), 4026 no home channel (`:7331`), 4027 already
 * in flight (`:7365`), 4028 no state.db row (`:7359`). (The brief's list omitted
 * 4025.)
 *
 * **5xxx stays 5xx.** Flattening a wedged worker or a dead dashboard into a
 * 400 would tell the user they typed something wrong while the agent is down.
 * The one agent-side miscoding found — `5063 "project_id required"` (`:12784`),
 * a client error wearing a server code — is unreachable from these two RPCs and
 * is deliberately not special-cased: guessing per-code intent is exactly what
 * the range rule exists to avoid.
 */
export function classifySlashFailure(error: unknown): SlashFailure {
  const message = error instanceof Error ? error.message : 'Command failed'

  if (error instanceof HermesRpcError) {
    const code = error.code
    if (code >= 4000 && code <= 4999) {
      const kind: SlashFailureKind =
        code === 4001 || code === 4007
          ? 'session-gone'
          : code === 4009 || code === 4023 || code === 4027
            ? 'busy'
            : code === 4090
              ? 'rate-limited'
              : code === 4018
                ? 'unroutable'
                : 'invalid-input'
      const status =
        kind === 'session-gone'
          ? 404
          : kind === 'busy'
            ? 409
            : kind === 'rate-limited'
              ? 429
              : 400
      return { status, kind, message, agentCode: code, guidance: true }
    }
    // 5xxx, and the JSON-RPC framing codes (-32600…-32700) which mean this
    // process built a bad request. Both are ours, not the user's.
    return {
      status: 502,
      kind: 'agent-error',
      message,
      agentCode: code,
      guidance: false,
    }
  }

  // Not an RPC error at all: the per-request deadline, a dropped socket, an
  // open circuit breaker. Only the deadline gets a rewritten message, because
  // "Hermes RPC timeout after 30000ms for slash.exec" tells the user nothing
  // about the command possibly still running inside the agent.
  if (/timeout/i.test(message)) {
    return {
      status: 504,
      kind: 'timeout',
      message: SLASH_TIMEOUT_MESSAGE,
      agentCode: null,
      guidance: false,
    }
  }
  return {
    status: 502,
    kind: 'agent-error',
    message,
    agentCode: null,
    guidance: false,
  }
}
