/**
 * onboarding-steps.ts — the wizard's step table, the one place branching is
 * allowed to live.
 *
 * `wizard-machine.ts` derives everything (rail, progress, next/prev) from a
 * flat `Array<WizardStepDef>` filtered by each step's `enabled(ctx)`. That
 * means a "quick" vs "full" wizard is not two step lists that can drift
 * apart — it is one list where `enabled` answers "does this ctx route
 * through here", so QUICK_STEPS/FULL_STEPS constants would be redundant and,
 * worse, a second place to update. `ONBOARDING_STEPS` below is that one list.
 */
import type { WizardStepDef } from '@/components/wizard/types'
import type { OnboardingDraft, OnboardingTransient } from './onboarding-storage'
import { getProviderInfo } from '@/lib/provider-catalog'

export type OnboardingStepId =
  | 'summary'
  | 'welcome'
  | 'system-check'
  | 'provider'
  | 'connect'
  | 'review'
  | 'verify'
  | 'profile'
  | 'plugins'
  | 'theme'
  | 'finish'

export type OnboardingBranch = 'quick' | 'full' | 'summary'

export type OnboardingCtx = {
  branch: OnboardingBranch
  /**
   * The live draft, not the sanitized-for-storage shape: step validators
   * need `apiKey` (an `OnboardingTransient` field) to check whether the user
   * has typed one, which `OnboardingDraft` alone cannot answer since that
   * type is deliberately the persisted subset (see onboarding-storage.ts).
   */
  draft: OnboardingDraft & OnboardingTransient
  saved: boolean
  hasStoredKey: boolean
  catalogBaseUrl: string | null
  /**
   * Whether this run is permitted to write config at all — the `canWriteConfig`
   * verdict for the review step, which is the only step that writes. A locked
   * relaunch has this false, and a step the user is *not permitted* to complete
   * must not be allowed to block them: see `validateReviewStep`.
   */
  canWrite: boolean
}

const notSummary = (ctx: OnboardingCtx) => ctx.branch !== 'summary'

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

export function validateProviderStep(ctx: OnboardingCtx): Array<string> {
  return ctx.draft.providerId ? [] : ['Choose a provider to continue']
}

export function validateConnectStep(ctx: OnboardingCtx): Array<string> {
  const providerId = ctx.draft.providerId
  if (!providerId) return []

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

  return errors
}

/**
 * The review gate is conditional on being able to write. In a locked relaunch
 * Save is disabled and `save()` refuses, so `saved` can never become true —
 * requiring it there left the user staring at "Press Save to write the
 * configuration" with Next permanently blocked, no Skip offered, and only Back
 * or Close as a way out. A step nobody is permitted to complete must never be
 * a dead end.
 */
export function validateReviewStep(ctx: OnboardingCtx): Array<string> {
  if (!ctx.canWrite) return []
  return ctx.saved ? [] : ['Press Save to write the configuration']
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
    blurb: 'A couple of minutes to connect a provider and pick a theme.',
    enabled: notSummary,
    chromeless: true,
  },
  {
    id: 'system-check',
    label: 'System check',
    title: 'System check',
    blurb: 'Confirm the gateway, chat, and dashboard are all reachable.',
    enabled: (ctx) => ctx.branch === 'full',
    optional: true,
  },
  {
    id: 'provider',
    label: 'Provider',
    title: 'Choose a provider',
    blurb: 'Pick who serves your models.',
    enabled: notSummary,
    validate: validateProviderStep,
  },
  {
    id: 'connect',
    label: 'Connect',
    title: 'Connect',
    blurb: 'Supply whatever this provider needs — a key, a URL, or a sign-in.',
    enabled: notSummary,
    validate: validateConnectStep,
  },
  {
    id: 'review',
    label: 'Review',
    title: 'Review and save',
    blurb: 'Check the configuration before it is written to config.yaml.',
    enabled: notSummary,
    validate: validateReviewStep,
  },
  {
    id: 'verify',
    label: 'Verify',
    title: 'Verify the connection',
    blurb: 'Confirm the gateway can actually see the new provider.',
    enabled: notSummary,
    optional: true,
  },
  {
    id: 'profile',
    label: 'Agent profile',
    title: 'Choose an agent profile',
    blurb: 'Pick which agent identity the gateway runs.',
    enabled: (ctx) => ctx.branch === 'full',
    optional: true,
  },
  {
    id: 'plugins',
    label: 'Plugins',
    title: 'Core plugins',
    blurb: 'Interstellar plugins, plus the upstream ones that unlock a screen.',
    enabled: (ctx) => ctx.branch === 'full',
    optional: true,
  },
  {
    id: 'theme',
    label: 'Theme',
    title: 'Pick a theme',
    blurb: 'Ten themes, five palettes each in dark and light.',
    enabled: (ctx) => ctx.branch === 'full',
    optional: true,
  },
  {
    id: 'finish',
    label: 'Finish',
    // Matches `FinishStep`'s own visible heading — house voice is plain
    // sentence case, and the two must not disagree on the same screen.
    title: 'Setup complete',
    blurb: 'Hermes Switch UI is ready to use.',
    enabled: notSummary,
    chromeless: true,
  },
]
