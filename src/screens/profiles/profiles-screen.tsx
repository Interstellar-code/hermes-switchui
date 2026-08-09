import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { ProfileCard } from './components/profile-card'
import { ProfileFilters } from './components/profile-filters'
import { ProfilePager } from './components/profile-pager'
import { ProfileTableRow } from './components/profile-table-row'
import { ProfileDetailDrawer } from './components/profile-detail-drawer'
import { TrashPanel } from './components/trash-panel'
import { AgentWizard } from './components/agent-wizard'
import { ConfirmDialog } from './components/confirm-dialog'
import type {
  AgentUIMetadata,
  ProfileStatus,
  ProfileSummary,
} from '@/server/profiles-browser'
import type { ProfilesListResponse } from '@/hooks/use-profiles-list'
import type {
  ProfileFilterState,
  ProfilesSearch,
} from '@/stores/profiles-screen-store'
import type { WizardStep } from './types'
import type { ProfileExportBundle } from '@/server/profiles-export'
import { BUILTIN_AGENTS } from '@/lib/builtin-agents'
import {
  applyFilterPatch,
  filtersToSearch,
  profilesSearchSchema,
  searchToFilters,
  usePageSize,
  useProfilesViewStore,
} from '@/stores/profiles-screen-store'
import { selectBrowsableProfiles, useProfilesList } from '@/hooks/use-profiles-list'
import { profileNameError, sanitizeProfileName } from '@/lib/profile-name'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/shadcn/ui/dialog'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { useGatewayRestartStore } from '@/stores/gateway-restart-store'
import '@/styles/matrix-profiles.css'

// ── Unified row type used by card + table ────────────────────────────────────
export type AgentRow = {
  id: string
  name: string
  tier: 1 | 2 | 3
  glyph: string
  role: string
  description: string
  model?: string
  provider?: string
  tags: Array<string>
  /**
   * Derived, authoritative lifecycle state straight from the server (P-06).
   * `agent_ui.status` is LEGACY / INERT and is deliberately never read here.
   */
  status: ProfileStatus
  /** UNIX **seconds** (P-12), or null when the profile has never run. */
  lastRunAt: number | null
  skillCount: number
  sessionCount: number
  hasEnv: boolean
  path?: string
  updatedAt?: string
  builtin: boolean
  profileName?: string
}

type SortKey = 'name' | 'tier' | 'last_run' | 'status'

// ── Builtin metadata lookup by id (profile name) ─────────────────────────────
const BUILTIN_BY_ID = new Map(BUILTIN_AGENTS.map((b) => [b.id, b]))

// ── Helper: derive AgentRow from ProfileSummary ──────────────────────────────
export function profileToRow(p: ProfileSummary): AgentRow {
  const name = p.name || ''
  const builtin = BUILTIN_BY_ID.get(name)
  const ui: AgentUIMetadata = p.agent_ui ?? {}
  const glyph = ui.glyph ?? builtin?.glyph ?? name.slice(0, 2).toUpperCase()
  const role = ui.role ?? builtin?.role ?? p.description ?? '—'
  const description = p.description ?? builtin?.description ?? ''
  const tags = ui.tags ?? builtin?.tags ?? []
  return {
    id: `profile:${name}`,
    name: builtin?.name ?? name,
    tier: ui.tier ?? builtin?.tier ?? 3,
    glyph,
    role,
    description,
    model: p.model || undefined,
    provider: p.provider || undefined,
    tags,
    // P-06 / P-12: the derived server fields, not the inert agent_ui ones.
    status: p.status,
    lastRunAt: p.lastRunAt ?? null,
    skillCount: p.skillCount,
    sessionCount: p.sessionCount,
    hasEnv: p.hasEnv,
    path: p.path,
    updatedAt: p.updatedAt,
    builtin: builtin !== undefined,
    profileName: name,
  }
}

// ── Action gating (P-07) ─────────────────────────────────────────────────────
// The server rejects create/rename/delete for the four built-in profile names
// with `Profile name "x" is reserved for built-in agents` (403), so offering
// those buttons on a built-in row guarantees an error toast. Update is a
// different code path (`validateProfileIdentifier`), so built-ins ARE editable
// and cloneable — a clone writes a *new*, non-reserved name.
//
// These live here rather than in the components so the screen decides once and
// simply withholds the callback; components keep only their own local guards.

/** The synthetic `default` row and rows with no on-disk name are inert. */
function isRealProfile(row: AgentRow): boolean {
  return Boolean(row.profileName) && row.profileName !== 'default'
}

export function canActivateRow(row: AgentRow): boolean {
  return isRealProfile(row) && row.status !== 'active'
}

export function canEditRow(row: AgentRow): boolean {
  return isRealProfile(row)
}

export function canCloneRow(row: AgentRow): boolean {
  return isRealProfile(row)
}

export function canRenameRow(row: AgentRow): boolean {
  return isRealProfile(row) && !row.builtin
}

export function canDeleteRow(row: AgentRow): boolean {
  // `deleteProfile` also throws "Cannot delete the active profile".
  return isRealProfile(row) && !row.builtin && row.status !== 'active'
}

/**
 * Which empty state to show (P-14).
 *
 * This used to test `rows.filter(r => r.tier === 3).length === 0`, so a fresh
 * install carrying only the built-in Tier-1/Tier-2 profiles answered "no agents
 * yet" to every non-matching search. The question is about the unfiltered
 * total, not about tiers.
 */
export function emptyStateVariant(totalRows: number): 'no-agents' | 'no-matches' {
  return totalRows === 0 ? 'no-agents' : 'no-matches'
}

async function postJson(url: string, body: Record<string, unknown>): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok || payload.error) {
    throw new Error(payload.error ?? `Request failed (${response.status})`)
  }
}

// ── Restart prompt: attach to the mismatch, not to the click (W3) ───────────
//
// Activating a profile only ever changes the SELECTED profile
// (`~/.hermes/active_profile`); it never touches the live gateway process.
// So whether a restart is actually needed depends entirely on what that
// process is already SERVING:
//   - multiplex, and the roster already includes this profile → live already,
//     no restart — `/p/<profile>/` reaches it right now.
//   - single, and the gateway is already running exactly this profile (e.g.
//     re-activating the current one) → no restart.
//   - anything else — a real mismatch, or topology we couldn't confirm →
//     warn. A spurious banner is a UI nag; a silently-stale gateway is a
//     wrong-profile chat, which is the worse failure to fail towards.
export type GatewayScopePayload = {
  mode?: string
  servedProfiles?: Array<string> | null
  servingProfile?: string | null
} | null | undefined

export function activationNeedsRestart(
  scope: GatewayScopePayload,
  profileName: string,
): boolean {
  if (!scope) return true
  if (scope.mode === 'multiplex') {
    return !(scope.servedProfiles ?? []).includes(profileName)
  }
  if (scope.mode === 'single') {
    return scope.servingProfile !== profileName
  }
  // 'unknown' (or any unrecognised value) — can't confirm either way.
  return true
}

/**
 * Fetches the live topology right after an activate and only raises the
 * restart banner when `activationNeedsRestart` says this one actually needs
 * it — replacing the old "fire on every activate" behaviour, which nagged
 * for a multiplex switch that was already live the moment it landed.
 */
async function syncRestartPrompt(profileName: string): Promise<void> {
  let needsRestart = true
  try {
    const res = await fetch('/api/gateway-status')
    if (res.ok) {
      const payload = (await res.json().catch(() => null)) as
        | { scope?: GatewayScopePayload }
        | null
      needsRestart = activationNeedsRestart(payload?.scope, profileName)
    }
  } catch {
    needsRestart = true
  }
  const store = useGatewayRestartStore.getState()
  if (needsRestart) store.markNeedsRestart(profileName)
  else store.dismiss()
}

// ── Import a profile bundle (G-03) ───────────────────────────────────────────
//
// `POST /api/profiles/import` validates every field of the bundle server-side
// (it is a file someone else handed the user), so the client validation below
// is not a security boundary — it exists so that picking a holiday photo, a
// half-downloaded file or a bundle from a future version fails immediately
// with a sentence that says what is wrong, instead of after a round trip that
// reports "Invalid profile bundle".

/** How the file picker's result is described back to the user. */
export type BundleParseResult =
  | { ok: true; bundle: ProfileExportBundle }
  | { ok: false; error: string }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parse and shape-check the text of a picked file. Mirrors the first few
 * checks `importProfile()` makes, and nothing more — anything subtler (name
 * rules, path traversal in `skills`, the size ceiling) is the server's call
 * and is reported from its response.
 */
export function parseProfileBundle(text: string): BundleParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: 'That file is not valid JSON — pick an exported .hermes-profile.json file.' }
  }
  if (!isPlainObject(parsed)) {
    return { ok: false, error: 'That file is JSON, but not a Hermes profile bundle.' }
  }
  if (parsed.schemaVersion !== 1) {
    return {
      ok: false,
      error:
        typeof parsed.schemaVersion === 'number'
          ? `Unsupported bundle version ${parsed.schemaVersion} — this workspace reads version 1.`
          : 'That file is missing a schemaVersion — it is not a Hermes profile bundle.',
    }
  }
  if (typeof parsed.name !== 'string' || parsed.name.trim() === '') {
    return { ok: false, error: 'That bundle has no agent name.' }
  }
  if (!isPlainObject(parsed.config)) {
    return { ok: false, error: 'That bundle has no config — its "config" field must be an object.' }
  }
  if (parsed.skills !== undefined && !isPlainObject(parsed.skills)) {
    return { ok: false, error: 'That bundle\'s "skills" field must be an object of path → contents.' }
  }
  return { ok: true, bundle: parsed as unknown as ProfileExportBundle }
}

/**
 * Turn an import failure into something actionable. The route already
 * distinguishes these (see `-error-response.ts`), so collapsing them into
 * "Import failed" would throw away the only information the user can act on.
 * 409 is handled separately by the caller — it opens the rename prompt rather
 * than reporting a dead end.
 */
export function importErrorMessage(status: number, serverError?: string): string {
  switch (status) {
    case 400:
      return `That bundle was rejected: ${serverError ?? 'it does not match the expected shape.'}`
    case 401:
      return 'Not signed in — reload the page and try again.'
    case 403:
      return serverError ?? 'That name is reserved for a built-in agent.'
    case 413:
      return 'That bundle is too large — its skills/ tree exceeds the 10 MiB import limit.'
    default:
      return serverError ?? `Import failed (${status})`
  }
}

/** First free `name`, `name-2`, `name-3`… for the import-under-a-new-name prompt. */
export function suggestImportName(name: string, taken: Array<string>): string {
  const used = new Set(taken.map((n) => n.toLowerCase()))
  const base = sanitizeProfileName(name) || 'imported-agent'
  if (!used.has(base.toLowerCase())) return base
  for (let n = 2; n < 100; n++) {
    const candidate = sanitizeProfileName(`${base}-${n}`)
    if (!used.has(candidate.toLowerCase())) return candidate
  }
  return base
}

// ── Card-grid keyboard navigation (P-16) ─────────────────────────────────────
// Cards are `role="button"` and tabbable, and a page can hold up to 96 of them,
// so Tab alone means 96 stops to cross the grid. Arrows move by cell instead.

const GRID_NAV_KEYS = new Set([
  'ArrowRight',
  'ArrowLeft',
  'ArrowDown',
  'ArrowUp',
  'Home',
  'End',
])

/**
 * Where an arrow key lands, given a flat index into a `columns`-wide grid.
 * Movement clamps at the edges rather than wrapping — wrapping from the end of
 * one row to the start of the next reads as a jump when the cells are visibly
 * two-dimensional. Returning `index` unchanged means "no move".
 */
export function nextGridIndex(
  index: number,
  count: number,
  columns: number,
  key: string,
): number {
  if (count <= 0) return index
  const cols = Math.max(1, columns)
  switch (key) {
    case 'ArrowRight':
      return Math.min(index + 1, count - 1)
    case 'ArrowLeft':
      return Math.max(index - 1, 0)
    case 'ArrowDown':
      return Math.min(index + cols, count - 1)
    case 'ArrowUp':
      return index - cols >= 0 ? index - cols : index
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return index
  }
}

/**
 * The grid is `repeat(auto-fill, minmax(300px, 1fr))`, so the column count is a
 * function of the viewport and only the laid-out DOM knows it. Cards sharing
 * the first card's `offsetTop` form row one.
 */
function gridColumnCount(cards: Array<HTMLElement>): number {
  if (cards.length === 0) return 1
  const top = cards[0].offsetTop
  let columns = 0
  for (const card of cards) {
    if (card.offsetTop !== top) break
    columns++
  }
  return Math.max(1, columns)
}

/** Typed handle on the route that owns the filter search params (G-07). */
const profilesRoute = getRouteApi('/profiles')

/** Module-level so the `select` identity stays stable across renders. */
function selectActiveProfileName(data: ProfilesListResponse): string | undefined {
  return data.activeProfile
}

// ── Main screen ───────────────────────────────────────────────────────────────
export function ProfilesScreen() {
  const queryClient = useQueryClient()

  // G-07: the URL is the single source of truth for what this list is showing.
  // No Zustand mirror — a mirror is a second writable copy, and back/forward,
  // a deep link, or any `navigate()` can move one of them without the other.
  const urlSearch = profilesRoute.useSearch()
  const navigate = profilesRoute.useNavigate()
  const filters = useMemo(() => searchToFilters(urlSearch), [urlSearch])
  const {
    search,
    tierFilter,
    statusFilter,
    modelFilter,
    tagFilter,
    page,
  } = filters

  /**
   * The only writer. `applyFilterPatch` carries over the old store's rule that
   * any filter change returns you to page 1, and `filtersToSearch` maps
   * defaults to `undefined` so they drop out of the query string instead of
   * accumulating as `?tier=all&status=all&…`. Spreading over `prev` leaves
   * `?edit=`/`?step=` alone.
   */
  const setFilters = useCallback(
    (
      patch: Partial<ProfileFilterState>,
      opts?: { replace?: boolean },
    ): void => {
      void navigate({
        search: (prev: ProfilesSearch) => ({
          ...prev,
          // `prev` is the *raw* parsed query string, not the validated one, so
          // `?tier=2` reaches here as the number 2. Re-running the schema makes
          // the writer read exactly what the screen reads, and incidentally
          // scrubs any junk a hand-edited URL left behind.
          ...filtersToSearch(
            applyFilterPatch(
              searchToFilters(profilesSearchSchema.parse(prev)),
              patch,
            ),
          ),
        }),
        replace: opts?.replace,
      })
    },
    [navigate],
  )

  const { viewMode } = useProfilesViewStore()
  const pageSize = usePageSize()

  const [sortKey, setSortKey] = useState<SortKey>('tier')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [renameTarget, setRenameTarget] = useState<AgentRow | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [cloneTarget, setCloneTarget] = useState<AgentRow | null>(null)
  const [cloneValue, setCloneValue] = useState('')
  const [cloneError, setCloneError] = useState<string | null>(null)
  const [busyName, setBusyName] = useState<string | null>(null)
  // Create has no URL identity (there is nothing to link *to* yet); editing
  // does, and lives in `?edit=`. The two modes are mutually exclusive, so this
  // is not a second source of truth for the same fact.
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteConfirmName, setDeleteConfirmName] = useState<string | null>(null)
  const [detailRow, setDetailRow] = useState<AgentRow | null>(null)
  const [trashOpen, setTrashOpen] = useState(false)
  const newProfileRef = useRef<string | null>(null)
  // Import: the picked bundle is held only while a name collision is being
  // resolved — the 409 path re-POSTs the same bundle under a new name.
  const [importing, setImporting] = useState(false)
  const [collisionBundle, setCollisionBundle] = useState<ProfileExportBundle | null>(null)
  const [collisionName, setCollisionName] = useState('')
  const [collisionError, setCollisionError] = useState<string | null>(null)
  const importInputRef = useRef<HTMLInputElement | null>(null)

  const profilesQuery = useProfilesList({ select: selectBrowsableProfiles })
  const activeProfileQuery = useProfilesList({ select: selectActiveProfileName })

  const profiles = profilesQuery.data ?? []
  const activeProfileName = activeProfileQuery.data ?? null

  const allRows = useMemo<Array<AgentRow>>(() => {
    return profiles.map(profileToRow)
  }, [profiles])

  // ── Wizard deep link: /profiles?edit=<name>[&step=1..9] ────────────────────
  const editParam = urlSearch.edit ?? null
  const deepLinkStep: WizardStep | undefined = urlSearch.step

  /**
   * A name in the URL is a claim, not a fact. Opening the wizard on a profile
   * that is not in the list gives an empty shell whose seeding effect never
   * runs — the read returns 404, `seededRef` stays false, and the user stares
   * at a blank step 1 with no explanation. So the param only counts once the
   * list has actually loaded and the profile is one this screen would let you
   * edit anyway (`canEditRow` — the synthetic `default` row is not).
   */
  const editTarget = useMemo<string | null>(() => {
    if (!editParam) return null
    const row = allRows.find((r) => r.profileName === editParam)
    return row && canEditRow(row) ? editParam : null
  }, [editParam, allRows])

  // Only report a bad name once per name — the effect re-runs on every list
  // refetch, and a repeating toast is worse than the broken link.
  const reportedMissingEditRef = useRef<string | null>(null)
  useEffect(() => {
    if (!editParam || !profilesQuery.isSuccess) return
    if (editTarget) {
      reportedMissingEditRef.current = null
      return
    }
    if (reportedMissingEditRef.current === editParam) return
    reportedMissingEditRef.current = editParam
    // Told, not ignored: someone followed a link that named a specific agent,
    // and silence would look like the app hung on an empty dialog.
    toast(`No agent named "${editParam}" — it may have been renamed or deleted`, {
      type: 'error',
    })
    void navigate({
      search: (prev: ProfilesSearch) => ({
        ...prev,
        edit: undefined,
        step: undefined,
      }),
      replace: true,
    })
  }, [editParam, editTarget, profilesQuery.isSuccess, navigate])

  const allModels = useMemo<Array<string>>(() => {
    const set = new Set<string>()
    for (const r of allRows) if (r.model) set.add(r.model)
    return Array.from(set).sort()
  }, [allRows])

  const allTags = useMemo<Array<string>>(() => {
    const freq = new Map<string, number>()
    for (const r of allRows) {
      for (const t of r.tags) freq.set(t, (freq.get(t) ?? 0) + 1)
    }
    return Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([t]) => t)
  }, [allRows])

  const filtered = useMemo<Array<AgentRow>>(() => {
    // Already debounced: the search box writes to the URL 150ms after the last
    // keystroke, so this value only ever changes at that cadence. Debouncing it
    // a second time here would just add 150ms of lag on top.
    const q = search.toLowerCase()
    return allRows.filter((r) => {
      if (
        q &&
        !r.name.toLowerCase().includes(q) &&
        !r.role.toLowerCase().includes(q) &&
        !r.description.toLowerCase().includes(q) &&
        !r.tags.some((t) => t.toLowerCase().includes(q))
      )
        return false
      if (tierFilter !== 'all' && r.tier !== Number(tierFilter)) return false
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (modelFilter !== 'all' && r.model !== modelFilter) return false
      if (tagFilter !== 'all' && !r.tags.includes(tagFilter)) return false
      return true
    })
  }, [allRows, search, tierFilter, statusFilter, modelFilter, tagFilter])

  const sorted = useMemo<Array<AgentRow>>(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'name') cmp = a.name.localeCompare(b.name)
      else if (sortKey === 'tier') cmp = a.tier - b.tier
      else if (sortKey === 'status') cmp = a.status.localeCompare(b.status)
      else cmp = (a.lastRunAt ?? 0) - (b.lastRunAt ?? 0)
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [filtered, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const paginated = sorted.slice((safePage - 1) * pageSize, safePage * pageSize)

  const t1Count = allRows.filter((r) => r.tier === 1).length
  const t2Count = allRows.filter((r) => r.tier === 2).length
  const t3Count = allRows.filter((r) => r.tier === 3).length
  const activeCount = allRows.filter((r) => r.status === 'active').length
  const emptyState = emptyStateVariant(allRows.length)
  // The `default` row is filtered out of the list, so "is default running?" has
  // to come from `activeProfile` rather than from any visible row.
  const defaultIsActive = !activeProfileName || activeProfileName === 'default'

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }

  function sortArrow(key: SortKey) {
    if (sortKey !== key) return '↕'
    return sortDir === 'asc' ? '↑' : '↓'
  }

  function sortClass(key: SortKey) {
    if (sortKey !== key) return 'sortable'
    return `sortable sort-${sortDir}`
  }

  async function refreshProfiles() {
    await queryClient.invalidateQueries({ queryKey: ['profiles'] })
  }

  async function handleActivate(profileName: string) {
    setBusyName(profileName)
    try {
      await postJson('/api/profiles/activate', { name: profileName })
      await syncRestartPrompt(profileName)
      toast(`Activated agent ${profileName}`, { type: 'success' })
      await refreshProfiles()
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Failed to activate', { type: 'error' })
    } finally {
      setBusyName(null)
    }
  }

  function handleDelete(profileName: string) {
    setDeleteConfirmName(profileName)
  }

  async function doDelete(profileName: string) {
    setBusyName(profileName)
    try {
      await postJson('/api/profiles/delete', { name: profileName })
      setDetailRow((current) =>
        current?.profileName === profileName ? null : current,
      )
      toast(`Moved ${profileName} to Recently Deleted`, { type: 'success' })
      // `['profiles']` is a prefix of the trash panel's key, so this refreshes
      // Recently Deleted as well.
      await refreshProfiles()
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Failed to delete', { type: 'error' })
    } finally {
      setBusyName(null)
    }
  }

  function openRename(agent: AgentRow) {
    setRenameTarget(agent)
    // `agent.name` is the *display* name — the built-in map turns `hermes-switch`
    // into "Hermes Switch", which contains a space and fails the name rule the
    // dialog itself enforces. Seed with the on-disk name (P-09).
    setRenameValue(agent.profileName ?? agent.name)
  }

  const renameError = renameValue.trim()
    ? profileNameError(renameValue, 'canonical')
    : null

  async function handleRename() {
    if (!renameTarget?.profileName || !renameValue.trim()) return
    if (renameError) return
    setBusyName(renameTarget.profileName)
    try {
      await postJson('/api/profiles/rename', {
        oldName: renameTarget.profileName,
        newName: renameValue.trim(),
      })
      toast(`Renamed ${renameTarget.profileName} → ${renameValue.trim()}`, { type: 'success' })
      setRenameTarget(null)
      setRenameValue('')
      await refreshProfiles()
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Failed to rename', { type: 'error' })
    } finally {
      setBusyName(null)
    }
  }

  const existingProfileNames = profiles.map((p) => (p.name || '').toLowerCase())

  function openClone(agent: AgentRow) {
    setCloneTarget(agent)
    setCloneValue(sanitizeProfileName(`${agent.profileName ?? agent.name}-copy`))
    setCloneError(null)
  }

  async function handleClone() {
    if (!cloneTarget?.profileName || !cloneValue.trim()) return
    const name = cloneValue.trim()
    const invalid = profileNameError(name, 'wizard')
    if (invalid) {
      setCloneError(invalid)
      return
    }
    if (existingProfileNames.includes(name)) {
      setCloneError(`Name "${name}" is already in use`)
      return
    }
    setBusyName(cloneTarget.profileName)
    try {
      await postJson('/api/profiles/create', { name, cloneFrom: cloneTarget.profileName })
      toast(`Cloned ${cloneTarget.profileName} → ${name}`, { type: 'success' })
      setCloneTarget(null)
      setCloneValue('')
      setCloneError(null)
      await refreshProfiles()
      // Open the newly cloned profile in the wizard so the user can adjust it.
      openEditor(name)
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Failed to clone', { type: 'error' })
    } finally {
      setBusyName(null)
    }
  }

  /** Row/card click now inspects; editing is an explicit action (G-01). */
  function openDetail(agent: AgentRow) {
    // Both panels occupy the same right-hand slot — never stack them.
    setTrashOpen(false)
    setDetailRow(agent)
  }

  function openTrash() {
    setDetailRow(null)
    setTrashOpen(true)
  }

  /**
   * Opening the editor is a real navigation, so it pushes: Back closes the
   * wizard, which is what Back should mean here. Closing it *replaces*, so the
   * dismissed `?edit=` entry is gone rather than sitting one step back waiting
   * to reopen a dialog the user just shut.
   */
  function openEditor(profileName: string) {
    setDetailRow(null)
    void navigate({
      search: (prev: ProfilesSearch) => ({
        ...prev,
        edit: profileName,
        step: undefined,
      }),
    })
  }

  function closeWizard() {
    setCreateOpen(false)
    if (urlSearch.edit === undefined && urlSearch.step === undefined) return
    void navigate({
      search: (prev: ProfilesSearch) => ({
        ...prev,
        edit: undefined,
        step: undefined,
      }),
      replace: true,
    })
  }

  function handleEdit(agent: AgentRow) {
    if (!canEditRow(agent)) return
    openEditor(agent.profileName!)
  }

  function handleNewAgent() {
    setCreateOpen(true)
  }

  function handleGridKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!GRID_NAV_KEYS.has(event.key)) return
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    // Only when a card itself holds focus — a control inside one owns its own
    // arrow keys (and `.pf-card-actions` already stops keydown from bubbling).
    if (!target.classList.contains('pf-card')) return

    const cards = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('.pf-card'),
    )
    const index = cards.indexOf(target)
    if (index < 0) return
    const next = nextGridIndex(
      index,
      cards.length,
      gridColumnCount(cards),
      event.key,
    )
    if (next === index) return
    event.preventDefault()
    cards[next]?.focus()
  }

  async function handleUseDefault() {
    setBusyName('default')
    try {
      await postJson('/api/profiles/activate', { name: 'default' })
      await syncRestartPrompt('default')
      toast('Switched back to the default profile', { type: 'success' })
      await refreshProfiles()
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Failed to activate the default profile', {
        type: 'error',
      })
    } finally {
      setBusyName(null)
    }
  }

  /** Scroll the named card/row into view and flash it, once the list refetch lands. */
  function revealProfile(profileName: string) {
    newProfileRef.current = profileName
    void refreshProfiles().then(() => {
      setTimeout(() => {
        const el = document.querySelector(`[data-profile="${profileName}"]`)
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
          el.classList.add('pf-card--new')
          setTimeout(() => el.classList.remove('pf-card--new'), 1600)
        }
        newProfileRef.current = null
      }, 100)
    })
  }

  function handleWizardSuccess(profileName: string) {
    // P-13: the wizard is also the editor — don't claim "created" on a save.
    const wasEdit = editTarget !== null
    toast(
      wasEdit ? `Agent "${profileName}" saved` : `Agent "${profileName}" created`,
      { type: 'success' },
    )
    revealProfile(profileName)
  }

  // ── Import ─────────────────────────────────────────────────────────────────

  /**
   * POST the bundle. A 409 is not an error the user can only read about — the
   * route accepts an optional `name`, so the collision opens a prompt that
   * re-submits the same bundle under a different one.
   */
  async function submitImport(bundle: ProfileExportBundle, name?: string) {
    setImporting(true)
    try {
      const response = await fetch('/api/profiles/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(name ? { bundle, name } : { bundle }),
      })
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string
        profile?: { name?: string }
      }
      if (!response.ok) {
        if (response.status === 409) {
          setCollisionBundle(bundle)
          setCollisionName(suggestImportName(name ?? bundle.name, existingProfileNames))
          setCollisionError(
            `An agent named "${name ?? bundle.name}" already exists. Import it under a different name?`,
          )
          return
        }
        throw new Error(importErrorMessage(response.status, payload.error))
      }
      const importedName = payload.profile?.name ?? name ?? bundle.name
      setCollisionBundle(null)
      setCollisionName('')
      setCollisionError(null)
      toast(`Imported agent "${importedName}"`, { type: 'success' })
      revealProfile(importedName)
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Failed to import agent', {
        type: 'error',
      })
    } finally {
      setImporting(false)
    }
  }

  async function handleImportFile(file: File) {
    const parsed = parseProfileBundle(await file.text())
    if (!parsed.ok) {
      toast(parsed.error, { type: 'error' })
      return
    }
    await submitImport(parsed.bundle)
  }

  function handleCollisionImport() {
    if (!collisionBundle) return
    const name = collisionName.trim()
    const invalid = profileNameError(name, 'wizard')
    if (invalid) {
      setCollisionError(invalid)
      return
    }
    if (existingProfileNames.includes(name.toLowerCase())) {
      setCollisionError(`Name "${name}" is already in use`)
      return
    }
    void submitImport(collisionBundle, name)
  }

  return (
    <div data-screen="profiles" className="pf-shell">
      {/* ── Header ── */}
      <div className="pf-header">
        <div className="pf-header-left">
          <h1>Agents</h1>
          <div className="pf-header-stats">
            <span><b>{t3Count}</b> Tier-3</span>
            <div className="sep" />
            <span><b>{t2Count}</b> Tier-2</span>
            <div className="sep" />
            <span><b className="ok">{t1Count}</b> Tier-1</span>
            <div className="sep" />
            <span><b className="ok">{activeCount}</b> Active</span>
          </div>
        </div>
        <div className="pf-header-actions">
          <button
            type="button"
            className="pf-header-btn"
            onClick={() => void handleUseDefault()}
            disabled={defaultIsActive || Boolean(busyName)}
            title={
              defaultIsActive
                ? 'The default profile is already active'
                : `Stop running "${activeProfileName}" and fall back to the default profile`
            }
          >
            Use default profile
          </button>
          <button
            type="button"
            className="pf-header-btn"
            onClick={openTrash}
            title="Profiles you deleted are kept in ~/.hermes/trash"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" width="13" height="13">
              <path d="M3 4h10M6 4V2.5h4V4M5 4v9h6V4" />
            </svg>
            Recently Deleted
          </button>
          <button
            type="button"
            className="pf-header-btn"
            onClick={() => importInputRef.current?.click()}
            disabled={importing}
            title="Import an agent from a .hermes-profile.json bundle exported from this or another workspace"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" width="13" height="13">
              <path d="M8 2v8M5 7l3 3 3-3M3 13h10" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {importing ? 'Importing…' : 'Import'}
          </button>
          {/* The picker itself is never shown; the button above drives it. The
              value is cleared on every change so picking the same file twice
              in a row still fires. */}
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            hidden
            aria-hidden="true"
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void handleImportFile(file)
            }}
          />
          <button type="button" className="btn-new-agent" onClick={handleNewAgent}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            New Agent
          </button>
        </div>
      </div>

      {/* ── Filter bar ── */}
      <ProfileFilters
        models={allModels}
        tags={allTags}
        filters={filters}
        onFilterChange={setFilters}
      />

      {/* ── Canvas ── */}
      <div className="pf-canvas">
        {profilesQuery.isLoading ? (
          /* Skeleton grid */
          <div className="pf-grid">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="pf-skeleton">
                <div className="pf-skeleton-glyph" />
                <div className="pf-skeleton-line" style={{ width: '60%' }} />
                <div className="pf-skeleton-line" style={{ width: '40%' }} />
                <div className="pf-skeleton-line" style={{ width: '80%', marginTop: 12 }} />
              </div>
            ))}
          </div>
        ) : profilesQuery.isError ? (
          <div className="pf-error-banner">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="8" cy="8" r="6.5"/>
              <line x1="8" y1="5" x2="8" y2="8.5"/>
              <circle cx="8" cy="11" r=".6" fill="currentColor" stroke="none"/>
            </svg>
            <span>Failed to load agents.</span>
            <button type="button" onClick={() => void profilesQuery.refetch()}>Retry</button>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="pf-grid" onKeyDown={handleGridKeyDown}>
            {paginated.map((agent) => (
              <ProfileCard
                key={agent.id}
                agent={agent}
                onOpen={() => openDetail(agent)}
                onActivate={canActivateRow(agent) ? (n) => void handleActivate(n) : undefined}
                onEdit={canEditRow(agent) ? (a) => handleEdit(a) : undefined}
                onClone={canCloneRow(agent) ? (a) => openClone(a) : undefined}
                onDelete={canDeleteRow(agent) ? (n) => handleDelete(n) : undefined}
                data-profile={agent.profileName}
              />
            ))}
            {paginated.length === 0 && (
              emptyState === 'no-agents' ? (
                /* No profiles at all */
                <div className="pf-empty">
                  <div className="pf-empty-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
                    </svg>
                  </div>
                  <div className="pf-empty-title">No agents yet</div>
                  <div className="pf-empty-desc">Create your first agent to get started with custom AI profiles.</div>
                  <button type="button" className="btn-new-agent" onClick={handleNewAgent}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    Create your first agent
                  </button>
                </div>
              ) : (
                /* Filtered to zero */
                <div className="pf-empty">
                  <div className="pf-empty-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/>
                      <line x1="8" y1="11" x2="14" y2="11"/>
                    </svg>
                  </div>
                  <div className="pf-empty-title">No agents match</div>
                  <div className="pf-empty-desc">No agents match these filters. Try a different search or clear the filters.</div>
                </div>
              )
            )}
          </div>
        ) : (
          <table className="pf-table">
            <thead>
              <tr>
                <th className={sortClass('name')} onClick={() => toggleSort('name')}>
                  Agent <span className="sort-arrow">{sortArrow('name')}</span>
                </th>
                <th className={sortClass('tier')} onClick={() => toggleSort('tier')}>
                  Tier <span className="sort-arrow">{sortArrow('tier')}</span>
                </th>
                <th>Role</th>
                <th>Model</th>
                <th className={sortClass('status')} onClick={() => toggleSort('status')}>
                  Status <span className="sort-arrow">{sortArrow('status')}</span>
                </th>
                <th>Tags</th>
                <th className={sortClass('last_run')} onClick={() => toggleSort('last_run')}>
                  Last Used <span className="sort-arrow">{sortArrow('last_run')}</span>
                </th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((agent) => (
                <ProfileTableRow
                  key={agent.id}
                  agent={agent}
                  onOpen={() => openDetail(agent)}
                  onActivate={canActivateRow(agent) ? (n) => void handleActivate(n) : undefined}
                  onEdit={canEditRow(agent) ? (a) => handleEdit(a) : undefined}
                  onRename={canRenameRow(agent) ? (a) => openRename(a) : undefined}
                  onClone={canCloneRow(agent) ? (a) => openClone(a) : undefined}
                  onDelete={canDeleteRow(agent) ? (n) => handleDelete(n) : undefined}
                />
              ))}
              {paginated.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '48px 0', opacity: 0.4, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.18em' }}>
                    {emptyState === 'no-agents'
                      ? 'No agents yet — click "New Agent" to create one'
                      : 'No agents match these filters'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Pagination ── */}
      <ProfilePager
        total={sorted.length}
        page={page}
        onPageChange={(next) => setFilters({ page: next })}
      />

      {/* ── Detail drawer ── */}
      <ProfileDetailDrawer
        agent={detailRow}
        open={detailRow !== null}
        busy={busyName !== null}
        onClose={() => setDetailRow(null)}
        onActivate={(n) => void handleActivate(n)}
        onEdit={(a) => handleEdit(a)}
        onClone={(a) => openClone(a)}
        onDelete={(n) => handleDelete(n)}
      />

      {/* ── Recently Deleted ── */}
      <TrashPanel open={trashOpen} onClose={() => setTrashOpen(false)} />

      {/* ── Agent wizard ── */}
      <AgentWizard
        open={createOpen || editTarget !== null}
        onClose={closeWizard}
        onSuccess={handleWizardSuccess}
        editProfileName={editTarget}
        // `?step=` is honoured for an edit only. A create flow locks the step
        // rail to already-completed steps precisely because steps 1–3 hold the
        // required fields; dropping someone on step 5 of an empty draft would
        // bypass that lock and hand them a form they cannot submit and cannot
        // navigate forward from. Editing already allows free jumping, so the
        // deep link grants nothing the UI does not.
        initialStep={editTarget ? deepLinkStep : undefined}
      />

      {/* ── Rename dialog ── */}
      <Dialog
        open={Boolean(renameTarget)}
        onOpenChange={(open) => {
          if (!open) { setRenameTarget(null); setRenameValue('') }
        }}
      >
        <DialogContent className="w-[min(440px,94vw)] max-w-none p-0">
          <div className="border-b border-primary-200 px-6 pb-4 pt-5 dark:border-neutral-800">
            <DialogTitle className="text-base font-semibold">Rename agent</DialogTitle>
            <p className="mt-0.5 text-xs text-primary-500 dark:text-neutral-400">
              Renaming <span className="font-semibold">{renameTarget?.profileName ?? renameTarget?.name}</span>
            </p>
          </div>
          <div className="space-y-4 px-6 py-5">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-primary-600 dark:text-neutral-400">
                New name
              </label>
              <Input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                placeholder="new-agent-name"
                className="h-11 text-sm"
                autoFocus
              />
              {renameError && (
                <p className="text-xs text-red-500 dark:text-red-400">{renameError}</p>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-primary-200 px-6 py-3 dark:border-neutral-800">
            <Button variant="outline" size="sm" onClick={() => { setRenameTarget(null); setRenameValue('') }}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void handleRename()}
              disabled={!renameValue.trim() || renameError !== null || Boolean(busyName)}
            >
              Rename
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Clone dialog ── */}
      <Dialog
        open={Boolean(cloneTarget)}
        onOpenChange={(open) => {
          if (!open) { setCloneTarget(null); setCloneValue(''); setCloneError(null) }
        }}
      >
        <DialogContent className="w-[min(440px,94vw)] max-w-none p-0">
          <div className="border-b border-primary-200 px-6 pb-4 pt-5 dark:border-neutral-800">
            <DialogTitle className="text-base font-semibold">Clone agent</DialogTitle>
            <p className="mt-0.5 text-xs text-primary-500 dark:text-neutral-400">
              Cloning <span className="font-semibold">{cloneTarget?.name}</span>
            </p>
          </div>
          <div className="space-y-4 px-6 py-5">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-primary-600 dark:text-neutral-400">
                New name
              </label>
              <Input
                value={cloneValue}
                onChange={(e) => { setCloneValue(e.target.value); setCloneError(null) }}
                placeholder="new-agent-name"
                className="h-11 text-sm"
                autoFocus
              />
              {cloneError && (
                <p className="text-xs text-red-500 dark:text-red-400">{cloneError}</p>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-primary-200 px-6 py-3 dark:border-neutral-800">
            <Button variant="outline" size="sm" onClick={() => { setCloneTarget(null); setCloneValue(''); setCloneError(null) }}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void handleClone()}
              disabled={!cloneValue.trim() || Boolean(busyName)}
            >
              Clone
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Import name-collision dialog ── */}
      <Dialog
        open={collisionBundle !== null}
        onOpenChange={(open) => {
          if (!open) { setCollisionBundle(null); setCollisionName(''); setCollisionError(null) }
        }}
      >
        <DialogContent className="w-[min(440px,94vw)] max-w-none p-0">
          <div className="border-b border-primary-200 px-6 pb-4 pt-5 dark:border-neutral-800">
            <DialogTitle className="text-base font-semibold">Name already taken</DialogTitle>
            <p className="mt-0.5 text-xs text-primary-500 dark:text-neutral-400">
              The bundle names an agent that already exists here. Nothing has been
              overwritten — pick a different name to import it alongside.
            </p>
          </div>
          <div className="space-y-4 px-6 py-5">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-primary-600 dark:text-neutral-400">
                Import as
              </label>
              <Input
                value={collisionName}
                onChange={(e) => { setCollisionName(e.target.value); setCollisionError(null) }}
                placeholder="new-agent-name"
                className="h-11 text-sm"
                autoFocus
              />
              {collisionError && (
                <p className="text-xs text-red-500 dark:text-red-400">{collisionError}</p>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-primary-200 px-6 py-3 dark:border-neutral-800">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setCollisionBundle(null); setCollisionName(''); setCollisionError(null) }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleCollisionImport}
              disabled={!collisionName.trim() || importing}
            >
              Import
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteConfirmName !== null}
        title="Delete agent?"
        message={
          /* P-14: `deleteProfile` moves the directory to ~/.hermes/trash — it
             does not erase it. Saying "cannot be undone" was simply false. */
          `"${deleteConfirmName ?? ''}" will be moved to Recently Deleted (~/.hermes/trash). ` +
          'It stops appearing here and the gateway can no longer run it, but you can restore ' +
          'it from Recently Deleted until you delete it permanently.'
        }
        confirmLabel="Move to Recently Deleted"
        destructive
        onConfirm={() => { const n = deleteConfirmName!; setDeleteConfirmName(null); void doDelete(n) }}
        onCancel={() => setDeleteConfirmName(null)}
      />
    </div>
  )
}
