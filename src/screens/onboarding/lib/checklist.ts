/**
 * checklist.ts — the "what's left" list the summary and finish steps render,
 * and the one the dashboard card and sidebar badge read from outside the
 * wizard entirely.
 *
 * Deliberately separate from `OnboardingDraft.skipped`: the draft is cleared
 * once the wizard finishes (`clearOnboardingDraft`), but the checklist has to
 * keep working after that, so it falls back to the `skipped` *and* `completed`
 * lists carried on a `'complete'` `OnboardingOutcome` once the draft is gone.
 *
 * `chatProven` / `pluginsTouched` and friends are live signals. Inside a wizard
 * session they are what that session observed; outside one they come from
 * `use-onboarding-checklist.ts`'s own probes of the real configuration. Either
 * way the completion record still has to be able to answer for them, because a
 * probe can be unavailable — otherwise a user who finished everything keeps a
 * permanent badge with no way to clear it. Hence: an item is done if a live
 * signal says so **or** the persisted run recorded that step as completed.
 *
 * The two are never merged in the other direction. Nothing here writes back
 * into `completed`: "a machine noticed the install is configured" and "a human
 * walked this step" stay separate records, the same distinction
 * `onboarding-storage.ts` keeps between `autoDetected` and `complete`.
 *
 * ## What the ordering encodes
 *
 * The list is the canonical order from the docs, and the first four entries
 * are the required ones. `chat` is `blocked` until a provider exists, and
 * every optional entry is `blocked` until the chat has been settled — a
 * checklist that invites a user to "set up memory" on an install that cannot
 * complete a sentence is the same mistake the twelve-step wizard made, just
 * rendered smaller.
 */
import type { OnboardingStepId } from './onboarding-steps'
import type { OnboardingDraft, OnboardingOutcome } from './onboarding-storage'
import type { ProfileServabilityResult } from './profile-servability'

export type ChecklistItemId =
  | 'connect'
  | 'provider'
  | 'workspace'
  | 'chat'
  | 'profile'
  | 'memory'
  | 'plugins'
  | 'theme'

export type ChecklistItemState = 'done' | 'skipped' | 'todo' | 'blocked'

export type ChecklistItem = {
  id: ChecklistItemId
  label: string
  detail: string
  state: ChecklistItemState
  goTo: OnboardingStepId
  /** One of the four the docs call required. Rendered ahead of the rest. */
  required: boolean
}

export type BuildChecklistInput = {
  outcome: OnboardingOutcome
  draft: OnboardingDraft | null
  activeProvider: string | null
  /** The gateway answered a health check in this session. */
  gatewayReachable: boolean | null
  /** A real completion has succeeded in this session. */
  chatProven: boolean
  /** The agent's resolved working directory, when it is known. */
  agentCwd: string | null
  /** True when that directory came from an explicit `terminal.cwd`. */
  agentCwdExplicit: boolean
  /**
   * Whether the core plugin set is settled — the wizard reads this as "this
   * session toggled something", the dashboard as "every core plugin is
   * already on". Both mean the same thing to a checklist: nothing left here.
   */
  pluginsTouched: boolean
  /**
   * Whether this session actually activated a profile. A 200 from
   * `/api/profiles/activate` only writes the `~/.hermes/active_profile`
   * pointer, and the gateway does not read it again until it restarts — so
   * "the API returned OK" is not the same as "this is done".
   */
  profileTouched: boolean
  /** Same contract as `profileTouched`, for `memory.provider`. */
  memoryTouched: boolean
  /**
   * Whether a theme has been picked for this browser.
   *
   * The odd one out: every other signal above describes the machine, and this
   * one describes `localStorage`, because that is where `setTheme` puts it.
   * Before this input existed the item read `completed.has('theme')` alone,
   * which is only ever written by a wizard run — so an install that settled
   * via the legacy flag or auto-detection (`use-onboarding-gate.ts`'s
   * `readGateOutcome`, both of which synthesise `completed: []`) could pick
   * every theme in the list and still be told to "Pick a theme".
   */
  themeChosen: boolean
  /**
   * Whether every profile on disk is actually reachable by the live
   * gateway — the gap where a multi-profile install with multiplexing off
   * (or an incompletely multiplexed one — see `profile-servability.ts`)
   * only found out at SEND time, from `profile-scope.ts`'s fail-closed
   * refusal, after a message had already been composed.
   *
   * `null` when the signal is not available: this is a live probe
   * (`use-profile-servability.ts`, mirroring `chatProven`/`profileTouched`
   * and the rest), so it only has an answer inside an active wizard
   * session — see `use-onboarding-checklist.ts`'s header for why the other
   * live signals are `false`/`null` outside one. `null` renders identically
   * to `{ kind: 'ok' }`: silence, never a false accusation.
   */
  profileServability: ProfileServabilityResult | null
}

export function buildChecklist(
  input: BuildChecklistInput,
): Array<ChecklistItem> {
  const completeOutcome =
    input.outcome.kind === 'complete' ? input.outcome : null
  const skippedSource = input.draft?.skipped ?? completeOutcome?.skipped ?? []
  const skipped = new Set<OnboardingStepId>(skippedSource)
  const completedSource =
    input.draft?.completed ?? completeOutcome?.completed ?? []
  const completed = new Set<OnboardingStepId>(completedSource)

  // A finished run is the persisted stand-in for the live probes the wizard
  // has and nobody else does.
  const chatProven = input.chatProven || completed.has('chat')
  const workspaceDone = input.agentCwdExplicit || completed.has('workspace')
  const pluginsTouched = input.pluginsTouched || completed.has('plugins')
  const profileTouched = input.profileTouched || completed.has('profile')
  const memoryTouched = input.memoryTouched || completed.has('memory')
  const connected = input.gatewayReachable === true || completed.has('connect')
  const themeChosen = input.themeChosen || completed.has('theme')

  function stateFor(
    id: OnboardingStepId,
    done: boolean,
    blocked: boolean,
  ): ChecklistItemState {
    if (done) return 'done'
    if (blocked) return 'blocked'
    if (skipped.has(id)) return 'skipped'
    return 'todo'
  }

  // Nothing optional is offered until a chat has been settled — the rule the
  // whole rebuild exists to enforce, applied to this list too.
  const optionalBlocked = !chatProven && !skipped.has('chat')

  // A real reachability gap (or genuine uncertainty about one — the
  // 'indeterminate' case) outranks "has this been touched": an
  // already-activated profile that turns out to be unreachable from a
  // non-multiplexed gateway, or one this install's topology couldn't even
  // confirm, is not "done". `{ kind: 'ok' }` and `null` both mean "nothing to
  // add" and fall through to the ordinary touched/optional detail below —
  // this is a WARNING surfaced inline, never a hard blocker: it only ever
  // downgrades `done` to `todo`/`skipped`, the same states this item can
  // already be in, and never flips `required` or forces `blocked` on its own.
  const servability =
    input.profileServability && input.profileServability.kind !== 'ok'
      ? input.profileServability
      : null
  const servabilityDetail = servability
    ? servability.kind === 'indeterminate'
      ? servability.detail
      : `${servability.detail} ${servability.remediation}`
    : null

  return [
    {
      id: 'connect',
      label: 'Reach the gateway',
      detail:
        input.gatewayReachable === true
          ? 'The gateway answered.'
          : input.gatewayReachable === false
            ? 'The gateway is not responding.'
            : 'Not checked in this session.',
      state: stateFor('connect', connected, false),
      goTo: 'connect',
      required: true,
    },
    {
      id: 'provider',
      label: 'Connect a provider',
      detail: input.activeProvider
        ? `Using ${input.activeProvider}.`
        : 'No active provider yet.',
      // Mandatory — never 'skipped', unlike everything else in this list.
      state: input.activeProvider ? 'done' : 'todo',
      goTo: 'provider',
      required: true,
    },
    {
      id: 'workspace',
      label: 'Set the working directory',
      detail: input.agentCwdExplicit
        ? `The agent runs in ${input.agentCwd ?? 'a configured directory'}.`
        : input.agentCwd
          ? `Falling back to ${input.agentCwd}.`
          : 'Not set — the agent runs in your home directory.',
      state: stateFor('workspace', workspaceDone, false),
      goTo: 'workspace',
      required: true,
    },
    {
      id: 'chat',
      label: 'Complete one real chat',
      detail: chatProven
        ? 'A completion succeeded.'
        : 'No completion has succeeded yet.',
      state: stateFor('chat', chatProven, !input.activeProvider),
      goTo: 'chat',
      required: true,
    },
    {
      id: 'profile',
      label: 'Choose an agent profile',
      detail:
        servabilityDetail ??
        (profileTouched ? 'Chosen.' : 'Optional — the default profile works.'),
      state: servability
        ? stateFor('profile', false, optionalBlocked)
        : stateFor('profile', profileTouched, optionalBlocked),
      goTo: 'profile',
      required: false,
    },
    {
      id: 'memory',
      label: 'Set up memory',
      detail: memoryTouched
        ? 'Chosen.'
        : 'Optional — built-in MEMORY.md is the default.',
      state: stateFor('memory', memoryTouched, optionalBlocked),
      goTo: 'memory',
      required: false,
    },
    {
      id: 'plugins',
      label: 'Review core plugins',
      // Neither "In place" nor "Reviewed": this settles three different ways —
      // the wizard toggled something, every core plugin is already on, or the
      // Plugins screen put the catalogue in front of the user, who may well
      // have looked and left one off on purpose. All three mean the same thing
      // to a checklist, and only this phrasing claims no more than that.
      detail: pluginsTouched
        ? 'Nothing outstanding.'
        : 'Optional — some screens stay empty without them.',
      state: stateFor('plugins', pluginsTouched, optionalBlocked),
      goTo: 'plugins',
      required: false,
    },
    {
      id: 'theme',
      label: 'Pick a theme',
      detail: themeChosen ? 'Chosen.' : 'Optional.',
      state: stateFor('theme', themeChosen, optionalBlocked),
      goTo: 'theme',
      required: false,
    },
  ]
}

/**
 * How many items still want attention. `blocked` deliberately does not count:
 * an item the user is not yet allowed to do is not a task they are behind on,
 * and counting it produced a badge that could never reach zero.
 */
export function outstandingCount(items: Array<ChecklistItem>): number {
  return items.filter(
    (item) => item.state === 'todo' || item.state === 'skipped',
  ).length
}

/** Outstanding items among the four the docs call required. */
export function outstandingRequiredCount(items: Array<ChecklistItem>): number {
  return items.filter(
    (item) =>
      item.required && (item.state === 'todo' || item.state === 'blocked'),
  ).length
}
