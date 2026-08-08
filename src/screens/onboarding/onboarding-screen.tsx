'use client'

/**
 * onboarding-screen.tsx — the composition root of the onboarding flow.
 *
 * Everything it renders is built elsewhere: the chrome and state machine come
 * from `@/components/wizard`, the step table and every rule about branching,
 * storage, entry point and the relaunch lock come from `./lib`, the bodies
 * from `./steps`, and the only write path from `./hooks/use-onboarding-save`.
 * This file owns exactly three things — the draft, the branch, and the wiring
 * between them.
 *
 * Two modes, distinguished the same way the component it replaces did it:
 *   `open === undefined` → first run. Uncontrolled, self-gates on the legacy
 *     completion flag, not dismissible with Escape (there is nothing behind it
 *     to go back to).
 *   `open` defined → relaunch. Controlled by the caller, opens on the
 *     read-only summary, and writes nothing until the user unlocks it.
 *
 * Hook-order note, because it is load-bearing: `useOnboardingSave` is called
 * *after* `useWizard` so it receives the live `currentId` with no one-render
 * lag — `stepId` is an input to the write lock and a stale one would be a
 * security bug. `ctx.saved` therefore cannot come from that hook (it would be
 * a render behind), so this component owns `saved` and sets it from what
 * `save()` returns.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useCorePlugins } from './hooks/use-core-plugins'
import { useOnboardingSave } from './hooks/use-onboarding-save'
import { useSystemChecks } from './hooks/use-system-checks'
import { buildChecklist } from './lib/checklist'
import { resolveEntryStep } from './lib/onboarding-mode'
import { ONBOARDING_STEPS } from './lib/onboarding-steps'
import {
  ONBOARDING_DRAFT_VERSION,
  ONBOARDING_KEYS,
  clearOnboardingDraft,
  readOnboardingDraft,
  readOnboardingOutcome,
  writeOnboardingComplete,
  writeOnboardingDraft,
} from './lib/onboarding-storage'
import { buildOnboardingProviderChoices } from './lib/provider-choices'
import { canWriteConfig } from './lib/relaunch-lock'
import { useOnboardingGate } from './lib/use-onboarding-gate'
import { ConnectStep } from './steps/connect-step'
import { FinishStep } from './steps/finish-step'
import { PluginsStep } from './steps/plugins-step'
import { ProviderStep } from './steps/provider-step'
import { ReviewStep } from './steps/review-step'
import { SummaryStep } from './steps/summary-step'
import { SystemCheckStep } from './steps/system-check-step'
import { ThemeStep } from './steps/theme-step'
import { VerifyStep } from './steps/verify-step'
import { WelcomeStep } from './steps/welcome-step'
import type { OnboardingMode } from './lib/onboarding-mode'
import type {
  OnboardingBranch,
  OnboardingCtx,
  OnboardingStepId,
} from './lib/onboarding-steps'
import type {
  OnboardingDraft,
  OnboardingTransient,
  StorageLike,
} from './lib/onboarding-storage'
import type { WizardState } from '@/components/wizard'
import type { ThemeId } from '@/lib/theme'
import {
  WizardFooter,
  WizardNote,
  WizardShell,
  WizardStepper,
  useWizard,
} from '@/components/wizard'
import { MatrixRainCanvas } from '@/components/terminal/matrix-rain-canvas'
import { normalizeProviderId } from '@/lib/provider-catalog'
import { getTheme } from '@/lib/theme'
// Imported here and nowhere else, matching `providers-screen.tsx`: a screen
// stylesheet pulled in from a leaf component ends up in a shared chunk and
// ships to every route.
import '@/styles/matrix-onboarding.css'

const CONFIG_QUERY_KEY = ['onboarding', 'claude-config'] as const

/** Steps that only exist on the `full` branch. */
const FULL_ONLY: ReadonlySet<OnboardingStepId> = new Set([
  'system-check',
  'plugins',
  'theme',
])

type ConfigProviderRow = {
  id?: string
  configured?: boolean
  maskedKeys?: Record<string, string>
}

type ClaudeConfigPayload = {
  providers?: Array<ConfigProviderRow>
  activeProvider?: string
  activeModel?: string
}

/** Never throws: TanStack Start renders this tree on the server too. */
function safeStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function readCompleteFlag(): boolean {
  const storage = safeStorage()
  if (!storage) return false
  try {
    return storage.getItem(ONBOARDING_KEYS.complete) === 'true'
  } catch {
    return false
  }
}

function emptyDraft(): OnboardingDraft & OnboardingTransient {
  return {
    version: ONBOARDING_DRAFT_VERSION,
    branch: 'quick',
    stepId: 'welcome',
    providerId: null,
    baseUrl: '',
    envKey: '',
    defaultModel: '',
    makeActive: true,
    themeId: null,
    skipped: [],
    completed: [],
    savedAt: Date.now(),
  }
}

async function fetchClaudeConfig(): Promise<ClaudeConfigPayload | null> {
  try {
    const res = await fetch('/api/claude-config')
    if (!res.ok) return null
    return (await res.json()) as ClaudeConfigPayload
  } catch {
    return null
  }
}

function idsWithStatus(
  state: WizardState<OnboardingStepId>,
  status: 'skipped' | 'done',
): Array<OnboardingStepId> {
  return (Object.keys(state.status) as Array<OnboardingStepId>).filter(
    (id) => state.status[id] === status,
  )
}

function union(
  left: Array<OnboardingStepId>,
  right: Array<OnboardingStepId>,
): Array<OnboardingStepId> {
  return [...new Set([...left, ...right])]
}

export type OnboardingScreenProps = {
  /** Omit for first run; pass (even `false`) to put the wizard in relaunch mode. */
  open?: boolean
  /** Fired when the wizard finishes or is closed. */
  onClose?: () => void
  /** Deep link from the setup-wizard store. Ignored while the flow is locked. */
  initialStepId?: OnboardingStepId
}

export function OnboardingScreen(props: OnboardingScreenProps) {
  // First run self-gates on the legacy flag, exactly like the component this
  // replaces: `__root.tsx` mounts it before it knows whether setup happened.
  // Read once, during the first render, so an already-onboarded install never
  // flashes the wizard.
  const [selfGated] = useState(
    () => props.open === undefined && readCompleteFlag(),
  )

  if (props.open === false || selfGated) return null
  return <OnboardingFlow {...props} />
}

function OnboardingFlow({
  open,
  onClose,
  initialStepId,
}: OnboardingScreenProps) {
  const relaunch = open !== undefined

  // Storage is read once, at mount. Re-reading mid-flow would let a sibling
  // tab move the step under the user's cursor.
  const [outcome] = useState(() => readOnboardingOutcome(safeStorage()))
  const [storedDraft] = useState(() => readOnboardingDraft(safeStorage()))
  const [initialTheme] = useState<ThemeId>(() => getTheme())

  const mode: OnboardingMode = relaunch
    ? 'relaunch'
    : outcome.kind === 'in-progress'
      ? 'resume'
      : 'first-run'

  // `hasWorkingProvider` is false here because the config read has not landed
  // yet; the effect below upgrades a fresh first run to the summary once it
  // has, and only while the user has not touched anything.
  const [entry] = useState(() =>
    resolveEntryStep({ mode, outcome, hasWorkingProvider: false }),
  )

  const [branch, setBranch] = useState<OnboardingBranch>(entry.branch)
  const [draft, setDraft] = useState<OnboardingDraft & OnboardingTransient>(
    () => ({
      ...emptyDraft(),
      ...(mode === 'resume' && storedDraft ? storedDraft : {}),
    }),
  )
  const [unlocked, setUnlocked] = useState(false)
  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false)

  const locked = relaunch && !unlocked

  // A deep link may pick the entry step, but never past the lock: a relaunch
  // always opens on the read-only summary.
  const [initialId] = useState<OnboardingStepId>(() =>
    relaunch ? entry.stepId : (initialStepId ?? entry.stepId),
  )

  const { markComplete, markDismissed, markEngaged } = useOnboardingGate({
    probe: false,
  })

  const choices = useMemo(() => buildOnboardingProviderChoices(), [])
  const choice = useMemo(
    () =>
      choices.find((candidate) => candidate.id === draft.providerId) ?? null,
    [choices, draft.providerId],
  )

  const configQuery = useQuery({
    queryKey: CONFIG_QUERY_KEY,
    queryFn: fetchClaudeConfig,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  })
  const config = configQuery.data ?? null
  const activeProvider = config?.activeProvider || null
  const activeModel = config?.activeModel || null

  const hasStoredKey = useMemo(() => {
    const providerId = draft.providerId
    if (!providerId || !config?.providers) return false
    const target = normalizeProviderId(providerId)
    const row = config.providers.find(
      (entryRow) => normalizeProviderId(entryRow.id ?? '') === target,
    )
    if (!row) return false
    return (
      row.configured === true || Object.keys(row.maskedKeys ?? {}).length > 0
    )
  }, [config, draft.providerId])

  const system = useSystemChecks({ enabled: true })
  const plugins = useCorePlugins({ enabled: branch === 'full' })

  const handleFinish = useCallback(
    (state: WizardState<OnboardingStepId>) => {
      const storage = safeStorage()
      if (mode !== 'relaunch') {
        // Order matters. `markComplete` stamps the legacy flag and fires the
        // event `__root.tsx` listens on; the richer record (which branch ran,
        // what was skipped) is written *after* so it is the copy that
        // survives — `markComplete` can only write `quick` / `[]`.
        markComplete()
        if (storage) {
          writeOnboardingComplete(storage, {
            branch,
            skipped: idsWithStatus(state, 'skipped'),
          })
          clearOnboardingDraft(storage)
        }
      }
      onClose?.()
    },
    [branch, markComplete, mode, onClose],
  )

  const ctx: OnboardingCtx = {
    branch,
    draft,
    saved,
    hasStoredKey,
    catalogBaseUrl: choice?.baseUrl ?? null,
  }

  const wz = useWizard<OnboardingStepId, OnboardingCtx>({
    steps: ONBOARDING_STEPS,
    ctx,
    initialId,
    onFinish: handleFinish,
  })

  // Called after `useWizard` on purpose — see the header note. `stepId` is a
  // write-lock input and must be the step the user is actually on.
  const saveApi = useOnboardingSave({
    mode,
    unlocked,
    stepId: wz.state.currentId,
  })

  // ── navigation that has to wait for a branch flip ──────────────────────────
  // `useWizard` resolves NEXT/GOTO against the ctx of the render the click
  // happened in, so a handler that changes the branch *and* moves must let the
  // branch land first — otherwise picking "Full setup" walks straight past the
  // system-check step that choice just enabled.
  type PendingNav = { kind: 'next' } | { kind: 'enter'; id: OnboardingStepId }
  const [pendingNav, setPendingNav] = useState<PendingNav | null>(null)

  useEffect(() => {
    if (!pendingNav) return
    setPendingNav(null)
    if (pendingNav.kind === 'next') wz.next()
    else wz.reset(pendingNav.id)
  }, [pendingNav, wz.next, wz.reset])

  const touch = useCallback(() => {
    setDirty(true)
    markEngaged()
  }, [markEngaged])

  const patchDraft = useCallback(
    (patch: Partial<OnboardingDraft & OnboardingTransient>) => {
      touch()
      setDraft((prev) => ({ ...prev, ...patch }))
      if ('providerId' in patch) {
        // A different provider means the previous save no longer describes
        // what is on screen.
        setSaved(false)
        saveApi.reset()
      }
    },
    [saveApi, touch],
  )

  const chooseBranch = useCallback(
    (next: 'quick' | 'full') => {
      touch()
      setBranch(next)
      setDraft((prev) => ({ ...prev, branch: next }))
      setPendingNav({ kind: 'next' })
    },
    [touch],
  )

  const jumpTo = useCallback(
    (id: OnboardingStepId) => {
      touch()
      if (branch === 'summary') {
        setBranch(FULL_ONLY.has(id) ? 'full' : 'quick')
      } else if (FULL_ONLY.has(id) && branch !== 'full') {
        setBranch('full')
      }
      // `reset` rather than `goto`: a jump from a landing page targets steps
      // the reachability rule (visited, or immediately next) would refuse.
      setPendingNav({ kind: 'enter', id })
    },
    [branch, touch],
  )

  const unlock = useCallback(() => {
    touch()
    setUnlocked(true)
    // Leaving the summary branch is what actually opens the editable flow;
    // this call unlocks and navigates, and writes nothing by itself.
    setBranch('quick')
  }, [touch])

  const dismiss = useCallback(() => {
    markDismissed()
    onClose?.()
  }, [markDismissed, onClose])

  const handleSave = useCallback(() => {
    if (!choice) return
    void saveApi.save({ choice, draft }).then((ok) => {
      if (ok) setSaved(true)
    })
  }, [choice, draft, saveApi])

  // ── save-and-resume ───────────────────────────────────────────────────────
  const draftRef = useRef(draft)
  draftRef.current = draft
  const firstSyncRef = useRef(true)

  // Step/status changes are persisted immediately: they are the coarse
  // "where was I" signal a resume needs, and they are rare.
  useEffect(() => {
    if (firstSyncRef.current) {
      firstSyncRef.current = false
      return
    }
    const next: OnboardingDraft & OnboardingTransient = {
      ...draftRef.current,
      stepId: wz.state.currentId,
      branch: branch === 'summary' ? draftRef.current.branch : branch,
      skipped: union(
        draftRef.current.skipped,
        idsWithStatus(wz.state, 'skipped'),
      ),
      completed: union(
        draftRef.current.completed,
        idsWithStatus(wz.state, 'done'),
      ),
      savedAt: Date.now(),
    }
    setDraft(next)
    // A relaunch never persists: it is a read of an existing setup, and a
    // dropped draft would make the next boot resume into someone else's flow.
    if (mode === 'relaunch') return
    const storage = safeStorage()
    if (storage) writeOnboardingDraft(storage, next)
  }, [branch, mode, wz.state])

  // Field edits are debounced — this fires on every keystroke in the API key
  // field, and `writeOnboardingDraft` sanitises rather than stores it.
  useEffect(() => {
    if (mode === 'relaunch' || !dirty) return undefined
    const storage = safeStorage()
    if (!storage) return undefined
    const timer = setTimeout(() => writeOnboardingDraft(storage, draft), 400)
    return () => clearTimeout(timer)
  }, [dirty, draft, mode])

  // A first run that turns out to already have a working provider lands on the
  // summary instead of the fork — but only while the user has not touched
  // anything, so a late config read can never yank the flow (the same rule
  // `onboarding-gate.ts` applies to the connection probe).
  useEffect(() => {
    if (mode !== 'first-run' || dirty) return
    if (branch === 'summary' || wz.state.currentId !== 'welcome') return
    if (!activeProvider) return
    setBranch('summary')
  }, [activeProvider, branch, dirty, mode, wz.state.currentId])

  const checklistItems = useMemo(
    () =>
      buildChecklist({
        outcome,
        draft,
        activeProvider,
        verified: saveApi.verifyOutcome?.status === 'confirmed',
        pluginsTouched: plugins.touched,
      }),
    [activeProvider, draft, outcome, plugins.touched, saveApi.verifyOutcome],
  )

  // QUICK never renders the system-check step, but a failing check is still
  // the most likely reason "connect" is about to go wrong, so it rides along
  // as a warning on that step instead.
  const systemCheckWarning = useMemo(() => {
    if (branch !== 'quick') return null
    return (
      system.checks.find((check) => check.status === 'fail')?.detail ?? null
    )
  }, [branch, system.checks])

  const step = wz.step
  if (!step) return null

  const chromeless = step.chromeless === true
  const isWelcome = step.id === 'welcome'

  const renderBody = () => {
    switch (step.id) {
      case 'summary':
        return (
          <SummaryStep
            activeProvider={activeProvider}
            activeModel={activeModel}
            checks={system.checks}
            items={checklistItems}
            onJump={jumpTo}
            onUnlock={unlock}
            onClose={() => onClose?.()}
            locked={locked}
          />
        )

      case 'welcome':
        return (
          <WelcomeStep
            onChooseBranch={chooseBranch}
            onDismiss={dismiss}
            showDismiss={!relaunch}
          />
        )

      case 'system-check':
        return (
          <SystemCheckStep
            checks={system.checks}
            loading={system.loading}
            onHeal={(action, payload) => void system.heal(action, payload)}
            healing={system.healing}
          />
        )

      case 'provider':
        return (
          <ProviderStep
            choices={choices}
            draft={draft}
            onChange={patchDraft}
            errors={wz.errors}
            detecting={false}
          />
        )

      case 'connect':
        return (
          <ConnectStep
            choice={choice}
            draft={draft}
            onChange={patchDraft}
            errors={wz.errors}
            hasStoredKey={hasStoredKey}
            systemCheckWarning={systemCheckWarning}
          />
        )

      case 'review':
        return choice ? (
          <ReviewStep
            choice={choice}
            draft={draft}
            canWrite={canWriteConfig({ mode, unlocked, stepId: 'review' })}
            saving={saveApi.saving}
            saveError={saveApi.saveError}
            saved={saved}
            onSave={handleSave}
          />
        ) : (
          <WizardNote tone="warn">
            Choose a provider before reviewing what will be written.
          </WizardNote>
        )

      case 'verify':
        return (
          <VerifyStep
            providerId={draft.providerId ?? ''}
            outcome={saveApi.verifyOutcome}
            verifying={saveApi.verifying}
            onVerify={() => {
              if (draft.providerId) void saveApi.verify(draft.providerId)
            }}
            canRestart={saveApi.canRestart}
            restarting={saveApi.restarting}
            onRestart={() => void saveApi.restart()}
            liveOutcome={saveApi.liveOutcome}
            liveTesting={saveApi.liveTesting}
            onLiveTest={() => void saveApi.liveTest()}
          />
        )

      case 'plugins':
        return (
          <PluginsStep
            rows={plugins.rows}
            loading={plugins.loading}
            error={plugins.error}
            onToggle={(name, next) => void plugins.toggle(name, next)}
            busyName={plugins.busyName}
            canRestart={plugins.canRestart}
            restarting={plugins.restarting}
            onRestart={() => void plugins.restart()}
          />
        )

      case 'theme':
        return (
          <ThemeStep
            selected={draft.themeId ?? initialTheme}
            onSelect={(id) => patchDraft({ themeId: id })}
          />
        )

      case 'finish':
        return (
          <FinishStep
            items={checklistItems}
            onJump={jumpTo}
            onOpenWorkspace={wz.finish}
            needsRestart={
              saved && saveApi.verifyOutcome?.status !== 'confirmed'
            }
          />
        )
    }
  }

  return (
    <WizardShell
      screen="onboarding"
      variant={relaunch ? 'modal' : 'fullscreen'}
      title={step.title ?? step.label}
      subtitle={step.blurb}
      headActions={
        relaunch ? (
          <button
            type="button"
            className="wz-btn"
            aria-label="Close setup wizard"
            onClick={() => onClose?.()}
          >
            Close
          </button>
        ) : undefined
      }
      stepper={
        chromeless ? undefined : (
          <WizardStepper
            steps={wz.rail}
            currentId={wz.state.currentId}
            statusOf={wz.statusOf}
            isReachable={wz.isReachable}
            onSelect={wz.goto}
            progressLabel={wz.progressLabel}
          />
        )
      }
      backdrop={
        isWelcome ? (
          <>
            <MatrixRainCanvas className="ob-rain" />
            <span className="ob-scan" />
          </>
        ) : undefined
      }
      scanline
      // First run is not dismissible: there is no workspace behind it yet.
      onDismiss={relaunch ? () => onClose?.() : undefined}
      footer={
        chromeless ? null : (
          <WizardFooter
            onBack={wz.canBack ? wz.back : undefined}
            onSkip={wz.canSkip ? wz.skip : undefined}
            onNext={wz.next}
            nextLabel={wz.isLast ? 'Finish' : 'Next'}
          />
        )
      }
    >
      {renderBody()}
    </WizardShell>
  )
}
