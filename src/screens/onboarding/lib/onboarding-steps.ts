/**
 * onboarding-steps.ts — the wizard's step table, the one place branching is
 * allowed to live.
 *
 * ## What changed, and why
 *
 * This was twelve steps on two branches. It is now **four required steps plus
 * optional extras**, because the official quickstart states a canonical order
 * and one rule that the twelve-step flow broke:
 *
 *   > if Hermes cannot complete a normal chat, do not add more features yet.
 *
 * The old flow offered profiles, memory, kanban and projects before any
 * completion had ever succeeded, so a user could finish every step and still
 * not have a working agent. The four steps below are the canonical order:
 *
 *   1. `connect`   — is the gateway there, and which trust boundary is broken
 *   2. `provider`  — pick one, supply what it needs, and prove it with a real call
 *   3. `workspace` — where does the agent actually run (nothing else asks this)
 *   4. `chat`      — the gate. A real completion has to succeed here.
 *
 * Everything else — profiles, memory, plugins, theme — is reachable only from
 * `extras`, which is `enabled` only once the gate is settled.
 *
 * ## Branching
 *
 * `wizard-machine.ts` derives everything (rail, progress, next/prev) from a
 * flat `Array<WizardStepDef>` filtered by each step's `enabled(ctx)`. The
 * quick/full fork is gone: there is one path, and the only conditional steps
 * are the optional ones behind the gate. That is why `OnboardingBranch` has
 * shrunk to `'main' | 'summary'` rather than being deleted — the summary is
 * still a real landing surface for a relaunch deep link, and it is still the
 * one place that must show no forward rail at all.
 *
 * ## The retired ids at the bottom of the table
 *
 * `system-check`, `review` and `verify` no longer exist as steps. They are
 * still listed, permanently disabled, because `setup-wizard-store.ts` derives
 * its deep-link allowlist from `ONBOARDING_STEPS.map(s => s.id)` — a link
 * saved in a shortcut, a palette entry or a dashboard card must resolve to
 * *something* rather than silently dumping the user on the front door.
 * `onboarding-screen.tsx` maps each of them onto its replacement at mount.
 */
import { isGateSettled } from './chat-gate'
import type { WizardStepDef } from '@/components/wizard/types'
import type { OnboardingMode } from './onboarding-mode'
import type { OnboardingDraft, OnboardingTransient } from './onboarding-storage'
import type { ChatGateState } from './chat-gate'
import { getProviderInfo } from '@/lib/provider-catalog'

export type OnboardingStepId =
  | 'summary'
  | 'welcome'
  | 'connect'
  | 'provider'
  | 'workspace'
  | 'chat'
  | 'extras'
  | 'profile'
  | 'memory'
  | 'plugins'
  | 'theme'
  | 'finish'
  // Retired. Present only so existing deep links resolve — see the header.
  | 'system-check'
  | 'review'
  | 'verify'

/**
 * Deep links that used to name a step which no longer exists, and the step
 * that now does that job. Consumed by `onboarding-screen.tsx` at mount.
 */
export const RETIRED_STEP_ALIASES: Readonly<
  Record<'system-check' | 'review' | 'verify', OnboardingStepId>
> = {
  'system-check': 'connect',
  review: 'provider',
  verify: 'provider',
}

export function resolveStepAlias(id: OnboardingStepId): OnboardingStepId {
  return (RETIRED_STEP_ALIASES as Record<string, OnboardingStepId>)[id] ?? id
}

/** `'summary'` is the read-only landing; everything else runs the one path. */
export type OnboardingBranch = 'main' | 'summary'

export type OnboardingCtx = {
  branch: OnboardingBranch
  /** Why the wizard is open — see `onboarding-mode.ts`. */
  mode: OnboardingMode
  /**
   * Has the user changed anything in this run? Only ever false → true, which
   * matters: a step whose `enabled` keys off it can appear mid-flow but never
   * vanish under the user's cursor.
   */
  dirty: boolean
  /**
   * The live draft, not the sanitized-for-storage shape: step validators
   * need `apiKey` (an `OnboardingTransient` field) to check whether the user
   * has typed one, which `OnboardingDraft` alone cannot answer since that
   * type is deliberately the persisted subset (see onboarding-storage.ts).
   */
  draft: OnboardingDraft & OnboardingTransient
  /** The provider config has been written in this run. */
  saved: boolean
  /** `verifyProviderAfterSave` confirmed resolution AND a live completion. */
  providerVerified: boolean
  hasStoredKey: boolean
  catalogBaseUrl: string | null
  /** The gate. Nothing optional is offered until this is settled. */
  chat: ChatGateState
  /**
   * Whether this run is permitted to write config at all — the `canWriteConfig`
   * verdict for the provider step, which is where the write now happens. A
   * locked relaunch has this false, and a step the user is *not permitted* to
   * complete must not be allowed to block them: see `validateProviderStep`.
   */
  canWrite: boolean
  /** The workspace already has a provider in config.yaml. */
  hasActiveProvider: boolean
}

const notSummary = (ctx: OnboardingCtx) => ctx.branch !== 'summary'

/**
 * Is the flow allowed to offer optional work yet?
 *
 * The gate proper is `isGateSettled` — a real completion succeeded, or the
 * user accepted the skip warning. A relaunch is added on top, and that is a
 * deliberate concession rather than a loophole: the relaunched wizard is a
 * settings surface reached from *inside* a running workspace, and making a
 * returning user re-prove a completion before they may toggle a plugin is the
 * exact regression the "usable settings surface" change fixed. First run and
 * resume — the two modes where the rule actually protects someone — are gated.
 */
export function extrasUnlocked(ctx: OnboardingCtx): boolean {
  return ctx.mode === 'relaunch' || isGateSettled(ctx.chat)
}

/**
 * A base URL is a hard requirement only when the catalog has no default for
 * this provider *and* the auth mechanism actually talks to a URL the user
 * controls. OAuth and CLI-token providers authenticate through a flow with a
 * fixed endpoint baked into the gateway, so there is nothing to type.
 */
function providerNeedsManualBaseUrl(providerId: string): boolean {
  const info = getProviderInfo(providerId)
  if (!info) return false
  return info.authTypes.includes('api-key') || info.authTypes.includes('local')
}

/**
 * The provider step absorbed what used to be three steps (choose, connect,
 * review) plus the verify step, so its validator carries all four rules.
 *
 * It never blocks a relaunch that is only looking: `canWrite` false means the
 * Save control is disabled, so requiring `saved` would strand the user with no
 * Skip and no way forward — the dead end `validateReviewStep` existed to
 * prevent. It also never blocks an install that already has a working provider
 * and has not been touched, which is the whole relaunch case.
 */
export function validateProviderStep(ctx: OnboardingCtx): Array<string> {
  const providerId = ctx.draft.providerId
  if (!providerId) {
    // Nothing chosen, but something is already configured and nothing has been
    // edited: there is nothing to validate, the user is passing through.
    if (ctx.hasActiveProvider && !ctx.dirty) return []
    return ['Choose a provider to continue']
  }

  const errors: Array<string> = []
  const info = getProviderInfo(providerId)

  if (
    ctx.catalogBaseUrl === null &&
    providerNeedsManualBaseUrl(providerId) &&
    !ctx.draft.baseUrl.trim()
  ) {
    errors.push('Enter the base URL for this provider before continuing.')
  }

  if (
    info?.authTypes.includes('api-key') &&
    !ctx.hasStoredKey &&
    !ctx.draft.apiKey?.trim()
  ) {
    errors.push('Enter an API key to continue — this provider requires one.')
  }

  if (errors.length > 0) return errors
  if (!ctx.canWrite) return []
  if (ctx.dirty && !ctx.saved) {
    return ['Press “Save and verify” to write this provider and test it.']
  }
  return []
}

/**
 * The gate. `chat-gate.ts` owns the wording; this only decides whether Next
 * moves. Note it is NOT `optional` — a Skip button in the footer would be an
 * unlabelled bypass of the one rule the docs are explicit about. The escape
 * hatch lives on the step body, behind a warning that names what breaks.
 */
export function validateChatStep(ctx: OnboardingCtx): Array<string> {
  if (isGateSettled(ctx.chat)) return []
  if (ctx.chat.kind === 'sending') {
    return ['Waiting for the provider to answer…']
  }
  if (ctx.chat.kind === 'failed') {
    return [
      `The agent could not answer: ${ctx.chat.error}. Fix it, or choose “Continue anyway”.`,
    ]
  }
  return [
    'Send one real message first — everything after this step depends on a completion succeeding.',
  ]
}

export const ONBOARDING_STEPS: ReadonlyArray<
  WizardStepDef<OnboardingStepId, OnboardingCtx>
> = [
  {
    id: 'summary',
    label: 'Summary',
    title: 'Your setup',
    blurb: 'A quick look at what is configured, and what still needs you.',
    enabled: (ctx) => ctx.branch === 'summary',
    chromeless: true,
  },
  {
    id: 'welcome',
    label: 'Welcome',
    title: 'Welcome to Hermes Switch UI',
    blurb: 'Four steps to a working agent. Everything else can wait.',
    // Relaunch skips it: a returning user does not need to be welcomed to a
    // workspace they are already standing in.
    enabled: (ctx) => notSummary(ctx) && ctx.mode !== 'relaunch',
    chromeless: true,
  },
  {
    id: 'connect',
    label: 'Connect',
    title: 'Connect to the gateway',
    blurb:
      'Three hops have to work: this browser to Switch UI, Switch UI to the gateway, the gateway to your provider.',
    enabled: notSummary,
    // Never blocks. A user whose gateway is down still has to be able to reach
    // the provider step to fix the URL, and the chat gate is the real check.
    optional: true,
  },
  {
    id: 'provider',
    label: 'Provider',
    title: 'Choose a provider and prove it',
    blurb:
      'Pick who serves your models, supply what it needs, then verify with one real call.',
    enabled: notSummary,
    validate: validateProviderStep,
  },
  {
    id: 'workspace',
    label: 'Workspace',
    title: 'Where the agent works',
    blurb:
      'The directory shell commands and file edits run in. Nothing else in Hermes asks this, and the default is your home folder.',
    enabled: notSummary,
    // Skippable: $HOME is a legitimate answer and we must not pretend
    // otherwise. What we must not do is fail to ask.
    optional: true,
  },
  {
    id: 'chat',
    label: 'First chat',
    title: 'Send the first message',
    blurb:
      'The one check that matters. If a normal chat cannot complete, nothing built on top of it will either.',
    enabled: notSummary,
    validate: validateChatStep,
  },
  {
    id: 'extras',
    label: 'Extras',
    title: 'Optional from here',
    blurb:
      'None of this is needed to use the workspace. Each card says why it might be worth it.',
    enabled: (ctx) => notSummary(ctx) && extrasUnlocked(ctx),
    optional: true,
  },
  {
    id: 'profile',
    label: 'Profiles',
    title: 'Agent profiles',
    blurb:
      'A separate agent identity, with its own config, memory and sessions.',
    enabled: (ctx) => notSummary(ctx) && extrasUnlocked(ctx),
    optional: true,
  },
  {
    id: 'memory',
    label: 'Memory',
    title: 'Set up memory',
    blurb: 'Choose where the agent keeps what it remembers.',
    enabled: (ctx) => notSummary(ctx) && extrasUnlocked(ctx),
    optional: true,
  },
  {
    id: 'plugins',
    label: 'Plugins',
    title: 'Core plugins',
    blurb: 'Interstellar plugins, plus the upstream ones that unlock a screen.',
    enabled: (ctx) => notSummary(ctx) && extrasUnlocked(ctx),
    optional: true,
  },
  {
    id: 'theme',
    label: 'Theme',
    title: 'Pick a theme',
    blurb: 'Ten themes, five palettes each in dark and light.',
    enabled: (ctx) => notSummary(ctx) && extrasUnlocked(ctx),
    optional: true,
  },
  {
    id: 'finish',
    label: 'Finish',
    title: 'Setup complete',
    blurb: 'Hermes Switch UI is ready to use.',
    enabled: notSummary,
    chromeless: true,
  },

  // ── retired ids, kept resolvable ──────────────────────────────────────────
  // Never enabled, never rendered, never on the rail. They exist so a saved
  // deep link naming one of them is still a known step id to
  // `setup-wizard-store.ts`, which `onboarding-screen.tsx` then maps onto the
  // replacement via `resolveStepAlias`.
  {
    id: 'system-check',
    label: 'System',
    enabled: () => false,
    chromeless: true,
  },
  { id: 'review', label: 'Review', enabled: () => false, chromeless: true },
  { id: 'verify', label: 'Verify', enabled: () => false, chromeless: true },
]
