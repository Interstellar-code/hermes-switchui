/**
 * checklist.ts — the "what's left" list the summary step renders on a
 * relaunch. Deliberately separate from `OnboardingDraft.skipped`: the draft
 * is cleared once the wizard finishes (`clearOnboardingDraft`), but the
 * checklist has to keep working after that, so it falls back to the `skipped`
 * *and* `completed` lists carried on a `'complete'` `OnboardingOutcome` once
 * the draft is gone.
 *
 * `verified` / `pluginsTouched` are live signals that only exist while a
 * wizard session is mounted. Outside one they arrive as `false`, so the
 * completion record has to be able to answer for them — otherwise a user who
 * finished the full branch keeps a permanent "4 left" badge with no way to
 * clear it. Hence: an item is done if the live probe says so **or** the
 * persisted run recorded that step as completed.
 */
import type { OnboardingStepId } from './onboarding-steps'
import type { OnboardingDraft, OnboardingOutcome } from './onboarding-storage'

export type ChecklistItemId =
  | 'provider'
  | 'verify'
  | 'plugins'
  | 'theme'
  | 'system-check'

export type ChecklistItemState = 'done' | 'skipped' | 'todo' | 'blocked'

export type ChecklistItem = {
  id: ChecklistItemId
  label: string
  detail: string
  state: ChecklistItemState
  goTo: OnboardingStepId
}

export function buildChecklist(input: {
  outcome: OnboardingOutcome
  draft: OnboardingDraft | null
  activeProvider: string | null
  verified: boolean
  pluginsTouched: boolean
}): Array<ChecklistItem> {
  const completeOutcome =
    input.outcome.kind === 'complete' ? input.outcome : null
  const skippedSource = input.draft?.skipped ?? completeOutcome?.skipped ?? []
  const skipped = new Set<OnboardingStepId>(skippedSource)
  const completedSource =
    input.draft?.completed ?? completeOutcome?.completed ?? []
  const completed = new Set<OnboardingStepId>(completedSource)

  // A finished run is the persisted stand-in for the live probes the wizard
  // has and nobody else does.
  const verified = input.verified || completed.has('verify')
  const pluginsTouched = input.pluginsTouched || completed.has('plugins')

  function stateFor(
    id: ChecklistItemId,
    done: boolean,
    blocked: boolean,
  ): ChecklistItemState {
    if (done) return 'done'
    if (blocked) return 'blocked'
    if (skipped.has(id)) return 'skipped'
    return 'todo'
  }

  return [
    {
      id: 'provider',
      label: 'Connect a provider',
      detail: input.activeProvider
        ? `Using ${input.activeProvider}.`
        : 'No active provider yet.',
      // Mandatory — never 'skipped', unlike everything else in this list.
      state: input.activeProvider ? 'done' : 'todo',
      goTo: 'provider',
    },
    {
      id: 'verify',
      label: 'Verify the connection',
      detail: verified ? 'Verified.' : 'Not verified yet.',
      state: stateFor('verify', verified, !input.activeProvider),
      goTo: 'verify',
    },
    {
      id: 'plugins',
      label: 'Review core plugins',
      detail: pluginsTouched ? 'Reviewed.' : 'Not reviewed yet.',
      state: stateFor('plugins', pluginsTouched, false),
      goTo: 'plugins',
    },
    {
      id: 'theme',
      label: 'Pick a theme',
      detail: completed.has('theme') ? 'Chosen.' : 'Not chosen yet.',
      state: stateFor('theme', completed.has('theme'), false),
      goTo: 'theme',
    },
    {
      id: 'system-check',
      label: 'Run the system check',
      detail: completed.has('system-check') ? 'Checked.' : 'Not checked yet.',
      state: stateFor('system-check', completed.has('system-check'), false),
      goTo: 'system-check',
    },
  ]
}

export function outstandingCount(items: Array<ChecklistItem>): number {
  return items.filter(
    (item) => item.state === 'todo' || item.state === 'skipped',
  ).length
}
