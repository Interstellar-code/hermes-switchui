/**
 * NewWorkflowWizard — 4-step wizard for creating a workflow definition,
 * hosted on the same fixed-size shell as the Run-workflow dialog.
 *
 * Step 1 SOURCE         — describe (chat) / template / duplicate / import YAML / blank
 * Step 2 DESIGN         — live DAG preview (DagSvg + parseDagFromYaml)
 * Step 3 CONFIGURE      — node-level editing with YAML round-tripping
 * Step 4 REVIEW & SAVE  — graph, checks, save target → POST /api/workflow-definitions
 *
 * Step components live in ./new-workflow/.
 *
 * Design source: docs/Design Assets/Hermes-Switchui/workflows-app.jsx + Workflows.html
 */
import { useEffect, useMemo, useState } from 'react'
import {
  useUpsertWorkflowDefinition,
  useWorkflowDefinitions,
} from './use-workflows'
import { LaunchWizard } from './launch-wizard'
import { WorkflowEngineUnavailableError } from './api-client'
import { buildChecks } from './new-workflow/checks'
import { ReviewStep } from './new-workflow/review-step'
import { BLANK_YAML, SourceStep } from './new-workflow/source-step'
import { useWizardValidation } from './new-workflow/use-wizard-validation'
import { WizardShell } from './new-workflow/wizard-shell'
import { lintWorkflowYaml, suggestFreeIds } from './new-workflow/yaml-lint'
import { parseDagFromYaml } from './new-workflow/parse-dag'
import {
  YAML_TEMPLATE,
  createDefaultNodeDraft,
  serializeWorkflowYaml,
  slugify,
  toNodeDraft,
  toWorkflowDocumentDraft,
} from './new-workflow/wizard-draft'
import { DescribeChatPane } from './new-workflow/describe-chat'
import {
  NWZ_CHAT_INIT,
  useDescribeChat,
} from './new-workflow/use-describe-chat'
import { DesignStep } from './new-workflow/design-step'
import { ConfigureStep } from './new-workflow/configure-step'
import type {
  WizardDocumentDraft,
  WizardHermesTaskDraft,
  WizardNodeDraft,
} from './new-workflow/wizard-draft'
import type { SaveFailure } from './new-workflow/review-step'
import type { SourceKind } from './new-workflow/source-step'
import type { NodeType } from './types'
import { ConfirmDialog } from '@/screens/profiles/components/confirm-dialog'

// Legacy contract: provider/model authoring deprecated; handled in ./new-workflow/configure-step.tsx

// ── Main wizard ──────────────────────────────────────────────────────────────

export interface NewWorkflowWizardProps {
  /** If provided, wizard opens on SOURCE → Import YAML with this as the YAML content */
  initialYaml?: string
  /** If provided, pre-fills the workflow id */
  initialId?: string
  onClose: () => void
  /** Called with the saved id when "Open in Workflows after save" is checked. */
  onOpenWorkflow?: (id: string) => void
}

const NO_IDS: ReadonlySet<string> = new Set()
// Mirrors the server's 1 MiB yaml limit for the import path.
const IMPORT_MAX_BYTES = 1024 * 1024

const KIND_LABEL: Record<SourceKind, string> = {
  describe: 'describe with AI',
  template: 'from a template',
  duplicate: 'duplicate existing',
  import: 'import YAML',
  blank: 'blank canvas',
}

export function NewWorkflowWizard({
  initialYaml,
  initialId,
  onClose,
  onOpenWorkflow,
}: NewWorkflowWizardProps) {
  const initialDocument = toWorkflowDocumentDraft(
    initialYaml ?? YAML_TEMPLATE,
  ) ?? {
    id: '',
    name: 'My Workflow',
    description: '',
    topLevel: {},
    nodes: [toNodeDraft({ id: 'start', prompt: 'Hello' }, 0)],
  }
  const [step, setStep] = useState(0)

  // SOURCE state
  const [kind, setKind] = useState<SourceKind>(
    initialYaml ? 'import' : 'describe',
  )
  const [importText, setImportText] = useState(initialYaml ?? '')
  const [importedFileName, setImportedFileName] = useState<string | null>(null)
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('')

  // Draft workflow state
  const [id, setId] = useState(initialId ?? '')
  const [name, setName] = useState(initialDocument.name || 'My Workflow')
  const [description, setDescription] = useState(initialDocument.description)
  const [source, setSource] = useState<'user' | 'project'>('project')
  const [topLevelDraft, setTopLevelDraft] = useState<Record<string, unknown>>(
    initialDocument.topLevel,
  )
  const [nodeDrafts, setNodeDrafts] = useState<Array<WizardNodeDraft>>(
    initialDocument.nodes,
  )
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    initialDocument.nodes[0]?.id ?? null,
  )
  const [yaml, setYaml] = useState(
    initialYaml ??
      serializeWorkflowYaml({
        ...initialDocument,
        name: initialDocument.name || 'My Workflow',
      }),
  )

  // REVIEW state
  const [openAfter, setOpenAfter] = useState(true)
  const [ack, setAck] = useState(false)
  const [failure, setFailure] = useState<SaveFailure | null>(null)
  const [conflicts, setConflicts] = useState<ReadonlySet<string>>(NO_IDS)
  const [runAfter, setRunAfter] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [importTooLarge, setImportTooLarge] = useState(false)

  const upsert = useUpsertWorkflowDefinition()
  const defs = useWorkflowDefinitions()
  const existingWorkflows = defs.data

  // null while the catalog is missing: a 409 alone must not make other ids
  // look free. Conflicts are checked separately by the validation hook.
  const takenIds = useMemo<ReadonlySet<string> | null>(
    () =>
      defs.data ? new Set([...defs.data.map((w) => w.id), ...conflicts]) : null,
    [defs.data, conflicts],
  )
  const validation = useWizardValidation({
    yaml,
    id,
    existingIds: takenIds,
    conflictIds: conflicts,
  })
  const importIssues = useMemo(
    () =>
      !importTooLarge && importText.trim()
        ? lintWorkflowYaml(importText).errors
        : [],
    [importText, importTooLarge],
  )
  const checks = useMemo(
    () => buildChecks(validation, id, validation.idStatus),
    [validation, id],
  )

  const idBlocked =
    validation.idStatus === 'empty' ||
    validation.idStatus === 'invalid' ||
    validation.idStatus === 'taken'
  // The id check has not answered yet (catalog loading/unreachable, validate
  // pending): every flavour of Save stays blocked, but stepping through the
  // wizard remains possible.
  const idSaveBlocked =
    validation.idStatus === 'checking' || validation.idStatus === 'unknown'
  const sourceReady =
    kind === 'template' || kind === 'duplicate'
      ? Boolean(selectedWorkflowId) && !idBlocked
      : kind === 'import'
        ? importText.trim().length > 0 &&
          importIssues.length === 0 &&
          !idBlocked
        : true

  // A new set of risky commands needs a fresh acknowledgement.
  const riskKey = validation.risky
    .map((r) => `${r.node_id}:${r.line}:${r.snippet}`)
    .join('|')
  useEffect(() => {
    setAck(false)
  }, [riskKey])

  function retryIdCheck() {
    // Re-asks the features while unknown, else the validate call (if listed).
    validation.refetchServer()
    if (!validation.hasValidate) void defs.refetch()
  }

  const [initialYamlSnapshot] = useState(
    () =>
      initialYaml ??
      serializeWorkflowYaml({
        ...initialDocument,
        name: initialDocument.name || 'My Workflow',
      }),
  )

  function buildDocument(
    next: {
      name?: string
      description?: string
      topLevel?: Record<string, unknown>
      nodes?: Array<WizardNodeDraft>
    } = {},
  ): WizardDocumentDraft {
    return {
      id: '',
      name: next.name ?? name,
      description: next.description ?? description,
      topLevel: next.topLevel ?? topLevelDraft,
      nodes: next.nodes ?? nodeDrafts,
    }
  }

  function syncYamlFromDocument(nextDoc: WizardDocumentDraft) {
    setYaml(serializeWorkflowYaml(nextDoc))
  }

  function applyParsedDocument(
    nextDoc: WizardDocumentDraft,
    options?: {
      wizardId?: string
      forceName?: string
      forceDescription?: string
    },
  ) {
    const nextName = options?.forceName ?? nextDoc.name
    const nextDescription = options?.forceDescription ?? nextDoc.description
    const normalizedDoc = {
      ...nextDoc,
      name: nextName || 'My Workflow',
      description: nextDescription,
    }
    setTopLevelDraft(normalizedDoc.topLevel)
    setNodeDrafts(normalizedDoc.nodes)
    setName(normalizedDoc.name)
    setDescription(normalizedDoc.description)
    if (options?.wizardId !== undefined) setId(options.wizardId)
    setSelectedNodeId((current) =>
      normalizedDoc.nodes.some((node) => node.id === current)
        ? current
        : (normalizedDoc.nodes[0]?.id ?? null),
    )
    syncYamlFromDocument(normalizedDoc)
  }

  function updateNodes(nextNodes: Array<WizardNodeDraft>) {
    setNodeDrafts(nextNodes)
    syncYamlFromDocument(buildDocument({ nodes: nextNodes }))
  }

  const describeChat = useDescribeChat({
    yaml,
    name,
    description,
    id,
    applyParsedDocument,
    setYaml,
  })

  const dirty =
    kind !== 'describe' ||
    id.trim() !== '' ||
    importText.trim() !== '' ||
    selectedWorkflowId !== '' ||
    describeChat.chatHistory.length > NWZ_CHAT_INIT.length ||
    yaml !== initialYamlSnapshot

  function requestClose() {
    if (dirty) {
      setConfirmDiscard(true)
      return
    }
    onClose()
  }

  const serverBlocked =
    validation.hasValidate &&
    (validation.serverPending || (validation.server?.errors.length ?? 0) > 0)
  const baseOk =
    validation.lint.errors.length === 0 &&
    name.trim().length > 0 &&
    (validation.risky.length === 0 || ack) &&
    !serverBlocked &&
    !upsert.isPending
  const canSave = baseOk && !idBlocked && !idSaveBlocked

  /** Load a valid imported YAML into the draft (original text is kept). */
  function applyImport(text: string, fileName: string | null) {
    const parsed = toWorkflowDocumentDraft(text)
    if (!parsed) {
      setYaml(text)
      return
    }
    applyParsedDocument(parsed, {
      wizardId:
        id ||
        parsed.id ||
        (fileName ? slugify(fileName) : slugify(parsed.name || '')),
      forceName: parsed.name || name || fileName?.replace(/\.ya?ml$/i, ''),
      forceDescription: parsed.description,
    })
    setYaml(text)
  }

  function handleImportText(text: string, fileName?: string | null) {
    const nextFile = fileName === undefined ? importedFileName : fileName
    const tooLarge = new TextEncoder().encode(text).length > IMPORT_MAX_BYTES
    setImportTooLarge(tooLarge)
    setImportText(text)
    setImportedFileName(nextFile)
    if (!tooLarge && text.trim() && lintWorkflowYaml(text).errors.length === 0)
      applyImport(text, nextFile)
  }

  function handleKind(next: SourceKind) {
    setKind(next)
    setSelectedWorkflowId('')
    if (next === 'blank') {
      const parsed = toWorkflowDocumentDraft(BLANK_YAML)
      if (parsed)
        applyParsedDocument(parsed, {
          forceName: 'My Workflow',
          forceDescription: 'New workflow',
        })
    } else if (
      next === 'import' &&
      importText.trim() &&
      lintWorkflowYaml(importText).errors.length === 0
    ) {
      applyImport(importText, importedFileName)
    }
  }

  function handlePickWorkflow(wfId: string) {
    const wf = existingWorkflows?.find((w) => w.id === wfId)
    if (!wf) return
    setSelectedWorkflowId(wfId)
    const nextId = slugify(wf.id + '-copy')
    const nextName = kind === 'duplicate' ? `${wf.name} (copy)` : wf.name
    const parsed = toWorkflowDocumentDraft(wf.yaml || YAML_TEMPLATE)
    if (parsed) {
      applyParsedDocument(parsed, {
        wizardId: nextId,
        forceName: nextName,
        forceDescription: wf.description || parsed.description,
      })
    } else {
      setYaml(wf.yaml || YAML_TEMPLATE)
      setName(nextName)
      setDescription(wf.description || '')
      setId(nextId)
    }
  }

  function handleYamlChange(nextYaml: string) {
    setYaml(nextYaml)
    const parsed = toWorkflowDocumentDraft(nextYaml)
    if (!parsed) return
    setTopLevelDraft(parsed.topLevel)
    setNodeDrafts(parsed.nodes)
    if (parsed.name) setName(parsed.name)
    setDescription(parsed.description)
    setSelectedNodeId((current) =>
      parsed.nodes.some((node) => node.id === current)
        ? current
        : (parsed.nodes[0]?.id ?? null),
    )
  }

  function handleUpdateNode(nodeId: string, patch: Partial<WizardNodeDraft>) {
    const nextNodes = nodeDrafts.map((node) =>
      node.id === nodeId ? { ...node, ...patch } : node,
    )
    if (patch.id && selectedNodeId === nodeId) setSelectedNodeId(patch.id)
    updateNodes(nextNodes)
  }

  function handleUpdateHermesTask(
    nodeId: string,
    patch: Partial<WizardHermesTaskDraft>,
  ) {
    const nextNodes = nodeDrafts.map((node) =>
      node.id === nodeId
        ? { ...node, hermes_task: { ...node.hermes_task, ...patch } }
        : node,
    )
    updateNodes(nextNodes)
  }

  function handleAddNode(type: NodeType) {
    const draft = createDefaultNodeDraft(type, nodeDrafts.length)
    if (nodeDrafts.length > 0) {
      draft.depends_on = [nodeDrafts[nodeDrafts.length - 1]?.id].filter(Boolean)
    }
    const nextNodes = [...nodeDrafts, draft]
    setSelectedNodeId(draft.id)
    updateNodes(nextNodes)
  }

  function handleRemoveNode(nodeId: string) {
    const nextNodes = nodeDrafts
      .filter((node) => node.id !== nodeId)
      .map((node) => ({
        ...node,
        depends_on: node.depends_on.filter((dep) => dep !== nodeId),
      }))
    setSelectedNodeId(nextNodes[0]?.id ?? null)
    updateNodes(nextNodes)
  }

  async function handleSave(over: { run?: boolean; id?: string } = {}) {
    const saveId = over.id ?? id
    setFailure(null)
    try {
      await upsert.mutateAsync({
        id: saveId,
        name: name.trim(),
        description: description.trim() || undefined,
        source,
        yaml,
        ...(kind === 'import' ? { save_source: 'import' as const } : {}),
        // Always create-only: a failed features fetch looks like `[]`, and
        // older engines ignore the unknown key.
        if_absent: true,
      })
      if (over.run) {
        // Hand over to the Run-workflow dialog for the freshly saved definition.
        setRunAfter(saveId)
        return
      }
      if (openAfter) onOpenWorkflow?.(saveId)
      onClose()
    } catch (err) {
      const { status, code } = err as { status?: number; code?: string }
      const message = err instanceof Error ? err.message : 'Unknown error'
      if (status === 409 && code === 'id_taken') {
        setConflicts((prev) => new Set(prev).add(saveId))
        setFailure({ kind: 'conflict', message, id: saveId })
      } else if (status === 409) {
        setFailure({
          kind: 'other',
          message: `The save conflicted with a change on the server: ${message}`,
        })
      } else if (
        err instanceof WorkflowEngineUnavailableError ||
        status === 502 ||
        status === 503
      ) {
        setFailure({ kind: 'engine', message })
      } else {
        setFailure({ kind: 'other', message })
      }
    }
  }

  if (runAfter) {
    return <LaunchWizard workflowId={runAfter} onClose={onClose} />
  }

  const isReview = step === 3
  const suggestion = suggestFreeIds(id, takenIds)[0]
  const conflict = failure?.kind === 'conflict'

  const railRight =
    step === 3 ? (
      <>
        <span
          className={`wz2-chip ${checks.pass === checks.total ? 'ok' : 'er'}`}
        >
          {checks.pass} OF {checks.total} CHECKS PASS
        </span>
        {validation.risky.length > 0 && !ack && (
          <span className="wz2-chip wa">1 TO ACKNOWLEDGE</span>
        )}
      </>
    ) : step === 0 ? (
      defs.isError ? (
        <span className="wz2-chip er">
          {defs.error instanceof WorkflowEngineUnavailableError
            ? 'ENGINE DOWN'
            : 'CATALOG UNAVAILABLE'}
        </span>
      ) : defs.data ? (
        <span className="wz2-chip ok">CATALOG LIVE · {defs.data.length}</span>
      ) : null
    ) : null

  const actions = isReview ? (
    <>
      {conflict && onOpenWorkflow && (
        <button
          type="button"
          className="wfw-btn wfw-btn--secondary"
          onClick={() => {
            onOpenWorkflow(failure.id ?? id)
            onClose()
          }}
        >
          Open existing
        </button>
      )}
      <button
        type="button"
        className="wfw-btn wfw-btn--secondary wz2-sm"
        disabled={!canSave}
        title="Saves, then opens the Run workflow dialog"
        onClick={() => {
          void handleSave({ run: true })
        }}
      >
        Save &amp; run
      </button>
      {conflict && suggestion && (
        <button
          type="button"
          className="wfw-btn wfw-btn--primary"
          disabled={!baseOk || idSaveBlocked}
          onClick={() => {
            setId(suggestion)
            void handleSave({ id: suggestion })
          }}
        >
          Save as {suggestion}
        </button>
      )}
      <button
        type="button"
        className="wfw-btn wfw-btn--primary"
        disabled={!canSave}
        onClick={() => {
          void handleSave()
        }}
      >
        {upsert.isPending ? 'Saving…' : 'Save workflow'}
      </button>
    </>
  ) : (
    <button
      type="button"
      className="wfw-btn wfw-btn--primary"
      disabled={step === 0 && !sourceReady}
      onClick={() => setStep((s) => s + 1)}
    >
      Next ▶
    </button>
  )

  return (
    <>
      <WizardShell
        meta={step === 0 ? KIND_LABEL[kind] : id || name}
        stepIndex={step}
        onStepClick={setStep}
        railRight={railRight}
        onBack={step > 0 ? () => setStep((s) => s - 1) : null}
        actions={actions}
        onClose={requestClose}
      >
        {step === 0 && (
          <SourceStep
            kind={kind}
            onKind={handleKind}
            describePane={<DescribeChatPane {...describeChat} />}
            workflows={existingWorkflows}
            workflowsLoading={defs.isLoading}
            workflowsError={defs.error}
            onRetryWorkflows={() => {
              void defs.refetch()
            }}
            selectedWorkflowId={selectedWorkflowId}
            onSelectWorkflow={handlePickWorkflow}
            id={id}
            onIdChange={setId}
            idStatus={validation.idStatus}
            takenIds={takenIds}
            importText={importText}
            importFileName={importedFileName}
            importTooLarge={importTooLarge}
            onImportText={handleImportText}
            importIssues={importIssues}
          />
        )}

        {step === 1 && <DesignStep yaml={yaml} />}

        {step === 2 && (
          <ConfigureStep
            nodes={nodeDrafts}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            onUpdateNode={handleUpdateNode}
            onUpdateHermesTask={handleUpdateHermesTask}
            onAddNode={handleAddNode}
            onRemoveNode={handleRemoveNode}
          />
        )}

        {step === 3 && (
          <ReviewStep
            yaml={yaml}
            id={id}
            name={name}
            description={description}
            source={source}
            openAfter={openAfter}
            validation={validation}
            idStatus={validation.idStatus}
            takenIds={takenIds}
            ack={ack}
            failure={failure}
            saving={upsert.isPending}
            onId={(v) => {
              setId(v)
              if (failure?.kind === 'conflict') setFailure(null)
            }}
            onName={(v) => {
              setName(v)
              syncYamlFromDocument(buildDocument({ name: v }))
            }}
            onDescription={(v) => {
              setDescription(v)
              syncYamlFromDocument(buildDocument({ description: v }))
            }}
            onSource={setSource}
            onOpenAfter={setOpenAfter}
            onAck={setAck}
            onYaml={handleYamlChange}
            onRetryIdCheck={retryIdCheck}
          />
        )}

        <ConfirmDialog
          open={confirmDiscard}
          title="Discard this workflow draft?"
          message="Your draft (source choice, yaml and id) has unsaved changes. Discarding cannot be undone."
          confirmLabel="Discard draft"
          cancelLabel="Keep editing"
          destructive
          onConfirm={() => {
            setConfirmDiscard(false)
            onClose()
          }}
          onCancel={() => setConfirmDiscard(false)}
        />
      </WizardShell>

      {/* ── Wizard-specific styles ── */}
      <style>{`
        .wz-steps {
          display: flex;
          justify-content: center;
          gap: 40px;
          padding: 14px 20px 10px;
          position: relative;
          flex-shrink: 0;
          border-bottom: 1px solid var(--m-border, #2a2a2a);
        }
        .wz-steps-line {
          position: absolute;
          top: 50%;
          left: 80px;
          right: 80px;
          height: 1px;
          background: var(--m-border, #2a2a2a);
          transform: translateY(-50%);
          z-index: 0;
        }
        .wz-step {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          position: relative;
          z-index: 1;
          cursor: pointer;
          background: transparent;
          border: none;
          padding: 0;
        }
        .wz-step-num {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          border: 1px solid var(--m-border, #444);
          background: var(--m-bg, #0d0d0d);
          font: 600 11px var(--m-font-mono, monospace);
          color: var(--m-text-muted, #888);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all .15s;
        }
        .wz-step.active .wz-step-num {
          border-color: var(--m-green-500, #00ff41);
          color: var(--m-green-500, #00ff41);
          background: rgba(0,255,65,.1);
          box-shadow: 0 0 10px rgba(0,255,65,.3);
        }
        .wz-step.done .wz-step-num {
          border-color: var(--m-green-700, #009926);
          color: var(--m-green-500, #00ff41);
        }
        .wz-step-lbl {
          font: 500 10px var(--m-font-mono, monospace);
          letter-spacing: .08em;
          text-transform: uppercase;
          color: var(--m-text-muted, #888);
        }
        .wz-step.active .wz-step-lbl {
          color: var(--m-green-500, #00ff41);
        }
        .wz-step.done .wz-step-lbl {
          color: var(--m-text, #ccc);
        }

        /* Route / DAG step */
        .wz-route { padding: 4px 0; }
        .route-note {
          font: 400 11px var(--m-font-mono, monospace);
          color: var(--m-text-muted, #888);
          margin-bottom: 12px;
        }
        .node-breakdown {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .nb-row {
          display: flex;
          align-items: center;
          gap: 8px;
          font: 400 11px var(--m-font-mono, monospace);
          padding: 2px 0;
        }
        .nb-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          display: inline-block;
          flex-shrink: 0;
        }
        .nb-type { flex: 1; color: var(--m-text, #e0e0e0); }
        .nb-n { color: var(--m-text-muted, #888); }

        /* Step 3: Configure nodes */
        .wz-config {
          display: grid;
          grid-template-columns: 280px 1fr;
          gap: 16px;
          min-height: 420px;
        }
        .wz-config-list {
          border-right: 1px solid var(--m-border, #2a2a2a);
          padding-right: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .wz-config-toolbar {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .wz-config-add {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .wz-config-cards {
          display: flex;
          flex-direction: column;
          gap: 8px;
          overflow-y: auto;
          max-height: 440px;
        }
        .wz-node-card {
          width: 100%;
          text-align: left;
          background: rgba(255,255,255,.02);
          border: 1px solid var(--m-border, #2a2a2a);
          border-radius: 6px;
          padding: 10px 12px;
          color: inherit;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .wz-node-card:hover {
          border-color: var(--m-border-strong, #3a3a3a);
          background: rgba(255,255,255,.04);
        }
        .wz-node-card.sel {
          border-color: var(--m-green-500, #00ff41);
          background: rgba(0,255,65,.06);
          box-shadow: 0 0 10px rgba(0,255,65,.12);
        }
        .wz-node-card-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .wz-node-card-id {
          font: 600 12px var(--m-font-mono, monospace);
          color: var(--m-text, #f0f0f0);
        }
        .wz-node-card-type {
          font: 500 10px var(--m-font-mono, monospace);
          text-transform: uppercase;
          letter-spacing: .08em;
          border: 1px solid currentColor;
          border-radius: 3px;
          padding: 1px 5px;
        }
        .wz-node-card-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          font: 400 10px var(--m-font-mono, monospace);
          color: var(--m-text-muted, #888);
        }
        .wz-config-editor {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .wz-config-editor-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
        }
        .wz-config-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        .wz-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
          font: 500 11px var(--m-font-mono, monospace);
          color: var(--m-text-muted, #888);
          text-transform: uppercase;
          letter-spacing: .08em;
        }
        .wz-field-full {
          grid-column: 1 / -1;
        }
        .wz-check {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font: 400 12px var(--m-font-sans, sans-serif);
          color: var(--m-text, #f0f0f0);
          cursor: pointer;
        }
        .wz-hermes-box {
          border: 1px solid var(--m-border, #2a2a2a);
          background: rgba(0,255,65,.03);
          border-radius: 6px;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .wz-empty-config {
          font: 400 12px var(--m-font-sans, sans-serif);
          color: var(--m-text-muted, #888);
          padding: 24px;
          text-align: center;
        }

        /* Review step */
        .wz-review {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .wz-checks {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .wz-check-row {
          display: flex;
          align-items: center;
          gap: 8px;
          font: 400 11px var(--m-font-mono, monospace);
          padding: 4px 8px;
          border-radius: 4px;
          background: rgba(255,255,255,.02);
        }
        .wz-check-icon { font-weight: 700; width: 14px; text-align: center; }
        .wz-check-icon.ok { color: var(--m-green-500, #00ff41); }
        .wz-check-icon.er { color: #ff5fa2; }
        .wz-check-name { color: var(--m-text, #e0e0e0); flex: 1; }
        .wz-check-detail { color: var(--m-text-muted, #888); }

        /* Describe chat */
        .plan-chat {
          display: flex;
          flex-direction: column;
          height: 100%;
          min-height: 280px;
        }
        .chat-msgs {
          flex: 1;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 4px 0 12px;
          max-height: 280px;
        }
        .chat-msg {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .chat-who {
          font: 600 10px var(--m-font-mono, monospace);
          letter-spacing: .1em;
          text-transform: uppercase;
        }
        .chat-msg.assistant .chat-who { color: var(--m-green-500, #00ff41); }
        .chat-msg.user .chat-who { color: var(--m-text-muted, #888); }
        .chat-text {
          font: 400 12px var(--m-font-sans, sans-serif);
          color: var(--m-text, #e0e0e0);
          line-height: 1.5;
        }
        .chat-text p { margin: 0 0 4px; }
        .chat-text p:last-child { margin-bottom: 0; }
        .chat-input-row {
          display: flex;
          gap: 8px;
          padding-top: 8px;
          border-top: 1px solid var(--m-border, #2a2a2a);
        }
        .chat-inp {
          flex: 1;
          background: rgba(0,0,0,.4);
          border: 1px solid var(--m-border, #333);
          border-radius: 4px;
          padding: 6px 10px;
          font: 400 12px var(--m-font-sans, sans-serif);
          color: var(--m-text, #f0f0f0);
          outline: none;
        }
        .chat-inp:focus { border-color: var(--m-green-500, #00ff41); }

        /* Shared mini panels */
        .panel-card {
          background: rgba(255,255,255,.02);
          border: 1px solid var(--m-border, #2a2a2a);
          border-radius: 6px;
          padding: 10px 14px;
        }
        .pc-head {
          font: 600 10px var(--m-font-mono, monospace);
          letter-spacing: .12em;
          text-transform: uppercase;
          color: var(--m-text-muted, #888);
          margin-bottom: 8px;
        }
        .pc-body {
          font: 400 12px var(--m-font-sans, sans-serif);
          line-height: 1.6;
        }

        /* Save pane */
        .wfw-save-pane { max-width: 560px; margin: 0 auto; }

        /* btn-mini */
        .btn-mini {
          padding: 5px 12px;
          font: 500 10px var(--m-font-mono, monospace);
          text-transform: uppercase;
          letter-spacing: .1em;
          border-radius: 4px;
          border: 1px solid var(--m-border, #333);
          background: transparent;
          color: var(--m-text, #e0e0e0);
          cursor: pointer;
          display: inline-flex;
          align-items: center;
        }
        .btn-mini:disabled { opacity: .45; cursor: not-allowed; }
        .btn-mini.prim {
          border-color: var(--m-green-500, #00ff41);
          color: var(--m-green-500, #00ff41);
          background: rgba(0,255,65,.06);
        }
        .btn-mini.prim:not(:disabled):hover { background: rgba(0,255,65,.14); }

        .act-lbl {
          font: 600 10px var(--m-font-mono, monospace);
          text-transform: uppercase;
          letter-spacing: .1em;
          color: var(--m-text-muted, #888);
        }
      `}</style>
    </>
  )
}

export { parseDagFromYaml }
