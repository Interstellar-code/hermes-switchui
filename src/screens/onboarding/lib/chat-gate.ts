/**
 * chat-gate.ts — the rule the whole rebuild hangs off.
 *
 * The official quickstart states the order plainly: install → choose a
 * provider → **first successful chat** → verify resume → and only then
 * gateway, MCP, skills, voice. It also states the rule that order encodes:
 *
 *   > if Hermes cannot complete a normal chat, do not add more features yet.
 *
 * The wizard this replaces offered profiles, memory, kanban and projects
 * before a single completion had ever succeeded, so a user could finish all
 * twelve steps and still not have a working agent. This module owns the gate
 * that stops that, and the escape hatch that keeps the wizard usable as a
 * settings surface.
 *
 * The escape hatch is deliberate and was decided before this code was written:
 * the gate **blocks by default but offers skip-with-warning**. A hard block
 * would make the relaunched wizard useless to a returning user whose gateway
 * happens to be down, and this wizard is a settings surface as well as a
 * first run. What the escape hatch must not be is vague — "some features may
 * not work" teaches nobody anything — so `buildSkipWarning` is a function of
 * the actual failure, and names the actual consequences.
 */
import type { OllamaContextVerdict } from './ollama-context'

export type ChatGateState =
  /** Nothing has been attempted yet. */
  | { kind: 'untested' }
  /** A completion is in flight. */
  | { kind: 'sending' }
  /** A real completion came back with real text. The gate is open. */
  | { kind: 'passed'; reply: string }
  /** The attempt produced an error. Carries the gateway's own words. */
  | {
      kind: 'failed'
      error: string
      /** The error looks like a credential problem rather than an outage. */
      credentialLikely: boolean
    }
  /** The user chose to continue anyway, having been told what breaks. */
  | { kind: 'skipped'; at: number }

export const CHAT_GATE_UNTESTED: ChatGateState = { kind: 'untested' }

/** Has the gate been settled, one way or the other? */
export function isGateSettled(state: ChatGateState): boolean {
  return state.kind === 'passed' || state.kind === 'skipped'
}

/** Has a real completion actually succeeded? Stricter than `isGateSettled`. */
export function isGateProven(state: ChatGateState): boolean {
  return state.kind === 'passed'
}

export type SkipWarningInput = {
  state: ChatGateState
  /** The provider `config.yaml` names as active, if any. */
  activeProvider: string | null
  /** The Ollama context verdict, when one applies. */
  ollama?: OllamaContextVerdict | null
}

/**
 * The consequences of skipping, in the order a user would hit them.
 *
 * Every entry is a thing that is *known* to depend on a working completion, so
 * this reads as a list of what breaks rather than a disclaimer. The
 * cause-specific line comes first, because that is the one the user can act on.
 */
export function buildSkipWarning(input: SkipWarningInput): Array<string> {
  const lines: Array<string> = []
  const { state, activeProvider, ollama } = input

  if (!activeProvider) {
    lines.push(
      'No provider is active, so the very first message you send will error before it reaches a model.',
    )
  } else if (state.kind === 'failed' && state.credentialLikely) {
    lines.push(
      `${activeProvider} is configured but rejected the credential — the gateway answered: “${state.error}”. ` +
        'Every chat, every tool call and every background job will fail the same way until that is fixed.',
    )
  } else if (state.kind === 'failed') {
    lines.push(
      `The last attempt failed with: “${state.error}”. Nothing below will behave differently until it succeeds.`,
    )
  } else {
    lines.push(
      'Nothing has proved this agent can answer, so everything below is unverified rather than known-broken.',
    )
  }

  if (
    ollama &&
    (ollama.kind === 'below-minimum' || ollama.kind === 'unconfigured')
  ) {
    lines.push(
      'The context window looks smaller than the 64,000 tokens Hermes requires, and the gateway ' +
        'rejects undersized models at startup — so the agent may not load at all, rather than merely answering badly.',
    )
  }

  lines.push(
    'Chat is the failure you will see first: the composer will accept a message and the stream will end in an error.',
  )
  lines.push(
    'Tool calls, terminal commands and file edits all run inside a completion, so none of them will execute either.',
  )
  lines.push(
    'Memory writes happen during a turn — the agent decides what to keep as it answers — so nothing will ever be remembered.',
  )
  lines.push(
    'Skills, MCP servers and scheduled jobs are all invoked by the agent mid-turn. Configuring them now configures something that never runs.',
  )

  return lines
}

/**
 * The one-line reason the gate is blocking, for the footer. Distinct from the
 * full warning: this is what the user sees before they ask to skip.
 */
export function gateBlockReason(state: ChatGateState): Array<string> {
  if (isGateSettled(state)) return []
  if (state.kind === 'sending') return ['Waiting for the provider to answer…']
  if (state.kind === 'failed') {
    return [
      `The agent could not answer: ${state.error}. Fix it, or choose “Continue anyway” to see what that costs.`,
    ]
  }
  return [
    'Send one real message first. Everything after this step depends on a completion actually succeeding.',
  ]
}
