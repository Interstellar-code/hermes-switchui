import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import {
  useBoards,
  useCreateBoard,
  useDeleteBoard,
  useSwitchBoard,
  useUpdateBoard,
} from '@/lib/boards-api'
import type { BoardMeta } from '@/lib/hermes-kanban-types'
import { toast } from '@/components/ui/toast'
import '@/styles/matrix-boards.css'

type FilterMode = 'all' | 'active' | 'archived'
type ViewMode = 'grid' | 'list'
type DrawerTab = 'overview' | 'settings'

type WizardState = {
  step: 1 | 2
  name: string
  slug: string
  desc: string
  color: string
}

const COLORS = ['#00ff41', '#5ad3ff', '#ffb454', '#b07cff', '#ff5fa2', '#d6ff5f']
const VIEW_KEY = 'hermes.boards.view'
const WIZARD_INIT: WizardState = {
  step: 1,
  name: '',
  slug: '',
  desc: '',
  color: COLORS[0],
}

function readInitialView(): ViewMode {
  if (typeof window === 'undefined') return 'list'
  const stored = window.localStorage.getItem(VIEW_KEY)
  return stored === 'grid' || stored === 'list' ? stored : 'list'
}

function totalTasks(board: BoardMeta): number {
  return board.total ?? Object.values(board.counts ?? {}).reduce((a, v) => a + v, 0)
}

function glyph(name = '?'): string {
  return (name.split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '??').slice(0, 2)
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
}

function relativeTime(timestamp: number | null): string {
  if (!timestamp) return '—'
  const deltaMs = Date.now() - timestamp * 1000
  const minutes = Math.floor(deltaMs / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

function formatDate(timestamp: number | null): string {
  if (!timestamp) return '—'
  return new Date(timestamp * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function resolvePath(board: BoardMeta): string {
  return board.db_path ?? '—'
}

function countFor(board: BoardMeta, names: string[]): number {
  const counts = board.counts ?? {}
  return names.reduce((sum, name) => sum + (counts[name] ?? 0), 0)
}

function statusPill(board: BoardMeta) {
  if (board.archived) return 'archived'
  if (board.is_current) return 'current'
  return 'active'
}

function SearchInput({ value, onChange, placeholder = 'Search…' }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <div className="brd-search-wrap">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>
      <input className="brd-search-inp" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  )
}

function StatusPill({ board }: { board: BoardMeta }) {
  const label = statusPill(board)
  return (
    <span className={`status-pill ${label}`}>
      <span className="d" />
      {label}
    </span>
  )
}

function BoardCard({ board, onOpen, onDelete }: { board: BoardMeta; onOpen: (board: BoardMeta) => void; onDelete: (board: BoardMeta) => void }) {
  const stats = {
    backlog: countFor(board, ['triage', 'backlog']),
    todo: countFor(board, ['todo']),
    running: countFor(board, ['ready', 'running']),
    blocked: countFor(board, ['blocked']),
    done: countFor(board, ['done']),
  }
  return (
    <div className={`brd-card ${board.archived ? 'archived' : ''}`} style={{ ['--bc' as string]: board.color || COLORS[0] }}>
      <div className="bc-head">
        <div className="bc-glyph">{glyph(board.name)}</div>
        <div className="bc-info">
          <div className="bc-name">{board.name}</div>
          <div className="bc-type">{board.slug}</div>
        </div>
        <div className="bc-right"><StatusPill board={board} /></div>
      </div>

      <div className="bc-path">{resolvePath(board)}</div>
      {board.description ? <div className="bc-desc">{board.description}</div> : null}

      <div className="bc-stats">
        {[
          ['Backlog', stats.backlog, ''],
          ['Todo', stats.todo, ''],
          ['Running', stats.running, ' run'],
          ['Blocked', stats.blocked, ' bl'],
          ['Done', stats.done, ' ok'],
        ].map(([label, value, cls]) => (
          <div key={label} className="bc-stat">
            <span className={`bsv${cls}`}>{value}</span>
            <span className="bsl">{label}</span>
          </div>
        ))}
      </div>

      <div className="bc-foot">
        <div className="bc-agents"><span>{board.color || 'no color'}</span></div>
        <span className="bc-time">{relativeTime(board.created_at)}</span>
        <div className="bc-acts">
          <button className="btn-mini" onClick={() => onOpen(board)}>Open</button>
          <button className="btn-mini danger" onClick={() => onDelete(board)} disabled={board.slug === 'default'}>Delete</button>
        </div>
      </div>
    </div>
  )
}

function BoardRow({ board, onOpen, onDelete }: { board: BoardMeta; onOpen: (board: BoardMeta) => void; onDelete: (board: BoardMeta) => void }) {
  return (
    <tr style={{ ['--bc' as string]: board.color || COLORS[0] }} onClick={() => onOpen(board)}>
      <td>
        <div className="tbl-name-cell">
          <div className="tbl-glyph">{glyph(board.name)}</div>
          <div>
            <div className="tbl-nm">{board.name}</div>
            <div className="tbl-tp">{board.slug}</div>
          </div>
        </div>
      </td>
      <td className="tbl-path-cell">{resolvePath(board)}</td>
      <td>{totalTasks(board)}</td>
      <td><StatusPill board={board} /></td>
      <td className="tbl-time">{relativeTime(board.created_at)}</td>
      <td onClick={(e) => e.stopPropagation()}>
        <div className="tbl-acts">
          <button className="btn-mini" onClick={() => onOpen(board)}>Open</button>
          <button className="btn-mini danger" onClick={() => onDelete(board)} disabled={board.slug === 'default'}>Delete</button>
        </div>
      </td>
    </tr>
  )
}

function MainTop({ allBoards, search, setSearch, filter, setFilter, view, setView, onNew }: { allBoards: BoardMeta[]; search: string; setSearch: (value: string) => void; filter: FilterMode; setFilter: (value: FilterMode) => void; view: ViewMode; setView: (value: ViewMode) => void; onNew: () => void }) {
  const activeCount = allBoards.filter((b) => !b.archived).length
  const archivedCount = allBoards.filter((b) => b.archived).length
  const allTasks = allBoards.reduce((a, b) => a + totalTasks(b), 0)
  return (
    <>
      <div className="brd-top">
        <div>
          <div className="crumbs">Workspace<span className="sep">/</span>Tasks<span className="sep">/</span><span className="cur">Boards</span></div>
          <h1>Boards</h1>
          <div className="top-sub">Hermes boards using only backend-supported fields.</div>
        </div>
        <div className="top-right">
          <div className="top-stat"><b>{allBoards.length}</b>Boards</div>
          <div className="top-stat"><b>{activeCount}</b>Active</div>
          <div className="top-stat"><b>{allTasks}</b>Tasks</div>
          <button className="btn-prim" onClick={onNew}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><path d="M12 5v14M5 12h14" /></svg>
            New Board
          </button>
        </div>
      </div>
      <div className="brd-toolbar">
        <div className="tb-filters">
          <button className={`tb-filter-btn${filter === 'all' ? ' on' : ''}`} onClick={() => setFilter('all')}>All <span className="tb-ct">{allBoards.length}</span></button>
          <button className={`tb-filter-btn${filter === 'active' ? ' on' : ''}`} onClick={() => setFilter('active')}>Active <span className="tb-ct">{activeCount}</span></button>
          <button className={`tb-filter-btn${filter === 'archived' ? ' on' : ''}`} onClick={() => setFilter('archived')}>Archived <span className="tb-ct">{archivedCount}</span></button>
        </div>
        <div className="tb-grow"><SearchInput value={search} onChange={setSearch} placeholder="Search boards…" /></div>
        <div className="view-toggle">
          <button className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')}>Grid</button>
          <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>List</button>
        </div>
      </div>
    </>
  )
}

function BoardsCanvas({ boards, view, onOpen, onDelete }: { boards: BoardMeta[]; view: ViewMode; onOpen: (board: BoardMeta) => void; onDelete: (board: BoardMeta) => void }) {
  if (boards.length === 0) {
    return <div className="brd-canvas"><div className="empty-state"><div className="es-title">No boards found</div><div className="es-sub">Create a board with supported backend fields only.</div></div></div>
  }
  if (view === 'list') {
    return (
      <div className="brd-canvas">
        <table className="brd-table">
          <thead><tr><th>Name</th><th>Database Path</th><th>Tasks</th><th>Status</th><th>Last Activity</th><th>Actions</th></tr></thead>
          <tbody>{boards.map((b) => <BoardRow key={b.slug} board={b} onOpen={onOpen} onDelete={onDelete} />)}</tbody>
        </table>
      </div>
    )
  }
  return <div className="brd-canvas"><div className={`brd-grid${boards.length === 1 ? ' single' : ''}`}>{boards.map((b) => <BoardCard key={b.slug} board={b} onOpen={onOpen} onDelete={onDelete} />)}</div></div>
}

function BoardDrawer({ board, onClose, onDelete, onUpdate }: { board: BoardMeta; onClose: () => void; onDelete: (board: BoardMeta) => void; onUpdate: (input: { name?: string; description?: string; color?: string }) => Promise<void> }) {
  const navigate = useNavigate()
  const switchMutation = useSwitchBoard()
  const [tab, setTab] = useState<DrawerTab>('overview')
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(board.name)
  const [editDesc, setEditDesc] = useState(board.description)
  const [editColor, setEditColor] = useState(board.color || COLORS[0])
  const stats = {
    backlog: countFor(board, ['triage', 'backlog']),
    todo: countFor(board, ['todo']),
    running: countFor(board, ['ready', 'running']),
    blocked: countFor(board, ['blocked']),
    done: countFor(board, ['done']),
  }

  useEffect(() => {
    setTab('overview')
    setEditing(false)
    setEditName(board.name)
    setEditDesc(board.description)
    setEditColor(board.color || COLORS[0])
  }, [board.slug, board.name, board.description, board.color])

  async function saveEdit() {
    await onUpdate({ name: editName.trim(), description: editDesc.trim(), color: editColor })
    setEditing(false)
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="drawer" role="dialog" aria-label={board.name}>
        <div className="dr-head">
          <div className="dr-title-row">
            <div className="dr-glyph" style={{ ['--bc' as string]: board.color || COLORS[0] }}>{glyph(board.name)}</div>
            <div>
              <h2>{board.name}</h2>
              <div className="dr-meta"><span>{board.slug}</span><span>{board.archived ? 'archived' : board.is_current ? 'current' : 'active'}</span><span>Created {formatDate(board.created_at)}</span></div>
            </div>
          </div>
          <div className="dr-acts">
            {board.slug !== 'default' ? (
              <button className="btn-mini danger" onClick={() => onDelete(board)}>Delete</button>
            ) : null}
            <button className="ico-btn" onClick={onClose} aria-label="Close">×</button>
          </div>
        </div>
        <div className="dr-tabs">
          {(['overview', 'settings'] as const).map((nextTab) => <button key={nextTab} className={tab === nextTab ? 'on' : ''} onClick={() => setTab(nextTab)}>{nextTab.charAt(0).toUpperCase() + nextTab.slice(1)}</button>)}
        </div>
        <div className="dr-body">
          {tab === 'overview' && (
            <>
              <div className="dr-stat-row">
                {[['Total', totalTasks(board), ''], ['Running', stats.running, '#ffb454'], ['Done', stats.done, '#00ff41'], ['Blocked', stats.blocked, '#ff5fa2']].map(([label, value, color]) => (
                  <div key={label} className="dr-stat-card"><div className="dsc-lbl">{label}</div><b style={color ? { color: String(color), textShadow: `0 0 8px ${String(color)}60` } : undefined}>{value}</b></div>
                ))}
              </div>
              <div className="panel-card">
                <div className="pc-head">Task Breakdown</div>
                <div className="pc-body"><div className="task-breakdown">{[['Backlog', stats.backlog, '#b07cff'], ['Todo', stats.todo, '#5ad3ff'], ['Running', stats.running, '#ffb454'], ['Blocked', stats.blocked, '#ff5fa2'], ['Done', stats.done, '#00ff41']].map(([label, value, color]) => <div key={label} className="tbk-cell"><div className="tbk-v" style={{ color: String(color), textShadow: `0 0 8px ${String(color)}60` }}>{value}</div><div className="tbk-l">{label}</div></div>)}</div></div>
              </div>
              <div className="panel-card">
                <div className="pc-head">Board Metadata</div>
                <div className="pc-body ws-grid">
                  <div className="ws-lbl">Slug</div><div className="ws-val">{board.slug}</div>
                  <div className="ws-lbl">Database Path</div><div className="ws-val path">{resolvePath(board)}</div>
                  <div className="ws-lbl">Color</div><div className="ws-val">{board.color || '—'}</div>
                  <div className="ws-lbl">Archived</div><div className="ws-val">{board.archived ? 'Yes' : 'No'}</div>
                </div>
              </div>
              {board.description ? <div className="panel-card"><div className="pc-head">Description</div><div className="pc-body description-copy">{board.description}</div></div> : null}
            </>
          )}
          {tab === 'settings' && (
            <>
              <div className="panel-card">
                <div className="pc-head">Board Details<div className="pc-head-right"><button className="btn-mini" onClick={() => setEditing((v) => !v)}>{editing ? 'Cancel' : 'Edit'}</button></div></div>
                <div className="pc-body settings-grid">
                  <div className="form-row"><label>Name</label>{editing ? <input className="form-inp" value={editName} onChange={(e) => setEditName(e.target.value)} /> : <div className="field-val">{board.name}</div>}</div>
                  <div className="form-row"><label>Description</label>{editing ? <textarea className="form-ta" value={editDesc} onChange={(e) => setEditDesc(e.target.value)} /> : <div className="field-val muted">{board.description || '—'}</div>}</div>
                  <div className="form-row"><label>Color</label>{editing ? <div className="color-swatches">{COLORS.map((color) => <div key={color} className={`color-swatch${editColor === color ? ' sel' : ''}`} style={{ background: color, boxShadow: `0 0 8px ${color}60`, ['--sw' as string]: color }} onClick={() => setEditColor(color)} />)}</div> : <div className="field-val">{board.color || '—'}</div>}</div>
                </div>
              </div>
              {editing ? <div className="settings-save-row"><button className="btn-mini" onClick={() => setEditing(false)}>Cancel</button><button className="btn-mini prim" onClick={() => void saveEdit()}>Save Changes</button></div> : null}
            </>
          )}
        </div>
        <div className="dr-foot">
          <span className="dr-foot-time">Last activity: {relativeTime(board.created_at)}</span>
          <div className="dr-foot-acts">
            <button className="btn-mini" onClick={onClose}>Close</button>
            <button className="btn-mini prim" onClick={async () => { try { await switchMutation.mutateAsync(board.slug); await navigate({ to: '/tasks' }) } catch (error) { toast(error instanceof Error ? error.message : 'Failed to open board', { type: 'error' }) } }}>Open Board</button>
          </div>
        </div>
      </div>
    </>
  )
}

function CreateWizard({ state, onChange, onClose, onCreate, creating }: { state: WizardState; onChange: (next: WizardState) => void; onClose: () => void; onCreate: () => Promise<void>; creating: boolean }) {
  const steps = ['Identity', 'Review']
  const cur = state.step

  function set<K extends keyof WizardState>(key: K, value: WizardState[K]) {
    onChange({ ...state, [key]: value })
  }

  function onNameChange(value: string) {
    const nextSlug = slugify(value)
    onChange({ ...state, name: value, slug: nextSlug })
  }

  const canNext = [state.name.trim().length >= 2 && state.slug.trim().length >= 1, true]

  return (
    <div className="wizard-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="wizard-modal">
        <div className="wz-head">
          <div className="wz-icon">▥</div>
          <div><h2>New Board</h2><div className="wz-sub">Step {cur} of {steps.length} — {steps[cur - 1]}</div></div>
          <button className="wz-close" onClick={onClose}>×</button>
        </div>
        <div className="wz-steps">
          <div className="wz-steps-line" />
          {steps.map((label, index) => {
            const n = index + 1
            const cls = n < cur ? 'done' : n === cur ? 'cur' : ''
            return <div key={n} className={`wz-step ${cls}`}><div className="wz-dot">{n < cur ? '✓' : n}</div><div className="wz-lbl">{label}</div></div>
          })}
        </div>
        <div className="wz-body">
          {cur === 1 ? (
            <>
              <div className="form-row"><label>Board Name <span className="req">*</span></label><input className="form-inp" autoFocus placeholder="e.g. GTW#34 Integration" value={state.name} onChange={(e) => onNameChange(e.target.value)} /><span className="form-hint">Minimum 2 characters.</span></div>
              <div className="form-row"><label>Slug <span className="req">*</span></label><input className="form-inp" value={state.slug} onChange={(e) => set('slug', slugify(e.target.value))} /><span className="form-hint">Backend-required identifier.</span></div>
              <div className="form-row"><label>Description</label><textarea className="form-ta" placeholder="What will agents be working on in this board?" value={state.desc} onChange={(e) => set('desc', e.target.value)} /></div>
              <div className="form-row"><label>Accent Color</label><div className="color-swatches">{COLORS.map((color) => <div key={color} className={`color-swatch${state.color === color ? ' sel' : ''}`} style={{ background: color, boxShadow: `0 0 8px ${color}60`, ['--sw' as string]: color }} onClick={() => set('color', color)} />)}</div></div>
            </>
          ) : (
            <>
              <p className="wz-p">Review the backend-supported fields before creating the board.</p>
              <div className="review-header"><div className="rh-glyph" style={{ borderColor: state.color, color: state.color, boxShadow: `0 0 14px ${state.color}60` }}>{glyph(state.name || '?')}</div><div><div className="rh-name">{state.name || <span className="ghost">Unnamed Board</span>}</div><div className="rh-type">{state.slug || 'slug-pending'}</div></div><span className="status-pill active"><span className="d" />active</span></div>
              <div className="review-block">{[['Description', state.desc || '—', ''], ['Slug', state.slug || '—', 'path'], ['Color', state.color, 'color']].map(([k, v, mod]) => <div key={k} className="rb-row"><span className="rb-k">{k}</span><span className={`rb-v${mod ? ` ${mod}` : ''}`}>{mod === 'color' ? <><span className="rb-dot" style={{ background: String(v), boxShadow: `0 0 6px ${String(v)}` }} />{v}</> : v}</span></div>)}</div>
            </>
          )}
        </div>
        <div className="wz-foot">
          <span className="wz-foot-step">Step {cur} / {steps.length}</span>
          <div className="wz-nav">
            {cur > 1 ? <button className="btn-mini" onClick={() => onChange({ ...state, step: 1 })}>← Back</button> : null}
            {cur < 2 ? <button className="btn-mini prim" disabled={!canNext[cur - 1]} style={{ opacity: canNext[cur - 1] ? 1 : 0.45 }} onClick={() => onChange({ ...state, step: 2 })}>Next →</button> : null}
            {cur === 2 ? <button className="btn-mini prim" disabled={creating} onClick={() => void onCreate()}>{creating ? 'Creating…' : 'Create Board'}</button> : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function DeleteConfirm({ board, onCancel, onConfirm, deleting }: { board: BoardMeta; onCancel: () => void; onConfirm: () => Promise<void>; deleting: boolean }) {
  return (
    <div className="confirm-scrim">
      <div className="confirm-box">
        <h3>Delete Board</h3>
        <p>Are you sure you want to permanently delete <span className="conf-name">{board.name}</span>? This cannot be undone.</p>
        <div className="conf-acts"><button className="btn-mini" onClick={onCancel}>Cancel</button><button className="btn-mini danger" disabled={deleting} onClick={() => void onConfirm()}>Delete Board</button></div>
      </div>
    </div>
  )
}

export function BoardsScreen() {
  usePageTitle('Boards')
  const boardsQuery = useBoards(true)
  const createMutation = useCreateBoard()
  const updateMutation = useUpdateBoard()
  const deleteMutation = useDeleteBoard()
  const [view, setView] = useState<ViewMode>(readInitialView)
  const [filter, setFilter] = useState<FilterMode>('all')
  const [search, setSearch] = useState('')
  const [activeSlug, setActiveSlug] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<BoardMeta | null>(null)
  const [wizard, setWizard] = useState<WizardState | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem(VIEW_KEY, view)
  }, [view])

  useEffect(() => {
    const hideUpdateCards = () => {
      document.querySelectorAll('div').forEach((node) => {
        const el = node as HTMLElement
        const cls = typeof el.className === 'string' ? el.className : ''
        const text = el.textContent?.toLowerCase() ?? ''
        if (cls.includes('z-[9998]') && text.includes('update available')) el.style.display = 'none'
      })
    }
    hideUpdateCards()
    const id = window.setInterval(hideUpdateCards, 1000)
    return () => window.clearInterval(id)
  }, [])

  const boards = boardsQuery.data?.boards ?? []
  const filtered = useMemo(() => boards.filter((b) => {
    if (filter !== 'all' && (b.archived ? 'archived' : 'active') !== filter) return false
    if (search && !`${b.name} ${b.slug} ${b.description}`.toLowerCase().includes(search.toLowerCase())) return false
    return true
  }), [boards, filter, search])
  const activeBoard = activeSlug ? boards.find((b) => b.slug === activeSlug) ?? null : null

  if (boardsQuery.isLoading) return <div className="brd-loading">Loading boards…</div>
  if (boardsQuery.isError) return <div className="brd-error">{boardsQuery.error instanceof Error ? boardsQuery.error.message : 'Boards unavailable'}</div>

  return (
    <div data-screen="boards" className="boards-screen-root">
      <div className="brd-main">
        <MainTop allBoards={boards} search={search} setSearch={setSearch} filter={filter} setFilter={setFilter} view={view} setView={setView} onNew={() => setWizard({ ...WIZARD_INIT })} />
        <BoardsCanvas boards={filtered} view={view} onOpen={(board) => setActiveSlug(board.slug)} onDelete={setConfirmDelete} />
      </div>

      {activeBoard ? <BoardDrawer board={activeBoard} onClose={() => setActiveSlug(null)} onDelete={(board) => setConfirmDelete(board)} onUpdate={async (input) => { try { await updateMutation.mutateAsync({ slug: activeBoard.slug, input }); toast(`Updated ${input.name || activeBoard.name}`, { type: 'success' }) } catch (error) { toast(error instanceof Error ? error.message : 'Failed to update board', { type: 'error' }) } }} /> : null}

      {wizard ? <CreateWizard state={wizard} onChange={setWizard} onClose={() => setWizard(null)} creating={createMutation.isPending} onCreate={async () => { try { await createMutation.mutateAsync({ slug: wizard.slug || slugify(wizard.name), name: wizard.name.trim(), description: wizard.desc.trim() || undefined, color: wizard.color }); toast(`Board \"${wizard.name.trim()}\" created`, { type: 'success' }); setWizard(null) } catch (error) { toast(error instanceof Error ? error.message : 'Failed to create board', { type: 'error' }) } }} /> : null}

      {confirmDelete ? <DeleteConfirm board={confirmDelete} deleting={deleteMutation.isPending} onCancel={() => setConfirmDelete(null)} onConfirm={async () => { try { await deleteMutation.mutateAsync({ slug: confirmDelete.slug, hardDelete: true }); toast(`Deleted ${confirmDelete.name}`, { type: 'success' }); setConfirmDelete(null); if (activeSlug === confirmDelete.slug) setActiveSlug(null) } catch (error) { toast(error instanceof Error ? error.message : 'Failed to delete board', { type: 'error' }) } }} /> : null}
    </div>
  )
}
