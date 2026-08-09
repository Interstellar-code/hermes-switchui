'use client'

/**
 * onboarding-screen.tsx — the composition root of the onboarding flow.
 *
 * Everything it renders is built elsewhere: the chrome and state machine come
 * from `@/components/wizard`, the step table and every rule about ordering,
 * storage, entry point and the relaunch lock come from `./lib`, the bodies
 * from `./steps`, and the only config write path from
 * `./hooks/use-onboarding-save`. This file owns exactly three things — the
 * draft, the gate, and the wiring between them.
 *
 * ## The shape, after W6
 *
 * Four required steps and a set of optional cards, in the order the official
 * quickstart gives: connect → provider → workspace → first chat, and only then
 * anything else. The quick/full fork is gone. `chat` is the gate: `extras` and
 * every optional step is `enabled` only once `useFirstChat` reports the gate
 * settled (see `extrasUnlocked`).
 *
 * Two modes, distinguished the same way the component this replaces did it:
 *   `open === undefined` → first run. Uncontrolled, self-gates on the legacy
 *     completion flag, not dismissible with Escape (there is nothing behind it
 *     to go back to).
 *   `open` defined → relaunch. Controlled by the caller, opens on the first
 *     real step, and stays a usable settings surface.
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
import { useAgentCwd } from './hooks/use-agent-cwd'
import { useConnectStatus } from './hooks/use-connect-status'
import { useCorePlugins } from './hooks/use-core-plugins'
import { useFirstChat } from './hooks/use-first-chat'
import { useOnboardingMemory } from './hooks/use-onboarding-memory'
import { useOnboardingProfiles } from './hooks/use-onboarding-profiles'
import { useOnboardingSave } from './hooks/use-onboarding-save'
import { isGateProven, isGateSettled } from './lib/chat-gate'
import { buildChecklist } from './lib/checklist'
import { buildCurrentSetup, factsForStep } from './lib/current-setup'
import { buildExtras } from './lib/extras'
import {
  pendingGatewayTips,
  readGatewayOnboarding,
} from './lib/gateway-onboarding'
import { detectOllamaContext } from './lib/ollama-context'
import { resolveEntryStep } from './lib/onboarding-mode'
import { ONBOARDING_STEPS, resolveStepAlias } from './lib/onboarding-steps'
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
import { ChatStep } from './steps/chat-step'
import { ConnectStep } from './steps/connect-step'
import { ExtrasStep } from './steps/extras-step'
import { FinishStep } from './steps/finish-step'
import { MemoryStep } from './steps/memory-step'
import { PluginsStep } from './steps/plugins-step'
import { ProfileStep } from './steps/profile-step'
import { ProviderStep } from './steps/provider-step'
import { SummaryStep } from './steps/summary-step'
import { ThemeStep } from './steps/theme-step'
import { WelcomeStep } from './steps/welcome-step'
import { WorkspaceStep } from './steps/workspace-step'
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
const LOCAL_PROVIDERS_KEY = ['onboarding', 'local-providers'] as const

type ConfigProviderRow = {
  id?: string
  configured?: boolean
  maskedKeys?: Record<string, string>
}

type ClaudeConfigPayload = {
  providers?: Array<ConfigProviderRow>
  activeProvider?: string
  activeModel?: string
  /** The raw (secret-masked) `config.yaml`, which carries `onboarding:`. */
  config?: unknown
}

type LocalProvidersPayload = {
  providers?: Array<{ id?: string; online?: boolean }>
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
    branch: 'main',
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

async function fetchLocalProviders(): Promise<LocalProvidersPayload | null> {
  try {
    const res = await fetch('/api/local-providers')
    if (!res.ok) return null
    return (await res.json()) as LocalProvidersPayload
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
  /**
   * Deep link from the setup-wizard store — picks the *starting step*, in
   * relaunch mode too. It never implies `unlocked`: a deep link must not be a
   * way around the write lock, so the flow it opens is still read-only until
   * the user unlocks it.
   */
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

  // The summary is the only branch left, and only a deep link or an
  // already-configured first run reaches it.
  const [branch, setBranch] = useState<OnboardingBranch>(() =>
    initialStepId
      ? initialStepId === 'summary'
        ? 'summary'
        : 'main'
      : entry.branch,
  )
  const [draft, setDraft] = useState<OnboardingDraft & OnboardingTransient>(
    () => ({
      ...emptyDraft(),
      ...(mode === 'resume' && storedDraft ? storedDraft : {}),
    }),
  )
  // Relaunch opens unlocked. The lock machinery is untouched and still works
  // when this is false — only the default flipped, because it was buying
  // nothing and costing the user a working settings surface: every write in
  // this wizard already requires an explicit press on a labelled control, and
  // a click-through of Next writes nothing at any point.
  const [unlocked, setUnlocked] = useState(true)
  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false)

  const locked = relaunch && !unlocked

  // A deep link picks the entry step — including on a relaunch, which is the
  // only mode the sidebar/palette/dashboard links ever open. Retired ids are
  // mapped onto their replacements here so a saved link never dead-ends.
  const [initialId] = useState<OnboardingStepId>(() =>
    initialStepId ? resolveStepAlias(initialStepId) : entry.stepId,
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
  const rawConfig = config?.config ?? null

  const localProvidersQuery = useQuery({
    queryKey: LOCAL_PROVIDERS_KEY,
    queryFn: fetchLocalProviders,
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })

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

  // One decision, consulted by every mutation the wizard can perform — not
  // just the config PATCH. A locked relaunch tells the user their setup is
  // read-only, so enabling a plugin, writing terminal.cwd or restarting the
  // gateway from a step the checklist deep-links into has to be refused too.
  const canWrite = canWriteConfig({ mode, unlocked, stepId: 'provider' })

  const chat = useFirstChat()
  const gateSettled = isGateSettled(chat.state)
  const gateProven = isGateProven(chat.state)
  const extrasOpen = mode === 'relaunch' || gateSettled

  const connection = useConnectStatus({
    enabled: true,
    canWrite,
    activeProvider,
  })
  const agentCwd = useAgentCwd({ enabled: true, canWrite })
  // The three optional pickers only fetch once the gate has opened them —
  // nothing should be probing the plugin hub for a screen the user cannot
  // reach yet.
  const plugins = useCorePlugins({ enabled: extrasOpen, canWrite })
  const profiles = useOnboardingProfiles({ enabled: extrasOpen, canWrite })
  const memory = useOnboardingMemory({ enabled: extrasOpen, canWrite })

  // Refreshed during render so callbacks below read the live draft without
  // taking it as a dependency.
  const draftRef = useRef(draft)
  draftRef.current = draft

  const handleFinish = useCallback(
    (state: WizardState<OnboardingStepId>) => {
      const storage = safeStorage()
      if (mode !== 'relaunch') {
        // Order matters. `markComplete` stamps the legacy flag and fires the
        // event `__root.tsx` listens on; the richer record (what was skipped,
        // what was completed) is written *after* so it is the copy that
        // survives.
        markComplete()
        if (storage) {
          writeOnboardingComplete(storage, {
            branch: 'main',
            skipped: union(
              draftRef.current.skipped,
              idsWithStatus(state, 'skipped'),
            ),
            completed: union(
              draftRef.current.completed,
              idsWithStatus(state, 'done'),
            ),
          })
          clearOnboardingDraft(storage)
        }
      }
      onClose?.()
    },
    [markComplete, mode, onClose],
  )

  const ctx: OnboardingCtx = {
    branch,
    mode,
    dirty,
    draft,
    saved,
    providerVerified: false,
    hasStoredKey,
    catalogBaseUrl: choice?.baseUrl ?? null,
    chat: chat.state,
    canWrite,
    hasActiveProvider: Boolean(activeProvider),
  }

  const wz = useWizard<OnboardingStepId, OnboardingCtx>({
    steps: ONBOARDING_STEPS,
    ctx,
    initialId,
    // A returning user knows which step they came for; a first-run user should
    // still be walked through in order.
    freeNavigation: mode === 'relaunch',
    onFinish: handleFinish,
  })

  // Called after `useWizard` on purpose — see the header note. `stepId` is a
  // write-lock input and must be the step the user is actually on.
  const saveApi = useOnboardingSave({
    mode,
    unlocked,
    stepId: wz.state.currentId,
  })

  // ── navigation that has to wait for a state flip ──────────────────────────
  // `useWizard` resolves NEXT/GOTO against the ctx of the render the click
  // happened in, so a handler that changes ctx *and* moves must let the change
  // land first.
  type PendingNav = { kind: 'next' } | { kind: 'enter'; id: OnboardingStepId }
  const [pendingNav, setPendingNav] = useState<PendingNav | null>(null)

  useEffect(() => {
    if (!pendingNav) return
    setPendingNav(null)
    if (pendingNav.kind === 'next') wz.next()
    else wz.reset(pendingNav.id)
  }, [pendingNav, wz.next, wz.reset])

  /**
   * The user changed something that has to be written. Deliberately NOT called
   * from navigation: `dirty` is an input to `validateProviderStep` ("you edited
   * this, now save it"), so a Next or a rail click that set it would demand a
   * save of a draft nobody touched — and on a configured install that is a dead
   * end, since there is nothing to save.
   */
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
        // what is on screen, and the previous verification described something
        // else entirely.
        setSaved(false)
        saveApi.reset()
      }
    },
    [saveApi, touch],
  )

  const jumpTo = useCallback(
    (id: OnboardingStepId) => {
      markEngaged()
      const target = resolveStepAlias(id)
      if (branch === 'summary') setBranch('main')
      // `reset` rather than `goto`: a jump from a landing page targets steps
      // the reachability rule (visited, or immediately next) would refuse.
      setPendingNav({ kind: 'enter', id: target })
    },
    [branch, markEngaged],
  )

  const startFlow = useCallback(() => {
    markEngaged()
    setPendingNav({ kind: 'next' })
  }, [markEngaged])

  const unlock = useCallback(() => {
    markEngaged()
    setUnlocked(true)
    setBranch('main')
    setPendingNav({ kind: 'enter', id: 'connect' })
  }, [markEngaged])

  const dismiss = useCallback(() => {
    markDismissed()
    onClose?.()
  }, [markDismissed, onClose])

  // Save and verify are one action now: a save the wizard never checked is how
  // it used to report success on a provider that 401s on first use.
  const handleSave = useCallback(() => {
    if (!choice) return
    void saveApi.save({ choice, draft }).then((ok) => {
      if (!ok) return
      setSaved(true)
      void saveApi.verify(choice.id)
    })
  }, [choice, draft, saveApi])

  const openRoute = useCallback(
    (href: string) => {
      onClose?.()
      if (typeof window !== 'undefined') window.location.assign(href)
    },
    [onClose],
  )

  // ── save-and-resume ───────────────────────────────────────────────────────
  const firstSyncRef = useRef(true)

  useEffect(() => {
    if (firstSyncRef.current) {
      firstSyncRef.current = false
      return
    }
    const next: OnboardingDraft & OnboardingTransient = {
      ...draftRef.current,
      stepId: wz.state.currentId,
      branch: 'main',
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
  }, [mode, wz.state])

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
  // summary instead of the welcome screen — but only while the user has not
  // touched anything, so a late config read can never yank the flow (the same
  // rule `onboarding-gate.ts` applies to the connection probe).
  useEffect(() => {
    if (mode !== 'first-run' || dirty) return
    if (branch === 'summary' || wz.state.currentId !== 'welcome') return
    if (!activeProvider) return
    setBranch('summary')
  }, [activeProvider, branch, dirty, mode, wz.state.currentId])

  // ── derived context ───────────────────────────────────────────────────────

  const gatewayReachable = useMemo(() => {
    const hop = connection.boundaries.find(
      (boundary) => boundary.id === 'ui-gateway',
    )
    if (!hop || hop.status === 'unknown') return null
    return hop.status !== 'fail'
  }, [connection.boundaries])

  const checklistItems = useMemo(
    () =>
      buildChecklist({
        outcome,
        draft,
        activeProvider,
        gatewayReachable,
        chatProven: gateProven,
        agentCwd: agentCwd.status?.resolved.path ?? null,
        agentCwdExplicit:
          agentCwd.status?.resolved.source === 'explicit-config' ||
          agentCwd.applied !== null,
        pluginsTouched: plugins.touched,
        profileTouched: profiles.touched,
        memoryTouched: memory.touched,
      }),
    [
      activeProvider,
      agentCwd.applied,
      agentCwd.status,
      draft,
      gateProven,
      gatewayReachable,
      memory.touched,
      outcome,
      plugins.touched,
      profiles.touched,
    ],
  )

  // Everything the wizard already knows about this workspace, assembled once.
  // `initialTheme` rather than the live theme: selecting in the theme picker
  // applies immediately, so the mount value is the only thing that can still
  // answer "what was this workspace on before I started clicking".
  const currentSetup = useMemo(
    () =>
      buildCurrentSetup({
        config,
        pluginRows: plugins.rows,
        boundaries: connection.boundaries,
        themeId: initialTheme,
        verifyOutcome: saveApi.verifyOutcome ?? null,
        gatewayUrl: connection.gatewayUrl,
        profiles: profiles.choices,
      }),
    [
      config,
      connection.boundaries,
      connection.gatewayUrl,
      initialTheme,
      plugins.rows,
      profiles.choices,
      saveApi.verifyOutcome,
    ],
  )

  const gatewayOnboarding = useMemo(
    () => readGatewayOnboarding(rawConfig),
    [rawConfig],
  )

  const ollamaOnline = useMemo(() => {
    const rows = localProvidersQuery.data?.providers ?? []
    const row = rows.find((entryRow) => entryRow.id === 'ollama')
    return row ? row.online === true : null
  }, [localProvidersQuery.data])

  const ollama = useMemo(
    () =>
      detectOllamaContext({
        providerId: draft.providerId ?? activeProvider,
        baseUrl:
          draft.baseUrl ||
          ((draft.providerId ?? activeProvider)
            ? (currentSetup.providerBaseUrls[
                normalizeProviderId(draft.providerId ?? activeProvider ?? '')
              ] ?? null)
            : null),
        config: rawConfig,
        online: ollamaOnline,
      }),
    [
      activeProvider,
      currentSetup.providerBaseUrls,
      draft.baseUrl,
      draft.providerId,
      ollamaOnline,
      rawConfig,
    ],
  )

  const extras = useMemo(
    () =>
      buildExtras({
        gateway: gatewayOnboarding,
        activeProfileName: currentSetup.activeProfileName,
        activeMemoryProvider: currentSetup.activeMemoryProvider,
        enabledPluginCount: currentSetup.enabledPlugins.length,
        corePluginCount: currentSetup.corePluginCount,
        themeLabel: currentSetup.themeLabel,
      }),
    [currentSetup, gatewayOnboarding],
  )

  const factsFor = (id: OnboardingStepId) =>
    factsForStep(id, currentSetup, {
      providerId: draft.providerId ?? undefined,
    })

  // Where the selected provider's credential already lives, if anywhere — the
  // env var *name*, never the key.
  const storedKeyEnv = draft.providerId
    ? (currentSetup.storedKeyEnvs[normalizeProviderId(draft.providerId)] ??
      null)
    : null

  // Provenance, not a boolean: "resolves from the pool, not from the .env you
  // just edited" is the case `configured: true` could never express.
  const originNote = useMemo(() => {
    const providerId = draft.providerId ?? activeProvider
    if (!providerId) return null
    const row = (connection.credentials?.statuses ?? []).find(
      (status) => status.provider === providerId,
    )
    if (!row) return null
    if (row.shadowedBy || row.effectiveOrigin === 'unknown') {
      return row.detail ?? null
    }
    return null
  }, [activeProvider, connection.credentials, draft.providerId])

  const connectionLabel =
    gatewayReachable === null
      ? 'Unknown'
      : gatewayReachable
        ? 'Online'
        : 'Offline'

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
            connection={connectionLabel}
            agentCwd={agentCwd.status?.resolved.path ?? null}
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
            onStart={startFlow}
            onDismiss={dismiss}
            showDismiss={!relaunch}
          />
        )

      case 'connect':
        return (
          <ConnectStep
            boundaries={connection.boundaries}
            loading={connection.loading}
            onHeal={(action, payload) => void connection.heal(action, payload)}
            healing={connection.healing}
            canWrite={canWrite}
            facts={factsFor('connect')}
            gatewayUrl={connection.gatewayUrl}
          />
        )

      case 'provider':
        return (
          <ProviderStep
            choices={choices}
            choice={choice}
            draft={draft}
            onChange={patchDraft}
            errors={wz.errors}
            facts={factsFor('provider')}
            activeProviderId={currentSetup.activeProviderId}
            configuredProviderIds={currentSetup.configuredProviderIds}
            hasStoredKey={hasStoredKey}
            storedKeyEnv={storedKeyEnv}
            originNote={originNote}
            canWrite={canWrite}
            saving={saveApi.saving}
            saveError={saveApi.saveError}
            saved={saved}
            onSave={handleSave}
            verifying={saveApi.verifying}
            verification={saveApi.verification}
            canRestart={saveApi.canRestart}
            restarting={saveApi.restarting}
            onRestart={() => void saveApi.restart()}
            ollama={ollama}
          />
        )

      case 'workspace':
        return (
          <WorkspaceStep
            status={agentCwd.status}
            loading={agentCwd.loading}
            error={agentCwd.error}
            preview={agentCwd.preview}
            previewing={agentCwd.previewing}
            onPreview={(path) => void agentCwd.requestPreview(path)}
            onCancelPreview={agentCwd.clearPreview}
            applying={agentCwd.applying}
            onApply={(path) => void agentCwd.apply(path)}
            applied={agentCwd.applied}
            canWrite={canWrite}
          />
        )

      case 'chat':
        return (
          <ChatStep
            state={chat.state}
            prompt={chat.prompt}
            onSend={() => {
              markEngaged()
              void chat.send()
            }}
            onSkip={() => {
              markEngaged()
              chat.skip()
            }}
            activeProvider={activeProvider}
            ollama={ollama}
            tips={pendingGatewayTips(gatewayOnboarding)}
            facts={factsFor('chat')}
            errors={wz.errors}
          />
        )

      case 'extras':
        return (
          <ExtrasStep
            cards={extras}
            onJump={jumpTo}
            onOpenRoute={openRoute}
            unproven={!gateProven}
          />
        )

      case 'profile':
        return (
          <ProfileStep
            choices={profiles.choices}
            activeName={profiles.activeName}
            loading={profiles.loading}
            error={profiles.error}
            onActivate={(name) => void profiles.activate(name)}
            activating={profiles.activating}
            canWrite={canWrite}
            needsRestart={profiles.needsRestart}
            facts={factsFor('profile')}
          />
        )

      case 'memory':
        return (
          <MemoryStep
            choices={memory.choices}
            activeProvider={memory.activeProvider}
            loading={memory.loading}
            error={memory.error}
            onSelect={(id) => void memory.select(id)}
            selecting={memory.selecting}
            canWrite={canWrite}
            touched={memory.touched}
            needsRestart={memory.needsRestart}
            stats={memory.stats}
            facts={factsFor('memory')}
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
            canWrite={canWrite}
            facts={factsFor('plugins')}
          />
        )

      case 'theme':
        return (
          <ThemeStep
            selected={draft.themeId ?? initialTheme}
            onSelect={(id) => patchDraft({ themeId: id })}
            current={initialTheme}
            facts={factsFor('theme')}
          />
        )

      case 'finish':
        return (
          <FinishStep
            items={checklistItems}
            onJump={jumpTo}
            onOpenWorkspace={wz.finish}
            chatProven={gateProven}
            needsRestart={
              saved && saveApi.verifyOutcome?.status !== 'confirmed'
            }
          />
        )

      // Retired ids never render — they are disabled in the step table and
      // mapped onto their replacements at mount.
      case 'system-check':
      case 'review':
      case 'verify':
        return null
    }
  }

  return (
    <WizardShell
      screen="onboarding"
      variant={relaunch ? 'modal' : 'fullscreen'}
      className={relaunch ? 'ob-relaunch' : 'ob-surface'}
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
