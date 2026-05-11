import { useReducer, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  INITIAL_WIZARD_STATE,
  STEP_LABELS,
  isDraftDirty,
  validateStep,
  wizardReducer,
  type WizardStep,
} from '../types'
import { WizardStepIdentity } from './wizard-step-identity'
import { WizardStepPersona } from './wizard-step-persona'
import { WizardStepModel } from './wizard-step-model'
import { WizardStepSkills } from './wizard-step-skills'
import { WizardStepMcp } from './wizard-step-mcp'
import { WizardStepMemory } from './wizard-step-memory'
import { WizardStepReview } from './wizard-step-review'
import type { ProfileSummary } from '@/server/profiles-browser'

type Props = {
  open: boolean
  onClose: () => void
  onSuccess: (profileName: string) => void
}

const TOTAL_STEPS = 7

async function postJson(url: string, body: unknown): Promise<unknown> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = (await r.json().catch(() => ({}))) as { error?: string }
  if (!r.ok || payload.error) throw new Error(payload.error ?? `Request failed (${r.status})`)
  return payload
}

export function AgentWizard({ open, onClose, onSuccess }: Props) {
  const [state, dispatch] = useReducer(wizardReducer, INITIAL_WIZARD_STATE)
  const queryClient = useQueryClient()

  const profilesQuery = useQuery({
    queryKey: ['profiles', 'list'],
    queryFn: async () => {
      const r = await fetch('/api/profiles/list')
      if (!r.ok) return { profiles: [] as ProfileSummary[] }
      return (await r.json()) as { profiles: ProfileSummary[] }
    },
    staleTime: 30_000,
  })

  const existingNames = (profilesQuery.data?.profiles ?? []).map((p) => p.name)

  const allTags = Array.from(
    new Set(
      (profilesQuery.data?.profiles ?? []).flatMap((p) => p.agent_ui?.tags ?? [])
    )
  )

  const currentErrors = state.errors[state.step] ?? []

  const canAdvance = useCallback(() => {
    const errs = validateStep(state.step as WizardStep, state.draft, existingNames)
    return errs.length === 0
  }, [state.step, state.draft, existingNames])

  function handleNext() {
    const errs = validateStep(state.step as WizardStep, state.draft, existingNames)
    if (errs.length > 0) {
      dispatch({ type: 'SET_ERRORS', step: state.step, errors: errs })
      return
    }
    dispatch({ type: 'CLEAR_ERRORS', step: state.step })
    if (state.step < TOTAL_STEPS) {
      dispatch({ type: 'SET_STEP', step: (state.step + 1) as WizardStep })
    }
  }

  function handleBack() {
    if (state.step > 1) {
      dispatch({ type: 'SET_STEP', step: (state.step - 1) as WizardStep })
    }
  }

  function handleCancel() {
    if (isDraftDirty(state.draft)) {
      if (!window.confirm('Discard changes and close the wizard?')) return
    }
    dispatch({ type: 'RESET' })
    onClose()
  }

  function handleJumpTo(step: WizardStep) {
    dispatch({ type: 'SET_STEP', step })
  }

  async function handleCreate() {
    // Final validation across all required steps
    const allErrs = validateStep(7, state.draft, existingNames)
    if (allErrs.length > 0) {
      dispatch({ type: 'SET_ERRORS', step: 7, errors: allErrs })
      return
    }

    dispatch({ type: 'SET_SUBMITTING', value: true })
    dispatch({ type: 'SET_SUBMIT_ERROR', error: null })

    try {
      const { draft } = state
      const payload = {
        name: draft.name,
        description: draft.role || draft.name,
        system_prompt: draft.system_prompt,
        model: { default: draft.model, provider: draft.provider },
        mcp_servers: draft.mcp_servers,
        skills: { external_dirs: draft.skill_dirs },
        memory: {
          memory_enabled: draft.memory_enabled,
          provider: draft.memory_provider,
        },
        agent: {
          max_turns: draft.max_turns ?? 200,
          reasoning_effort: draft.reasoning_effort ?? 'medium',
        },
        agent_ui: {
          tier: 3,
          glyph: draft.glyph,
          role: draft.role,
          status: 'draft',
          tags: draft.tags,
          persona_id: draft.persona_id,
        },
      }

      await postJson('/api/profiles/create', payload)
      await queryClient.invalidateQueries({ queryKey: ['profiles'] })
      dispatch({ type: 'RESET' })
      onSuccess(draft.name)
      onClose()
    } catch (err) {
      dispatch({
        type: 'SET_SUBMIT_ERROR',
        error: err instanceof Error ? err.message : 'Failed to create agent',
      })
    } finally {
      dispatch({ type: 'SET_SUBMITTING', value: false })
    }
  }

  if (!open) return null

  const { draft, step, submitting } = state

  function renderStep() {
    const errors = state.errors[step] ?? []
    switch (step) {
      case 1:
        return (
          <WizardStepIdentity
            draft={draft}
            errors={errors}
            existingTags={allTags}
            onChange={(patch) => dispatch({ type: 'SET_DRAFT', patch })}
          />
        )
      case 2:
        return (
          <WizardStepPersona
            draft={draft}
            errors={errors}
            onChange={(patch) => dispatch({ type: 'SET_DRAFT', patch })}
          />
        )
      case 3:
        return (
          <WizardStepModel
            draft={draft}
            errors={errors}
            onChange={(patch) => dispatch({ type: 'SET_DRAFT', patch })}
          />
        )
      case 4:
        return (
          <WizardStepSkills
            draft={draft}
            errors={errors}
            onChange={(patch) => dispatch({ type: 'SET_DRAFT', patch })}
          />
        )
      case 5:
        return (
          <WizardStepMcp
            draft={draft}
            errors={errors}
            onChange={(patch) => dispatch({ type: 'SET_DRAFT', patch })}
          />
        )
      case 6:
        return (
          <WizardStepMemory
            draft={draft}
            errors={errors}
            onChange={(patch) => dispatch({ type: 'SET_DRAFT', patch })}
          />
        )
      case 7:
        return (
          <WizardStepReview
            draft={draft}
            errors={state.errors[7] ?? []}
            submitError={state.submitError}
            onJumpTo={handleJumpTo}
          />
        )
      default:
        return null
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div className="wiz-backdrop" onClick={handleCancel} />

      {/* Modal shell */}
      <div className="wiz-modal" role="dialog" aria-modal="true" aria-label="New Agent Wizard">
        {/* Header */}
        <div className="wiz-head">
          <h2>New Agent</h2>
          <button type="button" className="x" onClick={handleCancel} aria-label="Close wizard">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Step rail */}
        <div className="wiz-steps">
          {(Object.keys(STEP_LABELS) as unknown as WizardStep[]).map((s, i) => {
            const sNum = Number(s) as WizardStep
            const isDone = sNum < step
            const isCurrent = sNum === step
            return (
              <div key={s} style={{ display: 'contents' }}>
                <div
                  className={`wiz-step${isDone ? ' done' : ''}${isCurrent ? ' on' : ''}${!isDone && !isCurrent ? ' locked' : ''}`}
                  style={{ cursor: isDone ? 'pointer' : 'default' }}
                  onClick={() => { if (isDone) handleJumpTo(sNum) }}
                >
                  <div className="n">{isDone ? '✓' : sNum}</div>
                  {STEP_LABELS[sNum]}
                </div>
                {i < TOTAL_STEPS - 1 && <div className="wiz-step-sep" />}
              </div>
            )
          })}
        </div>

        {/* Body */}
        <div className="wiz-body">
          {renderStep()}
        </div>

        {/* Footer */}
        <div className="wiz-foot">
          <div className="lhs">Step <b>{step}</b> / {TOTAL_STEPS}</div>
          <div className="actions">
            <button type="button" className="btn" onClick={handleCancel}>
              Cancel
            </button>
            {step > 1 && (
              <button type="button" className="btn" onClick={handleBack} disabled={submitting}>
                Back
              </button>
            )}
            {step < TOTAL_STEPS ? (
              <button
                type="button"
                className={`btn btn-primary${canAdvance() ? '' : ' disabled'}`}
                disabled={!canAdvance()}
                onClick={handleNext}
              >
                Next →
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleCreate()}
                disabled={submitting}
              >
                {submitting ? 'Creating…' : 'Create Agent'}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
