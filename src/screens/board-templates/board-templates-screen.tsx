import { useEffect, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type {
  InstantiateResult,
  KanbanTemplate,
  KanbanTemplateSummary,
  TemplateRecurrence,
  TemplateVariable,
} from '@/lib/hermes-kanban-types'
import { usePageTitle } from '@/hooks/use-page-title'
import {
  TemplateRequestError,
  useDeleteTemplate,
  useInstantiateTemplate,
  useSaveTemplate,
  useTemplate,
  useTemplates,
  useUpdateTemplate,
} from '@/lib/board-templates-api'
import { useSwitchBoard } from '@/lib/boards-api'
import { toast } from '@/components/ui/toast'
import {
  TooltipContent,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import '@/styles/matrix-boards.css'

const SIZE_WARN_BYTES = 64 * 1024
const COLORS = ['#00ff41', '#5ad3ff', '#ffb454', '#b07cff', '#ff5fa2', '#d6ff5f']
const PRIORITY_LABELS = ['low', 'normal', 'high', 'urgent', 'critical'] as const
const TEMPLATE_STATUSES = ['todo', 'ready'] as const
const CRON_EXAMPLES = '0 9 * * 1 (Mon 9am) · */30 * * * * (every 30m) · 0 0 1 * * (monthly)'

function byteLength(text: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length
  return text.length
}

function backendDetail(error: unknown, fallback: string): string {
  if (error instanceof TemplateRequestError) return error.message
  if (error instanceof Error) return error.message
  return fallback
}

// ── Wizard state model ──────────────────────────────────────────────────────────

const WIZARD_STEPS = ['Basics', 'Variables', 'Tasks', 'Dependencies', 'Review'] as const

type VarRow = {
  key: string
  required: boolean
  prompt: string
  description: string
  default: string
}

type TaskRow = {
  key: string
  title: string
  status: string
  /** Priority label string (backend accepts labels). */
  priority: string
  assignee: string
  body: string
  maxRuntime: string
  goalMaxTurns: string
  goalMode: boolean
  /** Raw scheduled_at value: '' | '+2h' | epoch digits | '{{var}}'. */
  scheduledAt: string
  showAdvanced: boolean
}

type WizardState = {
  step: number
  name: string
  slug: string
  description: string
  color: string
  variables: Array<VarRow>
  tasks: Array<TaskRow>
  links: Array<[string, string]>
  recurrenceEnabled: boolean
  cron: string
  timezone: string
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
}

function isKebab(value: string): boolean {
  return /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(value)
}

/** Positive-integer parse. Returns the int when the string is a clean positive integer, else null. */
function parsePositiveInt(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed || !/^\d+$/.test(trimmed)) return null
  const n = Number(trimmed)
  return Number.isInteger(n) && n > 0 ? n : null
}

// ── scheduled_at (deferred-dispatch start time) — mirrors backend validate_template ──
/** Relative offset `+<n><unit>`, unit ∈ s|m|h|d|w. */
const SCHED_REL_RE = /^\+(\d+)([smhdw])$/
/** Whole-value `{{variable}}` placeholder (\w = backend's \w). */
const SCHED_VAR_RE = /^\{\{(\w+)\}\}$/
const SCHED_UNITS: ReadonlyArray<readonly [string, string]> = [
  ['m', 'minutes'],
  ['h', 'hours'],
  ['d', 'days'],
  ['w', 'weeks'],
  ['s', 'seconds'],
]

type SchedMode = 'none' | 'relative' | 'absolute' | 'variable'

/** True when a raw scheduled_at value is acceptable (empty, relative, positive epoch, or {{var}}). */
function isValidScheduledAt(raw: string): boolean {
  const v = raw.trim()
  if (!v) return true
  if (SCHED_VAR_RE.test(v)) return true
  if (SCHED_REL_RE.test(v)) return true
  return /^\d+$/.test(v) && Number(v) > 0
}

function deriveSchedMode(raw: string): SchedMode {
  const v = raw.trim()
  if (!v) return 'none'
  if (SCHED_VAR_RE.test(v)) return 'variable'
  if (/^\d+$/.test(v)) return 'absolute'
  return 'relative' // relative or malformed-being-edited
}

/** Unix-epoch seconds → `YYYY-MM-DDTHH:mm` in local time (for <input type=datetime-local>). */
function epochToLocalInput(epoch: number): string {
  const d = new Date(epoch * 1000)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
/** datetime-local string → unix-epoch-seconds string (empty when unparseable). */
function localInputToEpoch(v: string): string {
  if (!v) return ''
  const ms = new Date(v).getTime()
  return Number.isNaN(ms) ? '' : String(Math.floor(ms / 1000))
}

/**
 * Per-task deferred-start control. Emits one of the backend-accepted forms as a
 * raw string (`+2h` / epoch / `{{var}}`) or '' for "dispatch immediately".
 */
function ScheduledAtControl({
  value,
  varKeys,
  onChange,
}: {
  value: string
  varKeys: Array<string>
  onChange: (next: string) => void
}) {
  const [mode, setMode] = useState<SchedMode>(() => deriveSchedMode(value))
  const v = value.trim()
  const relMatch = SCHED_REL_RE.exec(v)
  const relN = relMatch ? relMatch[1] : ''
  const relUnit = relMatch ? relMatch[2] : 'h'
  const varMatch = SCHED_VAR_RE.exec(v)
  const varKey = varMatch ? varMatch[1] : ''
  const absInput = /^\d+$/.test(v) ? epochToLocalInput(Number(v)) : ''
  const invalid = !isValidScheduledAt(value)

  const switchMode = (m: SchedMode) => {
    setMode(m)
    if (m === 'none') onChange('')
    else if (m === 'relative' && !SCHED_REL_RE.test(v)) onChange('')
    else if (m === 'absolute' && !/^\d+$/.test(v)) onChange('')
    else if (m === 'variable' && !SCHED_VAR_RE.test(v)) onChange(varKeys[0] ? `{{${varKeys[0]}}}` : '')
  }

  return (
    <div className="form-row">
      <FieldLabel
        text="Scheduled start"
        hint="Defer dispatch until this time. Relative (+2h, +30m, +1d, +1w), an absolute date/time, or a {{variable}} supplied at instantiation. Empty = dispatch as soon as the task is ready."
      />
      <div className="wz-sched">
        <select
          className="form-inp wz-sched-mode"
          value={mode}
          onChange={(e) => switchMode(e.target.value as SchedMode)}
        >
          <option value="none">Immediately</option>
          <option value="relative">After delay</option>
          <option value="absolute">At date/time</option>
          <option value="variable">From variable</option>
        </select>

        {mode === 'relative' ? (
          <>
            <input
              className="form-inp wz-sched-n"
              inputMode="numeric"
              placeholder="2"
              value={relN}
              onChange={(e) => {
                const n = e.target.value.replace(/[^0-9]/g, '')
                onChange(n ? `+${n}${relUnit}` : '')
              }}
            />
            <select
              className="form-inp wz-sched-unit"
              value={relUnit}
              onChange={(e) => onChange(relN ? `+${relN}${e.target.value}` : '')}
            >
              {SCHED_UNITS.map(([u, lbl]) => (
                <option key={u} value={u}>
                  {lbl}
                </option>
              ))}
            </select>
          </>
        ) : null}

        {mode === 'absolute' ? (
          <input
            type="datetime-local"
            className="form-inp"
            value={absInput}
            onChange={(e) => onChange(localInputToEpoch(e.target.value))}
          />
        ) : null}

        {mode === 'variable' ? (
          varKeys.length > 0 ? (
            <select
              className="form-inp"
              value={varKey}
              onChange={(e) => onChange(e.target.value ? `{{${e.target.value}}}` : '')}
            >
              <option value="">— pick variable —</option>
              {varKeys.map((k) => (
                <option key={k} value={k}>
                  {`{{${k}}}`}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="form-inp"
              placeholder="{{start_at}}"
              value={value}
              onChange={(e) => onChange(e.target.value)}
            />
          )
        ) : null}
      </div>
      {invalid ? (
        <span className="wz-err">Use +2h / +30m / +1d / +1w, a date/time, or a {'{{variable}}'}.</span>
      ) : mode === 'relative' && v ? (
        <span className="form-hint">Starts ~{v} after the template is instantiated.</span>
      ) : mode === 'variable' && !varKey ? (
        <span className="form-hint">Bind to a variable; its value is supplied when you instantiate.</span>
      ) : null}
    </div>
  )
}

/** Map a numeric priority (edit-mode passthrough) back to a label string. */
function priorityIntToLabel(priority: number): string {
  if (priority >= 4) return 'critical'
  if (priority >= 3) return 'high'
  if (priority >= 2) return 'urgent'
  if (priority >= 1) return 'high'
  return 'normal'
}

function emptyTask(): TaskRow {
  return {
    key: '',
    title: '',
    status: 'todo',
    priority: 'normal',
    assignee: '',
    body: '',
    maxRuntime: '',
    goalMaxTurns: '',
    goalMode: false,
    scheduledAt: '',
    showAdvanced: false,
  }
}

function emptyVar(): VarRow {
  return { key: '', required: false, prompt: '', description: '', default: '' }
}

function blankWizard(): WizardState {
  return {
    step: 1,
    name: '',
    slug: '',
    description: '',
    color: COLORS[0],
    variables: [],
    tasks: [emptyTask()],
    links: [],
    recurrenceEnabled: false,
    cron: '',
    timezone: '',
  }
}

/** Parse a fetched/raw template object into wizard state (edit mode + YAML→wizard). */
function templateToWizard(tpl: KanbanTemplate): WizardState {
  const variables = (tpl.variables ?? []).map<VarRow>((v) => ({
    key: v.key,
    required: v.required === true,
    prompt: v.prompt ?? '',
    description: v.description ?? '',
    default: v.default ?? '',
  }))
  const tasks = tpl.tasks.map<TaskRow>((t) => {
    const priority =
      typeof t.priority === 'number'
        ? priorityIntToLabel(t.priority)
        : typeof t.priority === 'string'
          ? t.priority
          : 'normal'
    const scheduledAt = t.scheduled_at != null ? String(t.scheduled_at) : ''
    const adv =
      t.max_runtime_seconds != null ||
      t.goal_max_turns != null ||
      t.goal_mode === true ||
      scheduledAt !== ''
    return {
      key: t.key,
      title: t.title,
      status: t.status === 'ready' ? 'ready' : 'todo',
      priority,
      assignee: t.assignee ?? '',
      body: t.body ?? '',
      maxRuntime: t.max_runtime_seconds != null ? String(t.max_runtime_seconds) : '',
      goalMaxTurns: t.goal_max_turns != null ? String(t.goal_max_turns) : '',
      goalMode: t.goal_mode === true,
      scheduledAt,
      showAdvanced: adv,
    }
  })
  const links = (tpl.links ?? []).map<[string, string]>((l) => [String(l[0]), String(l[1])])
  const rec = tpl.recurrence
  return {
    step: 1,
    name: tpl.name,
    slug: tpl.slug,
    description: tpl.description ?? '',
    color: tpl.color ?? COLORS[0],
    variables,
    tasks: tasks.length > 0 ? tasks : [emptyTask()],
    links,
    recurrenceEnabled: rec?.enabled === true,
    cron: rec?.cron ?? '',
    timezone: rec?.timezone ?? '',
  }
}

/** Build a clean KanbanTemplate-shaped object from wizard state, omitting empty/unset optionals. */
function wizardToTemplate(w: WizardState): Record<string, unknown> {
  // Serialization shape: priority is emitted as a label string (backend accepts labels),
  // which differs from TemplateTask.priority (number). Build a YAML-bound record instead.
  const tasks = w.tasks.map((t) => {
    const task: Record<string, unknown> = { key: t.key.trim(), title: t.title.trim() }
    if (t.status !== 'todo') task.status = t.status
    if (t.priority !== 'normal') task.priority = t.priority
    if (t.assignee.trim()) task.assignee = t.assignee.trim()
    if (t.body.trim()) task.body = t.body
    const mr = parsePositiveInt(t.maxRuntime)
    if (mr !== null) task.max_runtime_seconds = mr
    const gt = parsePositiveInt(t.goalMaxTurns)
    if (gt !== null) task.goal_max_turns = gt
    if (t.goalMode) task.goal_mode = true
    const sa = t.scheduledAt.trim()
    // Emit absolute epoch as a number; relative/variable forms stay strings.
    if (sa) task.scheduled_at = /^\d+$/.test(sa) ? Number(sa) : sa
    return task
  })

  const tpl: Record<string, unknown> = {
    schema: 1,
    slug: w.slug.trim(),
    name: w.name.trim(),
    tasks,
  }
  if (w.description.trim()) tpl.description = w.description.trim()
  if (w.color) tpl.color = w.color

  const variables = w.variables
    .filter((v) => v.key.trim())
    .map<TemplateVariable>((v) => {
      const out: TemplateVariable = { key: v.key.trim() }
      if (v.required) out.required = true
      if (v.prompt.trim()) out.prompt = v.prompt.trim()
      if (v.description.trim()) out.description = v.description.trim()
      if (v.default.trim()) out.default = v.default
      return out
    })
  if (variables.length > 0) tpl.variables = variables

  if (w.links.length > 0) tpl.links = w.links.map(([p, c]) => [p, c])

  if (w.recurrenceEnabled) {
    const rec: TemplateRecurrence = { enabled: true }
    if (w.cron.trim()) rec.cron = w.cron.trim()
    if (w.timezone.trim()) rec.timezone = w.timezone.trim()
    tpl.recurrence = rec
  }

  return tpl
}

function wizardToYaml(w: WizardState): string {
  return stringifyYaml(wizardToTemplate(w))
}

// ── Link graph (DFS, mirrors backend) ───────────────────────────────────────────

/** Returns true if adding edge parent→child would create a cycle in the existing edge set. */
function wouldCycle(edges: Array<[string, string]>, parent: string, child: string): boolean {
  // A cycle forms if `parent` is already reachable from `child`.
  const adj = new Map<string, Array<string>>()
  for (const [p, c] of edges) {
    const list = adj.get(p) ?? []
    list.push(c)
    adj.set(p, list)
  }
  const stack = [child]
  const seen = new Set<string>()
  while (stack.length > 0) {
    const node = stack.pop() as string
    if (node === parent) return true
    if (seen.has(node)) continue
    seen.add(node)
    for (const next of adj.get(node) ?? []) stack.push(next)
  }
  return false
}

// ── Validation (mirrors backend pre-commit checks) ──────────────────────────────

type Check = { ok: boolean; label: string; blocking: boolean }

function findVarRefs(body: string): Array<string> {
  const refs: Array<string> = []
  const re = /\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) refs.push(m[1])
  return refs
}

function runChecks(w: WizardState, slugTaken: boolean, isCreate: boolean): Array<Check> {
  const checks: Array<Check> = []
  const slug = w.slug.trim()
  checks.push({ ok: slug.length > 0 && isKebab(slug), label: 'Slug present and kebab-case', blocking: true })
  if (isCreate) {
    checks.push({ ok: slug.length > 0 && !slugTaken, label: 'Slug is unique', blocking: true })
  }
  checks.push({ ok: w.name.trim().length > 0, label: 'Name present', blocking: true })

  const tasks = w.tasks
  checks.push({ ok: tasks.length >= 1, label: 'At least one task', blocking: true })

  const keys = tasks.map((t) => t.key.trim())
  const nonEmptyKeys = keys.every((k) => k.length > 0)
  checks.push({ ok: nonEmptyKeys, label: 'Every task key is non-empty', blocking: true })
  const uniqueKeys = new Set(keys).size === keys.length
  checks.push({ ok: uniqueKeys && nonEmptyKeys, label: 'Task keys are unique', blocking: true })
  checks.push({
    ok: tasks.every((t) => t.title.trim().length > 0),
    label: 'Every task has a title',
    blocking: true,
  })
  checks.push({
    ok: tasks.every((t) => t.status === 'todo' || t.status === 'ready'),
    label: 'Task status is todo or ready',
    blocking: true,
  })
  const intsOk = tasks.every(
    (t) =>
      (t.maxRuntime.trim() === '' || parsePositiveInt(t.maxRuntime) !== null) &&
      (t.goalMaxTurns.trim() === '' || parsePositiveInt(t.goalMaxTurns) !== null),
  )
  checks.push({ ok: intsOk, label: 'Numeric task fields are positive integers', blocking: true })
  const schedOk = tasks.every((t) => isValidScheduledAt(t.scheduledAt))
  checks.push({
    ok: schedOk,
    label: 'Scheduled-start values are valid (+2h, epoch, or {{var}})',
    blocking: true,
  })

  const varKeys = w.variables.map((v) => v.key.trim()).filter((k) => k.length > 0)
  checks.push({
    ok: new Set(varKeys).size === varKeys.length,
    label: 'Variable keys are unique',
    blocking: true,
  })

  const keySet = new Set(keys.filter((k) => k.length > 0))
  const linksRefOk = w.links.every(([p, c]) => keySet.has(p) && keySet.has(c))
  checks.push({ ok: linksRefOk, label: 'Links reference existing task keys', blocking: true })
  const noSelfLink = w.links.every(([p, c]) => p !== c)
  checks.push({ ok: noSelfLink, label: 'No self-referential links', blocking: true })
  checks.push({ ok: !hasCycleInEdges(w.links), label: 'Dependency graph is acyclic', blocking: true })

  // Non-blocking warning: unresolved {{var}} references in task bodies.
  const varKeySet = new Set(varKeys)
  const unresolved = new Set<string>()
  for (const t of tasks) for (const ref of findVarRefs(t.body)) if (!varKeySet.has(ref)) unresolved.add(ref)
  checks.push({
    ok: unresolved.size === 0,
    label:
      unresolved.size === 0
        ? 'All {{variables}} in task bodies are defined'
        : `Undefined variables referenced: ${[...unresolved].join(', ')}`,
    blocking: false,
  })

  return checks
}

/** Full-graph cycle detection for the review pass. */
function hasCycleInEdges(edges: Array<[string, string]>): boolean {
  const adj = new Map<string, Array<string>>()
  const nodes = new Set<string>()
  for (const [p, c] of edges) {
    nodes.add(p)
    nodes.add(c)
    const list = adj.get(p) ?? []
    list.push(c)
    adj.set(p, list)
  }
  const state = new Map<string, number>() // 0=unvisited,1=in-stack,2=done
  const visit = (node: string): boolean => {
    state.set(node, 1)
    for (const next of adj.get(node) ?? []) {
      const s = state.get(next) ?? 0
      if (s === 1) return true
      if (s === 0 && visit(next)) return true
    }
    state.set(node, 2)
    return false
  }
  for (const node of nodes) if ((state.get(node) ?? 0) === 0 && visit(node)) return true
  return false
}

// ── List ──────────────────────────────────────────────────────────────────────

function TemplateRow({
  template,
  onOpen,
  onInstantiate,
  onDelete,
}: {
  template: KanbanTemplateSummary
  onOpen: (slug: string) => void
  onInstantiate: (template: KanbanTemplateSummary) => void
  onDelete: (template: KanbanTemplateSummary) => void
}) {
  return (
    <tr onClick={() => onOpen(template.slug)} style={{ ['--bc' as string]: template.color || '#5ad3ff' }}>
      <td>
        <div className="tbl-name-cell">
          <div className="tbl-glyph">{(template.name || template.slug).slice(0, 2).toUpperCase()}</div>
          <div>
            <div className="tbl-nm">{template.name || template.slug}</div>
            <div className="tbl-tp">{template.slug}</div>
          </div>
        </div>
      </td>
      <td>{template.variables.length}</td>
      <td>
        {template.has_recurrence ? (
          <span className="status-pill active">
            <span className="d" />
            recurring
          </span>
        ) : (
          <span className="tbl-time">—</span>
        )}
      </td>
      <td onClick={(e) => e.stopPropagation()}>
        <div className="tbl-acts">
          <button className="btn-mini" onClick={() => onInstantiate(template)}>
            Use
          </button>
          <button className="btn-mini" onClick={() => onOpen(template.slug)}>
            Edit
          </button>
          <button className="btn-mini danger" onClick={() => onDelete(template)}>
            Delete
          </button>
        </div>
      </td>
    </tr>
  )
}

// ── Template Wizard (replaces raw-YAML drawer) ──────────────────────────────────

type WizardMode = 'wizard' | 'yaml'

function VariablesStep({
  state,
  update,
}: {
  state: WizardState
  update: (next: Partial<WizardState>) => void
}) {
  const setVar = (i: number, patch: Partial<VarRow>) => {
    update({ variables: state.variables.map((v, idx) => (idx === i ? { ...v, ...patch } : v)) })
  }
  const dupKeys = new Set(
    state.variables
      .map((v) => v.key.trim())
      .filter((k, i, arr) => k && arr.indexOf(k) !== i),
  )
  return (
    <>
      <p className="wz-p">
        Variables are filled in at instantiation. Reference them in task bodies as{' '}
        <code className="wz-code">{'{{key}}'}</code>. This list may be empty.
      </p>
      {state.variables.map((v, i) => {
        const keyTrim = v.key.trim()
        const badKey = keyTrim.length > 0 && !isKebab(keyTrim)
        const dup = dupKeys.has(keyTrim)
        return (
          <div key={i} className="wz-card">
            <div className="wz-card-head">
              <span className="wz-card-title">Variable {i + 1}</span>
              <button
                className="btn-mini danger"
                onClick={() => update({ variables: state.variables.filter((_, idx) => idx !== i) })}
              >
                Remove
              </button>
            </div>
            <div className="wz-grid-2">
              <div className="form-row">
                <label>
                  Key <span className="req">*</span>
                </label>
                <input
                  className="form-inp"
                  value={v.key}
                  onChange={(e) => setVar(i, { key: e.target.value })}
                  placeholder="project"
                />
                {badKey ? <span className="wz-err">Must be kebab-case.</span> : null}
                {dup ? <span className="wz-err">Duplicate key.</span> : null}
              </div>
              <div className="form-row">
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={v.required}
                    onChange={(e) => setVar(i, { required: e.target.checked })}
                  />
                  Required
                </label>
              </div>
            </div>
            <div className="form-row">
              <label>Prompt</label>
              <input
                className="form-inp"
                value={v.prompt}
                onChange={(e) => setVar(i, { prompt: e.target.value })}
                placeholder="Project name"
              />
            </div>
            <div className="wz-grid-2">
              <div className="form-row">
                <label>Description</label>
                <input
                  className="form-inp"
                  value={v.description}
                  onChange={(e) => setVar(i, { description: e.target.value })}
                />
              </div>
              <div className="form-row">
                <label>Default</label>
                <input
                  className="form-inp"
                  value={v.default}
                  onChange={(e) => setVar(i, { default: e.target.value })}
                />
              </div>
            </div>
          </div>
        )
      })}
      <button
        className="btn-mini"
        onClick={() => update({ variables: [...state.variables, emptyVar()] })}
      >
        + Add variable
      </button>
    </>
  )
}

function TaskCard({
  task,
  index,
  varKeys,
  isFirst,
  isLast,
  dupKey,
  onChange,
  onRemove,
  onMove,
  canRemove,
}: {
  task: TaskRow
  index: number
  varKeys: Array<string>
  isFirst: boolean
  isLast: boolean
  dupKey: boolean
  onChange: (patch: Partial<TaskRow>) => void
  onRemove: () => void
  onMove: (dir: -1 | 1) => void
  canRemove: boolean
}) {
  const keyTrim = task.key.trim()
  const badKey = keyTrim.length > 0 && !isKebab(keyTrim)
  const badRuntime = task.maxRuntime.trim() !== '' && parsePositiveInt(task.maxRuntime) === null
  const badTurns = task.goalMaxTurns.trim() !== '' && parsePositiveInt(task.goalMaxTurns) === null

  const insertVar = (key: string) => {
    onChange({ body: `${task.body}${task.body && !task.body.endsWith(' ') ? ' ' : ''}{{${key}}}` })
  }

  return (
    <div className="wz-card">
      <div className="wz-card-head">
        <span className="wz-card-title">Task {index + 1}</span>
        <div className="tbl-acts">
          <button className="btn-mini" disabled={isFirst} onClick={() => onMove(-1)} aria-label="Move up">
            ↑
          </button>
          <button className="btn-mini" disabled={isLast} onClick={() => onMove(1)} aria-label="Move down">
            ↓
          </button>
          <button className="btn-mini danger" disabled={!canRemove} onClick={onRemove}>
            Remove
          </button>
        </div>
      </div>
      <div className="wz-grid-2">
        <div className="form-row">
          <label>
            Key <span className="req">*</span>
          </label>
          <input
            className="form-inp"
            value={task.key}
            onChange={(e) => onChange({ key: e.target.value })}
            placeholder="setup"
          />
          {badKey ? <span className="wz-err">Must be kebab-case.</span> : null}
          {dupKey ? <span className="wz-err">Duplicate key.</span> : null}
        </div>
        <div className="form-row">
          <label>
            Title <span className="req">*</span>
          </label>
          <input
            className="form-inp"
            value={task.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="Set up {{project}}"
          />
        </div>
      </div>
      <div className="wz-grid-3">
        <div className="form-row">
          <label>Status</label>
          <select className="form-inp" value={task.status} onChange={(e) => onChange({ status: e.target.value })}>
            {TEMPLATE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label>Priority</label>
          <select
            className="form-inp"
            value={task.priority}
            onChange={(e) => onChange({ priority: e.target.value })}
          >
            {PRIORITY_LABELS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label>Assignee</label>
          <input
            className="form-inp"
            value={task.assignee}
            onChange={(e) => onChange({ assignee: e.target.value })}
            placeholder="optional"
          />
        </div>
      </div>
      <div className="form-row">
        <label>Body</label>
        {varKeys.length > 0 ? (
          <div className="wz-chips">
            <span className="wz-chips-lbl">Insert:</span>
            {varKeys.map((k) => (
              <button key={k} type="button" className="wz-chip" onClick={() => insertVar(k)}>
                {`{{${k}}}`}
              </button>
            ))}
          </div>
        ) : null}
        <textarea
          className="form-ta"
          value={task.body}
          onChange={(e) => onChange({ body: e.target.value })}
          placeholder="Task body; supports {{variable}} placeholders"
        />
      </div>
      <button
        type="button"
        className="wz-adv-toggle"
        onClick={() => onChange({ showAdvanced: !task.showAdvanced })}
      >
        {task.showAdvanced ? '▾' : '▸'} Advanced
      </button>
      {task.showAdvanced ? (
        <div className="wz-adv">
          <div className="wz-grid-2">
            <div className="form-row">
              <label>Max runtime (seconds)</label>
              <input
                className="form-inp"
                value={task.maxRuntime}
                onChange={(e) => onChange({ maxRuntime: e.target.value })}
                placeholder="e.g. 3600"
                inputMode="numeric"
              />
              {badRuntime ? <span className="wz-err">Positive integer only.</span> : null}
            </div>
            <div className="form-row">
              <label>Goal max turns</label>
              <input
                className="form-inp"
                value={task.goalMaxTurns}
                onChange={(e) => onChange({ goalMaxTurns: e.target.value })}
                placeholder="e.g. 40"
                inputMode="numeric"
              />
              {badTurns ? <span className="wz-err">Positive integer only.</span> : null}
            </div>
          </div>
          <div className="form-row">
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={task.goalMode}
                onChange={(e) => onChange({ goalMode: e.target.checked })}
              />
              Goal mode
            </label>
          </div>
          <ScheduledAtControl
            value={task.scheduledAt}
            varKeys={varKeys}
            onChange={(v) => onChange({ scheduledAt: v })}
          />
        </div>
      ) : null}
    </div>
  )
}

function TasksStep({
  state,
  update,
}: {
  state: WizardState
  update: (next: Partial<WizardState>) => void
}) {
  const keys = state.tasks.map((t) => t.key.trim())
  const dupSet = new Set(keys.filter((k, i, arr) => k && arr.indexOf(k) !== i))
  const varKeys = state.variables.map((v) => v.key.trim()).filter((k) => k.length > 0)

  const setTask = (i: number, patch: Partial<TaskRow>) => {
    update({ tasks: state.tasks.map((t, idx) => (idx === i ? { ...t, ...patch } : t)) })
  }
  const moveTask = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= state.tasks.length) return
    const next = [...state.tasks]
    const tmp = next[i]
    next[i] = next[j]
    next[j] = tmp
    update({ tasks: next })
  }

  return (
    <>
      <p className="wz-p">A template needs at least one task. Keys must be unique and kebab-case.</p>
      {state.tasks.map((t, i) => (
        <TaskCard
          key={i}
          task={t}
          index={i}
          varKeys={varKeys}
          isFirst={i === 0}
          isLast={i === state.tasks.length - 1}
          dupKey={dupSet.has(t.key.trim())}
          canRemove={state.tasks.length > 1}
          onChange={(patch) => setTask(i, patch)}
          onRemove={() => update({ tasks: state.tasks.filter((_, idx) => idx !== i) })}
          onMove={(dir) => moveTask(i, dir)}
        />
      ))}
      <button className="btn-mini" onClick={() => update({ tasks: [...state.tasks, emptyTask()] })}>
        + Add task
      </button>
    </>
  )
}

function DependenciesStep({
  state,
  update,
}: {
  state: WizardState
  update: (next: Partial<WizardState>) => void
}) {
  const taskKeys = state.tasks.map((t) => t.key.trim()).filter((k) => k.length > 0)
  const [parent, setParent] = useState('')
  const [child, setChild] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)

  const addLink = () => {
    setLinkError(null)
    if (!parent || !child) {
      setLinkError('Select both a parent and a child task.')
      return
    }
    if (parent === child) {
      setLinkError('A task cannot depend on itself.')
      return
    }
    if (state.links.some(([p, c]) => p === parent && c === child)) {
      setLinkError('That dependency already exists.')
      return
    }
    if (wouldCycle(state.links, parent, child)) {
      setLinkError(`Adding ${parent} → ${child} would create a cycle.`)
      return
    }
    update({ links: [...state.links, [parent, child]] })
    setParent('')
    setChild('')
  }

  return (
    <>
      <div className="panel-card">
        <div className="pc-head">Dependencies</div>
        <div className="pc-body">
          <p className="wz-p" style={{ marginBottom: 10 }}>
            Define parent → child task ordering. Self-links, duplicates, and cycles are blocked.
          </p>
          {taskKeys.length < 2 ? (
            <p className="wz-p">Add at least two tasks (with keys) to create dependencies.</p>
          ) : (
            <>
              <div className="wz-link-add">
                <select className="form-inp" value={parent} onChange={(e) => setParent(e.target.value)}>
                  <option value="">parent…</option>
                  {taskKeys.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
                <span className="wz-link-arrow">→</span>
                <select className="form-inp" value={child} onChange={(e) => setChild(e.target.value)}>
                  <option value="">child…</option>
                  {taskKeys.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
                <button className="btn-mini prim" onClick={addLink}>
                  Add
                </button>
              </div>
              {linkError ? <div className="wz-err">{linkError}</div> : null}
            </>
          )}
          {state.links.length > 0 ? (
            <div className="wz-chips" style={{ marginTop: 12 }}>
              {state.links.map(([p, c], i) => (
                <span key={`${p}->${c}`} className="wz-chip removable">
                  {p} → {c}
                  <button
                    type="button"
                    className="wz-chip-x"
                    aria-label="Remove dependency"
                    onClick={() => update({ links: state.links.filter((_, idx) => idx !== i) })}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="panel-card">
        <div className="pc-head">Recurrence</div>
        <div className="pc-body">
          <div className="form-row">
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={state.recurrenceEnabled}
                onChange={(e) => update({ recurrenceEnabled: e.target.checked })}
              />
              Enable recurrence
            </label>
          </div>
          {state.recurrenceEnabled ? (
            <>
              <div className="form-row">
                <label>Cron schedule</label>
                <input
                  className="form-inp"
                  value={state.cron}
                  onChange={(e) => update({ cron: e.target.value })}
                  placeholder="0 9 * * 1"
                />
                <span className="form-hint">{CRON_EXAMPLES}</span>
              </div>
              <div className="form-row">
                <label>Timezone</label>
                <input
                  className="form-inp"
                  value={state.timezone}
                  onChange={(e) => update({ timezone: e.target.value })}
                  placeholder="UTC"
                />
              </div>
            </>
          ) : null}
        </div>
      </div>
    </>
  )
}

function ReviewStep({
  checks,
  yamlPreview,
  backendError,
}: {
  checks: Array<Check>
  yamlPreview: string
  backendError: string | null
}) {
  const size = byteLength(yamlPreview)
  const oversized = size > SIZE_WARN_BYTES
  return (
    <>
      {backendError ? (
        <div className="panel-card" style={{ borderColor: '#ff5fa2' }}>
          <div className="pc-head" style={{ color: '#ff5fa2' }}>
            Backend rejected the template
          </div>
          <div className="pc-body description-copy">{backendError}</div>
        </div>
      ) : null}
      <div className="panel-card">
        <div className="pc-head">Pre-commit checks</div>
        <div className="pc-body">
          <div className="wz-checklist">
            {checks.map((c) => (
              <div key={c.label} className={`wz-check ${c.ok ? 'ok' : c.blocking ? 'fail' : 'warn'}`}>
                <span className="wz-check-mark">{c.ok ? '✓' : c.blocking ? '✗' : '!'}</span>
                <span>{c.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="panel-card">
        <div className="pc-head">
          Generated YAML
          {oversized ? (
            <div className="pc-head-right" style={{ color: '#ff5fa2' }}>
              {(size / 1024).toFixed(1)} KB — exceeds 64 KB
            </div>
          ) : (
            <div className="pc-head-right">{size.toLocaleString()} bytes</div>
          )}
        </div>
        <div className="pc-body">
          <textarea
            className="form-ta"
            readOnly
            spellCheck={false}
            style={{
              width: '100%',
              minHeight: 240,
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: 12,
              lineHeight: 1.5,
              whiteSpace: 'pre',
              overflowWrap: 'normal',
            }}
            value={yamlPreview}
          />
        </div>
      </div>
    </>
  )
}

function TemplateWizard({
  slug,
  onClose,
  onSaved,
  onInstantiate,
}: {
  slug: string | null // null = create
  onClose: () => void
  onSaved: () => void
  onInstantiate: (slug: string) => void
}) {
  const isCreate = slug === null
  const detailQuery = useTemplate(slug, !isCreate)
  const templatesQuery = useTemplates()
  const saveMutation = useSaveTemplate()
  const updateMutation = useUpdateTemplate()

  const [state, setState] = useState<WizardState>(blankWizard)
  const [mode, setMode] = useState<WizardMode>('wizard')
  const [yamlText, setYamlText] = useState('')
  const [yamlParseError, setYamlParseError] = useState<string | null>(null)
  const [backendError, setBackendError] = useState<string | null>(null)
  const [loadedSlug, setLoadedSlug] = useState<string | null>(null)

  // Hydrate from the detail query in edit mode.
  useEffect(() => {
    if (isCreate) return
    if (detailQuery.data && loadedSlug !== slug) {
      setState(templateToWizard(detailQuery.data))
      setLoadedSlug(slug)
    }
  }, [detailQuery.data, isCreate, loadedSlug, slug])

  const update = (patch: Partial<WizardState>) => setState((prev) => ({ ...prev, ...patch }))

  function onNameChange(value: string) {
    setState((prev) => {
      const autoSlug = slugify(prev.name) === prev.slug || prev.slug === ''
      return { ...prev, name: value, slug: autoSlug ? slugify(value) : prev.slug }
    })
  }

  // Live slug-collision check (create mode only).
  const existingSlugs = useMemo(
    () => new Set((templatesQuery.data?.templates ?? []).map((t) => t.slug)),
    [templatesQuery.data],
  )
  const slugTaken = isCreate && state.slug.trim().length > 0 && existingSlugs.has(state.slug.trim())

  const checks = useMemo(
    () => runChecks(state, slugTaken, isCreate),
    [state, slugTaken, isCreate],
  )
  const blockingFail = checks.some((c) => c.blocking && !c.ok)
  const yamlPreview = useMemo(() => {
    try {
      return wizardToYaml(state)
    } catch {
      return '# Unable to serialize current state'
    }
  }, [state])

  const saving = saveMutation.isPending || updateMutation.isPending
  const loading = !isCreate && detailQuery.isLoading

  // Per-step gating for Next.
  const stepValid: Record<number, boolean> = {
    1: state.name.trim().length > 0 && state.slug.trim().length > 0 && isKebab(state.slug.trim()) && !slugTaken,
    2: (() => {
      const ks = state.variables.map((v) => v.key.trim())
      const allValid = state.variables.every((v) => {
        const k = v.key.trim()
        return k.length === 0 || isKebab(k)
      })
      const noEmpties = state.variables.every((v) => v.key.trim().length > 0)
      return allValid && noEmpties && new Set(ks).size === ks.length
    })(),
    3: (() => {
      if (state.tasks.length < 1) return false
      const ks = state.tasks.map((t) => t.key.trim())
      if (!ks.every((k) => k.length > 0 && isKebab(k))) return false
      if (new Set(ks).size !== ks.length) return false
      if (!state.tasks.every((t) => t.title.trim().length > 0)) return false
      return state.tasks.every(
        (t) =>
          (t.maxRuntime.trim() === '' || parsePositiveInt(t.maxRuntime) !== null) &&
          (t.goalMaxTurns.trim() === '' || parsePositiveInt(t.goalMaxTurns) !== null) &&
          isValidScheduledAt(t.scheduledAt),
      )
    })(),
    4: true,
    5: true,
  }

  function switchToYaml() {
    setYamlText(wizardToYaml(state))
    setYamlParseError(null)
    setMode('yaml')
  }

  function switchToWizard() {
    try {
      const parsed = parseYaml(yamlText) as KanbanTemplate | null
      if (!parsed || typeof parsed !== 'object') throw new Error('YAML did not parse to an object')
      setState(templateToWizard(parsed))
      setYamlParseError(null)
      setMode('wizard')
    } catch (err) {
      setYamlParseError(err instanceof Error ? err.message : 'Failed to parse YAML')
    }
  }

  async function handleSave() {
    setBackendError(null)
    const yaml = mode === 'yaml' ? yamlText : wizardToYaml(state)
    try {
      if (slug === null) {
        // Backend reads the slug from the request body field (not from inside the YAML).
        const res = await saveMutation.mutateAsync({ yaml, slug: state.slug.trim() })
        toast(`Template "${res.template.name || res.template.slug}" created`, { type: 'success' })
      } else {
        const res = await updateMutation.mutateAsync({ slug, yaml })
        toast(`Template "${res.template.name || res.template.slug}" updated`, { type: 'success' })
      }
      onSaved()
    } catch (err) {
      setBackendError(backendDetail(err, 'Failed to save template'))
    }
  }

  const cur = state.step
  const goStep = (n: number) => update({ step: n })
  const canReachStep = (n: number): boolean => {
    for (let s = 1; s < n; s++) if (!stepValid[s]) return false
    return true
  }

  return (
    <div className="wizard-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="wizard-modal">
        <div className="wz-head">
          <div className="wz-icon">{isCreate ? '+' : '✎'}</div>
          <div>
            <h2>{isCreate ? 'New Template' : detailQuery.data?.name || slug}</h2>
            <div className="wz-sub">
              {mode === 'yaml'
                ? 'Advanced — raw YAML'
                : `Step ${cur} of ${WIZARD_STEPS.length} — ${WIZARD_STEPS[cur - 1]}`}
            </div>
          </div>
          <div className="wz-mode-toggle">
            <button
              className={mode === 'wizard' ? 'on' : ''}
              onClick={() => (mode === 'wizard' ? undefined : switchToWizard())}
            >
              Wizard
            </button>
            <button className={mode === 'yaml' ? 'on' : ''} onClick={() => (mode === 'yaml' ? undefined : switchToYaml())}>
              YAML
            </button>
          </div>
          {!isCreate ? (
            <button className="btn-mini" style={{ marginLeft: 8 }} onClick={() => onInstantiate(slug)}>
              Use
            </button>
          ) : null}
          <button className="wz-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {mode === 'wizard' ? (
          <div className="wz-steps">
            <div className="wz-steps-line" />
            {WIZARD_STEPS.map((label, index) => {
              const n = index + 1
              const cls = n < cur ? 'done' : n === cur ? 'cur' : ''
              const reachable = canReachStep(n)
              return (
                <div
                  key={label}
                  className={`wz-step ${cls}`}
                  style={{ cursor: reachable ? 'pointer' : 'default' }}
                  onClick={() => reachable && goStep(n)}
                >
                  <div className="wz-dot">{n < cur ? '✓' : n}</div>
                  <div className="wz-lbl">{label}</div>
                </div>
              )
            })}
          </div>
        ) : null}

        <div className="wz-body wz-body-scroll">
          {loading ? (
            <div className="brd-loading">Loading template…</div>
          ) : mode === 'yaml' ? (
            <>
              {yamlParseError ? (
                <div className="panel-card" style={{ borderColor: '#ff5fa2' }}>
                  <div className="pc-head" style={{ color: '#ff5fa2' }}>
                    YAML parse error — fix before switching to Wizard
                  </div>
                  <div className="pc-body description-copy">{yamlParseError}</div>
                </div>
              ) : null}
              {backendError ? (
                <div className="panel-card" style={{ borderColor: '#ff5fa2' }}>
                  <div className="pc-head" style={{ color: '#ff5fa2' }}>
                    Backend rejected the template
                  </div>
                  <div className="pc-body description-copy">{backendError}</div>
                </div>
              ) : null}
              <div className="panel-card">
                <div className="pc-head">Template YAML</div>
                <div className="pc-body">
                  <textarea
                    className="form-ta"
                    spellCheck={false}
                    style={{
                      width: '100%',
                      minHeight: 360,
                      fontFamily: 'var(--font-mono, monospace)',
                      fontSize: 12,
                      lineHeight: 1.5,
                      whiteSpace: 'pre',
                      overflowWrap: 'normal',
                    }}
                    value={yamlText}
                    onChange={(e) => setYamlText(e.target.value)}
                  />
                </div>
              </div>
            </>
          ) : cur === 1 ? (
            <>
              <div className="form-row">
                <label>
                  Name <span className="req">*</span>
                </label>
                <input
                  className="form-inp"
                  autoFocus
                  value={state.name}
                  onChange={(e) => onNameChange(e.target.value)}
                  placeholder="e.g. Sprint Kickoff"
                />
              </div>
              <div className="form-row">
                <label>
                  Slug <span className="req">*</span>
                </label>
                <input
                  className="form-inp"
                  value={state.slug}
                  disabled={!isCreate}
                  onChange={(e) => update({ slug: slugify(e.target.value) })}
                />
                {!isCreate ? (
                  <span className="form-hint">Slug is immutable in edit mode.</span>
                ) : !isKebab(state.slug.trim()) && state.slug.trim().length > 0 ? (
                  <span className="wz-err">Must be kebab-case.</span>
                ) : slugTaken ? (
                  <span className="wz-err">A template with this slug already exists.</span>
                ) : (
                  <span className="form-hint">Auto-derived from name; editable.</span>
                )}
              </div>
              <div className="form-row">
                <label>Description</label>
                <textarea
                  className="form-ta"
                  value={state.description}
                  onChange={(e) => update({ description: e.target.value })}
                  placeholder="What does this template set up?"
                />
              </div>
              <div className="form-row">
                <label>Accent Color</label>
                <div className="color-swatches">
                  {COLORS.map((color) => (
                    <div
                      key={color}
                      className={`color-swatch${state.color === color ? ' sel' : ''}`}
                      style={{ background: color, boxShadow: `0 0 8px ${color}60`, ['--sw' as string]: color }}
                      onClick={() => update({ color })}
                    />
                  ))}
                </div>
              </div>
            </>
          ) : cur === 2 ? (
            <VariablesStep state={state} update={update} />
          ) : cur === 3 ? (
            <TasksStep state={state} update={update} />
          ) : cur === 4 ? (
            <DependenciesStep state={state} update={update} />
          ) : (
            <ReviewStep checks={checks} yamlPreview={yamlPreview} backendError={backendError} />
          )}
        </div>

        <div className="wz-foot">
          <span className="wz-foot-step">
            {mode === 'yaml' ? 'Raw YAML escape hatch' : `Step ${cur} / ${WIZARD_STEPS.length}`}
          </span>
          <div className="wz-nav">
            <button className="btn-mini" onClick={onClose}>
              Cancel
            </button>
            {mode === 'yaml' ? (
              <button className="btn-mini prim" disabled={saving} onClick={() => void handleSave()}>
                {saving ? 'Saving…' : isCreate ? 'Create' : 'Save Changes'}
              </button>
            ) : (
              <>
                {cur > 1 ? (
                  <button className="btn-mini" onClick={() => goStep(cur - 1)}>
                    ← Back
                  </button>
                ) : null}
                {cur < WIZARD_STEPS.length ? (
                  <button
                    className="btn-mini prim"
                    disabled={!stepValid[cur]}
                    style={{ opacity: stepValid[cur] ? 1 : 0.45 }}
                    onClick={() => goStep(cur + 1)}
                  >
                    Next →
                  </button>
                ) : (
                  <button
                    className="btn-mini prim"
                    disabled={saving || blockingFail}
                    style={{ opacity: saving || blockingFail ? 0.45 : 1 }}
                    onClick={() => void handleSave()}
                  >
                    {saving ? 'Saving…' : isCreate ? 'Create Template' : 'Save Changes'}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Instantiate modal ───────────────────────────────────────────────────────────

/** Field label with an optional info tooltip (hover/focus) instead of a long inline caption. */
function FieldLabel({
  text,
  required,
  hint,
}: {
  text: string
  required?: boolean
  hint?: string
}) {
  return (
    <label>
      {text} {required ? <span className="req">*</span> : null}
      {hint ? (
        <TooltipRoot>
          <TooltipTrigger
            render={
              <button type="button" className="wz-hint-i" aria-label={`Help: ${text}`}>
                i
              </button>
            }
          />
          <TooltipContent className="wz-tip-popup">{hint}</TooltipContent>
        </TooltipRoot>
      ) : null}
    </label>
  )
}

function InstantiateModal({
  slug,
  onClose,
}: {
  slug: string
  onClose: () => void
}) {
  const detailQuery = useTemplate(slug)
  const instantiateMutation = useInstantiateTemplate()
  const switchBoard = useSwitchBoard()
  const [values, setValues] = useState<Record<string, string>>({})
  const [boardSlug, setBoardSlug] = useState('')
  const [autoDispatch, setAutoDispatch] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<InstantiateResult | null>(null)

  const variables: Array<TemplateVariable> = detailQuery.data?.variables ?? []

  // Seed defaults once when the template detail arrives.
  useEffect(() => {
    if (!detailQuery.data) return
    setValues((prev) => {
      const seeded = { ...prev }
      for (const v of detailQuery.data.variables ?? []) {
        if (!(v.key in seeded)) seeded[v.key] = v.default ?? ''
      }
      return seeded
    })
  }, [detailQuery.data])

  const missingRequired = variables.some((v) => {
    const val = values[v.key]
    return v.required && !(val && val.trim())
  })

  async function handleInstantiate() {
    setError(null)
    try {
      const res = await instantiateMutation.mutateAsync({
        slug,
        input: {
          variables: values,
          board_slug: boardSlug.trim() || undefined,
          auto_dispatch: autoDispatch,
        },
      })
      setResult(res)
      toast(`Instantiated → ${res.board_slug} (${res.created} created, ${res.skipped} skipped)`, {
        type: 'success',
      })
    } catch (err) {
      setError(backendDetail(err, 'Failed to instantiate template'))
    }
  }

  return (
    <div className="wizard-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="wizard-modal">
        <div className="wz-head">
          <div className="wz-icon">▶</div>
          <div>
            <h2>Use Template</h2>
            <div className="wz-sub">{detailQuery.data?.name || slug}</div>
          </div>
          <button className="wz-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="wz-body">
          {detailQuery.isLoading ? (
            <div className="brd-loading">Loading template…</div>
          ) : result ? (
            <div className="review-block">
              <div className="rb-row">
                <span className="rb-k">Board</span>
                <span className="rb-v">
                  <Link
                    to="/tasks"
                    onClick={() => {
                      // Switch the active board to the one we just created so
                      // /tasks lands on the new tasks, not the previous board.
                      switchBoard.mutate(result.board_slug)
                      onClose()
                    }}
                  >
                    {result.board_slug}
                  </Link>
                </span>
              </div>
              <div className="rb-row">
                <span className="rb-k">Instance</span>
                <span className="rb-v path">{result.instance_id}</span>
              </div>
              <div className="rb-row">
                <span className="rb-k">Created</span>
                <span className="rb-v">{result.created}</span>
              </div>
              <div className="rb-row">
                <span className="rb-k">Skipped</span>
                <span className="rb-v">{result.skipped}</span>
              </div>
            </div>
          ) : (
            <TooltipProvider>
              {variables.length === 0 ? (
                <p className="wz-p">This template has no variables. Instantiate directly.</p>
              ) : (
                <div className="wz-var-grid">
                  {variables.map((v) => {
                    const invalid = v.required && !(values[v.key] ?? '').trim()
                    return (
                      <div key={v.key} className="form-row">
                        <FieldLabel text={v.prompt || v.key} required={v.required} hint={v.description} />
                        <input
                          className={`form-inp${invalid ? ' is-invalid' : ''}`}
                          placeholder={v.required ? 'Required' : 'Optional'}
                          aria-invalid={invalid}
                          value={values[v.key] ?? ''}
                          onChange={(e) => setValues((prev) => ({ ...prev, [v.key]: e.target.value }))}
                        />
                        {invalid ? (
                          <span className="form-hint is-error">Required — fill this in.</span>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              )}

              <div className="form-row">
                <FieldLabel
                  text="Board slug (optional)"
                  hint="Target board for the instantiated tasks. Auto-generated from the template if left blank."
                />
                <input
                  className="form-inp"
                  placeholder="auto-generated if blank"
                  value={boardSlug}
                  onChange={(e) => setBoardSlug(e.target.value)}
                />
              </div>

              <div className="form-row">
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={autoDispatch}
                    onChange={(e) => setAutoDispatch(e.target.checked)}
                  />
                  Auto-dispatch tasks to agents
                </label>
                <span className="form-hint">
                  {autoDispatch
                    ? 'On — root tasks (status “ready”, no dependencies) dispatch to agents immediately; dependents unlock as their parents finish.'
                    : 'Off — all tasks are seeded as “todo”; nothing runs until you start them manually.'}
                </span>
              </div>

              {error ? (
                <div className="panel-card" style={{ borderColor: '#ff5fa2', marginTop: 8 }}>
                  <div className="pc-head" style={{ color: '#ff5fa2' }}>
                    {error.includes('409') || error.toLowerCase().includes('refused')
                      ? 'Instantiation refused'
                      : 'Instantiation failed'}
                  </div>
                  <div className="pc-body description-copy">{error}</div>
                </div>
              ) : null}
            </TooltipProvider>
          )}
        </div>

        <div className="wz-foot">
          <span className="wz-foot-step">{result ? 'Done' : `${variables.length} variable${variables.length === 1 ? '' : 's'}`}</span>
          <div className="wz-nav">
            {result ? (
              <button className="btn-mini prim" onClick={onClose}>
                Close
              </button>
            ) : (
              <>
                <button className="btn-mini" onClick={onClose}>
                  Cancel
                </button>
                <button
                  className="btn-mini prim"
                  disabled={instantiateMutation.isPending || missingRequired || detailQuery.isLoading}
                  onClick={() => void handleInstantiate()}
                >
                  {instantiateMutation.isPending ? 'Instantiating…' : 'Instantiate'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Delete confirm ──────────────────────────────────────────────────────────────

function DeleteConfirm({
  template,
  onCancel,
  onConfirm,
  deleting,
}: {
  template: KanbanTemplateSummary
  onCancel: () => void
  onConfirm: () => Promise<void>
  deleting: boolean
}) {
  return (
    <div className="confirm-scrim">
      <div className="confirm-box">
        <h3>Delete Template</h3>
        <p>
          Permanently delete <span className="conf-name">{template.name || template.slug}</span>?
          This cannot be undone.
        </p>
        <div className="conf-acts">
          <button className="btn-mini" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn-mini danger" disabled={deleting} onClick={() => void onConfirm()}>
            Delete Template
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Degraded state (backend too old / endpoint 404) ─────────────────────────────

function TemplatesUnsupported() {
  return (
    <div className="brd-canvas">
      <div className="empty-state">
        <div className="es-title">Templates require a newer Hermes Agent</div>
        <div className="es-sub">
          The connected Hermes Agent does not expose the board templates API. Update the Agent and
          its Kanban plugin to use this feature.
        </div>
      </div>
    </div>
  )
}

// ── Screen ──────────────────────────────────────────────────────────────────────

export function BoardTemplatesScreen() {
  usePageTitle('Board Templates')
  const templatesQuery = useTemplates()
  const deleteMutation = useDeleteTemplate()
  const [search, setSearch] = useState('')
  const [editorSlug, setEditorSlug] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [instantiateSlug, setInstantiateSlug] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<KanbanTemplateSummary | null>(null)

  const templates = templatesQuery.data?.templates ?? []
  const filtered = useMemo(
    () =>
      templates.filter((t) => {
        if (!search) return true
        return `${t.name} ${t.slug} ${t.description ?? ''}`
          .toLowerCase()
          .includes(search.toLowerCase())
      }),
    [templates, search],
  )

  // Degraded: backend endpoint missing (404).
  const is404 =
    templatesQuery.isError &&
    templatesQuery.error instanceof TemplateRequestError &&
    templatesQuery.error.status === 404

  return (
    <div data-screen="boards" className="boards-screen-root">
      <div className="brd-main">
        <div className="brd-top">
          <div>
            <div className="crumbs">
              Workspace<span className="sep">/</span>Tasks<span className="sep">/</span>
              <span className="cur">Templates</span>
            </div>
            <h1>Board Templates</h1>
            <div className="top-sub">Reusable board definitions with variables and recurrence.</div>
          </div>
          <div className="top-right">
            <div className="top-stat">
              <b>{templates.length}</b>Templates
            </div>
            <button
              className="btn-prim"
              onClick={() => {
                setCreating(true)
                setEditorSlug(null)
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                <path d="M12 5v14M5 12h14" />
              </svg>
              New Template
            </button>
          </div>
        </div>

        <div className="brd-toolbar">
          <div className="tb-grow">
            <div className="brd-search-wrap">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <input
                className="brd-search-inp"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search templates…"
              />
            </div>
          </div>
        </div>

        {templatesQuery.isLoading ? (
          <div className="brd-loading">Loading templates…</div>
        ) : is404 ? (
          <TemplatesUnsupported />
        ) : templatesQuery.isError ? (
          <div className="brd-error">
            <span>
              {templatesQuery.error instanceof Error
                ? templatesQuery.error.message
                : 'Templates unavailable'}
            </span>
            <button
              type="button"
              className="btn-mini"
              onClick={() => void templatesQuery.refetch()}
              disabled={templatesQuery.isFetching}
            >
              {templatesQuery.isFetching ? 'Retrying…' : 'Retry'}
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="brd-canvas">
            <div className="empty-state">
              <div className="es-title">No templates found</div>
              <div className="es-sub">Create a template from raw YAML to get started.</div>
            </div>
          </div>
        ) : (
          <div className="brd-canvas">
            <table className="brd-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Variables</th>
                  <th>Recurrence</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <TemplateRow
                    key={t.slug}
                    template={t}
                    onOpen={(slug) => {
                      setCreating(false)
                      setEditorSlug(slug)
                    }}
                    onInstantiate={(tpl) => setInstantiateSlug(tpl.slug)}
                    onDelete={setConfirmDelete}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {creating || editorSlug !== null ? (
        <TemplateWizard
          slug={creating ? null : editorSlug}
          onClose={() => {
            setEditorSlug(null)
            setCreating(false)
          }}
          onSaved={() => {
            setEditorSlug(null)
            setCreating(false)
          }}
          onInstantiate={(slug) => {
            setEditorSlug(null)
            setCreating(false)
            setInstantiateSlug(slug)
          }}
        />
      ) : null}

      {instantiateSlug ? (
        <InstantiateModal slug={instantiateSlug} onClose={() => setInstantiateSlug(null)} />
      ) : null}

      {confirmDelete ? (
        <DeleteConfirm
          template={confirmDelete}
          deleting={deleteMutation.isPending}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            try {
              await deleteMutation.mutateAsync(confirmDelete.slug)
              toast(`Deleted ${confirmDelete.name || confirmDelete.slug}`, { type: 'success' })
              if (editorSlug === confirmDelete.slug) setEditorSlug(null)
              setConfirmDelete(null)
            } catch (err) {
              toast(backendDetail(err, 'Failed to delete template'), { type: 'error' })
            }
          }}
        />
      ) : null}
    </div>
  )
}
