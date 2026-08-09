/**
 * onboarding-storage.ts — the localStorage contract for the onboarding wizard.
 *
 * Five keys, five jobs: `complete` is the legacy flag the rest of the app
 * already gates on (unchanged — renaming it would re-onboard every install
 * on upgrade), `draft` is the in-progress wizard state so a refresh mid-flow
 * resumes where the user left off, `outcome` is the terminal record left
 * behind once the wizard finishes (so a later relaunch can say what happened
 * without needing the draft to still exist), `dismissed` is the same
 * for a relaunch the user closed without finishing, and `autoDetected` records
 * that an *authenticated* connection probe found a working install so the gate
 * does not have to re-derive it (and re-flash the wizard) on every boot.
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
  autoDetected: 'hermes-onboarding-auto-detected',
} as const

export const ONBOARDING_COMPLETE_EVENT = 'claude:onboarding-complete'

/**
 * Bump when `OnboardingDraft`'s shape changes. A mismatch discards, never
 * migrates.
 *
 * 3 — the quick/full fork is gone (see `onboarding-steps.ts`), so `branch` is
 * now `'main'`. A version-2 draft names a branch that no longer exists and a
 * step id that may have been retired, so discarding it is the correct read:
 * the user resumes at the front of the new flow instead of at a step the
 * wizard would have to reconcile them off anyway.
 */
export const ONBOARDING_DRAFT_VERSION = 3

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export type OnboardingDraft = {
  version: number
  branch: 'main'
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
      /**
       * Steps the run actually carried to 'done'. Persisted alongside
       * `skipped` because the draft — the only other place this lived — is
       * deleted the moment the wizard finishes, which left every out-of-wizard
       * consumer (the sidebar badge, the command palette label) permanently
       * reporting a full house of outstanding items for a user who had in fact
       * completed everything. Read tolerantly: records written before this
       * field existed simply carry `[]`, so nobody is re-onboarded on upgrade.
       */
      completed: Array<OnboardingStepId>
    }

/**
 * Written only from an authenticated context (see `use-onboarding-gate.ts`):
 * the connection probe found a configured install, so the gate may settle
 * immediately on the next boot instead of painting the fullscreen wizard and
 * yanking it away once the probe resolves. Deliberately a *separate* key from
 * `complete`/`outcome`: it is a machine's observation, not a claim that a
 * human completed setup, and keeping it distinct keeps it auditable.
 */
export type OnboardingAutoDetected = { kind: 'auto-detected'; at: number }

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
    record.branch === 'main' &&
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

type StoredCompleteOutcome = Omit<
  Extract<OnboardingOutcome, { kind: 'complete' }>,
  'completed'
> & { completed?: Array<OnboardingStepId> }

/**
 * `completed` is checked only when present. A record written before that
 * field existed is still a valid completion — treating it as a shape mismatch
 * would collapse it to `fresh` and re-onboard the install on upgrade, which is
 * exactly the failure `ONBOARDING_DRAFT_VERSION` exists to avoid causing.
 */
function isCompleteOutcomeShape(
  value: unknown,
): value is StoredCompleteOutcome {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    record.kind === 'complete' &&
    typeof record.at === 'number' &&
    typeof record.branch === 'string' &&
    Array.isArray(record.skipped) &&
    (record.completed === undefined || Array.isArray(record.completed))
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
  if (isCompleteOutcomeShape(outcome)) {
    return { ...outcome, completed: outcome.completed ?? [] }
  }

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
  input: {
    branch: OnboardingBranch
    skipped: Array<OnboardingStepId>
    completed?: Array<OnboardingStepId>
  },
): void {
  const outcome: OnboardingOutcome = {
    kind: 'complete',
    at: Date.now(),
    branch: input.branch,
    skipped: [...input.skipped],
    completed: [...(input.completed ?? [])],
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

/**
 * Deliberately does NOT stamp `ONBOARDING_KEYS.complete`. That flag means "a
 * human finished setup" and is what the checklist, the dashboard card and the
 * relaunch summary reason about; an auto-detection is only ever a statement
 * about the gate. Keeping the two apart is what makes this record auditable.
 */
export function writeOnboardingAutoDetected(storage: StorageLike): void {
  const record: OnboardingAutoDetected = {
    kind: 'auto-detected',
    at: Date.now(),
  }
  storage.setItem(ONBOARDING_KEYS.autoDetected, JSON.stringify(record))
}

/** `null` storage, corrupt JSON and an unrecognised shape all read as `null`. */
export function readOnboardingAutoDetected(
  storage: StorageLike | null,
): OnboardingAutoDetected | null {
  if (!storage) return null
  const parsed = parseJson<unknown>(
    storage.getItem(ONBOARDING_KEYS.autoDetected),
  )
  if (parsed === null || typeof parsed !== 'object') return null
  const record = parsed as Record<string, unknown>
  if (record.kind !== 'auto-detected' || typeof record.at !== 'number') {
    return null
  }
  return { kind: 'auto-detected', at: record.at }
}
