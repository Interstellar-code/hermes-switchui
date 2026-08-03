import { useMemo, useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import type {
  Project,
  ProjectFolder,
  UpdateProjectInput,
} from '@/lib/projects-types'
import { useAgentProfiles } from '@/hooks/use-agent-profiles'
import { usePageTitle } from '@/hooks/use-page-title'
import {
  useAddProjectFolder,
  useArchiveProject,
  useCreateProject,
  useDeleteProject,
  useProjectActivity,
  useProjectFolders,
  useProjects,
  useRemoveProjectFolder,
  useRestoreProject,
  useSetActiveProject,
  useSetPrimaryProjectFolder,
  useUpdateProject,
} from '@/lib/projects-api'
import { useBoards } from '@/lib/boards-api'
import '@/styles/matrix-boards.css'

type FilterMode = 'all' | 'active' | 'archived'
type ViewMode = 'grid' | 'list'

const COLORS = [
  '#00ff41',
  '#5ad3ff',
  '#ffb454',
  '#b07cff',
  '#ff5fa2',
  '#d6ff5f',
]
const VIEW_KEY = 'hermes.projects.view'

function readInitialView(): ViewMode {
  if (typeof window === 'undefined') return 'list'
  const stored = window.localStorage.getItem(VIEW_KEY)
  return stored === 'grid' || stored === 'list' ? stored : 'list'
}

function glyph(project: Project): string {
  if (project.icon) return project.icon.slice(0, 2)
  const name = project.name || '?'
  return (
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0] || '')
      .join('')
      .toUpperCase() || '??'
  ).slice(0, 2)
}

function basename(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() || path
}

function folderLabel(folder: ProjectFolder): string {
  return folder.label ?? basename(folder.path)
}

function formatDate(timestamp: number | null): string {
  if (!timestamp) return '—'
  return new Date(timestamp * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// Copied from boards-screen.tsx — backend-required slug from a display name.
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

// Copied from boards-screen.tsx — epoch-seconds → "5 min ago" / "—".
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

// Defensive read: v2 fields are typed required, but a stale v1 dashboard can
// omit them — distrust the type at the render boundary so a missing number/flag
// renders a default instead of crashing the page. (0 and false are valid, so
// `??` semantics are required here, not `||`.)
function orElse<T>(value: T | null | undefined, fallback: T): T {
  return value ?? fallback
}

export function promptProjectEdit(
  project: Project,
  prompt: typeof window.prompt,
) {
  const name = prompt('Project name', project.name)?.trim()
  if (!name) return null
  const board_slug = prompt(
    'Board slug (leave blank to clear)',
    project.board_slug ?? '',
  )
  return board_slug === null ? null : { name, board_slug }
}

export function confirmProjectDelete(
  project: Project,
  confirm: typeof window.confirm,
): boolean {
  return (
    project.archived &&
    confirm(`Delete ${project.name}? This cannot be undone.`) &&
    confirm('Confirm permanent deletion.')
  )
}

const DRAWER_TABS = ['overview', 'folders', 'activity'] as const
type DrawerTab = (typeof DRAWER_TABS)[number]
const TAB_LABELS: Record<DrawerTab, string> = {
  overview: 'Overview',
  folders: 'Folders',
  activity: 'Activity',
}

function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <div className="brd-search-wrap">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>
      <input
        className="brd-search-inp"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  )
}

function StatusPill({
  project,
  isActive,
}: {
  project: Project
  isActive: boolean
}) {
  // Prefer server-truth is_active; fall back to the prop for stale/v1 payloads.
  const active = orElse(project.is_active, isActive)
  const label = project.archived ? 'archived' : active ? 'active' : 'idle'
  return (
    <span className={`status-pill ${label}`}>
      <span className="d" />
      {label}
    </span>
  )
}

function BoundBoardChip({ project }: { project: Project }) {
  const navigate = useNavigate()
  const bound = project.bound_board ?? null
  if (!bound) {
    return project.board_slug ? (
      <span className="bsl">{project.board_slug}</span>
    ) : null
  }
  return (
    <button
      className="bound-board-chip"
      onClick={(e) => {
        e.stopPropagation()
        navigate({ to: '/boards' })
      }}
    >
      <span className="d" style={{ background: bound.color || COLORS[0] }} />
      {bound.name || project.board_slug || '—'}
    </button>
  )
}

export function ProjectCard({
  project,
  isActive,
  onOpen,
}: {
  project: Project
  isActive: boolean
  onOpen: (project: Project) => void
}) {
  return (
    <div
      className={`brd-card ${project.archived ? 'archived' : ''}`}
      style={{ ['--bc' as string]: project.color || COLORS[0] }}
      onClick={() => onOpen(project)}
    >
      <div className="bc-head">
        <div className="bc-glyph">{glyph(project)}</div>
        <div className="bc-info">
          <div className="bc-name">{project.name}</div>
          <div className="bc-type">{project.slug}</div>
        </div>
        <div className="bc-right">
          <StatusPill project={project} isActive={isActive} />
        </div>
      </div>

      <div className="bc-path">{project.primary_path ?? '—'}</div>
      {project.description ? (
        <div className="bc-desc">{project.description}</div>
      ) : null}

      <div className="bc-stats">
        <div className="bc-stat">
          <span className="bsv">
            {orElse(project.folder_count, project.folders.length)}
          </span>
          <span className="bsl">Folders</span>
        </div>
        <div className="bc-stat">
          <span className="bsv">{orElse(project.task_count, 0)}</span>
          <span className="bsl">{orElse(project.open_task_count, 0)} open</span>
        </div>
      </div>

      <div className="bc-foot">
        <BoundBoardChip project={project} />
        <span className="bc-time">
          Last active {relativeTime(project.last_activity_at)}
        </span>
        <div className="bc-acts">
          <button className="btn-mini" onClick={() => onOpen(project)}>
            Open
          </button>
        </div>
      </div>
    </div>
  )
}

function ProjectRow({
  project,
  isActive,
  onOpen,
}: {
  project: Project
  isActive: boolean
  onOpen: (project: Project) => void
}) {
  return (
    <tr
      style={{ ['--bc' as string]: project.color || COLORS[0] }}
      onClick={() => onOpen(project)}
    >
      <td>
        <div className="tbl-name-cell">
          <div className="tbl-glyph">{glyph(project)}</div>
          <div>
            <div className="tbl-nm">{project.name}</div>
            <div className="tbl-tp">{project.slug}</div>
          </div>
        </div>
      </td>
      <td className="tbl-path-cell">{project.primary_path ?? '—'}</td>
      <td>{orElse(project.folder_count, project.folders.length)}</td>
      <td>
        {orElse(project.task_count, 0)} · {orElse(project.open_task_count, 0)}{' '}
        open
      </td>
      <td onClick={(e) => e.stopPropagation()}>
        <BoundBoardChip project={project} />
      </td>
      <td>
        <StatusPill project={project} isActive={isActive} />
      </td>
      <td className="tbl-time">{relativeTime(project.last_activity_at)}</td>
      <td onClick={(e) => e.stopPropagation()}>
        <div className="tbl-acts">
          <button className="btn-mini" onClick={() => onOpen(project)}>
            Open
          </button>
        </div>
      </td>
    </tr>
  )
}

export function MainTop({
  allProjects,
  search,
  setSearch,
  filter,
  setFilter,
  view,
  setView,
  showArchived,
  setShowArchived,
  onCreate,
  busy,
  profiles,
  selectedProfile,
  onProfileChange,
}: {
  allProjects: Array<Project>
  search: string
  setSearch: (value: string) => void
  filter: FilterMode
  setFilter: (value: FilterMode) => void
  view: ViewMode
  setView: (value: ViewMode) => void
  showArchived: boolean
  setShowArchived: (value: boolean) => void
  onCreate: () => void
  busy: boolean
  profiles?: Array<string>
  selectedProfile?: string
  onProfileChange?: (profile: string) => void
}) {
  const activeCount = allProjects.filter((p) => !p.archived).length
  const archivedCount = allProjects.filter((p) => p.archived).length
  return (
    <>
      <div className="brd-top">
        <div>
          <div className="crumbs">
            Workspace<span className="sep">/</span>
            <span className="cur">Projects</span>
          </div>
          <h1>Projects</h1>
          <div className="top-sub">
            Hermes projects — grouped folders and board links.
          </div>
        </div>
        <div className="top-right">
          <label className="sr-only" htmlFor="projects-profile">Project profile</label>
          {profiles?.length ? <select id="projects-profile" aria-label="Project profile" value={selectedProfile} onChange={(event) => onProfileChange?.(event.target.value)}>
            {profiles.map((profile) => <option key={profile} value={profile}>{profile}</option>)}
          </select> : null}
          <div className="top-stat">
            <b>{allProjects.length}</b>Projects
          </div>
          <div className="top-stat">
            <b>{activeCount}</b>Active
          </div>
          <button
            className={`btn-mini${showArchived ? ' prim' : ''}`}
            onClick={() => setShowArchived(!showArchived)}
          >
            {showArchived ? 'Hide Archived' : 'Show Archived'}
          </button>
          <button className="btn-mini prim" onClick={onCreate} disabled={busy}>
            New Project
          </button>
        </div>
      </div>
      <div className="brd-toolbar">
        <div className="tb-filters">
          <button
            className={`tb-filter-btn${filter === 'all' ? ' on' : ''}`}
            onClick={() => setFilter('all')}
          >
            All <span className="tb-ct">{allProjects.length}</span>
          </button>
          <button
            className={`tb-filter-btn${filter === 'active' ? ' on' : ''}`}
            onClick={() => setFilter('active')}
          >
            Active <span className="tb-ct">{activeCount}</span>
          </button>
          <button
            className={`tb-filter-btn${filter === 'archived' ? ' on' : ''}`}
            onClick={() => setFilter('archived')}
          >
            Archived <span className="tb-ct">{archivedCount}</span>
          </button>
        </div>
        <div className="tb-grow">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search projects…"
          />
        </div>
        <div className="view-toggle">
          <button
            className={view === 'grid' ? 'on' : ''}
            onClick={() => setView('grid')}
          >
            Grid
          </button>
          <button
            className={view === 'list' ? 'on' : ''}
            onClick={() => setView('list')}
          >
            List
          </button>
        </div>
      </div>
    </>
  )
}

function ProjectsCanvas({
  projects,
  view,
  activeId,
  onOpen,
}: {
  projects: Array<Project>
  view: ViewMode
  activeId: string | null
  onOpen: (project: Project) => void
}) {
  if (projects.length === 0) {
    return (
      <div className="brd-canvas">
        <div className="empty-state">
          <div className="es-title">No projects found</div>
          <div className="es-sub">
            Projects are created and managed via the Hermes Agent dashboard.
          </div>
        </div>
      </div>
    )
  }
  if (view === 'list') {
    return (
      <div className="brd-canvas">
        <table className="brd-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Primary Path</th>
              <th>Folders</th>
              <th>Tasks</th>
              <th>Board</th>
              <th>Status</th>
              <th>Last Active</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <ProjectRow
                key={p.id}
                project={p}
                isActive={p.id === activeId}
                onOpen={onOpen}
              />
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  return (
    <div className="brd-canvas">
      <div className={`brd-grid${projects.length === 1 ? ' single' : ''}`}>
        {projects.map((p) => (
          <ProjectCard
            key={p.id}
            project={p}
            isActive={p.id === activeId}
            onOpen={onOpen}
          />
        ))}
      </div>
    </div>
  )
}

export function ProjectDrawer({
  project,
  isActive,
  onClose,
  onEdit,
  onAddFolder,
  onSetPrimary,
  onRemoveFolder,
  onArchive,
  onRestore,
  onSetActive,
  onDelete,
  busy,
  error,
  profile,
}: {
  project: Project
  isActive: boolean
  onClose: () => void
  onEdit: () => void
  onAddFolder: (path: string) => void
  onSetPrimary: (path: string) => void
  onRemoveFolder: (path: string) => void
  onArchive: () => void
  onRestore: () => void
  onSetActive: () => void
  onDelete: () => void
  busy: boolean
  error: string | null
  profile?: string
}) {
  const foldersQuery = useProjectFolders(project.id, true, profile)
  const folders = foldersQuery.data?.folders ?? project.folders
  const [activeTab, setActiveTab] = useState<DrawerTab>('overview')
  const [newFolder, setNewFolder] = useState('')

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="drawer" role="dialog" aria-label={project.name}>
        <div className="dr-head">
          <div className="dr-title-row">
            <div
              className="dr-glyph"
              style={{ ['--bc' as string]: project.color || COLORS[0] }}
            >
              {glyph(project)}
            </div>
            <div>
              <h2>{project.name}</h2>
              <div className="dr-meta">
                <span>{project.slug}</span>
                <span>
                  {project.archived
                    ? 'archived'
                    : orElse(project.is_active, isActive)
                      ? 'active'
                      : 'idle'}
                </span>
                <span>Created {formatDate(project.created_at)}</span>
              </div>
            </div>
          </div>
          <div className="dr-acts">
            <button className="btn-mini" onClick={onEdit} disabled={busy}>
              Edit
            </button>
            <button className="ico-btn" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
        </div>
        <div className="dr-tabs">
          {DRAWER_TABS.map((tab) => (
            <button
              key={tab}
              className={activeTab === tab ? 'on' : ''}
              onClick={() => setActiveTab(tab)}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>
        <div className="dr-body">
          {activeTab === 'overview' ? (
            <>
              <div className="panel-card">
                <div className="pc-head">Project Metadata</div>
                <div className="pc-body ws-grid">
                  <div className="ws-lbl">Slug</div>
                  <div className="ws-val">{project.slug}</div>
                  <div className="ws-lbl">Primary Path</div>
                  <div className="ws-val path">
                    {project.primary_path ?? '—'}
                  </div>
                  <div className="ws-lbl">Color</div>
                  <div className="ws-val">{project.color || '—'}</div>
                  <div className="ws-lbl">Board</div>
                  <div className="ws-val">{project.board_slug ?? '—'}</div>
                  <div className="ws-lbl">Bound Board</div>
                  <div className="ws-val">
                    {project.bound_board?.name ?? project.board_slug ?? '—'}
                  </div>
                  <div className="ws-lbl">Tasks</div>
                  <div className="ws-val">
                    {orElse(project.task_count, 0)} total ·{' '}
                    {orElse(project.open_task_count, 0)} open
                  </div>
                  <div className="ws-lbl">Last Active</div>
                  <div className="ws-val">
                    {relativeTime(project.last_activity_at)}
                  </div>
                  <div className="ws-lbl">Active</div>
                  <div className="ws-val">
                    <StatusPill project={project} isActive={isActive} />
                  </div>
                  <div className="ws-lbl">Archived</div>
                  <div className="ws-val">
                    {project.archived ? 'Yes' : 'No'}
                  </div>
                </div>
                {error ? (
                  <div className="field-val" role="alert">
                    {error}
                  </div>
                ) : null}
              </div>
              {project.description ? (
                <div className="panel-card">
                  <div className="pc-head">Description</div>
                  <div className="pc-body description-copy">
                    {project.description}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
          {activeTab === 'folders' ? (
            <div className="panel-card">
              <div className="pc-head">
                Folders
                <div className="pc-head-right">{folders.length}</div>
              </div>
              <div className="pc-body">
                <div className="wz-link-add">
                  <input
                    className="form-inp"
                    placeholder="/path/to/folder"
                    value={newFolder}
                    onChange={(e) => setNewFolder(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newFolder.trim()) {
                        onAddFolder(newFolder.trim())
                        setNewFolder('')
                      }
                    }}
                  />
                  <button
                    className="btn-mini prim"
                    disabled={!newFolder.trim() || busy}
                    onClick={() => {
                      onAddFolder(newFolder.trim())
                      setNewFolder('')
                    }}
                  >
                    Add
                  </button>
                </div>
                {folders.length === 0 ? (
                  <div className="field-val muted">No folders.</div>
                ) : (
                  <div className="task-breakdown" style={{ display: 'block' }}>
                    {folders.map((folder) => (
                      <div key={folder.path} className="ws-grid pc-body">
                        <div className="ws-lbl">
                          {folderLabel(folder)}
                          {folder.is_primary ? ' (primary)' : ''}
                        </div>
                        <div className="ws-val path">{folder.path}</div>
                        <div className="ws-val">
                          {!folder.is_primary ? (
                            <button
                              className="btn-mini"
                              onClick={() => onSetPrimary(folder.path)}
                              disabled={busy}
                            >
                              Set Primary
                            </button>
                          ) : null}
                          <button
                            className="btn-mini"
                            onClick={() => onRemoveFolder(folder.path)}
                            disabled={busy}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}
          {activeTab === 'activity' ? (
            <ProjectActivityTab project={project} profile={profile} />
          ) : null}
        </div>
        <div className="dr-foot">
          <span className="dr-foot-time">
            Last active: {relativeTime(project.last_activity_at)}
          </span>
          <div className="dr-foot-acts">
            {project.archived ? (
              <>
                <button
                  className="btn-mini"
                  onClick={onRestore}
                  disabled={busy}
                >
                  Restore
                </button>
                <button className="btn-mini" onClick={onDelete} disabled={busy}>
                  Delete
                </button>
              </>
            ) : (
              <>
                <button
                  className="btn-mini"
                  onClick={onSetActive}
                  disabled={busy || isActive}
                >
                  Set Active
                </button>
                <button
                  className="btn-mini"
                  onClick={onArchive}
                  disabled={busy}
                >
                  Archive
                </button>
              </>
            )}
            <button className="btn-mini" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

export function ProjectActivityTab({ project, profile }: { project: Project; profile?: string }) {
  // Stable p_<hex> id as the query key — never the slug.
  const activityQuery = useProjectActivity(project.id, undefined, true, profile)
  if (activityQuery.isLoading)
    return <div className="field-val muted">Loading activity…</div>
  if (activityQuery.isError)
    return <div className="field-val muted">Activity unavailable.</div>
  const items = (activityQuery.data?.items ?? [])
    .filter((it) => it.kind === 'task')
    .slice(0, 10)
  if (items.length === 0)
    return <div className="field-val muted">No recent activity</div>
  return (
    <div className="pa-timeline">
      <div className="pa-line" />
      {items.map((item) => (
        <div key={item.id} className="pa-row">
          <span className="pa-dot" />
          <div className="pa-body">
            <div className="pa-top">
              <span className="pa-title">{item.title || '—'}</span>
              <span className="status-pill">{item.status || '—'}</span>
              <span className="pa-time">{relativeTime(item.occurred_at)}</span>
            </div>
            <span className="pa-kind">{item.event_kind || ''}</span>
          </div>
        </div>
      ))}
      {/* ponytail: no-op until tasks route supports ?project= filter */}
      <a className="pa-viewall" href="/tasks">
        View all in Tasks page →
      </a>
    </div>
  )
}

type CreateDraft = {
  name: string
  slug: string
  description: string
  primary_path: string
  board_slug: string
  color: string
}

const CREATE_INIT: CreateDraft = {
  name: '',
  slug: '',
  description: '',
  primary_path: '',
  board_slug: '',
  color: COLORS[0],
}

// Board picker shared by the create and edit modals — live boards list.
function BoardSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (slug: string) => void
}) {
  const boardsQuery = useBoards()
  const boards = boardsQuery.data?.boards ?? []
  return (
    <div className="form-row">
      <label>Board</label>
      <select
        className="form-inp"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">— None (default) —</option>
        {boards.map((b) => (
          <option key={b.slug} value={b.slug}>
            {b.name || b.slug}
          </option>
        ))}
      </select>
      <span className="form-hint">
        {boardsQuery.isLoading
          ? 'Loading boards…'
          : 'Optional default board for this project.'}
      </span>
    </div>
  )
}

// In-app create modal, mirroring boards-screen's CreateWizard chrome so the
// flow matches the rest of the app instead of a native window.prompt().
// ponytail: single-step form (boards uses a 2-step wizard) — projects create
// has few fields, so one panel is enough; reuses the same .wizard-*/.wz-*/.form-* CSS.
function ProjectCreateWizard({
  state,
  onChange,
  onClose,
  onCreate,
  creating,
}: {
  state: CreateDraft
  onChange: (next: CreateDraft) => void
  onClose: () => void
  onCreate: () => Promise<void>
  creating: boolean
}) {
  function set<TKey extends keyof CreateDraft>(
    key: TKey,
    value: CreateDraft[TKey],
  ) {
    onChange({ ...state, [key]: value })
  }
  function onNameChange(value: string) {
    onChange({ ...state, name: value, slug: slugify(value) })
  }
  const canCreate =
    state.name.trim().length >= 2 && state.slug.trim().length >= 1

  return (
    <div
      className="wizard-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="wizard-modal">
        <div className="wz-head">
          <div className="wz-icon">◪</div>
          <div>
            <h2>New Project</h2>
            <div className="wz-sub">Backend-supported fields only.</div>
          </div>
          <button className="wz-close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="wz-body">
          <div className="form-row">
            <label>
              Project Name <span className="req">*</span>
            </label>
            <input
              className="form-inp"
              autoFocus
              placeholder="e.g. Hermes SwitchUI"
              value={state.name}
              onChange={(e) => onNameChange(e.target.value)}
            />
            <span className="form-hint">Minimum 2 characters.</span>
          </div>
          <div className="form-row">
            <label>
              Slug <span className="req">*</span>
            </label>
            <input
              className="form-inp"
              value={state.slug}
              onChange={(e) => set('slug', slugify(e.target.value))}
            />
            <span className="form-hint">Backend-required identifier.</span>
          </div>
          <div className="form-row">
            <label>Description</label>
            <textarea
              className="form-ta"
              placeholder="What lives in this project?"
              value={state.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </div>
          <div className="form-row">
            <label>Primary Path</label>
            <input
              className="form-inp"
              placeholder="/path/to/repo (optional)"
              value={state.primary_path}
              onChange={(e) => set('primary_path', e.target.value)}
            />
          </div>
          <BoardSelect
            value={state.board_slug}
            onChange={(v) => set('board_slug', v)}
          />
          <div className="form-row">
            <label>Accent Color</label>
            <div className="color-swatches">
              {COLORS.map((color) => (
                <div
                  key={color}
                  className={`color-swatch${state.color === color ? ' sel' : ''}`}
                  style={{
                    background: color,
                    boxShadow: `0 0 8px ${color}60`,
                    ['--sw' as string]: color,
                  }}
                  onClick={() => set('color', color)}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="wz-foot">
          <span className="wz-foot-step">New project</span>
          <div className="wz-nav">
            <button className="btn-mini" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn-mini prim"
              disabled={!canCreate || creating}
              style={{ opacity: canCreate && !creating ? 1 : 0.45 }}
              onClick={() => void onCreate()}
            >
              {creating ? 'Creating…' : 'Create Project'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// In-app edit wizard — same stepper chrome as boards. Step 1 Identity (name,
// description, board, color via UpdateProjectInput; slug/primary_path are
// immutable server-side). Step 2 Folders — add/remove/set-primary applied
// immediately against the live project. `project` must be the LIVE list entry
// so the folder list refreshes after each mutation invalidates the query.
function ProjectEditModal({
  project,
  onClose,
  onSave,
  saving,
  onAddFolder,
  onRemoveFolder,
  onSetPrimary,
}: {
  project: Project
  onClose: () => void
  onSave: (input: UpdateProjectInput) => Promise<void>
  saving: boolean
  onAddFolder: (path: string) => Promise<void>
  onRemoveFolder: (path: string) => Promise<void>
  onSetPrimary: (path: string) => Promise<void>
}) {
  const steps = ['Identity', 'Folders']
  const [step, setStep] = useState(1)
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description ?? '')
  const [boardSlug, setBoardSlug] = useState(project.board_slug ?? '')
  const [color, setColor] = useState(project.color ?? COLORS[0])
  const [newFolder, setNewFolder] = useState('')
  const canSave = name.trim().length >= 2
  const folders = orElse(project.folders, [])

  const submitFolder = async () => {
    const path = newFolder.trim()
    if (!path) return
    await onAddFolder(path)
    setNewFolder('')
  }

  return (
    <div
      className="wizard-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="wizard-modal">
        <div className="wz-head">
          <div className="wz-icon">◪</div>
          <div>
            <h2>Edit Project</h2>
            <div className="wz-sub">
              Step {step} of {steps.length} — {steps[step - 1]}
            </div>
          </div>
          <button className="wz-close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="wz-steps">
          <div className="wz-steps-line" />
          {steps.map((label, index) => {
            const n = index + 1
            const cls = n < step ? 'done' : n === step ? 'cur' : ''
            return (
              <div key={n} className={`wz-step ${cls}`}>
                <div className="wz-dot">{n < step ? '✓' : n}</div>
                <div className="wz-lbl">{label}</div>
              </div>
            )
          })}
        </div>
        <div className="wz-body">
          {step === 1 ? (
            <>
              <div className="form-row">
                <label>
                  Project Name <span className="req">*</span>
                </label>
                <input
                  className="form-inp"
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <span className="form-hint">Minimum 2 characters.</span>
              </div>
              <div className="form-row">
                <label>Description</label>
                <textarea
                  className="form-ta"
                  placeholder="What lives in this project?"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <BoardSelect value={boardSlug} onChange={setBoardSlug} />
              <div className="form-row">
                <label>Accent Color</label>
                <div className="color-swatches">
                  {COLORS.map((c) => (
                    <div
                      key={c}
                      className={`color-swatch${color === c ? ' sel' : ''}`}
                      style={{
                        background: c,
                        boxShadow: `0 0 8px ${c}60`,
                        ['--sw' as string]: c,
                      }}
                      onClick={() => setColor(c)}
                    />
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              <p className="wz-p">
                Folders link local paths to this project. Changes apply
                immediately.
              </p>
              <div className="form-row">
                <label>Add Folder</label>
                <div className="wz-link-add">
                  <input
                    className="form-inp"
                    placeholder="/path/to/folder"
                    value={newFolder}
                    onChange={(e) => setNewFolder(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void submitFolder()
                    }}
                  />
                  <button
                    className="btn-mini prim"
                    disabled={!newFolder.trim() || saving}
                    onClick={() => void submitFolder()}
                  >
                    Add
                  </button>
                </div>
              </div>
              {folders.length === 0 ? (
                <div className="field-val muted">No folders yet.</div>
              ) : (
                <div className="task-breakdown" style={{ display: 'block' }}>
                  {folders.map((folder) => (
                    <div key={folder.path} className="ws-grid pc-body">
                      <div className="ws-lbl">
                        {folderLabel(folder)}
                        {folder.is_primary ? ' (primary)' : ''}
                      </div>
                      <div className="ws-val path">{folder.path}</div>
                      <div className="ws-val">
                        {!folder.is_primary ? (
                          <button
                            className="btn-mini"
                            disabled={saving}
                            onClick={() => void onSetPrimary(folder.path)}
                          >
                            Set Primary
                          </button>
                        ) : null}
                        <button
                          className="btn-mini danger"
                          disabled={saving}
                          onClick={() => void onRemoveFolder(folder.path)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <div className="wz-foot">
          <span className="wz-foot-step">
            Step {step} / {steps.length}
          </span>
          <div className="wz-nav">
            {step > 1 ? (
              <button className="btn-mini" onClick={() => setStep(1)}>
                ← Back
              </button>
            ) : (
              <button className="btn-mini" onClick={onClose}>
                Cancel
              </button>
            )}
            {step < steps.length ? (
              <button
                className="btn-mini prim"
                disabled={!canSave}
                style={{ opacity: canSave ? 1 : 0.45 }}
                onClick={() => setStep(step + 1)}
              >
                Next →
              </button>
            ) : null}
            <button
              className="btn-mini prim"
              disabled={!canSave || saving}
              style={{ opacity: canSave && !saving ? 1 : 0.45 }}
              onClick={() =>
                void onSave({
                  name: name.trim(),
                  description: description.trim() || undefined,
                  board_slug: boardSlug.trim() || undefined,
                  color,
                })
              }
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

type ConfirmState = {
  title: string
  message: string
  confirmLabel: string
  danger: boolean
  action: () => Promise<void>
}

// Reusable in-app confirm modal (archive / delete), replacing window.confirm.
// Mirrors boards-screen's DeleteConfirm chrome.
function ConfirmDialog({
  state,
  onClose,
  busy,
}: {
  state: ConfirmState
  onClose: () => void
  busy: boolean
}) {
  return (
    <div
      className="confirm-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="confirm-box">
        <h3>{state.title}</h3>
        <p>{state.message}</p>
        <div className="conf-acts">
          <button className="btn-mini" onClick={onClose}>
            Cancel
          </button>
          <button
            className={`btn-mini ${state.danger ? 'danger' : 'prim'}`}
            disabled={busy}
            onClick={() => void state.action()}
          >
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export function ProjectsScreen() {
  usePageTitle('Projects')
  const searchParams = useSearch({ from: '/projects' })
  const { profiles, activeProfile } = useAgentProfiles()
  const selectedProfile = searchParams.profile || activeProfile || profiles[0] || ''
  const [showArchived, setShowArchived] = useState(false)
  const projectsQuery = useProjects(showArchived, true, selectedProfile)
  const [view, setView] = useState<ViewMode>(readInitialView)
  const [filter, setFilter] = useState<FilterMode>('all')
  const [search, setSearch] = useState('')
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [draft, setDraft] = useState<CreateDraft | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const navigate = useNavigate()
  const createMutation = useCreateProject(selectedProfile)
  const updateMutation = useUpdateProject(selectedProfile)
  const addFolderMutation = useAddProjectFolder(selectedProfile)
  const removeFolderMutation = useRemoveProjectFolder(selectedProfile)
  const primaryMutation = useSetPrimaryProjectFolder(selectedProfile)
  const archiveMutation = useArchiveProject(selectedProfile)
  const restoreMutation = useRestoreProject(selectedProfile)
  const activeMutation = useSetActiveProject(selectedProfile)
  const deleteMutation = useDeleteProject(selectedProfile)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const busy = [
    createMutation,
    updateMutation,
    addFolderMutation,
    removeFolderMutation,
    primaryMutation,
    archiveMutation,
    restoreMutation,
    activeMutation,
    deleteMutation,
  ].some((mutation) => mutation.isPending)

  const changeProfile = (profile: string) => {
    setActiveProjectId(null)
    setDraft(null)
    setEditing(null)
    setConfirm(null)
    void navigate({ to: '/projects', search: profile ? { profile } : {} })
  }

  const runMutation = async (action: () => Promise<unknown>) => {
    setMutationError(null)
    try {
      await action()
    } catch (error) {
      setMutationError(
        error instanceof Error ? error.message : 'Project update failed',
      )
    }
  }

  const create = () => {
    setActiveProjectId(null) // collapse the drawer behind the modal
    setDraft({ ...CREATE_INIT })
  }

  const submitCreate = async () => {
    if (!draft) return
    await runMutation(async () => {
      await createMutation.mutateAsync({
        name: draft.name.trim(),
        slug: draft.slug.trim() || slugify(draft.name),
        description: draft.description.trim() || undefined,
        primary_path: draft.primary_path.trim() || undefined,
        board_slug: draft.board_slug.trim() || undefined,
        color: draft.color,
      })
      setDraft(null)
    })
  }

  const edit = (project: Project) => {
    setActiveProjectId(null) // collapse the drawer behind the modal
    setEditing(project.id)
  }

  const submitEdit = async (input: UpdateProjectInput) => {
    if (!editing) return
    await runMutation(async () => {
      await updateMutation.mutateAsync({ idOrSlug: editing, input })
      setEditing(null)
    })
  }

  const addFolder = (project: Project, path: string) => {
    const trimmed = path.trim()
    if (!trimmed) return
    void runMutation(() =>
      addFolderMutation.mutateAsync({
        idOrSlug: project.id,
        input: { path: trimmed },
      }),
    )
  }

  const removeFolder = (project: Project, path: string) => {
    // Immediate — a folder link is low-stakes and re-addable (matches the edit wizard).
    void runMutation(() =>
      removeFolderMutation.mutateAsync({ idOrSlug: project.id, path }),
    )
  }

  const setPrimary = (project: Project, path: string) => {
    void runMutation(() =>
      primaryMutation.mutateAsync({ idOrSlug: project.id, path }),
    )
  }

  const archive = (project: Project) => {
    setActiveProjectId(null) // collapse the drawer behind the dialog
    setConfirm({
      title: 'Archive Project',
      message: `Archive ${project.name}? It will be hidden from active lists — you can restore it later.`,
      confirmLabel: 'Archive',
      danger: false,
      action: async () => {
        await runMutation(() => archiveMutation.mutateAsync(project.id))
        setConfirm(null)
      },
    })
  }

  const restore = (project: Project) => {
    void runMutation(() => restoreMutation.mutateAsync(project.id))
  }

  const setActive = (project: Project) => {
    void runMutation(() => activeMutation.mutateAsync(project.id))
  }

  const hardDelete = (project: Project) => {
    setActiveProjectId(null) // collapse the drawer behind the dialog
    setConfirm({
      title: 'Delete Project',
      message: `Permanently delete ${project.name}? This cannot be undone.`,
      confirmLabel: 'Delete Project',
      danger: true,
      action: async () => {
        await runMutation(() => deleteMutation.mutateAsync(project.id))
        setConfirm(null)
      },
    })
  }

  const projects = projectsQuery.data?.projects ?? []
  const activeId = projectsQuery.data?.active_id ?? null
  // Live project for the edit modal so its folder list refreshes after each
  // folder mutation invalidates the query (editing holds the stable id).
  const editingProject = editing
    ? (projects.find((p) => p.id === editing) ?? null)
    : null

  const filtered = useMemo(
    () =>
      projects.filter((p) => {
        if (filter !== 'all' && (p.archived ? 'archived' : 'active') !== filter)
          return false
        if (
          search &&
          !`${p.name} ${p.slug} ${p.description ?? ''}`
            .toLowerCase()
            .includes(search.toLowerCase())
        )
          return false
        return true
      }),
    [projects, filter, search],
  )
  const activeProject = activeProjectId
    ? (projects.find((p) => p.id === activeProjectId) ?? null)
    : null

  if (projectsQuery.isLoading)
    return <div className="brd-loading">Loading projects…</div>
  if (projectsQuery.isError)
    return (
      <div className="brd-error">
        {projectsQuery.error instanceof Error
          ? projectsQuery.error.message
          : 'Projects unavailable'}
      </div>
    )

  return (
    // ponytail: data-screen="boards" reuses matrix-boards.css scoped rules as-is; no new stylesheet needed.
    <div data-screen="boards" className="boards-screen-root">
      <div className="brd-main">
        <MainTop
          allProjects={projects}
          search={search}
          setSearch={setSearch}
          filter={filter}
          setFilter={setFilter}
          view={view}
          setView={(v) => {
            setView(v)
            if (typeof window !== 'undefined')
              window.localStorage.setItem(VIEW_KEY, v)
          }}
          showArchived={showArchived}
          setShowArchived={setShowArchived}
          onCreate={create}
          busy={busy}
          profiles={profiles}
          selectedProfile={selectedProfile}
          onProfileChange={changeProfile}
        />
        {mutationError ? (
          <div className="brd-error" role="alert">
            {mutationError}
          </div>
        ) : null}
        <ProjectsCanvas
          projects={filtered}
          view={view}
          activeId={activeId}
          onOpen={(project) => setActiveProjectId(project.id)}
        />
      </div>

      {activeProject ? (
        <ProjectDrawer
          project={activeProject}
          isActive={activeProject.id === activeId}
          onClose={() => setActiveProjectId(null)}
          onEdit={() => edit(activeProject)}
          onAddFolder={(path) => addFolder(activeProject, path)}
          onSetPrimary={(path) => setPrimary(activeProject, path)}
          onRemoveFolder={(path) => removeFolder(activeProject, path)}
          onArchive={() => archive(activeProject)}
          onRestore={() => restore(activeProject)}
          onSetActive={() => setActive(activeProject)}
          onDelete={() => hardDelete(activeProject)}
          busy={busy}
          profile={selectedProfile}
          error={mutationError}
        />
      ) : null}

      {draft ? (
        <ProjectCreateWizard
          state={draft}
          onChange={setDraft}
          onClose={() => setDraft(null)}
          onCreate={submitCreate}
          creating={busy}
        />
      ) : null}

      {editingProject ? (
        <ProjectEditModal
          project={editingProject}
          onClose={() => setEditing(null)}
          onSave={submitEdit}
          saving={busy}
          onAddFolder={(path) =>
            runMutation(() =>
              addFolderMutation.mutateAsync({
                idOrSlug: editingProject.id,
                input: { path },
              }),
            )
          }
          onRemoveFolder={(path) =>
            runMutation(() =>
              removeFolderMutation.mutateAsync({
                idOrSlug: editingProject.id,
                path,
              }),
            )
          }
          onSetPrimary={(path) =>
            runMutation(() =>
              primaryMutation.mutateAsync({ idOrSlug: editingProject.id, path }),
            )
          }
        />
      ) : null}

      {confirm ? (
        <ConfirmDialog
          state={confirm}
          busy={busy}
          onClose={() => setConfirm(null)}
        />
      ) : null}
    </div>
  )
}
