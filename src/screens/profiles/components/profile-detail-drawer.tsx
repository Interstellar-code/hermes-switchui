/**
 * ProfileDetailDrawer — right-side inspector for a profile (G-01).
 *
 * `matrix-profiles.css` has carried a full `.pf-drawer-*` kit since the
 * profiles redesign, but the only consumer was the memory screen's drawer —
 * the profile drawer it was written for was never built, so the sole way to
 * look at a profile was to open the nine-step wizard. This is that drawer.
 * Markup shape follows `screens/memory/components/memory-detail-drawer.tsx`.
 *
 * Tabs:
 *   Overview — identity, model/provider, derived status, the counts the list
 *              API already returns, and the on-disk path.
 *   Config   — read-only `config.yaml` via `GET /api/profiles/read`, secrets
 *              masked with `maskSecrets`.
 *   Files    — SOUL.md / memories/MEMORY.md / memory/IDENTITY.md. See the note
 *              on `canReadFiles` below: only some of these are readable today.
 *
 * The action bar also owns Export — `GET /api/profiles/export` returns the
 * portable bundle and this downloads it as a file. See `EXPORT_CONTENTS_NOTE`
 * for why the bar states what is in that file before you download it.
 */

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import YAML from 'yaml'
import { maskSecrets } from '../profile-config-map'
import type { AgentRow } from '../profiles-screen'
import type { ProfileDetail } from '@/server/profiles-browser'
import type {
  AgentFileReadResponse,
  AgentFilesListResponse,
} from '@/routes/api/memory/agent-files'
import { formatBytes, formatRelative } from '@/lib/format'
import { toast } from '@/components/ui/toast'

type DrawerTab = 'overview' | 'config' | 'files'

const TABS: Array<{ id: DrawerTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'config', label: 'Config' },
  { id: 'files', label: 'Files' },
]

type Props = {
  agent: AgentRow | null
  open: boolean
  busy?: boolean
  onClose: () => void
  onActivate?: (profileName: string) => void
  onEdit?: (agent: AgentRow) => void
  onClone?: (agent: AgentRow) => void
  onDelete?: (profileName: string) => void
}

// ── Profile-relative files the drawer knows about ────────────────────────────
//
// `readable` marks the two files `/api/memory/agent-files` can actually serve.
// That endpoint resolves `SOUL.md` at the profile root and everything else
// under `memories/`; it has no route to `memory/IDENTITY.md` at all, and its
// `validateAgentId` rejects any id that is not one of the four built-in
// agents. So the drawer reads what it can and states the truth about the rest
// rather than inventing an endpoint.
const PROFILE_FILES: Array<{
  label: string
  relPath: string
  /** Filename as `/api/memory/agent-files` names it, when it can serve the file. */
  apiFilename?: string
}> = [
  { label: 'Persona', relPath: 'SOUL.md', apiFilename: 'SOUL.md' },
  { label: 'Long-term memory', relPath: 'memories/MEMORY.md', apiFilename: 'MEMORY.md' },
  { label: 'Identity', relPath: 'memory/IDENTITY.md' },
]

async function apiFetch<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(payload.error ?? `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

function joinPath(dir: string | undefined, rel: string): string {
  if (!dir) return rel
  return `${dir.replace(/\/+$/, '')}/${rel}`
}

// ── Export ───────────────────────────────────────────────────────────────────

/** File name the browser saves an exported bundle under. */
export function exportFileName(profileName: string): string {
  return `${profileName}.hermes-profile.json`
}

/**
 * Stated next to the Export button, not behind a confirmation modal.
 *
 * An export bundle is meant to be handed to someone else, so the honest
 * question — "what am I about to give away?" — has to be answered before the
 * click, not after. `exportProfile()` leaves out `.env` and `sessions/` and
 * runs `config.yaml` through `maskSecrets`; masking is best-effort pattern
 * matching, so this says "masked", not "safe".
 */
const EXPORT_CONTENTS_NOTE =
  'Export writes a JSON bundle: config.yaml (secrets masked), SOUL.md, ' +
  'MEMORY.md, IDENTITY.md and skills/. Your .env file and session history ' +
  'are never included.'

/**
 * Fetch the bundle and hand it to the browser as a download.
 *
 * The object URL is revoked as soon as the synthetic click has been
 * dispatched — `click()` dispatches synchronously and the browser has already
 * taken its reference by the time this returns, so holding the blob any longer
 * only leaks it for the lifetime of the document.
 */
async function downloadProfileBundle(profileName: string): Promise<void> {
  const response = await fetch(
    `/api/profiles/export?name=${encodeURIComponent(profileName)}`,
  )
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(payload.error ?? `Export failed (${response.status})`)
  }
  const bundle = (await response.json()) as unknown

  const blob = new Blob([JSON.stringify(bundle, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = exportFileName(profileName)
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
}

// ── Overview ─────────────────────────────────────────────────────────────────

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="pf-drawer-field">
      <div className="pf-drawer-field-label">{label}</div>
      <div className="pf-drawer-field-value">{value}</div>
    </div>
  )
}

function OverviewTab({ agent }: { agent: AgentRow }) {
  const statusExplanation =
    agent.status === 'active'
      ? 'in use — named in ~/.hermes/active_profile'
      : agent.status === 'idle'
        ? 'idle — has run before'
        : 'draft — never run'

  return (
    <>
      <div className="pf-drawer-field-grid">
        <Field label="Name" value={agent.profileName ?? agent.name} />
        <Field label="Role" value={agent.role || '—'} />
        <Field label="Tier" value={`Tier ${String(agent.tier)}`} />
        <Field label="Status" value={statusExplanation} />
        <Field label="Model" value={agent.model ?? '—'} />
        <Field label="Provider" value={agent.provider ?? '—'} />
        <Field label="Skills" value={String(agent.skillCount)} />
        <Field label="Sessions" value={String(agent.sessionCount)} />
        <Field
          label="Last used"
          value={agent.lastRunAt !== null ? formatRelative(agent.lastRunAt) : 'never'}
        />
        <Field label="Own .env" value={agent.hasEnv ? 'yes' : 'no'} />
        <Field label="Origin" value={agent.builtin ? 'built-in' : 'user-created'} />
        <Field label="Path" value={agent.path ?? '—'} />
      </div>

      <div className="pf-drawer-section-title">Description</div>
      <div className="pf-drawer-field-value" style={{ border: 'none', padding: 0 }}>
        {agent.description || '—'}
      </div>

      {agent.tags.length > 0 && (
        <>
          <div className="pf-drawer-section-title" style={{ marginTop: 20 }}>Tags</div>
          <div className="pf-drawer-tags-row">
            {agent.tags.map((t) => (
              <span key={t} className="pf-drawer-tag-chip">{t}</span>
            ))}
          </div>
        </>
      )}
    </>
  )
}

// ── Config ───────────────────────────────────────────────────────────────────

function ConfigTab({ profileName }: { profileName: string }) {
  // Same query key AND same result shape as agent-wizard.tsx's edit-mode read,
  // so the two observers share one cache entry instead of fighting over it.
  const detailQuery = useQuery({
    queryKey: ['profile-detail', profileName],
    queryFn: async () => {
      const r = await fetch(`/api/profiles/read?name=${encodeURIComponent(profileName)}`)
      if (!r.ok) return null
      const data = (await r.json()) as { profile: ProfileDetail }
      return data.profile
    },
    staleTime: 30_000,
  })

  if (detailQuery.isLoading) return <div className="pf-drawer-readonly-notice">Loading config…</div>
  if (detailQuery.isError || !detailQuery.data) {
    return (
      <div className="pf-drawer-readonly-notice">
        Could not read config.yaml for “{profileName}”.
      </div>
    )
  }

  let yaml: string
  try {
    yaml = YAML.stringify(maskSecrets(detailQuery.data.config))
  } catch {
    yaml = JSON.stringify(maskSecrets(detailQuery.data.config), null, 2)
  }

  return (
    <>
      <div className="pf-drawer-readonly-notice">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="3" y="7" width="10" height="8" rx="1.5" />
          <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
        </svg>
        Read-only. API keys and tokens are masked. Use Edit to change any of this.
      </div>
      <div className="pf-drawer-field-value" style={{ border: 'none', padding: '0 0 10px', opacity: 0.6 }}>
        {joinPath(detailQuery.data.path, 'config.yaml')}
      </div>
      <pre className="pf-drawer-yaml">{yaml}</pre>
    </>
  )
}

// ── Files ────────────────────────────────────────────────────────────────────

function FileContents({ agentId, filename }: { agentId: string; filename: string }) {
  const contentQuery = useQuery({
    queryKey: ['agent-file', agentId, filename],
    queryFn: () =>
      apiFetch<AgentFileReadResponse>(
        `/api/memory/agent-files?agent=${encodeURIComponent(agentId)}&filename=${encodeURIComponent(filename)}`,
      ),
    staleTime: 15_000,
  })

  if (contentQuery.isLoading) return <div className="pf-file-body">Loading…</div>
  if (contentQuery.isError) {
    return (
      <div className="pf-file-body">
        {contentQuery.error instanceof Error ? contentQuery.error.message : 'Failed to read file'}
      </div>
    )
  }
  return <pre className="pf-drawer-yaml">{contentQuery.data?.content ?? ''}</pre>
}

function FilesTab({ agent }: { agent: AgentRow }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const profileName = agent.profileName ?? agent.name

  // `/api/memory/agent-files` only accepts the four built-in agent ids.
  const canReadFiles = agent.builtin

  const listQuery = useQuery({
    queryKey: ['agent-files', profileName],
    queryFn: () =>
      apiFetch<AgentFilesListResponse>(
        `/api/memory/agent-files?agent=${encodeURIComponent(profileName)}`,
      ),
    enabled: canReadFiles,
    staleTime: 15_000,
  })

  const byName = new Map(
    (listQuery.data?.files ?? []).map((f) => [f.filename, f]),
  )

  return (
    <>
      {!canReadFiles && (
        <div className="pf-drawer-readonly-notice">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
            <circle cx="8" cy="8" r="6.5" />
            <path d="M8 5v3.5M8 11h.01" />
          </svg>
          No API reads these files for user-created profiles yet — the only file
          endpoint (/api/memory/agent-files) is restricted to the four built-in
          agents. The paths below are where they live on disk.
        </div>
      )}

      <div className="pf-file-list">
        {PROFILE_FILES.map((file) => {
          const entry = file.apiFilename ? byName.get(file.apiFilename) : undefined
          const readable = canReadFiles && file.apiFilename !== undefined
          const isOpen = expanded === file.relPath
          const existence = !readable
            ? 'not readable from the UI'
            : listQuery.isLoading
              ? 'checking…'
              : entry
                ? `${formatBytes(entry.sizeBytes)} · ${formatRelative(Date.parse(entry.modifiedAt) / 1000)}`
                : 'not present'

          return (
            <div key={file.relPath} className="pf-file-row">
              <div className="pf-file-head">
                <div className="pf-file-label">{file.label}</div>
                <div className="pf-file-path">{joinPath(agent.path, file.relPath)}</div>
                <div className="pf-file-meta">{existence}</div>
                {readable && entry && (
                  <button
                    type="button"
                    className="pf-drawer-action-btn"
                    onClick={() => setExpanded(isOpen ? null : file.relPath)}
                    aria-expanded={isOpen}
                  >
                    {isOpen ? 'Hide' : 'View'}
                  </button>
                )}
              </div>
              {readable && entry && isOpen && file.apiFilename && (
                <FileContents agentId={profileName} filename={file.apiFilename} />
              )}
            </div>
          )
        })}
      </div>

      {/* memory/IDENTITY.md is written by profiles-bootstrap but no route serves it. */}
      <div className="pf-drawer-readonly-notice" style={{ marginTop: 16, marginBottom: 0 }}>
        memory/IDENTITY.md has no read endpoint at all; its path is shown for
        reference only.
      </div>
    </>
  )
}

// ── Drawer ───────────────────────────────────────────────────────────────────

export function ProfileDetailDrawer({
  agent,
  open,
  busy,
  onClose,
  onActivate,
  onEdit,
  onClone,
  onDelete,
}: Props) {
  const [tab, setTab] = useState<DrawerTab>('overview')
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    if (agent) setTab('overview')
  }, [agent?.id])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !agent) return null

  const profileName = agent.profileName ?? agent.name
  // Mirrors the screen's gating: rename/delete are reserved server-side for
  // built-ins, and the active profile cannot be deleted.
  const showActivate = Boolean(onActivate) && agent.status !== 'active'
  const showDelete = Boolean(onDelete) && !agent.builtin && agent.status !== 'active'

  async function handleExport() {
    setExporting(true)
    try {
      await downloadProfileBundle(profileName)
      toast(`Exported ${exportFileName(profileName)}`, { type: 'success' })
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Failed to export agent', {
        type: 'error',
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <div className="pf-drawer-backdrop" onClick={onClose} aria-hidden="true" />

      <div
        role="dialog"
        aria-label={`Agent details: ${agent.name}`}
        className="pf-drawer is-open"
      >
        {/* Header */}
        <div className="pf-drawer-header">
          <div className="pf-drawer-glyph">{agent.glyph}</div>
          <div className="pf-drawer-name">{agent.name}</div>
          <div className="pf-drawer-badges">
            <div className={`pf-status ${agent.status}`}>
              <div className="d" />
              {agent.status === 'active' ? 'in use' : agent.status}
            </div>
            {agent.builtin && (
              <span className="pf-lock-badge" title="Built-in agent — editable and cloneable, but it cannot be renamed or deleted">
                Built-in
              </span>
            )}
          </div>
          <button type="button" className="pf-drawer-close" onClick={onClose} aria-label="Close drawer">
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 2l10 10M12 2L2 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Action bar */}
        <div className="pf-drawer-actions pf-drawer-actions--bar">
          {showActivate && (
            <button
              type="button"
              className="pf-drawer-action-btn primary"
              disabled={busy}
              onClick={() => onActivate?.(profileName)}
            >
              Activate
            </button>
          )}
          {onEdit && (
            <button
              type="button"
              className="pf-drawer-action-btn"
              disabled={busy}
              onClick={() => onEdit(agent)}
            >
              Edit
            </button>
          )}
          {onClone && (
            <button
              type="button"
              className="pf-drawer-action-btn"
              disabled={busy}
              onClick={() => onClone(agent)}
            >
              Clone
            </button>
          )}
          <button
            type="button"
            className="pf-drawer-action-btn"
            disabled={busy || exporting}
            onClick={() => void handleExport()}
            title={EXPORT_CONTENTS_NOTE}
          >
            {exporting ? 'Exporting…' : 'Export'}
          </button>
          {showDelete && (
            <button
              type="button"
              className="pf-drawer-action-btn danger"
              disabled={busy}
              onClick={() => onDelete?.(profileName)}
            >
              Delete
            </button>
          )}
          {/* One honest line about what leaves the machine, on its own row of
              the (wrapping) action bar rather than behind a modal. */}
          <p
            className="pf-drawer-readonly-notice"
            style={{ flex: '1 1 100%', margin: '2px 0 0' }}
          >
            {EXPORT_CONTENTS_NOTE}
          </p>
        </div>

        {/* Tab bar */}
        <div className="pf-drawer-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`pf-drawer-tab${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="pf-drawer-body">
          {tab === 'overview' && <OverviewTab agent={agent} />}
          {tab === 'config' && <ConfigTab profileName={profileName} />}
          {tab === 'files' && <FilesTab agent={agent} />}
        </div>
      </div>
    </>
  )
}
