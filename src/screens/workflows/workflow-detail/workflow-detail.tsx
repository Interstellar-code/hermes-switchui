import { Suspense, useMemo, useState } from 'react'
import {
  useDeleteWorkflowDefinition,
  useResetWorkflowDefinitionToFactory,
  useUpsertWorkflowDefinition,
  useValidateWorkflowDefinition,
  useWorkflowDefinitionVersion,
  useWorkflowDefinitionVersions,
  useWorkflowFeatures,
  useWorkflowParsed,
  useWorkflowRuns,
} from '../use-workflows'
import { nodeColor } from '../node-colors'
import { PROVENANCE_LABEL, provenanceOf } from '../provenance'
import { WorkflowEngineUnavailableError } from '../api-client'
import type React from 'react'
import type { CSSProperties } from 'react'
import type { WorkflowDefinitionRow } from '../api-client'
import type { ParsedWorkflow, WorkflowInputDetail } from '../types'
import type { DagModel } from '@/screens/gateway/conductor/dag-model'
import { useConductorScheduled } from '@/screens/gateway/conductor/use-conductor-queries'
import {
  FlowCanvas,
  graphLoading,
} from '@/screens/gateway/conductor/mission-canvas'
import { buildDag } from '@/screens/gateway/conductor/dag-model'
import { ConfirmDialog } from '@/screens/profiles/components/confirm-dialog'
import '@/styles/workflow-detail.css'

export type DetailTab =
  | 'OVERVIEW'
  | 'GRAPH'
  | 'INPUTS'
  | 'SCHEDULES'
  | 'YAML'
  | 'VERSIONS'

interface WorkflowDetailProps {
  workflowId: string
  onBack: () => void
  onEditGraph: () => void
  onOpenLaunchWizard?: (workflowId: string) => void
  onSelectWorkflow?: (workflowId: string) => void
}

function yamlLine(line: string, idx: number): React.ReactElement {
  if (/^\s*#/.test(line)) {
    return (
      <span key={idx} style={{ color: 'var(--m-text-faint, #6f8a78)' }}>
        {line}
        {'\n'}
      </span>
    )
  }
  const kvMatch = line.match(/^(\s*)([^:\s][^:]*?)(\s*:\s*)(.*)$/)
  if (kvMatch) {
    const [, indent, key, colon, value] = kvMatch
    let valueColor = 'var(--m-text, var(--theme-fg, #d8ffe3))'
    if (value === '' || value === '|' || value === '>') {
      valueColor = 'var(--m-text-faint, #6f8a78)'
    } else if (/^".*"$/.test(value) || /^'.*'$/.test(value)) {
      valueColor = 'var(--m-cyan-400, #5ad3ff)'
    } else if (/^\d+(\.\d+)?$/.test(value)) {
      valueColor = 'var(--m-amber-400, #ffb454)'
    }
    return (
      <span key={idx}>
        {indent}
        <span style={{ color: 'var(--m-green-400, #00ff41)' }}>{key}</span>
        <span style={{ color: 'var(--m-text-faint, #6f8a78)' }}>{colon}</span>
        <span style={{ color: valueColor }}>{value}</span>
        {'\n'}
      </span>
    )
  }
  return (
    <span key={idx}>
      {line}
      {'\n'}
    </span>
  )
}

function inputFields(
  parsed: ParsedWorkflow | undefined,
): Array<WorkflowInputDetail> {
  if (!parsed) return []
  if (parsed.inputs_detail && parsed.inputs_detail.length > 0)
    return parsed.inputs_detail
  return [
    ...parsed.required_inputs.map((name) => ({
      name,
      type: 'string',
      required: true,
    })),
    ...parsed.optional_inputs.map((name) => ({
      name,
      type: 'string',
      required: false,
    })),
  ]
}

function formatEditedTime(ts: number | undefined): string {
  if (!ts) return 'recently'
  const d = new Date(ts < 1e12 ? ts * 1000 : ts)
  if (isNaN(d.getTime())) return 'recently'
  const now = new Date()
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return isToday ? `today ${hh}:${mm}` : `${d.toLocaleDateString()} ${hh}:${mm}`
}

function duplicateWorkflowId(id: string): string {
  return `${id}-copy-${Date.now().toString(36)}`
}

export function WorkflowDetail({
  workflowId,
  onBack,
  onEditGraph,
  onOpenLaunchWizard,
  onSelectWorkflow,
}: WorkflowDetailProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>('OVERVIEW')
  const [resetKey, setResetKey] = useState(0)
  const [confirmAction, setConfirmAction] = useState<'delete' | 'reset' | null>(
    null,
  )
  const [copiedChecksum, setCopiedChecksum] = useState(false)
  const [copiedYaml, setCopiedYaml] = useState(false)

  const { data, isLoading, error, refetch } = useWorkflowParsed(workflowId)
  const { data: runsData } = useWorkflowRuns(workflowId)
  const { data: featuresData } = useWorkflowFeatures()
  const { data: schedData } = useConductorScheduled()

  const deleteMutation = useDeleteWorkflowDefinition()
  const resetMutation = useResetWorkflowDefinitionToFactory()
  const duplicateMutation = useUpsertWorkflowDefinition()

  const features = useMemo(() => featuresData?.features ?? [], [featuresData])
  const hasValidate = features.includes('validate')
  const hasVersions = features.includes('definition_versions')

  const parsed = data?.parsed
  const def = data?.definition

  const { data: validationResult, isLoading: validationLoading } =
    useValidateWorkflowDefinition(def?.yaml, def?.id, {
      enabled: hasValidate && Boolean(def?.yaml),
    })

  const [viewVersionChecksum, setViewVersionChecksum] = useState<string | null>(
    null,
  )
  const {
    data: versions,
    isLoading: versionsLoading,
    error: versionsError,
  } = useWorkflowDefinitionVersions(workflowId, hasVersions)
  const { data: versionDetail, isLoading: versionDetailLoading } =
    useWorkflowDefinitionVersion(
      workflowId,
      viewVersionChecksum,
      hasVersions && viewVersionChecksum != null,
    )

  const dag: DagModel | null = useMemo(() => {
    if (!parsed) return null
    return buildDag(parsed)
  }, [parsed])

  const schedulesForThisWf = useMemo(() => {
    if (!schedData?.scheduled) return []
    return schedData.scheduled.filter(
      (s) => s.workflowId === workflowId && s.enabled,
    )
  }, [schedData, workflowId])

  const inputs = useMemo(() => inputFields(parsed), [parsed])

  const runCount = runsData ? runsData.length : def ? def.run_count : 0

  if (isLoading) {
    return (
      <div className="wfd-root">
        <div className="wfd-state-box">
          <div className="wfd-state-title" style={{ opacity: 0.6 }}>
            LOADING WORKFLOW…
          </div>
          <div className="wfd-state-msg">
            Fetching definition for {workflowId}
          </div>
        </div>
      </div>
    )
  }

  const isEngineDown =
    error instanceof WorkflowEngineUnavailableError ||
    (error instanceof Error &&
      (error.message.includes('unavailable') ||
        error.message.includes('503') ||
        error.message.includes('Failed to fetch')))

  const isNotFound =
    Boolean(error && (error as { status?: number }).status === 404) ||
    Boolean(error && error.message.includes('404'))

  if (error || !data || !def || !parsed) {
    if (isEngineDown) {
      return (
        <div className="wfd-root" role="alert">
          <div className="wfd-state-box">
            <div
              className="wfd-state-title"
              style={{ color: 'var(--m-red-400, #ff6b6b)' }}
            >
              WORKFLOW ENGINE DOWN
            </div>
            <div className="wfd-state-msg">
              {error.message ||
                'Workflow engine unavailable. Please ensure the backend is running.'}
            </div>
            <button
              type="button"
              className="wfd-btn wfd-btn-p"
              style={{ marginTop: 12 }}
              onClick={() => void refetch()}
            >
              Retry connection
            </button>
          </div>
        </div>
      )
    }

    if (isNotFound) {
      return (
        <div className="wfd-root" role="alert">
          <div className="wfd-state-box">
            <div className="wfd-state-title">WORKFLOW NOT FOUND</div>
            <div className="wfd-state-msg">
              No workflow definition found for <code>{workflowId}</code>.
            </div>
            <button
              type="button"
              className="wfd-btn"
              style={{ marginTop: 12 }}
              onClick={onBack}
            >
              ← Back to Workflows
            </button>
          </div>
        </div>
      )
    }

    return (
      <div className="wfd-root" role="alert">
        <div className="wfd-state-box">
          <div className="wfd-state-title">ERROR LOADING WORKFLOW</div>
          <div className="wfd-state-msg">
            {error?.message || 'Unknown error'}
          </div>
          <button
            type="button"
            className="wfd-btn"
            style={{ marginTop: 12 }}
            onClick={() => void refetch()}
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  const prov = provenanceOf(def.source, def.user_modified)
  const isFactory = def.source === 'bundled'
  const isModifiedFactory = prov === 'modified-factory'

  const shortChecksum = def.checksum ? def.checksum.slice(0, 8) : '—'
  const versionStr = def.version ? `v${def.version}` : 'v1'
  const editedStr = formatEditedTime(def.updated_at)

  const distinctTypes = dag ? [...new Set(dag.nodes.map((n) => n.type))] : []
  const phasesCount = dag ? new Set(dag.nodes.map((n) => n.stage)).size : 0

  function handleExport() {
    const blob = new Blob([def!.yaml], { type: 'text/yaml;charset=utf-8' })
    const href = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = href
    link.download = `${def!.id}.yaml`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(href)
  }

  function handleCopyChecksum() {
    if (!def?.checksum) return
    void navigator.clipboard.writeText(def.checksum)
    setCopiedChecksum(true)
    setTimeout(() => setCopiedChecksum(false), 2000)
  }

  function handleCopyYaml() {
    if (!def?.yaml) return
    void navigator.clipboard.writeText(def.yaml)
    setCopiedYaml(true)
    setTimeout(() => setCopiedYaml(false), 2000)
  }

  function handleDuplicate() {
    const nextId = duplicateWorkflowId(def!.id)
    duplicateMutation.mutate(
      {
        id: nextId,
        name: `${def!.name} Copy`,
        description: def!.description ?? undefined,
        source: 'user',
        yaml: def!.yaml,
        version: def!.version ?? undefined,
        tags: def!.tags ? JSON.parse(def!.tags) : undefined,
      },
      {
        onSuccess: () => {
          onSelectWorkflow?.(nextId)
        },
      },
    )
  }

  function handleConfirmAction() {
    if (confirmAction === 'delete') {
      deleteMutation.mutate(def!.id, {
        onSuccess: () => {
          setConfirmAction(null)
          onBack()
        },
      })
    } else if (confirmAction === 'reset') {
      resetMutation.mutate(def!.id, {
        onSuccess: () => {
          setConfirmAction(null)
          void refetch()
        },
      })
    }
  }

  return (
    <div className="wfd-root">
      {/* ── Header ── */}
      <div className="wfd-dh">
        <div className="wfd-r">
          <button type="button" className="wfd-back" onClick={onBack}>
            ← WORKFLOWS
          </button>
        </div>
        <div className="wfd-r">
          <h1 className="wfd-dt" title={def.name}>
            {def.name}
          </h1>
          <span
            className={`wfd-chip ${
              prov === 'user' ? 'wfd-chip-cy' : 'wfd-chip-ok'
            }`}
          >
            {PROVENANCE_LABEL[prov].toUpperCase()}
          </span>
          <span className="wfd-chip wfd-chip-mu">{versionStr}</span>
          <span className="wfd-chip wfd-chip-mu">
            sha {shortChecksum}
            <button
              type="button"
              className="wfd-cp"
              aria-label="Copy checksum"
              onClick={handleCopyChecksum}
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <rect x="5.5" y="5.5" width="8" height="8" rx="1" />
                <path d="M3.5 10.5h-1v-8h8v1" />
              </svg>
            </button>
            {copiedChecksum && <span style={{ fontSize: 8 }}>copied</span>}
          </span>
          <span className="wfd-grow" />

          <button
            type="button"
            className="wfd-btn wfd-btn-p"
            onClick={onEditGraph}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path d="M3 13l1-3.5L11 2.5l2.5 2.5-7 7z" />
            </svg>
            EDIT GRAPH
          </button>

          <button
            type="button"
            className="wfd-btn"
            disabled={duplicateMutation.isPending}
            onClick={handleDuplicate}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <rect x="5.5" y="5.5" width="8" height="8" rx="1" />
              <path d="M3.5 10.5h-1v-8h8v1" />
            </svg>
            {duplicateMutation.isPending ? 'DUPLICATING…' : 'DUPLICATE'}
          </button>

          <button type="button" className="wfd-btn" onClick={handleExport}>
            <svg
              width="10"
              height="10"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path d="M8 2v8M4.5 7L8 10.5 11.5 7M3 13.5h10" />
            </svg>
            EXPORT
          </button>

          {isFactory ? (
            <button
              type="button"
              className="wfd-btn wfd-btn-red"
              disabled={!isModifiedFactory || resetMutation.isPending}
              onClick={() => setConfirmAction('reset')}
              title={
                !isModifiedFactory
                  ? 'Factory workflow is already unmodified'
                  : 'Reset definition back to factory default'
              }
            >
              {resetMutation.isPending ? 'RESETTING…' : 'RESET'}
            </button>
          ) : (
            <button
              type="button"
              className="wfd-btn wfd-btn-red"
              disabled={deleteMutation.isPending}
              onClick={() => setConfirmAction('delete')}
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 9h5.6l.7-9" />
              </svg>
              {deleteMutation.isPending ? 'DELETING…' : 'DELETE'}
            </button>
          )}

          <button
            type="button"
            className="wfd-btn wfd-btn-sm wfd-btn-gh"
            onClick={() => onOpenLaunchWizard?.(def.id)}
          >
            <svg
              width="9"
              height="9"
              viewBox="0 0 16 16"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M4 2.5v11l9-5.5z" />
            </svg>
            RUN…
          </button>
        </div>

        <div className="wfd-r wfd-meta">
          <span>{def.id}</span>
          <span>·</span>
          <span>edited {editedStr}</span>
          <span>·</span>
          <span>
            {dag ? dag.nodes.length : (def.node_count ?? 0)} nodes ·{' '}
            {inputs.length} {inputs.length === 1 ? 'input' : 'inputs'}
            {phasesCount > 0 ? ` · ${phasesCount} phases` : ''}
          </span>
          <span className="wfd-grow" />
          <a
            className="wfd-conductor-link"
            href={`/conductor?wf=${encodeURIComponent(def.id)}`}
          >
            {runCount} {runCount === 1 ? 'run' : 'runs'} in Conductor →
          </a>
        </div>
      </div>

      {/* ── Navigation Tabs ── */}
      <nav className="wfd-tabs" role="tablist" aria-label="Workflow sections">
        <button
          type="button"
          role="tab"
          className={`wfd-tab ${activeTab === 'OVERVIEW' ? 'on' : ''}`}
          aria-selected={activeTab === 'OVERVIEW'}
          onClick={() => setActiveTab('OVERVIEW')}
        >
          OVERVIEW
        </button>
        <button
          type="button"
          role="tab"
          className={`wfd-tab ${activeTab === 'GRAPH' ? 'on' : ''}`}
          aria-selected={activeTab === 'GRAPH'}
          onClick={() => setActiveTab('GRAPH')}
        >
          GRAPH
        </button>
        <button
          type="button"
          role="tab"
          className={`wfd-tab ${activeTab === 'INPUTS' ? 'on' : ''}`}
          aria-selected={activeTab === 'INPUTS'}
          onClick={() => setActiveTab('INPUTS')}
        >
          INPUTS<span className="wfd-tab-c">{inputs.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          className={`wfd-tab ${activeTab === 'SCHEDULES' ? 'on' : ''}`}
          aria-selected={activeTab === 'SCHEDULES'}
          onClick={() => setActiveTab('SCHEDULES')}
        >
          SCHEDULES
          <span className="wfd-tab-c">{schedulesForThisWf.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          className={`wfd-tab ${activeTab === 'YAML' ? 'on' : ''}`}
          aria-selected={activeTab === 'YAML'}
          onClick={() => setActiveTab('YAML')}
        >
          YAML
        </button>
        {hasVersions && (
          <button
            type="button"
            role="tab"
            className={`wfd-tab ${activeTab === 'VERSIONS' ? 'on' : ''}`}
            aria-selected={activeTab === 'VERSIONS'}
            onClick={() => setActiveTab('VERSIONS')}
          >
            VERSIONS
            {versions != null && (
              <span className="wfd-tab-c">{versions.length}</span>
            )}
          </button>
        )}
      </nav>

      {/* ── Tab Panels ── */}
      <div className="wfd-body" role="tabpanel">
        {/* OVERVIEW TAB */}
        {activeTab === 'OVERVIEW' && (
          <>
            <div className="wfd-canvas-wrap wfd-canvas-overview">
              <div className="wfd-chd">
                <h2 className="wfd-ttl">GRAPH</h2>
                <span className="wfd-meta">
                  definition · {dag?.nodes.length ?? 0} nodes
                </span>
                <span className="wfd-lg2">
                  {distinctTypes.map((t) => (
                    <span key={t}>
                      <span
                        className="wfd-dot"
                        style={{ background: nodeColor(t) }}
                      />
                      {t.toUpperCase()}
                    </span>
                  ))}
                </span>
                <span className="wfd-grow" />
                <span className="wfd-chip wfd-chip-ok">
                  ✓ VALID · no cycles · deps resolve
                </span>
                <span className="wfd-meta">
                  drag to arrange · saved for this workflow
                </span>
                <button
                  type="button"
                  className="wfd-btn wfd-btn-sm"
                  onClick={() => setResetKey((k) => k + 1)}
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    aria-hidden="true"
                  >
                    <path d="M3 8a5 5 0 1 0 1.5-3.5" />
                    <path d="M3 2v3h3" />
                  </svg>
                  RESET LAYOUT
                </button>
              </div>

              {dag && dag.nodes.length > 0 ? (
                <Suspense fallback={graphLoading}>
                  <FlowCanvas
                    key={`ov-${workflowId}-${resetKey}`}
                    dag={dag}
                    workflowId={workflowId}
                    resetKey={resetKey}
                  />
                </Suspense>
              ) : (
                <div className="dag-empty">No nodes in definition</div>
              )}
            </div>

            <div className="wfd-cols">
              {/* Card 1: ABOUT */}
              <section className="wfd-card" aria-labelledby="h-ab">
                <h2 id="h-ab">ABOUT</h2>
                <div className="wfd-tw">
                  <p className="wfd-txt">
                    {def.description || 'No description provided.'}
                  </p>
                  {distinctTypes.length > 0 && (
                    <p
                      className="wfd-txt"
                      style={{ color: 'var(--m-text-muted, #8fae9a)' }}
                    >
                      {distinctTypes.join(' → ')}
                    </p>
                  )}
                  <dl className="wfd-kv" style={{ marginTop: 4 }}>
                    <dt>trigger phrases</dt>
                    <dd className="wfd-na">none in description</dd>
                    <dt>tags</dt>
                    <dd>
                      {def.tags && JSON.parse(def.tags).length > 0 ? (
                        JSON.parse(def.tags).join(', ')
                      ) : (
                        <span className="wfd-na">none</span>
                      )}
                    </dd>
                    <dt>scope</dt>
                    <dd title={def.scope_path ?? 'default'}>
                      {def.scope_path ?? 'default'}
                    </dd>
                  </dl>
                </div>
              </section>

              {/* Stack: INPUTS + VALIDATION */}
              <div className="wfd-stack">
                <section className="wfd-card" aria-labelledby="h-in">
                  <h2 id="h-in">
                    INPUTS · {inputs.length}
                    <button
                      type="button"
                      className="wfd-card-link"
                      onClick={() => setActiveTab('INPUTS')}
                    >
                      ALL →
                    </button>
                  </h2>
                  {inputs.length === 0 ? (
                    <p className="wfd-txt wfd-na">No declared inputs.</p>
                  ) : (
                    <>
                      <table className="wfd-table">
                        <thead>
                          <tr>
                            <th scope="col">NAME</th>
                            <th scope="col">TYPE</th>
                            <th scope="col">REQ</th>
                            <th scope="col">DEFAULT</th>
                          </tr>
                        </thead>
                        <tbody>
                          {inputs.slice(0, 3).map((f) => (
                            <tr key={f.name}>
                              <td className="wfd-k">{f.name}</td>
                              <td>{f.type}</td>
                              <td className={f.required ? '' : 'wfd-na'}>
                                {f.required ? 'required' : 'optional'}
                              </td>
                              <td className="wfd-na">
                                {f.default != null ? String(f.default) : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {inputs[0]?.description && (
                        <p
                          className="wfd-txt"
                          style={{ marginTop: 6, fontSize: 10 }}
                        >
                          {inputs[0].description}
                        </p>
                      )}
                    </>
                  )}
                </section>

                {hasValidate && (
                  <section className="wfd-card" aria-labelledby="h-val">
                    <h2 id="h-val">VALIDATION</h2>
                    {validationLoading ? (
                      <p className="wfd-txt wfd-na">Validating YAML…</p>
                    ) : validationResult ? (
                      <div className="wfd-tw">
                        <dl className="wfd-kv">
                          <dt>Status</dt>
                          <dd>
                            {validationResult.ok ? (
                              <span
                                style={{ color: 'var(--m-green-400, #00ff41)' }}
                              >
                                ✓ Definition valid
                              </span>
                            ) : (
                              <span
                                style={{ color: 'var(--m-red-400, #ff6b6b)' }}
                              >
                                ✗ {validationResult.errors.length} error(s)
                              </span>
                            )}
                          </dd>
                          {validationResult.errors.map((e, idx) => (
                            <div
                              key={`err-${idx}`}
                              style={{ display: 'contents' }}
                            >
                              <dt
                                style={{ color: 'var(--m-red-400, #ff6b6b)' }}
                              >
                                {e.code}
                                {e.line ? ` (L${e.line})` : ''}
                              </dt>
                              <dd
                                style={{ color: 'var(--m-red-400, #ff6b6b)' }}
                              >
                                {e.message}
                              </dd>
                            </div>
                          ))}
                          {validationResult.warnings.map((w, idx) => (
                            <div
                              key={`wrn-${idx}`}
                              style={{ display: 'contents' }}
                            >
                              <dt
                                style={{ color: 'var(--m-amber-400, #ffb454)' }}
                              >
                                {w.code}
                                {w.line ? ` (L${w.line})` : ''}
                              </dt>
                              <dd
                                style={{ color: 'var(--m-amber-400, #ffb454)' }}
                              >
                                {w.message}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    ) : (
                      <dl className="wfd-kv">
                        <dt>YAML</dt>
                        <dd>
                          <span
                            style={{ color: 'var(--m-green-400, #00ff41)' }}
                          >
                            ✓
                          </span>{' '}
                          parses · schema ok
                        </dd>
                        <dt>graph</dt>
                        <dd>
                          <span
                            style={{ color: 'var(--m-green-400, #00ff41)' }}
                          >
                            ✓
                          </span>{' '}
                          no cycles · {dag?.nodes.length ?? 0} nodes
                        </dd>
                        <dt>dependencies</dt>
                        <dd>
                          <span
                            style={{ color: 'var(--m-green-400, #00ff41)' }}
                          >
                            ✓
                          </span>{' '}
                          all resolve
                        </dd>
                      </dl>
                    )}
                  </section>
                )}
              </div>

              {/* Card 3: VERSIONS (only if backend feature present) or RUNS */}
              {hasVersions ? (
                <section className="wfd-card" aria-labelledby="h-rn">
                  <h2 id="h-rn">
                    VERSIONS
                    <button
                      type="button"
                      className="wfd-card-link"
                      onClick={() => setActiveTab('VERSIONS')}
                    >
                      ALL →
                    </button>
                  </h2>
                  {versionsLoading ? (
                    <p className="wfd-txt">Loading versions…</p>
                  ) : !versions || versions.length === 0 ? (
                    <p className="wfd-txt">
                      No stored versions yet. Every save, import or reset adds
                      one.
                    </p>
                  ) : (
                    <table className="wfd-table">
                      <thead>
                        <tr>
                          <th scope="col">VER</th>
                          <th scope="col">CHECKSUM</th>
                          <th scope="col">SAVED</th>
                          <th scope="col">SOURCE</th>
                          <th scope="col">
                            <span className="wfd-sr">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {versions.slice(0, 3).map((v) => (
                          <tr key={v.checksum}>
                            <td className="wfd-k">
                              {v.version ? `v${v.version}` : '—'}
                              {v.checksum === def.checksum && (
                                <span className="wfd-chip wfd-chip-mu">
                                  CURRENT
                                </span>
                              )}
                            </td>
                            <td>{v.checksum.slice(0, 8)}</td>
                            <td>{formatEditedTime(v.saved_at ?? undefined)}</td>
                            <td>
                              <span className="wfd-chip wfd-chip-mu">
                                {v.source.toUpperCase()}
                              </span>
                            </td>
                            <td>
                              <button
                                type="button"
                                className="wfd-btn wfd-btn-sm wfd-btn-gh"
                                onClick={() => {
                                  setViewVersionChecksum(v.checksum)
                                  setActiveTab('VERSIONS')
                                }}
                              >
                                VIEW
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <p
                    className="wfd-txt"
                    style={{
                      marginTop: 6,
                      fontSize: 10,
                      color: 'var(--m-text-muted, #8fae9a)',
                    }}
                  >
                    Snapshots are kept on save.
                  </p>
                  <p className="wfd-txt" style={{ marginTop: 6, fontSize: 10 }}>
                    <a
                      href={`/conductor?wf=${encodeURIComponent(def.id)}`}
                      style={{
                        color: 'var(--m-green-400, #00ff41)',
                        textDecoration: 'none',
                      }}
                    >
                      {runCount} runs live in Conductor →
                    </a>
                  </p>
                </section>
              ) : (
                <section className="wfd-card" aria-labelledby="h-runs-mini">
                  <h2 id="h-runs-mini">RUNS</h2>
                  <p className="wfd-txt">
                    Workflows manages definitions. Execution details live in
                    Conductor.
                  </p>
                  <p style={{ marginTop: 10 }}>
                    <a
                      className="wfd-conductor-link"
                      style={{ color: 'var(--m-green-400, #00ff41)' }}
                      href={`/conductor?wf=${encodeURIComponent(def.id)}`}
                    >
                      {runCount} {runCount === 1 ? 'run' : 'runs'} in Conductor
                      →
                    </a>
                  </p>
                </section>
              )}
            </div>
          </>
        )}

        {/* GRAPH TAB */}
        {activeTab === 'GRAPH' && (
          <div className="wfd-canvas-wrap wfd-canvas-full">
            <div className="wfd-chd">
              <h2 className="wfd-ttl">FULL DEFINITION GRAPH</h2>
              <span className="wfd-meta">
                {dag?.nodes.length ?? 0} nodes · interactive pan/zoom
              </span>
              <span className="wfd-grow" />
              <button
                type="button"
                className="wfd-btn wfd-btn-sm"
                onClick={() => setResetKey((k) => k + 1)}
              >
                FIT VIEW / RESET
              </button>
            </div>
            {dag && dag.nodes.length > 0 ? (
              <Suspense fallback={graphLoading}>
                <FlowCanvas
                  key={`graph-tab-${workflowId}-${resetKey}`}
                  dag={dag}
                  workflowId={workflowId}
                  resetKey={resetKey}
                />
              </Suspense>
            ) : (
              <div className="dag-empty">No nodes in definition</div>
            )}
          </div>
        )}

        {/* INPUTS TAB */}
        {activeTab === 'INPUTS' && (
          <div className="wfd-card" style={{ flexGrow: 1 }}>
            <h2>DECLARED WORKFLOW INPUTS ({inputs.length})</h2>
            {inputs.length === 0 ? (
              <p className="wfd-txt wfd-na">No inputs required or optional.</p>
            ) : (
              <table className="wfd-table">
                <thead>
                  <tr>
                    <th scope="col">NAME</th>
                    <th scope="col">TYPE</th>
                    <th scope="col">REQUIREMENT</th>
                    <th scope="col">DEFAULT</th>
                    <th scope="col">DESCRIPTION</th>
                  </tr>
                </thead>
                <tbody>
                  {inputs.map((f) => (
                    <tr key={f.name}>
                      <td className="wfd-k">{f.name}</td>
                      <td>{f.type}</td>
                      <td className={f.required ? '' : 'wfd-na'}>
                        {f.required ? 'REQUIRED' : 'OPTIONAL'}
                      </td>
                      <td className="wfd-na">
                        {f.default != null ? String(f.default) : '—'}
                      </td>
                      <td style={{ whiteSpace: 'normal' }}>
                        {f.description || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* SCHEDULES TAB */}
        {activeTab === 'SCHEDULES' && (
          <div className="wfd-card" style={{ flexGrow: 1 }}>
            <h2>SCHEDULES FOR {def.id.toUpperCase()}</h2>
            {schedulesForThisWf.length === 0 ? (
              <div className="wfd-tw">
                <p className="wfd-txt wfd-na">
                  No active engine cron schedules configured for this workflow.
                </p>
                <p
                  className="wfd-txt"
                  style={{
                    color: 'var(--m-text-muted, #8fae9a)',
                    marginTop: 8,
                  }}
                >
                  Configure repeating schedules in Conductor or through the
                  launch wizard.
                </p>
              </div>
            ) : (
              <table className="wfd-table">
                <thead>
                  <tr>
                    <th scope="col">ID</th>
                    <th scope="col">CRON</th>
                    <th scope="col">SCHEDULE LABEL</th>
                    <th scope="col">STATUS</th>
                    <th scope="col">NEXT RUN</th>
                  </tr>
                </thead>
                <tbody>
                  {schedulesForThisWf.map((s) => (
                    <tr key={s.id}>
                      <td className="wfd-k">{s.id}</td>
                      <td>{s.cron ?? '—'}</td>
                      <td>{s.scheduleLabel}</td>
                      <td>{s.enabled ? 'Enabled' : 'Disabled'}</td>
                      <td>
                        {s.nextRunAt
                          ? new Date(s.nextRunAt).toLocaleString()
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* YAML TAB */}
        {activeTab === 'YAML' && (
          <div className="wfd-yaml-wrap">
            <div className="wfd-yaml-toolbar">
              <span className="wfd-meta">
                {def.id}.yaml · {def.yaml.split('\n').length} lines
              </span>
              <button
                type="button"
                className="wfd-btn wfd-btn-sm"
                onClick={handleCopyYaml}
              >
                {copiedYaml ? 'COPIED!' : 'COPY YAML'}
              </button>
            </div>
            <div className="wfd-yaml-body">
              <div className="wfd-yaml-gutter">
                {def.yaml.split('\n').map((_, i) => (
                  <div key={i}>{i + 1}</div>
                ))}
              </div>
              <pre className="wfd-yaml-code">
                {def.yaml.split('\n').map((l, i) => yamlLine(l, i))}
              </pre>
            </div>
          </div>
        )}

        {/* VERSIONS TAB */}
        {activeTab === 'VERSIONS' && hasVersions && (
          <div className="wfd-card" style={{ flexGrow: 1 }}>
            {viewVersionChecksum != null ? (
              <>
                <h2>
                  VERSION{' '}
                  {versionDetail
                    ? versionDetail.checksum.slice(0, 8)
                    : viewVersionChecksum.slice(0, 8)}
                  <button
                    type="button"
                    className="wfd-card-link"
                    onClick={() => setViewVersionChecksum(null)}
                  >
                    ← ALL VERSIONS
                  </button>
                </h2>
                {versionDetailLoading || !versionDetail ? (
                  <p className="wfd-txt">Loading snapshot…</p>
                ) : (
                  <>
                    <p className="wfd-txt" style={{ fontSize: 11 }}>
                      saved{' '}
                      {formatEditedTime(versionDetail.saved_at ?? undefined)} ·
                      source {versionDetail.source} ·{' '}
                      {versionDetail.node_count ?? '?'} nodes · in use by{' '}
                      {versionDetail.in_use_by_runs} run
                      {versionDetail.in_use_by_runs === 1 ? '' : 's'}
                      {versionDetail.checksum === def.checksum
                        ? ' · CURRENT'
                        : ''}
                    </p>
                    <div className="wfd-yaml-wrap">
                      <div className="wfd-yaml-toolbar">
                        <span className="wfd-meta">
                          {def.id}.yaml ·{' '}
                          {versionDetail.yaml.split('\n').length} lines ·
                          read-only
                        </span>
                      </div>
                      <div className="wfd-yaml-body">
                        <div className="wfd-yaml-gutter">
                          {versionDetail.yaml.split('\n').map((_, i) => (
                            <div key={i}>{i + 1}</div>
                          ))}
                        </div>
                        <pre className="wfd-yaml-code">
                          {versionDetail.yaml
                            .split('\n')
                            .map((l, i) => yamlLine(l, i))}
                        </pre>
                      </div>
                    </div>
                  </>
                )}
              </>
            ) : (
              <>
                <h2>VERSION HISTORY</h2>
                {versionsLoading ? (
                  <p className="wfd-txt">Loading versions…</p>
                ) : versionsError ? (
                  <p className="wfd-txt">
                    Couldn’t load versions — the workflow engine reported an
                    error.
                  </p>
                ) : !versions || versions.length === 0 ? (
                  <p className="wfd-txt">
                    No stored versions yet. Every save, import or reset adds
                    one.
                  </p>
                ) : (
                  <table className="wfd-table">
                    <thead>
                      <tr>
                        <th scope="col">VERSION</th>
                        <th scope="col">CHECKSUM</th>
                        <th scope="col">SAVED</th>
                        <th scope="col">SOURCE</th>
                        <th scope="col">NODES</th>
                        <th scope="col">RUNS</th>
                        <th scope="col">
                          <span className="wfd-sr">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {versions.map((v) => (
                        <tr key={v.checksum}>
                          <td className="wfd-k">
                            {v.version ? `v${v.version}` : '—'}
                            {v.checksum === def.checksum && (
                              <span className="wfd-chip wfd-chip-mu">
                                CURRENT
                              </span>
                            )}
                          </td>
                          <td>{v.checksum.slice(0, 8)}</td>
                          <td>{formatEditedTime(v.saved_at ?? undefined)}</td>
                          <td>
                            <span className="wfd-chip wfd-chip-mu">
                              {v.source.toUpperCase()}
                            </span>
                          </td>
                          <td>{v.node_count ?? '—'}</td>
                          <td>
                            {v.in_use_by_runs > 0
                              ? `in use by ${v.in_use_by_runs}`
                              : '—'}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="wfd-btn wfd-btn-sm wfd-btn-gh"
                              onClick={() => setViewVersionChecksum(v.checksum)}
                            >
                              VIEW
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Confirm Dialog */}
      <ConfirmDialog
        open={confirmAction !== null}
        title={
          confirmAction === 'delete'
            ? 'Delete workflow?'
            : 'Reset to factory default?'
        }
        message={
          confirmAction === 'delete'
            ? `Delete workflow "${def.name}"? This cannot be undone.`
            : `Discard user customizations and restore the factory definition for "${def.name}"?`
        }
        confirmLabel={
          confirmAction === 'delete' ? 'Delete workflow' : 'Reset workflow'
        }
        destructive
        onConfirm={handleConfirmAction}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  )
}
