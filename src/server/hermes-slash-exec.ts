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

export type SlashExecResult =
  | { type: 'exec'; output: string; warning?: string }
  | { type: 'plugin'; output: string }
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

  return { ok: true, command: decision.command, result }
}
