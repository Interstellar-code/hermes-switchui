/**
 * onboarding-storage.ts — the localStorage contract for the onboarding wizard.
 *
 * Four keys, four jobs: `complete` is the legacy flag the rest of the app
 * already gates on (unchanged — renaming it would re-onboard every install
 * on upgrade), `draft` is the in-progress wizard state so a refresh mid-flow
 * resumes where the user left off, `outcome` is the terminal record left
 * behind once the wizard finishes (so a later relaunch can say what happened
 * without needing the draft to still exist), and `dismissed` is the same
 * for a relaunch the user closed without finishing.
 *
 * The one rule that matters more than the others: nothing secret ever
 * reaches `localStorage`. `OnboardingTransient` names every field that is
 * legitimate to hold in memory (an API key mid-entry, an OAuth device code)
 * but must never be serialized, and `sanitizeDraftForStorage` is the single
 * chokepoint every write path routes through to enforce that.
 */
import type { ThemeId } from '@/lib/theme'
import type { OnboardingBranch, OnboardingStepId } from './onboarding-steps'

export const ONBOARDING_KEYS = {
  complete: 'claude-onboarding-complete',
  dismissed: 'hermes-onboarding-dismissed',
  draft: 'hermes-onboarding-draft',
  outcome: 'hermes-onboarding-outcome',
} as const

export const ONBOARDING_COMPLETE_EVENT = 'claude:onboarding-complete'

/** Bump when `OnboardingDraft`'s shape changes. A mismatch discards, never migrates. */
export const ONBOARDING_DRAFT_VERSION = 2

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export type OnboardingDraft = {
  version: number
  branch: 'quick' | 'full'
  stepId: OnboardingStepId
  providerId: string | null
  baseUrl: string
  envKey: string
  defaultModel: string
  makeActive: boolean
  themeId: ThemeId | null
  skipped: Array<OnboardingStepId>
  completed: Array<OnboardingStepId>
  savedAt: number
}

/**
 * Fields that exist at runtime but must never reach storage. The live wizard
 * context carries these alongside an `OnboardingDraft` (see `OnboardingCtx`
 * in `onboarding-steps.ts`, typed `OnboardingDraft & OnboardingTransient`) —
 * an in-flight API key has to live somewhere while the user is typing it,
 * but it has no business surviving a page refresh in plaintext.
 */
export type OnboardingTransient = {
  apiKey?: string
  deviceCode?: string
  userCode?: string
  verificationUrl?: string
  models?: Array<string>
  verifyOutcome?: unknown
  systemChecks?: unknown
  gatewayUrlInput?: string
}

export type OnboardingOutcome =
  | { kind: 'fresh' }
  | { kind: 'in-progress'; stepId: OnboardingStepId; branch: OnboardingBranch }
  | { kind: 'dismissed'; at: number }
  | {
      kind: 'complete'
      at: number
      branch: OnboardingBranch
      skipped: Array<OnboardingStepId>
    }

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/**
 * The allowlist is deliberate, not a denylist: a field only reaches storage
 * if it is named below. `OnboardingTransient` fields are simply never read
 * here, so a field added to that type later cannot leak into localStorage
 * just because nobody remembered to add it to a blacklist — the failure mode
 * of forgetting is "missing from storage", never "leaked into storage".
 */
export function sanitizeDraftForStorage(
  draft: OnboardingDraft & OnboardingTransient,
): OnboardingDraft {
  return {
    version: draft.version,
    branch: draft.branch,
    stepId: draft.stepId,
    providerId: draft.providerId,
    baseUrl: draft.baseUrl,
    envKey: draft.envKey,
    defaultModel: draft.defaultModel,
    makeActive: draft.makeActive,
    themeId: draft.themeId,
    skipped: [...draft.skipped],
    completed: [...draft.completed],
    savedAt: draft.savedAt,
  }
}

function isDraftShape(value: unknown): value is OnboardingDraft {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    record.version === ONBOARDING_DRAFT_VERSION &&
    typeof record.stepId === 'string' &&
    (record.branch === 'quick' || record.branch === 'full') &&
    Array.isArray(record.skipped) &&
    Array.isArray(record.completed)
  )
}

/** `null` storage (SSR), corrupt JSON, and a version mismatch all read as "no draft" — never throws. */
export function readOnboardingDraft(
  storage: StorageLike | null,
): OnboardingDraft | null {
  if (!storage) return null
  const parsed = parseJson<unknown>(storage.getItem(ONBOARDING_KEYS.draft))
  if (!isDraftShape(parsed)) return null
  return sanitizeDraftForStorage(parsed)
}

export function writeOnboardingDraft(
  storage: StorageLike,
  draft: OnboardingDraft & OnboardingTransient,
): void {
  storage.setItem(
    ONBOARDING_KEYS.draft,
    JSON.stringify(sanitizeDraftForStorage(draft)),
  )
}

export function clearOnboardingDraft(storage: StorageLike): void {
  storage.removeItem(ONBOARDING_KEYS.draft)
}

function isCompleteOutcomeShape(
  value: unknown,
): value is Extract<OnboardingOutcome, { kind: 'complete' }> {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    record.kind === 'complete' &&
    typeof record.at === 'number' &&
    typeof record.branch === 'string' &&
    Array.isArray(record.skipped)
  )
}

/**
 * Pure and total: every branch below returns a value, none throws. `null`
 * storage (SSR), a corrupt `outcome`/`draft` payload, and a stale draft
 * version all collapse to `fresh` rather than propagating an exception up
 * into a render path.
 */
export function readOnboardingOutcome(
  storage: StorageLike | null,
): OnboardingOutcome {
  if (!storage) return { kind: 'fresh' }

  const outcome = parseJson<unknown>(storage.getItem(ONBOARDING_KEYS.outcome))
  if (isCompleteOutcomeShape(outcome)) return outcome

  const dismissedRaw = storage.getItem(ONBOARDING_KEYS.dismissed)
  if (dismissedRaw) {
    const at = Number(dismissedRaw)
    return { kind: 'dismissed', at: Number.isFinite(at) ? at : Date.now() }
  }

  const draft = readOnboardingDraft(storage)
  if (draft) {
    return { kind: 'in-progress', stepId: draft.stepId, branch: draft.branch }
  }

  return { kind: 'fresh' }
}

export function writeOnboardingComplete(
  storage: StorageLike,
  input: { branch: OnboardingBranch; skipped: Array<OnboardingStepId> },
): void {
  const outcome: OnboardingOutcome = {
    kind: 'complete',
    at: Date.now(),
    branch: input.branch,
    skipped: [...input.skipped],
  }
  storage.setItem(ONBOARDING_KEYS.outcome, JSON.stringify(outcome))
  // The rest of the app (the onboarding gate in __root.tsx, and anything
  // else written before this wizard existed) still reads this key directly,
  // so it has to keep being written even though `outcome` above is now the
  // richer source of truth for this module.
  storage.setItem(ONBOARDING_KEYS.complete, 'true')
}

export function writeOnboardingDismissed(storage: StorageLike): void {
  storage.setItem(ONBOARDING_KEYS.dismissed, String(Date.now()))
}
