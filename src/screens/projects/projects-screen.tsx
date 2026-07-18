import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { Project, ProjectFolder } from '@/lib/projects-types'
import { usePageTitle } from '@/hooks/use-page-title'
import {
  useProjectActivity,
  useProjectFolders,
  useProjects,
} from '@/lib/projects-api'
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

function ProjectCard({
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

function MainTop({
  allProjects,
  search,
  setSearch,
  filter,
  setFilter,
  view,
  setView,
  showArchived,
  setShowArchived,
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

function ProjectDrawer({
  project,
  isActive,
  onClose,
}: {
  project: Project
  isActive: boolean
  onClose: () => void
}) {
  const foldersQuery = useProjectFolders(project.id)
  const folders = foldersQuery.data?.folders ?? project.folders
  const [activeTab, setActiveTab] = useState<DrawerTab>('overview')

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
                    : isActive
                      ? 'active'
                      : 'idle'}
                </span>
                <span>Created {formatDate(project.created_at)}</span>
              </div>
            </div>
          </div>
          <div className="dr-acts">
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
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}
          {activeTab === 'activity' ? (
            <ProjectActivityTab project={project} />
          ) : null}
        </div>
        <div className="dr-foot">
          <span className="dr-foot-time">
            Last active: {relativeTime(project.last_activity_at)}
          </span>
          <div className="dr-foot-acts">
            <button className="btn-mini" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

function ProjectActivityTab({ project }: { project: Project }) {
  // Stable p_<hex> id as the query key — never the slug.
  const activityQuery = useProjectActivity(project.id)
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

export function ProjectsScreen() {
  usePageTitle('Projects')
  const [showArchived, setShowArchived] = useState(false)
  const projectsQuery = useProjects(showArchived)
  const [view, setView] = useState<ViewMode>(readInitialView)
  const [filter, setFilter] = useState<FilterMode>('all')
  const [search, setSearch] = useState('')
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)

  const projects = projectsQuery.data?.projects ?? []
  const activeId = projectsQuery.data?.active_id ?? null

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
        />
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
        />
      ) : null}
    </div>
  )
}
