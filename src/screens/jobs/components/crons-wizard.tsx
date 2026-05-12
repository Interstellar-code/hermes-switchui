'use client'

/**
 * CR-06 — Crons Wizard
 * 6-step modal: Identity → Schedule → Agent → Prompt → Tags → Review
 */

import { useReducer, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ConfirmDialog } from '@/screens/profiles/components/confirm-dialog'
import { BUILTIN_AGENTS } from '@/lib/builtin-agents'
import { createJob, updateJob } from '@/lib/jobs-api'
import type { ClaudeJob } from '@/lib/jobs-api'
import { toast } from '@/components/ui/toast'
import type { ProfileSummary } from '@/server/profiles-browser'

// ── Types ──────────────────────────────────────────────────────────────────────

export type CronDraft = {
  // Step 1: Identity
  name: string
  glyph: string
  status: 'active' | 'paused' | 'draft'
  // Step 2: Schedule
  cron: string
  tz: string
  // Step 3: Agent
  agentId: string
  // Step 4: Prompt
  prompt: string
  // Step 5: Tags
  tagList: string[]
}

type WizardStep = 1 | 2 | 3 | 4 | 5 | 6

type WizardState = {
  step: WizardStep
  draft: CronDraft
  errors: Record<number, string[]>
  submitting: boolean
  submitError: string | null
}

type WizardAction =
  | { type: 'SET_STEP'; step: WizardStep }
  | { type: 'SET_DRAFT'; patch: Partial<CronDraft> }
  | { type: 'SET_ERRORS'; step: number; errors: string[] }
  | { type: 'CLEAR_ERRORS'; step: number }
  | { type: 'SET_SUBMITTING'; value: boolean }
  | { type: 'SET_SUBMIT_ERROR'; error: string | null }
  | { type: 'RESET' }

const systemTz = Intl.DateTimeFormat().resolvedOptions().timeZone

const INITIAL_DRAFT: CronDraft = {
  name: '',
  glyph: '⚙',
  status: 'active',
  cron: '0 9 * * *',
  tz: systemTz,
  agentId: 'hermes-switch',
  prompt: '',
  tagList: [],
}

const INITIAL_STATE: WizardState = {
  step: 1,
  draft: INITIAL_DRAFT,
  errors: {},
  submitting: false,
  submitError: null,
}

function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'SET_STEP':
      return { ...state, step: action.step }
    case 'SET_DRAFT':
      return { ...state, draft: { ...state.draft, ...action.patch } }
    case 'SET_ERRORS':
      return { ...state, errors: { ...state.errors, [action.step]: action.errors } }
    case 'CLEAR_ERRORS':
      return { ...state, errors: { ...state.errors, [action.step]: [] } }
    case 'SET_SUBMITTING':
      return { ...state, submitting: action.value }
    case 'SET_SUBMIT_ERROR':
      return { ...state, submitError: action.error }
    case 'RESET':
      return { ...INITIAL_STATE, draft: { ...INITIAL_DRAFT, tz: systemTz } }
    default:
      return state
  }
}

function isDraftDirty(draft: CronDraft): boolean {
  return (
    draft.name.trim().length > 0 ||
    draft.prompt.trim().length > 0 ||
    draft.tagList.length > 0
  )
}

// ── Validation ─────────────────────────────────────────────────────────────────

const NAME_RE = /^[a-z0-9_-]{2,40}$/
const CRON_5_RE = /^(\S+\s+){4}\S+$/

function validateStep(step: WizardStep, draft: CronDraft): string[] {
  switch (step) {
    case 1: {
      const errs: string[] = []
      if (!NAME_RE.test(draft.name.trim()))
        errs.push('Name must be 2-40 chars, lowercase letters, numbers, _ or -')
      if (!draft.glyph.trim() || draft.glyph.trim().length > 3)
        errs.push('Glyph must be 1–3 characters')
      if (!['active', 'paused', 'draft'].includes(draft.status))
        errs.push('Status must be active, paused, or draft')
      return errs
    }
    case 2: {
      const errs: string[] = []
      if (!draft.cron.trim())
        errs.push('Schedule is required')
      else if (!CRON_5_RE.test(draft.cron.trim()))
        errs.push('Schedule must be a 5-field cron expression (e.g. 0 9 * * *)')
      return errs
    }
    case 3: {
      return draft.agentId.trim() ? [] : ['Agent is required']
    }
    case 4: {
      return draft.prompt.trim().length > 5 ? [] : ['Prompt must be more than 5 characters']
    }
    case 5:
    case 6:
      return []
    default:
      return []
  }
}

// ── Schedule presets ───────────────────────────────────────────────────────────

const SCHEDULE_PRESETS = [
  { label: 'Hourly', value: '0 * * * *' },
  { label: 'Daily 9am', value: '0 9 * * *' },
  { label: 'Daily midnight', value: '0 0 * * *' },
  { label: 'Weekly Mon', value: '0 9 * * 1' },
  { label: 'Monthly 1st', value: '0 9 1 * *' },
]

function parseCronHuman(expr: string): string {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return ''
  const [min, hour, dom, , dow] = parts
  if (min === '*' && hour === '*' && dom === '*' && dow === '*') return 'Every minute'
  if (min !== '*' && hour === '*') return `Every hour at :${min.padStart(2, '0')}`
  if (dom === '*' && dow === '*')
    return `Daily at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`
  if (dom === '*' && dow !== '*') return `Weekly (${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][Number(dow)] ?? dow})`
  if (dom !== '*' && dow === '*') return `Monthly on day ${dom}`
  return ''
}

// ── Glyph picker ───────────────────────────────────────────────────────────────

const GLYPHS = ['⚙', '⏰', '🤖', '📊', '🔄', '📧', '🔍', '📝', '🚀', '💡', '🛠', '📡', '⚡', '🗂', '🧠', '🌐']

// ── Step components ────────────────────────────────────────────────────────────

function StepIdentity({
  draft,
  errors,
  onChange,
}: {
  draft: CronDraft
  errors: string[]
  onChange: (patch: Partial<CronDraft>) => void
}) {
  return (
    <div className="cr-wiz-step">
      <div className="cr-wiz-field">
        <label className="cr-wiz-label">Name <span className="cr-wiz-required">*</span></label>
        <input
          className="cr-wiz-input"
          type="text"
          value={draft.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="daily-report"
          autoFocus
        />
        <div className="cr-wiz-hint">Lowercase letters, numbers, _ or - · 2–40 chars</div>
      </div>

      <div className="cr-wiz-field">
        <label className="cr-wiz-label">Glyph</label>
        <div className="cr-wiz-glyph-grid">
          {GLYPHS.map((g) => (
            <button
              key={g}
              type="button"
              className={`cr-wiz-glyph-btn${draft.glyph === g ? ' selected' : ''}`}
              onClick={() => onChange({ glyph: g })}
            >
              {g}
            </button>
          ))}
        </div>
        <input
          className="cr-wiz-input"
          type="text"
          maxLength={3}
          value={draft.glyph}
          onChange={(e) => onChange({ glyph: e.target.value })}
          placeholder="Custom glyph (1–3 chars)"
          style={{ marginTop: 8 }}
        />
      </div>

      <div className="cr-wiz-field">
        <label className="cr-wiz-label">Initial status</label>
        <div className="cr-wiz-radio-group">
          {(['active', 'paused', 'draft'] as const).map((s) => (
            <label key={s} className="cr-wiz-radio">
              <input
                type="radio"
                name="status"
                value={s}
                checked={draft.status === s}
                onChange={() => onChange({ status: s })}
              />
              {s}
            </label>
          ))}
        </div>
      </div>

      {errors.length > 0 && (
        <ul className="cr-wiz-errors">
          {errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
    </div>
  )
}

function StepSchedule({
  draft,
  errors,
  onChange,
}: {
  draft: CronDraft
  errors: string[]
  onChange: (patch: Partial<CronDraft>) => void
}) {
  const humanized = parseCronHuman(draft.cron)

  return (
    <div className="cr-wiz-step">
      <div className="cr-wiz-field">
        <label className="cr-wiz-label">Quick presets</label>
        <div className="cr-wiz-preset-row">
          {SCHEDULE_PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              className={`cr-wiz-preset-btn${draft.cron === p.value ? ' selected' : ''}`}
              onClick={() => onChange({ cron: p.value })}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="cr-wiz-field">
        <label className="cr-wiz-label">Cron expression <span className="cr-wiz-required">*</span></label>
        <input
          className="cr-wiz-input cr-wiz-mono"
          type="text"
          value={draft.cron}
          onChange={(e) => onChange({ cron: e.target.value })}
          placeholder="0 9 * * *"
          spellCheck={false}
        />
        {humanized && (
          <div className="cr-wiz-cron-parsed">{humanized}</div>
        )}
        <div className="cr-wiz-hint">5-field format: minute hour day-of-month month day-of-week</div>
      </div>

      <div className="cr-wiz-field">
        <label className="cr-wiz-label">Timezone</label>
        <input
          className="cr-wiz-input"
          type="text"
          value={draft.tz}
          onChange={(e) => onChange({ tz: e.target.value })}
          placeholder={systemTz}
        />
        <div className="cr-wiz-hint">IANA timezone, e.g. America/New_York</div>
      </div>

      {errors.length > 0 && (
        <ul className="cr-wiz-errors">
          {errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
    </div>
  )
}

function StepAgent({
  draft,
  errors,
  onChange,
}: {
  draft: CronDraft
  errors: string[]
  onChange: (patch: Partial<CronDraft>) => void
}) {
  const profilesQuery = useQuery({
    queryKey: ['profiles', 'list'],
    queryFn: async () => {
      const r = await fetch('/api/profiles/list')
      if (!r.ok) return { profiles: [] as ProfileSummary[] }
      return (await r.json()) as { profiles: ProfileSummary[] }
    },
    staleTime: 30_000,
  })

  const t3Agents = (profilesQuery.data?.profiles ?? []).map((p) => ({
    id: p.name,
    name: p.name,
    glyph: (p.agent_ui as { glyph?: string } | undefined)?.glyph ?? p.name.slice(0, 2).toUpperCase(),
    role: 'Custom',
    tier: 3 as const,
  }))

  const allAgents = [
    ...BUILTIN_AGENTS.map((a) => ({ ...a, tier: a.tier as 1 | 2 | 3 })),
    ...t3Agents,
  ]

  return (
    <div className="cr-wiz-step">
      <div className="cr-wiz-field">
        <label className="cr-wiz-label">Agent <span className="cr-wiz-required">*</span></label>
        <div className="cr-wiz-agent-grid">
          {allAgents.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`cr-wiz-agent-btn${draft.agentId === a.id ? ' selected' : ''}`}
              onClick={() => onChange({ agentId: a.id })}
            >
              <span className="cr-wiz-agent-glyph">{a.glyph}</span>
              <span className="cr-wiz-agent-name">{a.name}</span>
              <span className="cr-wiz-agent-role">{a.role}</span>
            </button>
          ))}
        </div>
        {profilesQuery.isLoading && (
          <div className="cr-wiz-hint">Loading custom agents…</div>
        )}
      </div>

      {errors.length > 0 && (
        <ul className="cr-wiz-errors">
          {errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
    </div>
  )
}

function StepPrompt({
  draft,
  errors,
  onChange,
}: {
  draft: CronDraft
  errors: string[]
  onChange: (patch: Partial<CronDraft>) => void
}) {
  return (
    <div className="cr-wiz-step">
      <div className="cr-wiz-field">
        <label className="cr-wiz-label">Prompt <span className="cr-wiz-required">*</span></label>
        <textarea
          className="cr-wiz-textarea"
          rows={10}
          value={draft.prompt}
          onChange={(e) => onChange({ prompt: e.target.value })}
          placeholder="What should this cron job do? Be specific…"
          autoFocus
        />
        <div className="cr-wiz-hint">{draft.prompt.length} chars</div>
      </div>

      {errors.length > 0 && (
        <ul className="cr-wiz-errors">
          {errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
    </div>
  )
}

function StepTags({
  draft,
  onChange,
}: {
  draft: CronDraft
  errors: string[]
  onChange: (patch: Partial<CronDraft>) => void
}) {
  const [tagInput, setTagInput] = useState('')

  function addTag() {
    const tag = tagInput.trim()
    if (!tag || draft.tagList.includes(tag)) { setTagInput(''); return }
    onChange({ tagList: [...draft.tagList, tag] })
    setTagInput('')
  }

  function removeTag(t: string) {
    onChange({ tagList: draft.tagList.filter((x) => x !== t) })
  }

  return (
    <div className="cr-wiz-step">
      <div className="cr-wiz-field">
        <label className="cr-wiz-label">Tags <span className="cr-wiz-optional">(optional)</span></label>
        <div className="cr-wiz-tag-input-row">
          <input
            className="cr-wiz-input"
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
            placeholder="Add tag and press Enter"
          />
          <button type="button" className="cr-wiz-tag-add-btn" onClick={addTag}>Add</button>
        </div>
        {draft.tagList.length > 0 && (
          <div className="cr-wiz-chip-row">
            {draft.tagList.map((t) => (
              <span key={t} className="cr-chip">
                {t}
                <button
                  type="button"
                  className="cr-chip-remove"
                  onClick={() => removeTag(t)}
                  aria-label={`Remove ${t}`}
                >×</button>
              </span>
            ))}
          </div>
        )}
        <div className="cr-wiz-hint">
          Reserved prefixes are auto-added: <code>agent:</code>, <code>glyph:</code>, <code>tz:</code>, <code>state:</code>
        </div>
      </div>
    </div>
  )
}

function StepReview({
  draft,
  submitError,
}: {
  draft: CronDraft
  submitError: string | null
}) {
  const humanized = parseCronHuman(draft.cron)
  return (
    <div className="cr-wiz-step">
      <div className="cr-wiz-review">
        <div className="cr-wiz-review-row">
          <span className="cr-wiz-review-key">Name</span>
          <span className="cr-wiz-review-val">{draft.name || '—'}</span>
        </div>
        <div className="cr-wiz-review-row">
          <span className="cr-wiz-review-key">Glyph</span>
          <span className="cr-wiz-review-val">{draft.glyph}</span>
        </div>
        <div className="cr-wiz-review-row">
          <span className="cr-wiz-review-key">Status</span>
          <span className="cr-wiz-review-val">{draft.status}</span>
        </div>
        <div className="cr-wiz-review-row">
          <span className="cr-wiz-review-key">Schedule</span>
          <span className="cr-wiz-review-val cr-wiz-mono">{draft.cron}</span>
        </div>
        {humanized && (
          <div className="cr-wiz-review-row">
            <span className="cr-wiz-review-key" />
            <span className="cr-wiz-review-val cr-wiz-review-sub">{humanized}</span>
          </div>
        )}
        <div className="cr-wiz-review-row">
          <span className="cr-wiz-review-key">Timezone</span>
          <span className="cr-wiz-review-val">{draft.tz || 'UTC'}</span>
        </div>
        <div className="cr-wiz-review-row">
          <span className="cr-wiz-review-key">Agent</span>
          <span className="cr-wiz-review-val">{draft.agentId}</span>
        </div>
        <div className="cr-wiz-review-row cr-wiz-review-row--tall">
          <span className="cr-wiz-review-key">Prompt</span>
          <span className="cr-wiz-review-val cr-wiz-review-prompt">{draft.prompt}</span>
        </div>
        {draft.tagList.length > 0 && (
          <div className="cr-wiz-review-row">
            <span className="cr-wiz-review-key">Tags</span>
            <span className="cr-wiz-review-val">
              <div className="cr-wiz-chip-row">
                {draft.tagList.map((t) => (
                  <span key={t} className="cr-chip">{t}</span>
                ))}
              </div>
            </span>
          </div>
        )}
      </div>
      {submitError && (
        <div className="cr-wiz-submit-error">{submitError}</div>
      )}
    </div>
  )
}

// ── Step labels ────────────────────────────────────────────────────────────────

const STEP_LABELS: Record<WizardStep, string> = {
  1: 'Identity',
  2: 'Schedule',
  3: 'Agent',
  4: 'Prompt',
  5: 'Tags',
  6: 'Review',
}

const TOTAL_STEPS = 6

// ── Main wizard ────────────────────────────────────────────────────────────────

type Props = {
  open: boolean
  editJob?: ClaudeJob | null
  onClose: () => void
  onSuccess: () => void
}

function draftFromJob(job: ClaudeJob): CronDraft {
  const tags: string[] = Array.isArray((job as unknown as Record<string, unknown>).tags)
    ? ((job as unknown as Record<string, unknown>).tags as string[])
    : []
  const agentTag = tags.find((t) => t.startsWith('agent:'))
  const glyphTag = tags.find((t) => t.startsWith('glyph:'))
  const tzTag = tags.find((t) => t.startsWith('tz:'))
  const isDraft = tags.includes('state:draft')

  const cronExpr = (() => {
    const s = job.schedule
    if (!s || typeof s !== 'object') return '0 9 * * *'
    return ((s as Record<string, unknown>).cron_expression as string) ?? '0 9 * * *'
  })()

  const userTags = tags.filter(
    (t) =>
      !t.startsWith('agent:') &&
      !t.startsWith('glyph:') &&
      !t.startsWith('tz:') &&
      !t.startsWith('state:'),
  )

  return {
    name: job.name ?? '',
    glyph: glyphTag ? glyphTag.slice('glyph:'.length) : '⚙',
    status: isDraft ? 'draft' : job.enabled ? 'active' : 'paused',
    cron: cronExpr,
    tz: tzTag ? tzTag.slice('tz:'.length) : systemTz,
    agentId: agentTag ? agentTag.slice('agent:'.length) : 'hermes-switch',
    prompt: job.prompt ?? '',
    tagList: userTags,
  }
}

function buildPayload(draft: CronDraft) {
  const tags = [
    ...draft.tagList,
    `agent:${draft.agentId}`,
    draft.glyph ? `glyph:${draft.glyph}` : null,
    draft.tz && draft.tz !== 'UTC' ? `tz:${draft.tz}` : null,
    draft.status === 'draft' ? 'state:draft' : null,
  ].filter(Boolean) as string[]

  return {
    name: draft.name,
    schedule: draft.cron,
    prompt: draft.prompt,
    skills: [] as string[],
    deliver: [] as string[],
    tags,
    enabled: draft.status !== 'paused' && draft.status !== 'draft',
  }
}

export function CronsWizard({ open, editJob, onClose, onSuccess }: Props) {
  const [state, dispatch] = useReducer(wizardReducer, INITIAL_STATE)
  const queryClient = useQueryClient()
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const isEdit = editJob != null

  // Populate draft when editing
  const [loadedJobId, setLoadedJobId] = useState<string | undefined>(undefined)
  if (isEdit && editJob.id !== loadedJobId && open) {
    dispatch({ type: 'RESET' })
    dispatch({ type: 'SET_DRAFT', patch: draftFromJob(editJob) })
    setLoadedJobId(editJob.id)
  }
  if (!open && loadedJobId !== undefined) {
    setLoadedJobId(undefined)
  }

  const { step, draft, submitting } = state

  const handleNext = useCallback(() => {
    const errs = validateStep(step, draft)
    if (errs.length > 0) {
      dispatch({ type: 'SET_ERRORS', step, errors: errs })
      return
    }
    dispatch({ type: 'CLEAR_ERRORS', step })
    if (step < TOTAL_STEPS) {
      dispatch({ type: 'SET_STEP', step: (step + 1) as WizardStep })
    }
  }, [step, draft])

  const handleBack = useCallback(() => {
    if (step > 1) {
      dispatch({ type: 'SET_STEP', step: (step - 1) as WizardStep })
    }
  }, [step])

  const handleCancel = useCallback(() => {
    if (isDraftDirty(draft) && !isEdit) {
      setConfirmDiscard(true)
      return
    }
    dispatch({ type: 'RESET' })
    onClose()
  }, [draft, isEdit, onClose])

  async function handleSubmit() {
    // Validate all steps
    const allErrors: string[] = []
    for (let s = 1; s <= TOTAL_STEPS - 1; s++) {
      allErrors.push(...validateStep(s as WizardStep, draft))
    }
    if (allErrors.length > 0) {
      dispatch({ type: 'SET_SUBMIT_ERROR', error: allErrors.join('; ') })
      return
    }

    dispatch({ type: 'SET_SUBMITTING', value: true })
    dispatch({ type: 'SET_SUBMIT_ERROR', error: null })

    try {
      const payload = buildPayload(draft)
      if (isEdit && editJob) {
        await updateJob(editJob.id, payload as Record<string, unknown>)
        toast('Cron updated', { type: 'success' })
      } else {
        await createJob({
          name: payload.name,
          schedule: payload.schedule,
          prompt: payload.prompt,
          skills: payload.skills.length ? payload.skills : undefined,
          deliver: payload.deliver.length ? payload.deliver : undefined,
        })
        toast('Cron created', { type: 'success' })
      }
      await queryClient.invalidateQueries({ queryKey: ['crons', 'list'] })
      dispatch({ type: 'RESET' })
      onSuccess()
      onClose()
    } catch (err) {
      dispatch({
        type: 'SET_SUBMIT_ERROR',
        error: err instanceof Error ? err.message : 'Failed to save cron',
      })
    } finally {
      dispatch({ type: 'SET_SUBMITTING', value: false })
    }
  }

  if (!open) return null

  const errors = state.errors[step] ?? []

  function renderStep() {
    switch (step) {
      case 1:
        return <StepIdentity draft={draft} errors={errors} onChange={(p) => dispatch({ type: 'SET_DRAFT', patch: p })} />
      case 2:
        return <StepSchedule draft={draft} errors={errors} onChange={(p) => dispatch({ type: 'SET_DRAFT', patch: p })} />
      case 3:
        return <StepAgent draft={draft} errors={errors} onChange={(p) => dispatch({ type: 'SET_DRAFT', patch: p })} />
      case 4:
        return <StepPrompt draft={draft} errors={errors} onChange={(p) => dispatch({ type: 'SET_DRAFT', patch: p })} />
      case 5:
        return <StepTags draft={draft} errors={errors} onChange={(p) => dispatch({ type: 'SET_DRAFT', patch: p })} />
      case 6:
        return <StepReview draft={draft} submitError={state.submitError} />
      default:
        return null
    }
  }

  const isLastStep = step === TOTAL_STEPS

  return createPortal(
    <>
      <div className="cr-wizard-backdrop" onClick={handleCancel} />
      <div className="cr-wizard" role="dialog" aria-modal="true" aria-label={isEdit ? 'Edit Cron' : 'New Cron'}>
        {/* Header */}
        <div className="cr-wizard-head">
          <div className="cr-wizard-title">
            <span className="cr-wizard-title-main">{isEdit ? 'Edit Cron' : 'New Cron'}</span>
            <span className="cr-wizard-title-step">{STEP_LABELS[step]}</span>
          </div>
          <button type="button" className="cr-wizard-close" onClick={handleCancel} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Step bar */}
        <div className="cr-wizard-steps">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((s) => (
            <div
              key={s}
              className={`cr-wizard-step-dot${s === step ? ' active' : s < step ? ' done' : ''}`}
              title={STEP_LABELS[s as WizardStep]}
            />
          ))}
        </div>

        {/* Body */}
        <div className="cr-wizard-body">
          {renderStep()}
        </div>

        {/* Footer */}
        <div className="cr-wizard-foot">
          <button type="button" className="cr-wizard-btn cr-wizard-btn--ghost" onClick={handleCancel}>
            Cancel
          </button>
          <div className="cr-wizard-foot-right">
            {step > 1 && (
              <button type="button" className="cr-wizard-btn cr-wizard-btn--secondary" onClick={handleBack}>
                Back
              </button>
            )}
            {!isLastStep ? (
              <button type="button" className="cr-wizard-btn cr-wizard-btn--primary" onClick={handleNext}>
                Next
              </button>
            ) : (
              <button
                type="button"
                className="cr-wizard-btn cr-wizard-btn--primary"
                onClick={() => { void handleSubmit() }}
                disabled={submitting}
              >
                {submitting ? (isEdit ? 'Saving…' : 'Creating…') : (isEdit ? 'Save' : 'Create')}
              </button>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDiscard}
        title="Discard changes?"
        message="You have unsaved changes. Discard and close?"
        confirmLabel="Discard"
        destructive
        onConfirm={() => {
          setConfirmDiscard(false)
          dispatch({ type: 'RESET' })
          onClose()
        }}
        onCancel={() => setConfirmDiscard(false)}
      />
    </>,
    document.body,
  )
}

