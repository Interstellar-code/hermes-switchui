import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ProfileCard } from './components/profile-card'
import { ProfileFilters } from './components/profile-filters'
import { ProfilePager } from './components/profile-pager'
import { ProfileTableRow } from './components/profile-table-row'
import { AgentWizard } from './components/agent-wizard'
import { AgentDetailDrawer } from './components/agent-detail-drawer'
import { ConfirmDialog } from './components/confirm-dialog'
import type { BuiltinAgent } from '@/lib/builtin-agents'
import type { AgentUIMetadata, ProfileSummary } from '@/server/profiles-browser'
import { BUILTIN_AGENTS } from '@/lib/builtin-agents'
import { useProfilesFilterStore, useProfilesViewStore, usePageSize } from '@/stores/profiles-screen-store'
import { Button } from '@/components/ui/button'
import { DialogContent, DialogRoot, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
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
  tags: Array<string>
  status: 'active' | 'idle' | 'draft'
  last_run: number | null
  builtin: boolean
  profileName?: string
  active?: boolean
}

type SortKey = 'name' | 'tier' | 'last_run' | 'status'

// ── Helper: derive AgentRow from ProfileSummary ──────────────────────────────
function profileToRow(p: ProfileSummary): AgentRow {
  const ui: AgentUIMetadata = p.agent_ui ?? {}
  const glyph = ui.glyph ?? p.name.slice(0, 2).toUpperCase()
  const role = ui.role ?? p.description ?? '—'
  const description = p.description ?? ''
  const tags = ui.tags ?? []
  const status: AgentRow['status'] = ui.status ?? 'idle'
  const last_run = ui.last_run ?? null
  return {
    id: `profile:${p.name}`,
    name: p.name,
    tier: 3,
    glyph,
    role,
    description,
    model: p.model,
    tags,
    status,
    last_run,
    builtin: false,
    profileName: p.name,
    active: p.active,
  }
}

function builtinToRow(b: BuiltinAgent): AgentRow {
  return {
    id: `builtin:${b.id}`,
    name: b.name,
    tier: b.tier,
    glyph: b.glyph,
    role: b.role,
    description: b.description,
    tags: b.tags,
    status: b.status,
    last_run: null,
    builtin: true,
  }
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `Request failed (${response.status})`)
  }
  return (await response.json()) as T
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

// ── Debounce hook ────────────────────────────────────────────────────────────
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return debounced
}

// ── Main screen ───────────────────────────────────────────────────────────────
export function ProfilesScreen() {
  const queryClient = useQueryClient()
  const { search, tierFilter, statusFilter, modelFilter, tagFilter, page } =
    useProfilesFilterStore()
  const { viewMode } = useProfilesViewStore()
  const pageSize = usePageSize()
  const debouncedSearch = useDebounced(search, 150)

  const [sortKey, setSortKey] = useState<SortKey>('tier')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [renameTarget, setRenameTarget] = useState<AgentRow | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [busyName, setBusyName] = useState<string | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [drawerAgent, setDrawerAgent] = useState<AgentRow | null>(null)
  const [deleteConfirmName, setDeleteConfirmName] = useState<string | null>(null)
  const newProfileRef = useRef<string | null>(null)

  const profilesQuery = useQuery({
    queryKey: ['profiles', 'list'],
    queryFn: () =>
      readJson<{ profiles: Array<ProfileSummary>; activeProfile: string }>(
        '/api/profiles/list',
      ),
  })

  const profiles = profilesQuery.data?.profiles ?? []

  const allRows = useMemo<Array<AgentRow>>(() => {
    const builtins = BUILTIN_AGENTS.map(builtinToRow)
    const user = profiles.map(profileToRow)
    return [...builtins, ...user]
  }, [profiles])

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
    const q = debouncedSearch.toLowerCase()
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
  }, [allRows, debouncedSearch, tierFilter, statusFilter, modelFilter, tagFilter])

  const sorted = useMemo<Array<AgentRow>>(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'name') cmp = a.name.localeCompare(b.name)
      else if (sortKey === 'tier') cmp = a.tier - b.tier
      else if (sortKey === 'status') cmp = a.status.localeCompare(b.status)
      else cmp = (a.last_run ?? 0) - (b.last_run ?? 0)
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
      toast(`Deleted agent ${profileName}`, { type: 'success' })
      await refreshProfiles()
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Failed to delete', { type: 'error' })
    } finally {
      setBusyName(null)
    }
  }

  async function handleRename() {
    if (!renameTarget?.profileName || !renameValue.trim()) return
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

  function handleCardClick(agent: AgentRow) {
    setDrawerAgent(agent)
  }

  function handleNewAgent() {
    setWizardOpen(true)
  }

  function handleWizardSuccess(profileName: string) {
    newProfileRef.current = profileName
    toast(`Agent "${profileName}" created`, { type: 'success' })
    void refreshProfiles().then(() => {
      // Scroll new card/row into view + highlight after refetch resolves
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
        <button type="button" className="btn-new-agent" onClick={handleNewAgent}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          New Agent
        </button>
      </div>

      {/* ── Filter bar ── */}
      <ProfileFilters models={allModels} tags={allTags} />

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
          <div className="pf-grid">
            {paginated.map((agent) => (
              <ProfileCard
                key={agent.id}
                agent={agent}
                onClick={() => handleCardClick(agent)}
                data-profile={agent.profileName}
              />
            ))}
            {paginated.length === 0 && (
              allRows.filter((r) => r.tier === 3).length === 0 ? (
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
                  Last Run <span className="sort-arrow">{sortArrow('last_run')}</span>
                </th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((agent) => (
                <ProfileTableRow
                  key={agent.id}
                  agent={agent}
                  onClick={() => handleCardClick(agent)}
                  onActivate={(profileName) => void handleActivate(profileName)}
                  onRename={(a) => { setRenameTarget(a); setRenameValue(a.name) }}
                  onDelete={(profileName) => void handleDelete(profileName)}
                />
              ))}
              {paginated.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '48px 0', opacity: 0.4, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.18em' }}>
                    {allRows.filter((r) => r.tier === 3).length === 0
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
      <ProfilePager total={sorted.length} />

      {/* ── Agent wizard ── */}
      <AgentWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onSuccess={handleWizardSuccess}
      />

      {/* ── Agent detail drawer ── */}
      <AgentDetailDrawer
        agent={drawerAgent}
        open={!!drawerAgent}
        onClose={() => setDrawerAgent(null)}
        onRename={(agent) => {
          setDrawerAgent(null)
          setRenameTarget(agent)
          setRenameValue(agent.name)
        }}
        onDelete={(profileName) => {
          setDrawerAgent(null)
          void handleDelete(profileName)
        }}
        onActivate={(profileName) => {
          setDrawerAgent(null)
          void handleActivate(profileName)
        }}
      />

      {/* ── Rename dialog ── */}
      <DialogRoot
        open={Boolean(renameTarget)}
        onOpenChange={(open) => {
          if (!open) { setRenameTarget(null); setRenameValue('') }
        }}
      >
        <DialogContent className="w-[min(440px,94vw)] max-w-none p-0">
          <div className="border-b border-primary-200 px-6 pb-4 pt-5 dark:border-neutral-800">
            <DialogTitle className="text-base font-semibold">Rename agent</DialogTitle>
            <p className="mt-0.5 text-xs text-primary-500 dark:text-neutral-400">
              Renaming <span className="font-semibold">{renameTarget?.name}</span>
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
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-primary-200 px-6 py-3 dark:border-neutral-800">
            <Button variant="outline" size="sm" onClick={() => { setRenameTarget(null); setRenameValue('') }}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void handleRename()}
              disabled={
                !renameValue.trim() ||
                !/^[A-Za-z0-9_-]+$/.test(renameValue.trim()) ||
                Boolean(busyName)
              }
            >
              Rename
            </Button>
          </div>
        </DialogContent>
      </DialogRoot>

      <ConfirmDialog
        open={deleteConfirmName !== null}
        title="Delete agent?"
        message="Move profile to ~/.hermes/trash? This can be restored manually but won't appear in the UI."
        confirmLabel="Delete"
        destructive
        onConfirm={() => { const n = deleteConfirmName!; setDeleteConfirmName(null); void doDelete(n) }}
        onCancel={() => setDeleteConfirmName(null)}
      />
    </div>
  )
}
