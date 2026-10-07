/**
 * graph-editor.tsx — F4 Workflows v2 graph editor: palette + editable React
 * Flow canvas (shared Conductor FlowCanvas in opt-in `editable` mode) +
 * selected-node config panel, undo/redo, auto-layout, YAML mirror, debounced
 * validation, dirty guard and versioned save with 409 conflict handling.
 *
 * The draft YAML string is the single source of truth; every edit goes
 * through the pure, lossless yaml-model and the graph-history reducer.
 */
import {
  Suspense,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import { useBlocker, useRouter } from '@tanstack/react-router'
import {
  useUpsertWorkflowDefinition,
  useWorkflowFeatures,
  useWorkflowParsed,
} from '../use-workflows'
import {
  WorkflowEngineUnavailableError,
  validateWorkflowDefinition,
} from '../api-client'
import { findRiskyShell, lintWorkflowYaml } from '../new-workflow/yaml-lint'
import { PROVENANCE_LABEL, provenanceOf } from '../provenance'
import {
  addDependency,
  addNode,
  duplicateNode,
  findDanglingOutputRefs,
  getYamlParseError,
  removeDependency,
  removeNodes,
  renameNode,
  setNodeBody,
  setNodePhase,
  setNodeRetry,
  setNodeTimeout,
  setNodeTrigger,
  setNodeType,
  suggestNodeId,
  wouldCreateCycle,
} from './yaml-model'
import { buildEditorDag } from './editor-graph'
import { graphReducer, initHistory, unsavedCount } from './graph-history'
import { NodePalette } from './palette'
import { NodeConfigPanel } from './node-config-panel'
import { ValidationPanel } from './validation-panel'
import type { RefObject } from 'react'
import type { EditorIssue, ValidationState } from './validation-panel'
import type { Point } from '@/screens/gateway/conductor/dag-layout'
import type { NodeType } from '../types'
import {
  FlowCanvas,
  graphLoading,
} from '@/screens/gateway/conductor/mission-canvas'
import { ConfirmDialog } from '@/screens/profiles/components/confirm-dialog'
import '@/styles/graph-editor.css'

const VALIDATE_DEBOUNCE_MS = 400

type SavePhase =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'error'; message: string }
  | { kind: 'conflict' }

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  )
}

function normaliseIssue(raw: {
  line?: number | null
  col?: number | null
  code: string
  message: string
  node_id?: string
}): EditorIssue {
  return {
    line: typeof raw.line === 'number' ? raw.line : null,
    col: typeof raw.col === 'number' ? raw.col : null,
    code: raw.code,
    message: raw.message,
    node_id: raw.node_id,
  }
}

// TanStack history's per-entry position (history.state.__TSR_index).
const HISTORY_INDEX = '__TSR_index'

/** F6: the create wizard's DESIGN step. The host owns the draft YAML. */
export interface EmbeddedGraphEditor {
  yaml: string
  onChange: (yaml: string) => void
}

export interface WorkflowGraphEditorProps {
  /** Route mode: the definition to load and save. */
  workflowId?: string
  /** Route mode: back to the detail page. */
  onExit?: () => void
  /**
   * Embedded mode (wizard): no load, no SAVE/DISCARD bar, no leave guards,
   * no route coupling — `yaml` in, `onChange(yaml)` out.
   */
  embedded?: EmbeddedGraphEditor
}

export function WorkflowGraphEditor({
  workflowId,
  onExit = () => {},
  embedded,
}: WorkflowGraphEditorProps) {
  const isEmbedded = embedded !== undefined
  const {
    data: defData,
    isLoading,
    error,
    refetch,
  } = useWorkflowParsed(workflowId ?? null)
  const { data: featuresData } = useWorkflowFeatures()
  const saveMutation = useUpsertWorkflowDefinition()
  const hasValidate = (featuresData?.features ?? []).includes('validate')

  const def = defData?.definition
  const [history, dispatch] = useReducer(graphReducer, undefined, () =>
    initHistory(''),
  )
  const [baseline, setBaseline] = useState<{
    id: string
    checksum?: string
  } | null>(null)
  if (def && baseline?.id !== def.id) {
    setBaseline({ id: def.id, checksum: def.checksum })
    dispatch({ type: 'reset', yaml: def.yaml })
  }

  // Embedded: adopt the host's yaml whenever it changes from outside (e.g.
  // CONFIGURE edits); every draft change is reported back below.
  const [syncedYaml, setSyncedYaml] = useState<string | null>(null)
  if (embedded && embedded.yaml !== syncedYaml) {
    setSyncedYaml(embedded.yaml)
    if (embedded.yaml !== history.present) {
      dispatch({ type: 'reset', yaml: embedded.yaml })
    }
  }

  const draft = history.present
  const dirty = history.present !== history.saved
  const changes = unsavedCount(history)

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null)
  const [positions, setPositions] = useState<Record<string, Point>>({})
  const [autoLayoutKey, setAutoLayoutKey] = useState(0)
  const [mirrorOpen, setMirrorOpen] = useState(false)
  const [lastPaletteType, setLastPaletteType] = useState<NodeType>('prompt')
  const [validation, setValidation] = useState<ValidationState>({
    phase: 'idle',
  })
  const [validatedDraft, setValidatedDraft] = useState<string | null>(null)
  const [save, setSave] = useState<SavePhase>({ kind: 'idle' })
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)

  const editorDag = useMemo(() => buildEditorDag(draft), [draft])
  const parseError = useMemo(() => getYamlParseError(draft), [draft])
  // e.g. a deleted node's `$id.output` still used elsewhere.
  const danglingRefs = useMemo(() => findDanglingOutputRefs(draft), [draft])
  const errorByNode = useMemo(() => {
    const map = new Map<string, string>()
    if (validation.phase === 'done') {
      for (const issue of validation.errors) {
        if (issue.node_id && !map.has(issue.node_id)) {
          const pos = issue.line != null ? ` (L${issue.line})` : ''
          map.set(issue.node_id, `${issue.message}${pos}`)
        }
      }
    }
    return map
  }, [validation])
  const nodeMeta = useMemo(() => {
    const meta = { ...(editorDag?.meta ?? {}) }
    for (const [id, message] of errorByNode) {
      if (editorDag?.meta[id]) meta[id] = { ...meta[id], errorText: message }
    }
    return meta
  }, [editorDag, errorByNode])

  const selectedNode = useMemo(
    () => editorDag?.graph.nodes.find((n) => n.id === selectedNodeId) ?? null,
    [editorDag, selectedNodeId],
  )

  const isDraftValidated = validatedDraft === draft
  const blockingErrors =
    !isDraftValidated || validation.phase !== 'done'
      ? 1
      : validation.errors.length

  // Latest draft, also within one event: the canvas can fire node + edge
  // deletes back to back before React re-renders.
  const draftRef = useRef(draft)
  draftRef.current = draft

  function applyEdit(
    nextYaml: string | null | undefined,
    coalesceKey?: string,
  ) {
    if (typeof nextYaml !== 'string') return
    draftRef.current = nextYaml
    dispatch({ type: 'edit', yaml: nextYaml, coalesceKey })
  }

  function handleAddNode(type: NodeType, position?: Point, afterId?: string) {
    setLastPaletteType(type)
    const taken = (editorDag?.graph.nodes ?? []).map((n) => n.id)
    const base = `${type}-node`
    const newId = taken.includes(base) ? suggestNodeId(taken, base) : base
    let yaml: string
    try {
      yaml = addNode(draft, type, newId)
      if (afterId) yaml = addDependency(yaml, newId, afterId)
    } catch {
      return
    }
    if (position) setPositions((p) => ({ ...p, [newId]: position }))
    applyEdit(yaml)
    setSelectedNodeId(newId)
  }

  function handleConnect(connection: { source: string; target: string }) {
    if (wouldCreateCycle(draft, connection.source, connection.target)) {
      return
    }
    try {
      applyEdit(addDependency(draft, connection.target, connection.source))
    } catch {
      // duplicate or self edge — nothing to do
    }
  }

  // One Delete keypress (or the panel's DELETE NODE) → one undo step.
  function handleDelete({
    nodeIds,
    edges,
  }: {
    nodeIds: Array<string>
    edges: Array<{ source: string; target: string }>
  }) {
    let yaml = draftRef.current
    if (nodeIds.length) yaml = removeNodes(yaml, nodeIds)
    // FlowCanvas already drops edges of nodes deleted in the same batch.
    for (const { source, target } of edges) {
      try {
        yaml = removeDependency(yaml, target, source)
      } catch {
        // already gone
      }
    }
    applyEdit(yaml)
    if (selectedNodeId && nodeIds.includes(selectedNodeId)) {
      setSelectedNodeId(null)
    }
    if (focusNodeId && nodeIds.includes(focusNodeId)) setFocusNodeId(null)
  }

  function handlePositionsChange(next: Record<string, Point>) {
    setPositions((p) => ({ ...p, ...next }))
  }

  function handleAutoLayout() {
    setPositions({})
    setAutoLayoutKey((k) => k + 1)
  }

  function handleFocusNode(nodeId: string) {
    setSelectedNodeId(nodeId)
    setFocusNodeId(nodeId)
  }

  function handleRename(nextId: string) {
    if (!selectedNodeId) return
    try {
      applyEdit(renameNode(draft, selectedNodeId, nextId))
      setSelectedNodeId(nextId.trim())
      setFocusNodeId(nextId.trim())
      setRenameError(null)
    } catch (e) {
      setRenameError(e instanceof Error ? e.message : 'Rename failed')
    }
  }

  // Debounced validation: engine when the feature is live, client lint otherwise.
  useEffect(() => {
    if (!baseline && !isEmbedded) return
    let cancelled = false
    setValidation((prev) =>
      prev.phase === 'idle' ? { phase: 'loading' } : prev,
    )
    const timer = setTimeout(() => {
      void (async () => {
        if (hasValidate) {
          try {
            // HIGH 2: validate with id = undefined to avoid self id_taken collision
            const result = await validateWorkflowDefinition(draft, undefined)
            if (cancelled) return
            setValidation({
              phase: 'done',
              source: 'engine',
              errors: result.errors.map(normaliseIssue),
              warnings: result.warnings.map(normaliseIssue),
            })
            setValidatedDraft(draft)
            return
          } catch (e) {
            if (!(e instanceof WorkflowEngineUnavailableError)) {
              if (cancelled) return
              setValidation({
                phase: 'error',
                message: e instanceof Error ? e.message : String(e),
              })
              setValidatedDraft(draft)
              return
            }
            // engine down → client lint below
          }
        }
        const lint = lintWorkflowYaml(draft)
        const risky = findRiskyShell(draft)
        if (cancelled) return
        setValidation({
          phase: 'done',
          source: 'client',
          errors: lint.errors.map(normaliseIssue),
          warnings: [
            ...lint.warnings.map(normaliseIssue),
            ...risky.map((r) =>
              normaliseIssue({
                line: r.line,
                col: 1,
                code: 'risky_shell',
                message: `${r.node_id}: ${r.reason} (${r.snippet})`,
                node_id: r.node_id,
              }),
            ),
          ],
        })
        setValidatedDraft(draft)
      })()
    }, VALIDATE_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [draft, hasValidate, baseline, isEmbedded])

  const onChangeRef = useRef(embedded?.onChange)
  onChangeRef.current = embedded?.onChange
  useEffect(() => {
    if (syncedYaml === null || draft === syncedYaml) return
    setSyncedYaml(draft)
    onChangeRef.current?.(draft)
  }, [draft, syncedYaml])

  // Leave-page guard: beforeunload + router blocker.
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const changesRef = useRef(changes)
  changesRef.current = changes

  // Undo / redo + A-to-add keyboard shortcuts (never while typing in a field or with modifiers/dialogs).
  const addAfterSelectedRef = useRef(() => {})
  addAfterSelectedRef.current = () =>
    handleAddNode(lastPaletteType, undefined, selectedNodeId ?? undefined)
  // Set on the editor root: a dialog that hosts the (embedded) editor is not
  // "another dialog on top".
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return
      const dialogs = document.querySelectorAll(
        'dialog[open], [role="dialog"], [role="alertdialog"]',
      )
      if (Array.from(dialogs).some((d) => !d.contains(rootRef.current))) {
        return
      }
      const meta = event.metaKey || event.ctrlKey
      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        dispatch({ type: event.shiftKey ? 'redo' : 'undo' })
        return
      }
      if (!meta && !event.altKey && (event.key === 'a' || event.key === 'A')) {
        event.preventDefault()
        addAfterSelectedRef.current()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  function confirmLeave(): boolean {
    if (!dirtyRef.current) return true
    const ok = window.confirm(
      `Discard ${changesRef.current} unsaved ${changesRef.current === 1 ? 'change' : 'changes'} and leave the graph editor?`,
    )
    if (ok) dispatch({ type: 'markSaved' })
    return ok
  }
  const confirmLeaveRef = useRef(confirmLeave)
  confirmLeaveRef.current = confirmLeave
  useEffect(() => {
    if (!dirty || isEmbedded) return
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty, isEmbedded])

  function guardedExit() {
    if (!confirmLeave()) return
    onExit()
  }

  async function persist(expectedChecksum: string | undefined) {
    if (!def) return
    setSave({ kind: 'saving' })
    try {
      await saveMutation.mutateAsync({
        id: def.id,
        name: def.name,
        description: def.description ?? undefined,
        source: def.source,
        scope_path: def.scope_path ?? undefined,
        yaml: draft,
        version: def.version ?? undefined,
        expected_checksum: expectedChecksum,
      })
      dispatch({ type: 'markSaved' })
      setSave({ kind: 'idle' })
      onExit()
    } catch (e) {
      const err = e as {
        status?: number
        serverError?: string
        message?: string
      }
      if (err.status === 409) setSave({ kind: 'conflict' })
      else
        setSave({
          kind: 'error',
          message:
            err.serverError ??
            (e instanceof Error ? e.message : 'Save failed — please retry'),
        })
    }
  }

  function handleSave() {
    if (blockingErrors > 0 || !dirty || !def || !baseline?.checksum) return
    // HIGH 1: send baseline.checksum so concurrent refetches don't silently overwrite
    void persist(baseline.checksum)
  }

  async function handleConflictReload() {
    setSave({ kind: 'idle' })
    const result = await refetch()
    const nextDef = result.data?.definition
    if (nextDef) {
      dispatch({ type: 'reset', yaml: nextDef.yaml })
      setBaseline({ id: nextDef.id, checksum: nextDef.checksum })
      setSelectedNodeId(null)
      setPositions({})
    }
  }

  function handleConflictOverwrite() {
    setSave({ kind: 'saving' })
    void persist(undefined)
  }

  if (!isEmbedded && isLoading) {
    return (
      <div className="wge-root">
        <div className="wge-state">
          <div className="wge-state-title">LOADING GRAPH EDITOR…</div>
          <div className="wge-state-msg">
            Fetching definition for {workflowId}
          </div>
        </div>
      </div>
    )
  }

  if (!isEmbedded && (error || !def)) {
    return (
      <div className="wge-root" role="alert">
        <div className="wge-state">
          <div className="wge-state-title">GRAPH EDITOR UNAVAILABLE</div>
          <div className="wge-state-msg">
            {error instanceof Error
              ? error.message
              : 'The workflow definition could not be loaded.'}
          </div>
          <button
            type="button"
            className="wge-btn"
            style={{ marginTop: 12 }}
            onClick={onExit}
          >
            ← Back to workflow
          </button>
        </div>
      </div>
    )
  }

  const prov = def ? provenanceOf(def.source, def.user_modified) : null
  // Real origin on the header chip: project rows showed "USER" before (F3-5).
  const originLabel =
    def && prov
      ? def.source === 'bundled'
        ? PROVENANCE_LABEL[prov]
        : def.source
      : ''
  const currentVersion = Math.max(1, parseInt(def?.version ?? '1', 10) || 1)
  const noChecksum = !baseline?.checksum
  const saveDisabled =
    blockingErrors > 0 || !dirty || noChecksum || save.kind === 'saving'
  const saveTitle =
    blockingErrors > 0
      ? `Fix ${blockingErrors} error${blockingErrors === 1 ? '' : 's'} to save`
      : !dirty
        ? 'No unsaved changes'
        : noChecksum
          ? 'Save blocked: definition has no checksum (no conflict check)'
          : 'Save as a new version'

  return (
    <div
      ref={rootRef}
      className={`wge-root${isEmbedded ? ' wge-root--embedded' : ''}`}
    >
      {!isEmbedded && <RouteLeaveGuard confirmLeave={confirmLeaveRef} />}
      {def && prov && (
        <div className="wge-head">
          <div className="wge-r">
            <button type="button" className="wge-back" onClick={guardedExit}>
              ← WORKFLOW
            </button>
            <h1 className="wge-dt" title={def.name}>
              {def.name}
            </h1>
            <span className="wge-chip">{originLabel.toUpperCase()}</span>
            <span className="wge-chip wge-chip-mu">
              {dirty
                ? `v${currentVersion} → v${currentVersion + 1} draft`
                : `v${currentVersion}`}
            </span>
          </div>
          <div className="wge-r wge-meta">
            <span>{def.id}</span>
            <span>·</span>
            <span>
              saving creates a new version; past runs keep their pinned version
            </span>
          </div>
        </div>
      )}

      <div className="wge-main">
        <NodePalette onAdd={(type) => handleAddNode(type)} />

        <div className="wge-center">
          <div className="wge-etb">
            <button
              type="button"
              className="wge-ib"
              aria-label="Undo"
              title="Undo (Cmd/Ctrl+Z)"
              disabled={history.past.length === 0}
              onClick={() => dispatch({ type: 'undo' })}
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
            </button>
            <button
              type="button"
              className="wge-ib flip"
              aria-label="Redo"
              title="Redo (Shift+Cmd/Ctrl+Z)"
              disabled={history.future.length === 0}
              onClick={() => dispatch({ type: 'redo' })}
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
            </button>
            <button
              type="button"
              className="wge-btn wge-btn-gh"
              onClick={handleAutoLayout}
            >
              AUTO-LAYOUT
            </button>
            <button
              type="button"
              className="wge-btn wge-btn-gh"
              aria-pressed={mirrorOpen}
              onClick={() => setMirrorOpen((m) => !m)}
            >
              YAML MIRROR
            </button>
            <span className="wge-grow" />
            {!isEmbedded && (
              <>
                {dirty && (
                  <span className="wge-dirty" role="status">
                    {changes} UNSAVED {changes === 1 ? 'CHANGE' : 'CHANGES'}
                  </span>
                )}
                <button
                  type="button"
                  className="wge-btn wge-btn-gh"
                  disabled={!dirty}
                  onClick={() => setConfirmDiscard(true)}
                >
                  DISCARD
                </button>
                <button
                  type="button"
                  className="wge-btn wge-btn-p"
                  disabled={saveDisabled}
                  title={saveTitle}
                  onClick={handleSave}
                >
                  {save.kind === 'saving' ? 'SAVING…' : 'SAVE'}
                </button>
              </>
            )}
          </div>

          <div className={`wge-canvas-row${mirrorOpen ? ' with-mirror' : ''}`}>
            <div
              className="wge-canvas-wrap"
              data-screen="conductor"
              role="region"
              aria-label="Workflow graph editor canvas"
            >
              <div className="wge-chd">
                <h2 className="wge-ttl">GRAPH · EDITING</h2>
                {dirty && !isEmbedded && (
                  <span className="wge-dirty">
                    {changes} UNSAVED {changes === 1 ? 'CHANGE' : 'CHANGES'}
                  </span>
                )}
                <span className="wge-grow" />
                <span className="wge-meta">
                  drag from palette · connect by dragging a handle · Del removes
                </span>
              </div>
              {editorDag ? (
                <Suspense fallback={graphLoading}>
                  <FlowCanvas
                    dag={editorDag.dag}
                    workflowId={def?.id ?? 'wizard-draft'}
                    editable
                    resetKey={autoLayoutKey}
                    focusNodeId={focusNodeId}
                    onConnect={handleConnect}
                    onDelete={handleDelete}
                    onDropNode={(type, position) =>
                      handleAddNode(type as NodeType, position)
                    }
                    onSelectionChange={(ids) =>
                      setSelectedNodeId(ids[0] ?? null)
                    }
                    onPositionsChange={handlePositionsChange}
                    overridePositions={positions}
                    nodeMeta={nodeMeta}
                  />
                </Suspense>
              ) : (
                <div className="wge-canvas-empty" role="status">
                  {parseError
                    ? `YAML parse error: ${parseError}`
                    : 'No nodes in the draft — add one from the palette, or undo.'}
                </div>
              )}
            </div>
            {mirrorOpen && (
              <div className="wge-mirror" aria-label="YAML mirror, read-only">
                <div className="wge-mirror-head">
                  <span className="wge-meta">
                    {def ? `${def.id}.yaml · ` : ''}draft (read-only)
                  </span>
                </div>
                <div className="wge-mirror-body">
                  <div className="wge-mirror-gutter">
                    {draft.split('\n').map((_, i) => (
                      <div key={i}>{i + 1}</div>
                    ))}
                  </div>
                  <pre className="wge-mirror-code">{draft}</pre>
                </div>
              </div>
            )}
          </div>

          <ValidationPanel state={validation} onFocusNode={handleFocusNode} />

          {danglingRefs.length > 0 && (
            <div className="wge-save-error" role="status">
              DANGLING OUTPUT REFERENCES —{' '}
              {danglingRefs
                .map((r) => `${r.nodeId} uses $${r.refId}.output`)
                .join('; ')}
            </div>
          )}
          {def && noChecksum && (
            <div className="wge-save-error" role="status">
              SAVE BLOCKED — this definition has no checksum, so a save could
              silently overwrite a newer version. Reload the workflow.
            </div>
          )}
          {save.kind === 'error' && (
            <div className="wge-save-error" role="alert">
              SAVE FAILED — {save.message}
            </div>
          )}
        </div>

        {selectedNode ? (
          <NodeConfigPanel
            key={selectedNode.id}
            node={selectedNode}
            nodes={editorDag?.graph.nodes ?? []}
            renameError={renameError}
            onRename={handleRename}
            onTypeChange={(type) =>
              applyEdit(setNodeType(draft, selectedNode.id, type))
            }
            onPhaseChange={(phase) =>
              applyEdit(setNodePhase(draft, selectedNode.id, phase))
            }
            onBodyChange={(body) =>
              applyEdit(
                setNodeBody(draft, selectedNode.id, body),
                `${selectedNode.id}:body`,
              )
            }
            onAddDependency={(depId) => {
              try {
                applyEdit(addDependency(draft, selectedNode.id, depId))
              } catch {
                // duplicate — ignore
              }
            }}
            onRemoveDependency={(depId) =>
              applyEdit(removeDependency(draft, selectedNode.id, depId))
            }
            onTriggerChange={(rule) =>
              applyEdit(setNodeTrigger(draft, selectedNode.id, rule))
            }
            onRetryChange={(attempts) =>
              applyEdit(
                setNodeRetry(draft, selectedNode.id, attempts),
                `${selectedNode.id}:retry`,
              )
            }
            onTimeoutChange={(seconds) =>
              applyEdit(
                setNodeTimeout(draft, selectedNode.id, seconds),
                `${selectedNode.id}:timeout`,
              )
            }
            onDelete={() =>
              handleDelete({ nodeIds: [selectedNode.id], edges: [] })
            }
            onDuplicate={() => {
              try {
                const result = duplicateNode(draft, selectedNode.id)
                applyEdit(result.yaml)
                setSelectedNodeId(result.newId)
              } catch {
                // duplicate error ignored
              }
            }}
          />
        ) : (
          <aside className="wge-cfg wge-cfg-empty" aria-label="Selected node">
            <h2>SELECTED NODE</h2>
            <p className="wge-meta">
              Click a node on the canvas to configure it. Drag from the palette
              to add one, or press A to add after the selection.
            </p>
          </aside>
        )}
      </div>

      {def && (
        <ConfirmDialog
          open={confirmDiscard}
          title="Discard unsaved changes?"
          message={`Discard ${changes} unsaved ${changes === 1 ? 'change' : 'changes'} and restore the last saved version of "${def.name}"?`}
          confirmLabel="Discard changes"
          destructive
          onConfirm={() => {
            setConfirmDiscard(false)
            dispatch({ type: 'reset', yaml: def.yaml })
            setBaseline({ id: def.id, checksum: def.checksum })
            setSelectedNodeId(null)
            setPositions({})
            setFocusNodeId(null)
          }}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}

      {save.kind === 'conflict' && (
        <div className="wge-dialog-backdrop" role="presentation">
          <div
            className="wge-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="wge-conflict-title"
            aria-describedby="wge-conflict-msg"
          >
            <h2 id="wge-conflict-title">CHANGED ELSEWHERE</h2>
            <p id="wge-conflict-msg">
              This workflow was saved by someone else while you were editing.
              Reload the newer definition (your draft is discarded) or overwrite
              it with your draft (the other change will be lost)?
            </p>
            <div className="wge-dialog-actions">
              <button
                type="button"
                className="wge-btn"
                onClick={() => void handleConflictReload()}
              >
                RELOAD
              </button>
              <button
                type="button"
                className="wge-btn wge-btn-p"
                onClick={handleConflictOverwrite}
              >
                OVERWRITE
              </button>
              <button
                type="button"
                className="wge-btn wge-btn-gh"
                onClick={() => setSave({ kind: 'idle' })}
              >
                KEEP EDITING
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** Route mode only: the editor's leave guard as a router blocker. */
function RouteLeaveGuard({
  confirmLeave,
}: {
  confirmLeave: RefObject<() => boolean>
}) {
  // The one guard for every navigation: app links, the workflows layout's
  // ?wf=/?run= changes, and browser Back/Forward/Go.
  const router = useRouter()
  useBlocker({
    shouldBlockFn: async ({ action, current, next }) => {
      // Only another page or workflow (the layout's ?wf=) leaves the editor;
      // ?run=/?wizard= changes keep it mounted.
      const search = (l: typeof next) => l.search as Record<string, unknown>
      if (
        next.pathname === current.pathname &&
        search(next).wf === search(current).wf
      ) {
        return false
      }
      if (action === 'PUSH' || action === 'REPLACE') {
        return !confirmLeave.current()
      }
      // A pop has already moved the browser. TanStack undoes a blocked pop
      // with history.go(1), which is right only for Back — so step back by
      // the real delta ourselves and let the router re-read the restored URL.
      const delta =
        Number(window.history.state?.[HISTORY_INDEX]) -
        Number(router.history.location.state[HISTORY_INDEX])
      if (confirmLeave.current()) return false
      if (!Number.isFinite(delta)) return true // unknown entry: TanStack's go(1)
      await new Promise<void>((resolve) => {
        window.addEventListener('popstate', () => resolve(), { once: true })
        window.history.go(-delta)
      })
      return false
    },
    enableBeforeUnload: false,
  })
  return null
}
