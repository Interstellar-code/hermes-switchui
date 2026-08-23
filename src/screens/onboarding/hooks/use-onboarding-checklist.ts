'use client'

/**
 * use-onboarding-checklist.ts — the same "what's left" list the wizard's
 * summary/finish steps render, available outside the wizard entirely.
 *
 * Skipped and never-done items must stay discoverable after the wizard
 * closes — that's why the sidebar badge and the dashboard card exist. Both
 * read through this hook rather than duplicating the storage/fetch wiring
 * `onboarding-screen.tsx` already does for its own summary step.
 *
 * ## Why this hook probes at all
 *
 * It used to pass `false`/`null` for every live signal and lean entirely on
 * the `completed` list carried by a `'complete'` outcome record. That list is
 * written by one thing only: a wizard run walking its own steps. Two very
 * common populations never produce one —
 *
 *   - installs that settled on the legacy `claude-onboarding-complete` flag,
 *   - installs the connection probe auto-detected,
 *
 * both of which `use-onboarding-gate.ts`'s `readGateOutcome` synthesises as
 * `{ completed: [], skipped: [] }`. On those, `completed` is permanently empty,
 * so configuring a profile, a memory provider, a working directory or a theme
 * through the real screens could never be noticed: the card kept reporting
 * finished work as outstanding, with no way to clear it.
 *
 * So this hook asks the machine instead. Each item below gets a real read of
 * the live configuration, answering "is this actually set up?" rather than
 * "did someone walk the wizard?". Nothing is written back into `completed` —
 * forging wizard-completion records would destroy the `autoDetected` vs
 * `complete` distinction `onboarding-storage.ts` keeps deliberately auditable,
 * and would assert something that did not happen.
 *
 * ## Failure is always "todo", never "done"
 *
 * Every probe funnels through `fetchJsonOrNull`: a network error, a non-2xx,
 * or an unparseable body all become `null`, and every signal derived below
 * reads `null` as "no proof" — the same value the hook passed unconditionally
 * before, so a broken probe degrades to exactly the old behaviour rather than
 * to a false claim that setup is finished. `gatewayReachable` is the one
 * three-valued signal: `null` means "could not check", which renders as
 * "Not checked in this session" instead of accusing a working gateway of
 * being down.
 *
 * ## `ready` waits for the probes
 *
 * `ready` gates every consumer (`outstanding` is forced to 0 until then, the
 * dashboard card and the sidebar badge both refuse to render). It therefore
 * waits for the probes to settle, not just for localStorage: resolving it
 * earlier would paint "3 of 4 required steps left" on a fully-configured
 * install for as long as the fetches take, then yank it away — the same
 * paint-and-vanish flicker `onboarding-gate.ts` exists to prevent for the
 * wizard itself.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { buildChecklist, outstandingCount } from '../lib/checklist'
import { buildCorePluginRows } from '../lib/core-plugins'
import { DEFAULT_PROFILE_NAME } from '../lib/profile-choices'
import {
  ONBOARDING_COMPLETE_EVENT,
  ONBOARDING_KEYS,
  readOnboardingDraft,
  readOnboardingOutcome,
  readPluginsReviewed,
} from '../lib/onboarding-storage'
import type { ChecklistItem } from '../lib/checklist'
import type {
  OnboardingDraft,
  OnboardingOutcome,
  StorageLike,
} from '../lib/onboarding-storage'
import {
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
  readStoredTheme,
} from '@/lib/theme'
import { getPluginsHub } from '@/lib/hermes-client'

// Same key `onboarding-screen.tsx` uses for its own `/api/claude-config`
// query — reusing the literal keeps this hook and a concurrently-mounted
// wizard sharing one TanStack Query cache entry instead of double-fetching.
const CONFIG_QUERY_KEY = ['onboarding', 'claude-config'] as const
const CONNECTION_QUERY_KEY = ['onboarding', 'checklist', 'connection'] as const
const AGENT_CWD_QUERY_KEY = ['onboarding', 'checklist', 'agent-cwd'] as const
const PROFILES_QUERY_KEY = ['onboarding', 'checklist', 'profiles'] as const
const SESSIONS_QUERY_KEY = ['onboarding', 'checklist', 'sessions'] as const
// Deliberately the bare key `plugins-screen.tsx`, `section-mcp-registered.tsx`
// and `use-nav-counts.ts` already share. The Plugins Hub read is a proxy hop to
// the dashboard on :9119 and is entirely profile-agnostic; forking the key here
// would buy a second identical round trip and nothing else.
const PLUGINS_HUB_QUERY_KEY = ['plugins-hub'] as const

/**
 * How many of the most recent sessions to inspect for proof that a completion
 * has ever succeeded. Enough that a run of empty/aborted sessions at the top
 * of the list cannot hide a real one, small enough that the badge never pulls
 * a full history. Worst case is a false `todo`, which is the safe direction.
 */
const CHAT_PROOF_WINDOW = 25

/** A session with a user turn *and* a reply — the cheapest honest proof. */
const CHAT_PROOF_MIN_MESSAGES = 2

type ConfigProviderRow = {
  id?: string
  configured?: boolean
  maskedKeys?: Record<string, string>
}

type ClaudeConfigPayload = {
  providers?: Array<ConfigProviderRow>
  activeProvider?: string
  activeModel?: string
  config?: {
    memory?: { provider?: unknown; memory_enabled?: unknown }
  }
}

type ConnectionStatusPayload = {
  health?: boolean
  capabilities?: Record<string, boolean>
}

type AgentCwdPayload = {
  ok?: boolean
  resolved?: { path?: string | null; source?: string }
}

type ProfilesListPayload = { activeProfile?: string | null }

type SessionRow = { messageCount?: unknown; message_count?: unknown }
type SessionsPayload = { sessions?: Array<SessionRow> }

const WATCHED_KEYS: ReadonlySet<string> = new Set([
  ...Object.values(ONBOARDING_KEYS),
  // Not an onboarding key, but the theme item reads it — a sibling tab
  // switching themes has to invalidate this list the same way.
  THEME_STORAGE_KEY,
])

const EMPTY_ITEMS: Array<ChecklistItem> = []

function safeStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** Never rejects: every failure mode collapses to `null` = "no proof". */
async function fetchJsonOrNull<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

function nonEmpty(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function messageCountOf(row: SessionRow): number {
  const value = row.messageCount ?? row.message_count
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

type Snapshot = {
  outcome: OnboardingOutcome
  draft: OnboardingDraft | null
  themeChosen: boolean
  pluginsReviewed: boolean
}

export type UseOnboardingChecklistResult = {
  items: Array<ChecklistItem>
  outstanding: number
  ready: boolean
}

export function useOnboardingChecklist(): UseOnboardingChecklistResult {
  const [hydrated, setHydrated] = useState(false)
  const [snapshot, setSnapshot] = useState<Snapshot>({
    outcome: { kind: 'fresh' },
    draft: null,
    themeChosen: false,
    pluginsReviewed: false,
  })

  const readSnapshot = useCallback(() => {
    const storage = safeStorage()
    setSnapshot({
      outcome: readOnboardingOutcome(storage),
      draft: readOnboardingDraft(storage),
      themeChosen: readStoredTheme() !== null,
      pluginsReviewed: readPluginsReviewed(storage),
    })
    setHydrated(true)
  }, [])

  useEffect(() => {
    // Never throws: this effect only runs client-side (React skips effects
    // during SSR), but `readSnapshot`/`safeStorage` stay defensive anyway.
    readSnapshot()

    const onComplete = () => readSnapshot()
    const onStorage = (event: StorageEvent) => {
      // A cleared storage area (`event.key === null`) or a change to any key
      // this contract owns both warrant a re-read; anything else is noise
      // from an unrelated feature sharing the same localStorage.
      if (event.key === null || WATCHED_KEYS.has(event.key)) readSnapshot()
    }
    // `storage` is delivered to every tab *except* the writer, so it cannot
    // see a theme picked in this one — and the theme control lives in a dialog
    // that opens over this card without unmounting it, so there is no remount
    // to fall back on either. `setTheme` fires this for exactly that gap.
    const onThemeChange = () => readSnapshot()

    window.addEventListener(ONBOARDING_COMPLETE_EVENT, onComplete)
    window.addEventListener(THEME_CHANGE_EVENT, onThemeChange)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(ONBOARDING_COMPLETE_EVENT, onComplete)
      window.removeEventListener(THEME_CHANGE_EVENT, onThemeChange)
      window.removeEventListener('storage', onStorage)
    }
  }, [readSnapshot])

  // Shared by every probe below. `retry: false` because each `queryFn`
  // already swallows its own failures — a retry would only delay the same
  // `null`, and `ready` is waiting on all of them.
  const probeOptions = {
    retry: false as const,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  }

  const configQuery = useQuery({
    queryKey: CONFIG_QUERY_KEY,
    queryFn: () => fetchJsonOrNull<ClaudeConfigPayload>('/api/claude-config'),
    ...probeOptions,
    // The wizard's own copy of this query uses 30s; keep the shorter of the
    // two so a concurrently-mounted wizard is never made staler by us.
    staleTime: 30_000,
  })

  const connectionQuery = useQuery({
    queryKey: CONNECTION_QUERY_KEY,
    queryFn: () =>
      fetchJsonOrNull<ConnectionStatusPayload>('/api/connection-status'),
    ...probeOptions,
  })

  const agentCwdQuery = useQuery({
    queryKey: AGENT_CWD_QUERY_KEY,
    queryFn: () => fetchJsonOrNull<AgentCwdPayload>('/api/agent-cwd'),
    ...probeOptions,
  })

  const profilesQuery = useQuery({
    queryKey: PROFILES_QUERY_KEY,
    queryFn: () => fetchJsonOrNull<ProfilesListPayload>('/api/profiles/list'),
    ...probeOptions,
  })

  const sessionsQuery = useQuery({
    queryKey: SESSIONS_QUERY_KEY,
    queryFn: () =>
      fetchJsonOrNull<SessionsPayload>(
        `/api/sessions?limit=${CHAT_PROOF_WINDOW}&offset=0`,
      ),
    ...probeOptions,
  })

  // The one probe that can reject: `getPluginsHub` throws on a failed proxy
  // hop rather than returning null, so the error state is read below instead.
  const pluginsHubQuery = useQuery({
    queryKey: PLUGINS_HUB_QUERY_KEY,
    queryFn: getPluginsHub,
    ...probeOptions,
  })

  // ── signals ────────────────────────────────────────────────────────────────

  const config = configQuery.data ?? null
  const activeProvider = nonEmpty(config?.activeProvider)

  // "Reach the gateway": `health` is the gateway's own /health probe, which is
  // exactly what this item claims. `null` (no payload at all) is "could not
  // check" — the workspace API failing tells us nothing about the gateway.
  const connection = connectionQuery.data ?? null
  const gatewayReachable =
    typeof connection?.health === 'boolean' ? connection.health : null

  const resolvedCwd = agentCwdQuery.data?.ok
    ? (agentCwdQuery.data.resolved ?? null)
    : null
  const agentCwd = nonEmpty(resolvedCwd?.path)
  // The same test `onboarding-screen.tsx` applies: only an explicit
  // `terminal.cwd` counts. A home-sentinel or container default is the
  // fallback this item exists to get the user off.
  const agentCwdExplicit = resolvedCwd?.source === 'explicit-config'

  // A named profile is running. The synthetic `default` row is "no profile was
  // chosen, the root config is what runs" — which is the state this optional
  // item offers to change, so it must not read as done.
  const activeProfileName = nonEmpty(profilesQuery.data?.activeProfile)
  const profileTouched =
    activeProfileName !== null && activeProfileName !== DEFAULT_PROFILE_NAME

  // `memory.provider` is the field the memory step writes, and
  // `memory_enabled` is what makes it load at all — a provider named under a
  // disabled memory block is configuration nobody is using.
  const memory = config?.config?.memory
  const memoryTouched =
    nonEmpty(memory?.provider) !== null && memory?.memory_enabled !== false

  const chatProven = (sessionsQuery.data?.sessions ?? []).some(
    (row) => messageCountOf(row) >= CHAT_PROOF_MIN_MESSAGES,
  )

  // `kanban` ships no plugin.yaml and so never appears in a hub snapshot;
  // the gateway capability flag is the only thing that can speak for it. The
  // other capability `buildCorePluginRows` accepts, `projects`, *is* a hub
  // plugin, so the hub answers for it and `/api/gateway-status` — a heavier
  // call that also probes dashboard session totals — is not worth a hop here.
  const corePluginRows = useMemo(
    () =>
      buildCorePluginRows(pluginsHubQuery.data?.plugins ?? [], {
        kanban: connection?.capabilities?.kanban === true,
      }),
    [connection?.capabilities?.kanban, pluginsHubQuery.data],
  )
  // Two ways this settles, and it needs both.
  //
  // "Everything is on" is the happy path: an unreachable hub marks every row
  // `absent`, so a failed probe reads as `todo`, never as done. But on its own
  // it made the step unsatisfiable for anyone with an opinion — a user who
  // opened the catalogue and deliberately left one plugin off was told, in
  // perpetuity, that they still had a review to do, and the only way to clear
  // it was to enable the plugin they had just rejected. A step called *Review*
  // has to be able to end in "no".
  //
  // So an explicit review counts too: the Plugins screen records one once it
  // has actually rendered the catalogue (see `readPluginsReviewed`). That is a
  // weaker claim than "all enabled" and is stored separately from the wizard's
  // `completed` list for exactly that reason.
  const allCorePluginsEnabled = corePluginRows.every(
    (row) => row.state === 'enabled' || row.state === 'self',
  )
  const pluginsTouched = allCorePluginsEnabled || snapshot.pluginsReviewed

  // Every probe has answered (with data, `null`, or an error). Consumers stay
  // silent until then rather than flashing a wrong count — see the header.
  const probed =
    !configQuery.isPending &&
    !connectionQuery.isPending &&
    !agentCwdQuery.isPending &&
    !profilesQuery.isPending &&
    !sessionsQuery.isPending &&
    !pluginsHubQuery.isPending
  const ready = hydrated && probed

  const items = useMemo(
    () =>
      ready
        ? buildChecklist({
            outcome: snapshot.outcome,
            draft: snapshot.draft,
            activeProvider,
            gatewayReachable,
            chatProven,
            agentCwd,
            agentCwdExplicit,
            pluginsTouched,
            profileTouched,
            memoryTouched,
            themeChosen: snapshot.themeChosen,
            // The one signal with no out-of-wizard probe. It is a live
            // reachability *warning* (`use-profile-servability.ts`, wired
            // through `onboarding-screen.tsx`), and `null` renders identically
            // to "nothing to warn about" — silence, never a false accusation.
            // Reproducing it here would mean re-deriving gateway topology for
            // a badge; the profile item degrades to the ordinary
            // touched/not-touched read instead, which is a true statement.
            profileServability: null,
          })
        : EMPTY_ITEMS,
    [
      activeProvider,
      agentCwd,
      agentCwdExplicit,
      chatProven,
      gatewayReachable,
      memoryTouched,
      pluginsTouched,
      profileTouched,
      ready,
      snapshot,
    ],
  )

  return {
    items,
    outstanding: ready ? outstandingCount(items) : 0,
    ready,
  }
}
