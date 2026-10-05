/**
 * launch-wizard.tsx — shared launch dialog (D10).
 *
 * `LaunchDialog` serves Conductor "New Mission" and /workflows ("Run workflow").
 * `LaunchWizard` is the legacy /workflows entry point: a thin wrapper that
 * preselects a workflow. Steps: WORKFLOW → INPUTS → WHEN → CONFIRM; a
 * preselected workflow skips WORKFLOW. The Route step is hidden until routing
 * ships (LB2/C2).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import '@/styles/workflow-ui.css'
import {
  useLaunchWorkflowRun,
  useWorkflowDefinitions,
  useWorkflowParsed,
} from './use-workflows'
import { toEpochMs, useWorkflowRunIndex } from './run-status'
import type { WorkflowRunRow } from './api-client'
import type {
  LaunchDialogProps,
  LaunchDialogStep,
} from './launch-dialog-contract'
import type {
  ParsedWorkflow,
  WorkflowInputDetail,
  WorkflowSummary,
} from './types'
import { useFocusTrap } from '@/components/ui/use-focus-trap'
import { toast } from '@/components/ui/toast'
import { useConductorScheduled } from '@/screens/gateway/conductor/use-conductor-queries'

const STEPS: Array<{ id: LaunchDialogStep; title: string }> = [
  { id: 'workflow', title: 'Workflow' },
  { id: 'inputs', title: 'Inputs' },
  { id: 'when', title: 'When' },
  { id: 'confirm', title: 'Confirm' },
]

const RECENT_LIMIT = 3
const SCHEDULER_LOST =
  'The scheduler is offline, so this run can’t be scheduled. Pick “Now”, or wait for the scheduler to come back.'
const MAX_RUNTIME_SECONDS = 3600

/** Fields come from `inputs_detail`; older responses fall back to the name lists. */
function inputFields(
  parsed: ParsedWorkflow | undefined,
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

const shortDate = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

type Tone = 'ok' | 'warn' | 'fail'

/** Last run → dot tone + "last ✓ Sep 28"; null when the workflow never ran. */
function lastRun(
  run: WorkflowRunRow | null | undefined,
): { tone: Tone; text: string } | null {
  if (!run) return null
  const ms = toEpochMs(run.started_at)
  const date = ms ? ` ${shortDate(ms)}` : ''
  if (run.status === 'completed') return { tone: 'ok', text: `last ✓${date}` }
  if (run.status === 'failed' || run.status === 'cancelled')
    return { tone: 'fail', text: `last ✗${date}` }
  return { tone: 'warn', text: `last ${run.status}${date}` }
}

/** "in 13h 20m" for a future date. */
function fromNow(d: Date): string {
  const min = Math.max(0, Math.round((d.getTime() - Date.now()) / 60_000))
  const h = Math.floor(min / 60)
  if (h >= 24) return `in ${Math.floor(h / 24)}d ${h % 24}h`
  return h ? `in ${h}h ${min % 60}m` : `in ${min}m`
}

const longDate = (d: Date) =>
  d.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  })

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

// ── Step 1 — pick a workflow ─────────────────────────────────────────────────

type Filter = 'all' | 'recent' | 'none' | 'scheduled'

function PickStep({
  workflows,
  loading,
  failed,
  onRetry,
  scheduledIds,
  selectedId,
  onSelect,
}: {
  workflows: Array<WorkflowSummary>
  loading: boolean
  failed: boolean
  onRetry: () => void
  scheduledIds: Set<string>
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const searchRef = useRef<HTMLInputElement>(null)
  // Land on the search box on open and after "change"/"pick a workflow".
  useEffect(() => searchRef.current?.focus(), [])
  const runIndex = useWorkflowRunIndex().data

  const q = query.trim().toLowerCase()
  const byRecency = useMemo(
    () =>
      workflows
        .filter((w) => runIndex?.[w.id]?.last)
        .sort(
          (a, b) =>
            (toEpochMs(runIndex![b.id].last!.started_at) ?? 0) -
            (toEpochMs(runIndex![a.id].last!.started_at) ?? 0),
        ),
    [workflows, runIndex],
  )
  const matches = (filter === 'recent' ? byRecency : workflows).filter(
    (w) =>
      (filter !== 'none' ||
        (!w.required_inputs.length && !w.optional_inputs.length)) &&
      (filter !== 'scheduled' || scheduledIds.has(w.id)) &&
      (!q ||
        w.id.toLowerCase().includes(q) ||
        w.name.toLowerCase().includes(q) ||
        w.description.toLowerCase().includes(q)),
  )
  // Sections only on the unfiltered view; any filter or query shows one flat grid.
  const sectioned = filter === 'all' && !q
  const recent = sectioned ? byRecency.slice(0, RECENT_LIMIT) : []
  const recentIds = new Set(recent.map((w) => w.id))
  const rest = matches.filter((w) => !recentIds.has(w.id))

  const card = (w: WorkflowSummary) => {
    const last = lastRun(runIndex?.[w.id]?.last)
    const meta = [
      w.name && w.name !== w.id ? w.id : null,
      w.node_count ? `${w.node_count} steps` : null,
      w.has_approval ? 'approval' : null,
      needsHint(w),
      last?.text,
    ]
      .filter(Boolean)
      .join(' · ')
    return (
      <button
        key={w.id}
        type="button"
        className={`wfl-card${w.id === selectedId ? ' is-sel' : ''}`}
        aria-pressed={w.id === selectedId}
        onClick={() => onSelect(w.id)}
      >
        <span className="wfl-card-hd">
          {last && (
            <span className={`wfl-dot is-${last.tone}`} aria-hidden="true" />
          )}
          <span className="wfl-card-name">{w.name || w.id}</span>
        </span>
        {w.description && (
          <span className="wfl-card-desc">{w.description}</span>
        )}
        <span className="wfl-meta">{meta}</span>
      </button>
    )
  }

  const chips: Array<[Filter, string]> = [
    ['all', `All ${workflows.length}`],
    ['recent', 'Recent'],
    ['none', 'No inputs'],
    ['scheduled', 'Scheduled'],
  ]

  return (
    <>
      <div className="wfl-pick-bar">
        <input
          ref={searchRef}
          className="wfl-input"
          type="search"
          aria-label="Find a workflow"
          placeholder="Find a workflow…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="wfl-chips" role="group" aria-label="Filter workflows">
          {chips.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`wfl-chip${filter === id ? ' is-on' : ''}`}
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <div className="wfl-skeletons" aria-label="Loading workflows">
          {[70, 55, 62, 40].map((w) => (
            <div key={w} className="wfl-skeleton" style={{ width: `${w}%` }} />
          ))}
        </div>
      ) : failed ? (
        <div className="wfl-error" role="alert">
          Couldn&apos;t load workflows ·{' '}
          <button type="button" className="wfl-link" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : matches.length === 0 ? (
        <div className="wfl-empty">
          {workflows.length === 0
            ? 'No workflows defined yet.'
            : 'No workflows match.'}
        </div>
      ) : (
        <>
          {recent.length > 0 && (
            <>
              <span className="wfl-label">Recent</span>
              <div className="wfl-grid">{recent.map(card)}</div>
              {rest.length > 0 && <span className="wfl-label">All</span>}
            </>
          )}
          <div className="wfl-grid">{rest.map(card)}</div>
        </>
      )}
    </>
  )
}

// ── Step 2 — inputs ──────────────────────────────────────────────────────────

function InputsStep({
  wf,
  parsed,
  fields,
  loading,
  failed,
  values,
  setValue,
  userMessage,
  setUserMessage,
}: {
  wf: WorkflowSummary | undefined
  parsed: ParsedWorkflow | undefined
  fields: Array<WorkflowInputDetail>
  loading: boolean
  failed: boolean
  values: Record<string, string>
  setValue: (name: string, v: string) => void
  userMessage: string
  setUserMessage: (v: string) => void
}) {
  const last = useWorkflowRunIndex().data?.[wf?.id ?? '']?.last
  const lastMs = last ? toEpochMs(last.started_at) : null
  return (
    <div className="wfl-split">
      <div className="wfl-main">
        {wf?.description && <span className="wfl-hint">{wf.description}</span>}
        {loading ? (
          <div className="wfl-skeleton" aria-label="Loading inputs" />
        ) : failed ? (
          <div className="wfl-error" role="alert">
            Couldn&apos;t load this workflow&apos;s inputs. Pick it again or try
            later.
          </div>
        ) : fields.length === 0 ? (
          <div className="wfl-hint">This workflow takes no inputs.</div>
        ) : (
          <div className="wfl-fields">
            {fields.map((f) => {
              const id = `wfl-in-${f.name}`
              const v = valueOf(values, f)
              const def = defaultText(f)
              const hint = [
                f.type,
                f.required ? null : 'optional',
                def != null ? `default ${def}` : null,
                f.description,
              ]
                .filter(Boolean)
                .join(' · ')
              return (
                <div key={f.name} className="wfl-field">
                  <label
                    id={`${id}-label`}
                    htmlFor={f.type === 'boolean' ? undefined : id}
                    className="wfl-label"
                  >
                    {f.name}
                    {f.required && <span className="wfl-req"> · required</span>}
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
                  <span className="wfl-hint">{hint}</span>
                </div>
              )
            })}
          </div>
        )}
        <div className="wfl-field wfl-grow">
          <label htmlFor="wfl-context" className="wfl-label">
            Context for this run (optional)
          </label>
          <textarea
            id="wfl-context"
            className="wfl-input wfl-context"
            placeholder="Anything the first step should know — sent as the run's message"
            value={userMessage}
            onChange={(e) => setUserMessage(e.target.value)}
          />
        </div>
      </div>
      <aside className="wfl-aside" aria-label="This run">
        <span className="wfl-label">This run</span>
        <span className="wfl-hint">{runShape(wf, parsed)}</span>
        <span className="wfl-hint">
          {last
            ? `Last run${lastMs ? ` ${shortDate(lastMs)}` : ''} · ${last.status}`
            : 'Never run'}
        </span>
        {fields.length > 0 && (
          <>
            <span className="wfl-label wfl-gap">Filled</span>
            {fields.map((f) => {
              const v = valueOf(values, f).trim()
              return (
                <span key={f.name} className="wfl-hint">
                  {v
                    ? `✓ ${f.name} = ${v}`
                    : `· ${f.name} → ${
                        f.default != null
                          ? 'default'
                          : f.required
                            ? 'required'
                            : 'empty'
                      }`}
                </span>
              )
            })}
          </>
        )}
      </aside>
    </div>
  )
}

const approvalIds = (parsed: ParsedWorkflow | undefined) =>
  (parsed?.nodes ?? []).filter((n) => n.type === 'approval').map((n) => n.id)

/** "9 steps · pauses at “approval”". */
function runShape(
  wf: WorkflowSummary | undefined,
  parsed: ParsedWorkflow | undefined,
): string {
  const n = parsed?.nodes.length || wf?.node_count
  const gates = approvalIds(parsed)
  return [
    n ? `${n} steps` : null,
    gates.length
      ? `pauses at ${gates.map((g) => `“${g}”`).join(', ')}`
      : wf?.has_approval
        ? 'pauses for approval'
        : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

// ── Step 3 — when ────────────────────────────────────────────────────────────

type WhenMode = 'now' | 'at'

function WhenStep({
  mode,
  setMode,
  datetime,
  setDatetime,
  schedulerAlive,
  schedulerLine,
}: {
  mode: WhenMode
  setMode: (m: WhenMode) => void
  datetime: string
  setDatetime: (v: string) => void
  schedulerAlive: boolean
  schedulerLine: string
}) {
  const at = futureDate(datetime)
  return (
    <>
      <div className="wfl-opts" role="radiogroup" aria-label="When to run">
        <div className={`wfl-opt${mode === 'now' ? ' is-sel' : ''}`}>
          <label className="wfl-opt-t">
            <input
              type="radio"
              name="wfl-when"
              checked={mode === 'now'}
              onChange={() => setMode('now')}
            />
            Now
          </label>
          <span className="wfl-desc">
            Starts as soon as you confirm, and is selected so you can watch.
          </span>
        </div>
        <div
          className={`wfl-opt${mode === 'at' ? ' is-sel' : ''}${schedulerAlive ? '' : ' is-off'}`}
        >
          <label className="wfl-opt-t">
            <input
              type="radio"
              name="wfl-when"
              checked={mode === 'at'}
              disabled={!schedulerAlive && mode !== 'at'}
              onChange={() => setMode('at')}
            />
            At a time
          </label>
          <span className="wfl-desc">One run at a set time.</span>
          {mode === 'at' && (
            <div className="wfl-field">
              <label htmlFor="wfl-at" className="wfl-label">
                Date and time
              </label>
              <input
                id="wfl-at"
                type="datetime-local"
                className="wfl-input"
                value={datetime}
                min={localNow()}
                onChange={(e) => setDatetime(e.target.value)}
              />
              {datetime && !at ? (
                <span className="wfl-warn">Pick a time in the future.</span>
              ) : (
                <span className="wfl-hint">
                  {at ? `${fromNow(at)} · ` : ''}your timezone (
                  {Intl.DateTimeFormat().resolvedOptions().timeZone})
                </span>
              )}
            </div>
          )}
        </div>
        <div className="wfl-opt is-off">
          <label className="wfl-opt-t">
            <input type="radio" name="wfl-when" disabled />
            Repeat
          </label>
          <span className="wfl-desc">
            Repeating schedules aren&apos;t supported by the workflow engine
            yet. Use a Hermes cron job that runs this workflow instead.
          </span>
        </div>
      </div>
      <span
        className={`wfl-sched${schedulerAlive ? ' is-ok' : ''}`}
        role="status"
      >
        {schedulerAlive ? '✓ ' : ''}
        {schedulerLine}
      </span>
      {mode === 'at' && !schedulerAlive && (
        <span className="wfl-warn" role="alert">
          {SCHEDULER_LOST}
        </span>
      )}
    </>
  )
}

// ── Step 4 — confirm ─────────────────────────────────────────────────────────

function ConfirmStep({
  wf,
  parsed,
  fields,
  values,
  userMessage,
  mode,
  datetime,
  profile,
  error,
  scheduleBlocked,
  onEdit,
}: {
  wf: WorkflowSummary | undefined
  parsed: ParsedWorkflow | undefined
  fields: Array<WorkflowInputDetail>
  values: Record<string, string>
  userMessage: string
  mode: WhenMode
  datetime: string
  profile: string | null | undefined
  error: string | null
  scheduleBlocked: boolean
  onEdit: (step: LaunchDialogStep) => void
}) {
  const at = mode === 'at' ? futureDate(datetime) : null
  const nodes = parsed?.nodes ?? []
  const gates = approvalIds(parsed)
  const n = nodes.length || wf?.node_count
  return (
    <>
      <section className="wfl-box" aria-label="Inputs">
        <div className="wfl-box-hd">
          <span className="wfl-label">Inputs</span>
          <button
            type="button"
            className="wfl-link"
            aria-label="Edit inputs"
            onClick={() => onEdit('inputs')}
          >
            edit
          </button>
        </div>
        {fields.map((f) => {
          const v = valueOf(values, f).trim()
          const def = defaultText(f)
          return (
            <div key={f.name} className="wfl-kv">
              <span>{f.name}</span>
              {v ? (
                <span>{v}</span>
              ) : (
                <span className="is-dim">
                  {def != null ? `default · ${def}` : 'not set'}
                </span>
              )}
            </div>
          )
        })}
        <div className="wfl-kv">
          <span>context</span>
          {userMessage.trim() ? (
            <span>{userMessage.trim()}</span>
          ) : (
            <span className="is-dim">none</span>
          )}
        </div>
      </section>
      <section className="wfl-box" aria-label="When">
        <div className="wfl-box-hd">
          <span className="wfl-label">When</span>
          <button
            type="button"
            className="wfl-link"
            aria-label="Edit when"
            onClick={() => onEdit('when')}
          >
            edit
          </button>
        </div>
        <div className="wfl-kv">
          <span>schedule</span>
          <span>
            {at ? `${longDate(at)} (${fromNow(at)})` : 'Now — starts on launch'}
          </span>
        </div>
      </section>
      <section className="wfl-box" aria-label="What will happen">
        <span className="wfl-label">What will happen</span>
        {nodes.length > 0 && (
          <div className="wfl-graph">
            {nodes.map((node, i) => (
              <span key={node.id} className="wfl-graph-step">
                {i > 0 && <span className="wfl-edge" aria-hidden="true" />}
                <span
                  className={`wfl-node${node.type === 'approval' ? ' is-gate' : ''}`}
                >
                  {node.id}
                  {node.type === 'approval' ? ' ⏸' : ''}
                </span>
              </span>
            ))}
          </div>
        )}
        <span className="wfl-desc">
          Runs {n ? `${n} steps` : wf?.id}
          {profile ? ` in ${profile}` : ''}.
          {gates.length
            ? ` Pauses at ${gates.map((g) => `“${g}”`).join(', ')} for your approval.`
            : wf?.has_approval
              ? ' Pauses for your approval.'
              : ''}{' '}
          Runtime limit {MAX_RUNTIME_SECONDS / 3600}h.
        </span>
      </section>
      {scheduleBlocked && (
        <div className="wfl-warn" role="alert">
          {SCHEDULER_LOST}
        </div>
      )}
      {error && (
        <div className="wfl-error" role="alert">
          {error}
        </div>
      )}
    </>
  )
}

// ── Dialog ───────────────────────────────────────────────────────────────────

function LaunchDialogBody({
  title = 'New mission',
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
  // An unknown ?wizard= id: say so instead of an inputs error or raw JSON.
  const notFound = Boolean(workflowId && defs.data && !wf)
  const parsed = useWorkflowParsed(workflowId)
  const parsedWf = parsed.data?.parsed
  const fields = inputFields(parsedWf)
  const launch = useLaunchWorkflowRun()
  // Scheduled-run support: 404 / error / offline all mean "not alive" (an error
  // wins over stale data React Query keeps from an earlier success).
  const sched = useConductorScheduled()
  const schedulerAlive = !sched.isError && sched.data?.schedulerAlive === true
  const schedulerLine = sched.isError
    ? 'Scheduler status unavailable — couldn’t reach the workflow plugin, so “At a time” is disabled.'
    : sched.data
      ? schedulerAlive
        ? 'Scheduler alive'
        : 'Scheduler offline — the workflow scheduler daemon isn’t running, so “At a time” is disabled.'
      : 'Checking the scheduler…'
  const scheduledIds = useMemo(
    () => new Set((sched.data?.scheduled ?? []).map((s) => s.workflowId)),
    [sched.data],
  )
  // "At a time" chosen, then the scheduler dropped: block, never fold into a run-now.
  const scheduleBlocked = mode === 'at' && !schedulerAlive

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
        ? inputsReady && Boolean(wf)
        : step === 'when'
          ? mode === 'now' ||
            (!scheduleBlocked && futureDate(datetime) !== null)
          : false
  const idx = STEPS.findIndex((s) => s.id === step)

  function submit() {
    if (!wf || launch.isPending || !inputsReady || scheduleBlocked) return // guard double-submit before React flushes disabled
    const variables: Record<string, string> = {}
    for (const f of fields) {
      const v = valueOf(values, f).trim()
      if (v) variables[f.name] = v
    }
    const at = mode === 'at' ? futureDate(datetime) : null
    if (mode === 'at' && !at) {
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
        maxRuntimeSeconds: MAX_RUNTIME_SECONDS,
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

  // Keeps the current pick (and typed values) unless it doesn't exist.
  function pickAgain() {
    if (notFound) setWorkflowId(null)
    setError(null)
    setStep('workflow')
  }

  return createPortal(
    <div data-wf-ui>
      <div className="wfw-backdrop" onClick={close}>
        <div
          ref={modalRef}
          className="wfl-dlg"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="wfl-hd">
            <span className="wfl-t">{title.toUpperCase()}</span>
            {sched.data?.profile && (
              <span className="wfl-meta">profile {sched.data.profile}</span>
            )}
            <span className="wfl-grow" />
            <button
              type="button"
              className="wfw-close-btn wfl-x"
              onClick={close}
              aria-label="Close dialog"
            >
              ✕ Esc
            </button>
          </div>
          <div className="wfl-rail">
            {step !== 'workflow' && wf && (
              <>
                <span className="wfl-chosen" title={wf.id}>
                  {wf.name || wf.id}
                  {step === 'inputs' && (
                    <button
                      type="button"
                      className="wfl-link wfl-link--dim"
                      aria-label="Change workflow"
                      onClick={pickAgain}
                    >
                      change
                    </button>
                  )}
                </span>
                <span className="wfl-grow" />
              </>
            )}
            <ol className="wfl-steps" aria-label="Steps">
              {STEPS.map((s, i) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className={`wfl-pill${i === idx ? ' is-on' : ''}${i < idx ? ' is-done' : ''}`}
                    aria-current={i === idx ? 'step' : undefined}
                    aria-label={i < idx ? `${s.title} (done)` : undefined}
                    disabled={i > idx}
                    onClick={() => setStep(s.id)}
                  >
                    {i + 1} {i < idx ? '✓' : s.title.toUpperCase()}
                  </button>
                </li>
              ))}
            </ol>
          </div>
          <div className="wfl-body">
            {notFound ? (
              <div className="wfl-state" role="alert">
                <span className="wfl-state-h">Workflow not found</span>
                <span className="wfl-desc">
                  No workflow with the id “{workflowId}”. It may have been
                  renamed or deleted.
                </span>
                <div className="wfl-row">
                  <button
                    type="button"
                    className="wfw-btn wfw-btn--primary"
                    onClick={pickAgain}
                  >
                    Pick a workflow
                  </button>
                  <button
                    type="button"
                    className="wfw-btn wfw-btn--secondary"
                    onClick={close}
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : step !== 'workflow' && defs.isError && !wf ? (
              <div className="wfl-error" role="alert">
                Couldn&apos;t load workflows ·{' '}
                <button
                  type="button"
                  className="wfl-link"
                  onClick={() => void defs.refetch()}
                >
                  Retry
                </button>
              </div>
            ) : step === 'workflow' ? (
              <PickStep
                workflows={workflows}
                loading={defs.isLoading}
                failed={defs.isError}
                onRetry={() => void defs.refetch()}
                scheduledIds={scheduledIds}
                selectedId={workflowId}
                onSelect={selectWorkflow}
              />
            ) : step === 'inputs' ? (
              <InputsStep
                wf={wf}
                parsed={parsedWf}
                fields={fields}
                loading={parsed.isLoading}
                failed={parsed.isError}
                values={values}
                setValue={(name, v) => setValues((p) => ({ ...p, [name]: v }))}
                userMessage={userMessage}
                setUserMessage={setUserMessage}
              />
            ) : step === 'when' ? (
              <WhenStep
                mode={mode}
                setMode={setMode}
                datetime={datetime}
                setDatetime={setDatetime}
                schedulerAlive={schedulerAlive}
                schedulerLine={schedulerLine}
              />
            ) : (
              <ConfirmStep
                wf={wf}
                parsed={parsedWf}
                fields={fields}
                values={values}
                userMessage={userMessage}
                mode={mode}
                datetime={datetime}
                profile={sched.data?.profile}
                error={error}
                scheduleBlocked={scheduleBlocked}
                onEdit={setStep}
              />
            )}
          </div>
          <div className="wfw-footer">
            {idx > 0 && !notFound && (
              <button
                type="button"
                className="wfw-btn wfw-btn--secondary"
                onClick={() => setStep(STEPS[idx - 1].id)}
              >
                ◀ Back
              </button>
            )}
            <div className="wfw-footer-spacer" />
            <button
              type="button"
              className="wfw-btn wfw-btn--secondary"
              onClick={close}
            >
              Cancel
            </button>
            {step === 'confirm' ? (
              <button
                type="button"
                className="wfw-btn wfw-btn--primary"
                onClick={submit}
                disabled={launch.isPending || !wf || scheduleBlocked}
                title={scheduleBlocked ? SCHEDULER_LOST : undefined}
              >
                {launch.isPending
                  ? 'Launching…'
                  : mode === 'at'
                    ? 'Schedule ▶'
                    : 'Launch ▶'}
              </button>
            ) : (
              <button
                type="button"
                className="wfw-btn wfw-btn--primary"
                onClick={() => setStep(STEPS[idx + 1].id)}
                disabled={!canNext || notFound}
              >
                Next ▶
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
      title="Run workflow"
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
