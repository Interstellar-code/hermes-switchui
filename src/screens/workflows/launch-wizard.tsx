/**
 * launch-wizard.tsx — shared launch dialog (D10).
 *
 * `LaunchDialog` serves Conductor "New Mission" and /workflows. `LaunchWizard`
 * is the legacy /workflows entry point: a thin wrapper that preselects a
 * workflow. Steps: WORKFLOW → INPUTS → WHEN → CONFIRM. The Route step is
 * hidden until routing ships (LB2/C2).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import '@/styles/workflow-ui.css'
import {
  useLaunchWorkflowRun,
  useWorkflowDefinitions,
  useWorkflowParsed,
} from './use-workflows'
import { useWorkflowRunIndex } from './run-status'
import type {
  LaunchDialogProps,
  LaunchDialogStep,
} from './launch-dialog-contract'
import type { WorkflowInputDetail, WorkflowSummary } from './types'
import { useFocusTrap } from '@/components/ui/use-focus-trap'
import { toast } from '@/components/ui/toast'
import { useConductorScheduled } from '@/screens/gateway/conductor/use-conductor-queries'

const STEPS: Array<{ id: LaunchDialogStep; title: string }> = [
  { id: 'workflow', title: 'Workflow' },
  { id: 'inputs', title: 'Inputs' },
  { id: 'when', title: 'When' },
  { id: 'confirm', title: 'Confirm' },
]

const RECENT_LIMIT = 4

/** Fields come from `inputs_detail`; older responses fall back to the name lists. */
function inputFields(
  parsed:
    | {
        inputs_detail?: Array<WorkflowInputDetail>
        required_inputs: Array<string>
        optional_inputs: Array<string>
      }
    | undefined,
): Array<WorkflowInputDetail> {
  if (!parsed) return []
  if (parsed.inputs_detail) return parsed.inputs_detail
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

/** YAML default as display text (objects as JSON, never "[object Object]"). */
const defaultText = (f: WorkflowInputDetail): string | undefined =>
  f.default == null
    ? undefined
    : typeof f.default === 'object'
      ? JSON.stringify(f.default)
      : String(f.default)

/** User-edited value only — YAML defaults are applied by the engine, never sent. */
const valueOf = (
  values: Record<string, string>,
  f: WorkflowInputDetail,
): string => values[f.name] ?? ''

function needsHint(wf: WorkflowSummary): string {
  if (wf.required_inputs.length)
    return `needs: ${wf.required_inputs.join(', ')}`
  return wf.optional_inputs.length
    ? `${wf.optional_inputs.length} optional inputs`
    : 'no inputs'
}

/** "9 nodes · approval · needs: x" — node count omitted when the list row lacks it. */
function wfMeta(wf: WorkflowSummary): string {
  return [
    wf.node_count ? `${wf.node_count} nodes` : null,
    wf.has_loop ? 'loops' : null,
    wf.has_approval ? 'approval' : null,
    needsHint(wf),
  ]
    .filter(Boolean)
    .join(' · ')
}

// ── Step 1 — workflow list (left pane, always visible) ───────────────────────

function WorkflowList({
  workflows,
  loading,
  failed,
  selectedId,
  onSelect,
}: {
  workflows: Array<WorkflowSummary>
  loading: boolean
  failed: boolean
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const runIndex = useWorkflowRunIndex().data

  const q = query.trim().toLowerCase()
  const matches = useMemo(
    () =>
      workflows.filter(
        (w) =>
          !q ||
          w.id.toLowerCase().includes(q) ||
          w.name.toLowerCase().includes(q) ||
          w.description.toLowerCase().includes(q),
      ),
    [workflows, q],
  )
  const recent = useMemo(() => {
    if (q || !runIndex) return []
    const byId = new Map(matches.map((w) => [w.id, w]))
    return Object.entries(runIndex)
      .filter(([id, s]) => byId.has(id) && s.last)
      .sort(([, a], [, b]) =>
        String(b.last?.started_at).localeCompare(String(a.last?.started_at)),
      )
      .slice(0, RECENT_LIMIT)
      .map(([id]) => byId.get(id)!)
  }, [matches, runIndex, q])
  const recentIds = new Set(recent.map((w) => w.id))
  const rest = matches.filter((w) => !recentIds.has(w.id))

  const row = (w: WorkflowSummary) => (
    <button
      key={w.id}
      type="button"
      className={`wfl-wf${w.id === selectedId ? ' is-sel' : ''}`}
      aria-pressed={w.id === selectedId}
      onClick={() => onSelect(w.id)}
    >
      <span className="wfl-wf-name">{w.name || w.id}</span>
      <span className="wfl-meta">{wfMeta(w)}</span>
    </button>
  )

  return (
    <div className="wfl-left">
      <input
        className="wfl-input wfl-search"
        type="search"
        aria-label="Find a workflow"
        placeholder="Find a workflow…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="wfl-list" aria-busy={loading}>
        {loading ? (
          <div className="wfl-skeletons" aria-label="Loading workflows">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="wfl-skeleton" />
            ))}
          </div>
        ) : failed ? (
          <div className="wfl-error wfl-empty" role="alert">
            Couldn&apos;t load workflows.
          </div>
        ) : matches.length === 0 ? (
          <div className="wfl-empty">
            {workflows.length === 0
              ? 'No workflows defined yet.'
              : 'No workflows match your search.'}
          </div>
        ) : (
          <>
            {recent.length > 0 && (
              <div className="wfl-label wfl-group">Recent</div>
            )}
            {recent.map(row)}
            {recent.length > 0 && rest.length > 0 && (
              <div className="wfl-label wfl-group">All</div>
            )}
            {rest.map(row)}
          </>
        )}
      </div>
    </div>
  )
}

// ── Right pane steps ─────────────────────────────────────────────────────────

function WorkflowPreview({ wf }: { wf: WorkflowSummary | undefined }) {
  if (!wf)
    return (
      <div className="wfl-empty">
        Pick a workflow on the left to start a mission.
      </div>
    )
  return (
    <div className="wfl-pane-col">
      <span className="wfl-label">Workflow</span>
      <div className="wfl-title">{wf.name || wf.id}</div>
      <div className="wfl-meta">{wf.id}</div>
      {wf.description && <p className="wfl-desc">{wf.description}</p>}
      <div className="wfl-sum">
        {wfMeta(wf)}
        {wf.has_approval ? ' — pauses for your approval' : ''}
      </div>
    </div>
  )
}

function InputsStep({
  wfId,
  fields,
  loading,
  failed,
  values,
  setValue,
  userMessage,
  setUserMessage,
}: {
  wfId: string
  fields: Array<WorkflowInputDetail>
  loading: boolean
  failed: boolean
  values: Record<string, string>
  setValue: (name: string, v: string) => void
  userMessage: string
  setUserMessage: (v: string) => void
}) {
  return (
    <div className="wfl-pane-col">
      <span className="wfl-label">Inputs · {wfId}</span>
      {loading ? (
        <div className="wfl-skeleton" aria-label="Loading inputs" />
      ) : failed ? (
        <div className="wfl-error" role="alert">
          Couldn&apos;t load this workflow&apos;s inputs. Pick it again or try
          later.
        </div>
      ) : fields.length === 0 ? (
        <div className="wfl-meta">This workflow takes no inputs.</div>
      ) : (
        <div className="wfl-fields">
          {fields.map((f) => {
            const id = `wfl-in-${f.name}`
            const v = valueOf(values, f)
            const def = defaultText(f)
            return (
              <div key={f.name} className="wfl-field">
                <label
                  id={`${id}-label`}
                  htmlFor={f.type === 'boolean' ? undefined : id}
                  className="wfl-field-name"
                >
                  {f.name}
                  {f.required ? (
                    <span className="wfl-req" title="required">
                      {' '}
                      *
                    </span>
                  ) : (
                    <span className="wfl-opt"> optional</span>
                  )}
                </label>
                {f.type === 'boolean' ? (
                  <div
                    className="wfl-seg"
                    role="group"
                    aria-labelledby={`${id}-label`}
                  >
                    {['false', 'true'].map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        aria-pressed={(v || def) === opt}
                        className={(v || def) === opt ? 'is-on' : ''}
                        onClick={() => setValue(f.name, opt)}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                ) : (
                  <input
                    id={id}
                    className="wfl-input"
                    type={f.type === 'number' ? 'number' : 'text'}
                    value={v}
                    placeholder={def}
                    required={f.required}
                    onChange={(e) => setValue(f.name, e.target.value)}
                  />
                )}
                {f.description && (
                  <span className="wfl-meta">{f.description}</span>
                )}
              </div>
            )
          })}
        </div>
      )}
      <label htmlFor="wfl-context" className="wfl-label">
        Context (optional)
      </label>
      <textarea
        id="wfl-context"
        className="wfl-input wfl-context"
        placeholder="Issue number, repo, or extra prompt context…"
        value={userMessage}
        onChange={(e) => setUserMessage(e.target.value)}
      />
    </div>
  )
}

type WhenMode = 'now' | 'at'

/** `<input type=datetime-local>` value → Date, or null if empty/invalid/past. */
function futureDate(local: string): Date | null {
  const d = new Date(local)
  return local && !isNaN(d.getTime()) && d.getTime() > Date.now() ? d : null
}

/** Current local time as a `datetime-local` value (YYYY-MM-DDTHH:mm). */
const localNow = () =>
  new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16)

function WhenStep({
  mode,
  setMode,
  datetime,
  setDatetime,
  schedulerAlive,
}: {
  mode: WhenMode
  setMode: (m: WhenMode) => void
  datetime: string
  setDatetime: (v: string) => void
  schedulerAlive: boolean
}) {
  return (
    <div className="wfl-pane-col">
      <span className="wfl-label">When</span>
      <div className="wfl-seg" role="group" aria-label="When to run">
        <button
          type="button"
          aria-pressed={mode === 'now'}
          className={mode === 'now' ? 'is-on' : ''}
          onClick={() => setMode('now')}
        >
          Now
        </button>
        <button
          type="button"
          aria-pressed={mode === 'at'}
          className={mode === 'at' ? 'is-on' : ''}
          disabled={!schedulerAlive}
          onClick={() => setMode('at')}
        >
          At a time
        </button>
        <button
          type="button"
          disabled
          aria-disabled="true"
          title="Not supported yet"
        >
          Repeat (cron)
        </button>
      </div>
      {mode === 'at' && (
        <>
          <label htmlFor="wfl-at" className="wfl-field-name">
            Run at
          </label>
          <input
            id="wfl-at"
            type="datetime-local"
            className="wfl-input wfl-datetime"
            value={datetime}
            min={localNow()}
            onChange={(e) => setDatetime(e.target.value)}
          />
          {datetime && !futureDate(datetime) && (
            <span className="wfl-warn">Pick a time in the future.</span>
          )}
        </>
      )}
      {!schedulerAlive && (
        <span className="wfl-meta" role="note">
          Scheduling needs the workflow scheduler daemon, which isn&apos;t
          running — runs start now only.
        </span>
      )}
      <span className="wfl-meta" role="note">
        Repeat schedules aren&apos;t supported by the workflow engine yet.
      </span>
    </div>
  )
}

function ConfirmStep({
  wf,
  fields,
  values,
  userMessage,
  mode,
  datetime,
  error,
}: {
  wf: WorkflowSummary | undefined
  fields: Array<WorkflowInputDetail>
  values: Record<string, string>
  userMessage: string
  mode: WhenMode
  datetime: string
  error: string | null
}) {
  const filled = fields.filter((f) => valueOf(values, f).trim())
  return (
    <div className="wfl-pane-col">
      <span className="wfl-label">Confirm</span>
      <div className="wfl-sum">
        <div>
          <strong>{wf?.name ?? '—'}</strong>{' '}
          <span className="wfl-meta">{wf?.id}</span>
        </div>
        <div>
          {mode === 'now'
            ? 'Starts immediately'
            : `Scheduled for ${new Date(datetime).toLocaleString()}`}
        </div>
        {filled.map((f) => (
          <div key={f.name}>
            {f.name} ={' '}
            <span className="wfl-val">{valueOf(values, f).trim()}</span>
          </div>
        ))}
        {userMessage.trim() && <div>context: {userMessage.trim()}</div>}
      </div>
      {error && (
        <div className="wfl-error" role="alert">
          {error}
        </div>
      )}
    </div>
  )
}

// ── Dialog ───────────────────────────────────────────────────────────────────

function LaunchDialogBody({
  initialWorkflowId,
  initialStep,
  onClose,
  onRunLaunched,
}: Omit<LaunchDialogProps, 'open'>) {
  const [workflowId, setWorkflowId] = useState<string | null>(
    initialWorkflowId ?? null,
  )
  // Skipping ahead needs a workflow; otherwise a preselected workflow lands on INPUTS.
  const [rawStep, setStep] = useState<LaunchDialogStep>(
    !initialWorkflowId ? 'workflow' : (initialStep ?? 'inputs'),
  )
  const [values, setValues] = useState<Record<string, string>>({})
  const [userMessage, setUserMessage] = useState('')
  const [mode, setMode] = useState<WhenMode>('now')
  const [datetime, setDatetime] = useState('')
  const [error, setError] = useState<string | null>(null)

  const defs = useWorkflowDefinitions()
  const workflows = useMemo(
    () => (defs.data ?? []).filter((w) => w.kind !== 'subgraph'),
    [defs.data],
  )
  const wf = (defs.data ?? []).find((w) => w.id === workflowId)
  const parsed = useWorkflowParsed(workflowId)
  const fields = inputFields(parsed.data?.parsed)
  const launch = useLaunchWorkflowRun()
  // Scheduled-run support: 404 / error / offline all mean "not alive".
  const schedulerAlive = useConductorScheduled().data?.schedulerAlive === true
  const effectiveMode: WhenMode = schedulerAlive ? mode : 'now'

  const modalRef = useRef<HTMLDivElement>(null)
  const close = () => {
    if (!launch.isPending) onClose()
  }
  useFocusTrap(true, modalRef, close)

  function selectWorkflow(id: string) {
    if (id === workflowId) return
    setWorkflowId(id)
    setValues({})
    setError(null)
  }

  // A declared YAML default satisfies a required input (the engine applies it).
  const inputsReady =
    !parsed.isLoading &&
    !parsed.isError &&
    fields.every(
      (f) => !f.required || valueOf(values, f).trim() || f.default != null,
    )
  // Never sit past INPUTS while a required input is unsatisfied (also clamps initialStep).
  const step: LaunchDialogStep =
    rawStep !== 'workflow' && !inputsReady ? 'inputs' : rawStep
  const canNext =
    step === 'workflow'
      ? Boolean(wf)
      : step === 'inputs'
        ? inputsReady
        : step === 'when'
          ? effectiveMode === 'now' || futureDate(datetime) !== null
          : false
  const idx = STEPS.findIndex((s) => s.id === step)

  function submit() {
    if (!wf || launch.isPending || !inputsReady) return // guard double-submit before React flushes disabled
    const variables: Record<string, string> = {}
    for (const f of fields) {
      const v = valueOf(values, f).trim()
      if (v) variables[f.name] = v
    }
    const at = effectiveMode === 'at' ? futureDate(datetime) : null
    if (effectiveMode === 'at' && !at) {
      setError('Scheduled time has passed — pick a new time.')
      return
    }
    setError(null)
    launch.mutate(
      {
        workflow_id: wf.id,
        conversation_id: crypto.randomUUID(),
        user_message: userMessage.trim() || `Launch ${wf.name}`,
        variables: Object.keys(variables).length ? variables : undefined,
        schedule: at ? { type: 'at', at: at.toISOString() } : { type: 'now' },
        priority: 50,
        maxRuntimeSeconds: 3600,
      },
      {
        onSuccess: (result) => {
          onClose()
          // A scheduled row is not a run yet — nothing to select until the daemon fires it.
          if (at) toast(`Scheduled ${wf.name} for ${at.toLocaleString()}`)
          else onRunLaunched(result.run.id, wf.id)
        },
        onError: (err) => {
          setError(`Launch failed: ${err.message}`)
          toast(`Launch failed: ${err.message}`, { type: 'error' })
        },
      },
    )
  }

  return createPortal(
    <div data-wf-ui>
      <div className="wfw-backdrop" onClick={close}>
        <div
          ref={modalRef}
          className="wfl-dlg"
          role="dialog"
          aria-modal="true"
          aria-label="New mission"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="wfl-hd">
            <span className="wfl-t">NEW MISSION</span>
            <span className="wfl-grow" />
            <button
              className="wfw-close-btn"
              onClick={close}
              aria-label="Close dialog"
            >
              ✕
            </button>
          </div>
          <ol className="wfl-steps" aria-label="Steps">
            {STEPS.map((s, i) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={`wfl-pill${i === idx ? ' is-on' : ''}${i < idx ? ' is-done' : ''}`}
                  aria-current={i === idx ? 'step' : undefined}
                  disabled={i > idx}
                  onClick={() => setStep(s.id)}
                >
                  {i + 1} {s.title.toUpperCase()}
                  {i < idx ? ' ✓' : ''}
                </button>
              </li>
            ))}
          </ol>
          <div className="wfl-body">
            <WorkflowList
              workflows={workflows}
              loading={defs.isLoading}
              failed={defs.isError}
              selectedId={workflowId}
              onSelect={selectWorkflow}
            />
            <div className="wfl-right">
              {step === 'workflow' && <WorkflowPreview wf={wf} />}
              {step === 'inputs' && workflowId && (
                <InputsStep
                  wfId={workflowId}
                  fields={fields}
                  loading={parsed.isLoading}
                  failed={parsed.isError}
                  values={values}
                  setValue={(name, v) =>
                    setValues((p) => ({ ...p, [name]: v }))
                  }
                  userMessage={userMessage}
                  setUserMessage={setUserMessage}
                />
              )}
              {step === 'when' && (
                <WhenStep
                  mode={effectiveMode}
                  setMode={setMode}
                  datetime={datetime}
                  setDatetime={setDatetime}
                  schedulerAlive={schedulerAlive}
                />
              )}
              {step === 'confirm' && (
                <ConfirmStep
                  wf={wf}
                  fields={fields}
                  values={values}
                  userMessage={userMessage}
                  mode={effectiveMode}
                  datetime={datetime}
                  error={error}
                />
              )}
            </div>
          </div>
          <div className="wfw-footer">
            <button
              className="wfw-btn wfw-btn--secondary"
              onClick={() => setStep(STEPS[idx - 1].id)}
              disabled={idx === 0}
            >
              Back
            </button>
            <div className="wfw-footer-spacer" />
            <button className="wfw-btn wfw-btn--ghost" onClick={close}>
              Cancel
            </button>
            {step === 'confirm' ? (
              <button
                className="wfw-btn wfw-btn--primary"
                onClick={submit}
                disabled={launch.isPending || !wf}
              >
                {launch.isPending
                  ? 'Launching…'
                  : effectiveMode === 'at'
                    ? 'Schedule ▶'
                    : 'Launch ▶'}
              </button>
            ) : (
              <button
                className="wfw-btn wfw-btn--primary"
                onClick={() => setStep(STEPS[idx + 1].id)}
                disabled={!canNext}
              >
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export function LaunchDialog({ open, ...rest }: LaunchDialogProps) {
  // Portal target (document.body) only exists after mount — keeps SSR safe.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!open || !mounted) return null
  // Body unmounts on close, so every open starts from clean state.
  return <LaunchDialogBody {...rest} />
}

// ── Legacy /workflows entry point ────────────────────────────────────────────

interface LaunchWizardProps {
  workflowId: string | null
  onClose: () => void
  onRunLaunched?: (runId: string) => void
}

export function LaunchWizard({
  workflowId,
  onClose,
  onRunLaunched,
}: LaunchWizardProps) {
  return (
    <LaunchDialog
      key={workflowId ?? ''}
      open={Boolean(workflowId)}
      initialWorkflowId={workflowId ?? undefined}
      onClose={onClose}
      onRunLaunched={(runId) =>
        onRunLaunched
          ? onRunLaunched(runId)
          : toast(`Workflow Run created: ${runId}`)
      }
    />
  )
}
