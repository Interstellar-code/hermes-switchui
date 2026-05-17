import { useDeleteWorkflowDefinition, useWorkflowParsed } from './use-workflows'

interface WorkflowActionsProps {
  selectedId: string | null
  onOpenLaunchWizard: (workflowId: string) => void
  onDeselect?: () => void
}

/** Deterministic pseudo-random 0-3 from workflow id string */
function activeRunCount(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0
  }
  return h % 4
}

function mockSha256(id: string): string {
  let h = 5381
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) + h + id.charCodeAt(i)) >>> 0
  }
  const base = h.toString(16).padStart(8, '0')
  return (base + base + base + base + base + base + base + base).slice(0, 64)
}

function mockVersion(id: string): string {
  const n = id.charCodeAt(id.length - 1) % 10
  return `1.${n}.0`
}

const SOURCE_LABEL: Record<string, string> = {
  bundled: 'bundled',
  user: 'user',
  project: 'project',
}

function SourceBadge({ source }: { source: string }) {
  return (
    <span className={`wf-src-badge wf-src-${source}`}>
      {SOURCE_LABEL[source] ?? source}
    </span>
  )
}

export function WorkflowActions({
  selectedId,
  onOpenLaunchWizard,
  onDeselect,
}: WorkflowActionsProps) {
  const { data, isLoading } = useWorkflowParsed(selectedId)
  const deleteMutation = useDeleteWorkflowDefinition()

  if (!selectedId) {
    return null
  }

  if (isLoading) {
    return (
      <div className="wfa-root wfa-empty">
        <span className="wfa-empty-msg">Loading…</span>
      </div>
    )
  }

  if (!data) return null

  const def = data.definition
  const isBundled = def.source === 'bundled'
  const runCount = activeRunCount(def.id)
  const checksum = def.checksum || mockSha256(def.id)
  const version = def.version || mockVersion(def.id)
  const filePath = `~/.archon/workflows/defaults/${def.id}.yaml`

  function handleLaunch() {
    onOpenLaunchWizard(def.id)
  }

  function handleDelete() {
    if (
      !window.confirm(`Delete workflow "${def.name}"? This cannot be undone.`)
    )
      return
    deleteMutation.mutate(def.id, {
      onSuccess: () => {
        onDeselect?.()
      },
    })
  }

  return (
    <div className="wfa-root">
      {/* 1. Primary CTA */}
      <div className="wfa-section">
        <button className="wfa-launch-btn" onClick={handleLaunch}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            width="15"
            height="15"
          >
            <path d="M5 3l14 9-14 9V3z" />
          </svg>
          Launch Workflow Run
        </button>
        <p className="wfa-launch-note">
          Opens the launch wizard — handoff to Conductor.
        </p>
      </div>

      <div className="wfa-divider" />

      {/* 2. Secondary actions */}
      <div className="wfa-section">
        <div className="wfa-lbl">Actions</div>

        <button
          className="wfa-action-btn"
          onClick={() => console.log('[WorkflowActions] duplicate', def.id)}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            width="12"
            height="12"
          >
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          Duplicate
        </button>

        <button
          className="wfa-action-btn"
          onClick={() => console.log('[WorkflowActions] export-yaml', def.id)}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            width="12"
            height="12"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Export YAML
        </button>

        <div
          className="wfa-delete-wrap"
          title={isBundled ? 'Bundled workflows cannot be deleted' : undefined}
        >
          <button
            className={`wfa-action-btn wfa-action-danger${isBundled ? ' wfa-disabled' : ''}`}
            disabled={isBundled || deleteMutation.isPending}
            onClick={handleDelete}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              width="12"
              height="12"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14H6L5 6" />
            </svg>
            Delete
          </button>
        </div>

        <button
          className="wfa-action-btn"
          onClick={() => console.log('[WorkflowActions] set-default', def.id)}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            width="12"
            height="12"
          >
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          Set as Default
        </button>
      </div>

      <div className="wfa-divider" />

      {/* 3. Live Status */}
      <div className="wfa-section">
        <div className="wfa-lbl">Active Runs</div>
        <div className="wfa-live-panel">
          <div className="wfa-live-row">
            <span
              className={`wfa-pulse${runCount > 0 ? ' wfa-pulse-active' : ''}`}
            />
            <span className="wfa-live-count">
              {runCount === 0
                ? 'No active runs'
                : `${runCount} run${runCount > 1 ? 's' : ''} active`}
            </span>
            <a
              href={`/conductor?workflow=${encodeURIComponent(def.id)}`}
              className="wfa-conductor-link"
            >
              View in Conductor →
            </a>
          </div>
        </div>
      </div>

      <div className="wfa-divider" />

      {/* 4. Metadata footer */}
      <div className="wfa-section wfa-meta-section">
        <div className="wfa-lbl">Metadata</div>
        <div className="wfa-meta-kv">
          <span className="wfa-mk">Checksum</span>
          <span className="wfa-mv wfa-mono" title={checksum}>
            {checksum.slice(0, 12)}…
          </span>
        </div>
        <div className="wfa-meta-kv">
          <span className="wfa-mk">Version</span>
          <span className="wfa-mv">{version}</span>
        </div>
        <div className="wfa-meta-kv">
          <span className="wfa-mk">Source</span>
          <span className="wfa-mv">
            <SourceBadge source={def.source} />
          </span>
        </div>
        <div className="wfa-meta-kv">
          <span className="wfa-mk">Path</span>
          <span className="wfa-mv wfa-mono wfa-path" title={filePath}>
            {filePath}
          </span>
        </div>
      </div>
    </div>
  )
}
