import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { buildCreatePayload, buildUpdatePayload, draftFromConfig } from '../profile-config-map'
import {
  INITIAL_WIZARD_STATE,
  STEP_LABELS,
  isDraftDirty,
  validateStep,
  wizardReducer,
} from '../types'
import { ConfirmDialog } from './confirm-dialog'
import { WizardStepConfig } from './wizard-step-config'
import { WizardStepIdentity } from './wizard-step-identity'
import { WizardStepMcp } from './wizard-step-mcp'
import { WizardStepMemory } from './wizard-step-memory'
import { WizardStepModel } from './wizard-step-model'
import { WizardStepPersona } from './wizard-step-persona'
import { WizardStepReview } from './wizard-step-review'
import { WizardStepSkills } from './wizard-step-skills'
import { WizardStepToolset } from './wizard-step-toolset'
import type { NewAgentDraft, WizardStep } from '../types'
import type { ProfileConfig, ProfileDetail } from '@/server/profiles-browser'
import { useFocusTrap } from '@/components/ui/use-focus-trap'
import { randomMatrixName } from '@/lib/matrix-names'
import { useProfilesList } from '@/hooks/use-profiles-list'

type Props = {
  open: boolean
  onClose: () => void
  onSuccess: (profileName: string) => void
  editProfileName?: string | null
  /**
   * Step to land on when the wizard opens, from `?step=` (already clamped to
   * 1–9 by the route schema). Read **once per open**, at the moment the draft
   * is seeded — see the seeding effect. It is an entry point, not a mirror: the
   * reducer owns `step` for the rest of the session, and nothing writes it back
   * to the URL. Mirroring would mean two writers for one value and the effect
   * could no longer tell "the user pressed Next" from "the URL changed".
   *
   * Only honoured in edit mode; the screen withholds it for a create flow.
   */
  initialStep?: WizardStep
}

const TOTAL_STEPS = 9

async function postJson(url: string, body: unknown): Promise<unknown> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = (await r.json().catch(() => ({}))) as { error?: string }
  if (!r.ok || payload.error)
    throw new Error(payload.error ?? `Request failed (${r.status})`)
  return payload
}

export function AgentWizard({
  open,
  onClose,
  onSuccess,
  editProfileName,
  initialStep,
}: Props) {
  const [state, dispatch] = useReducer(wizardReducer, INITIAL_WIZARD_STATE)
  const queryClient = useQueryClient()

  const mode = editProfileName ? 'edit' : 'create'

  const profilesQuery = useProfilesList()

  const activeProfile = profilesQuery.data?.activeProfile
  const existingNames = (profilesQuery.data?.profiles ?? []).map((p) => p.name)

  const activeConfigQuery = useQuery({
    queryKey: ['profile-config', activeProfile],
    queryFn: async () => {
      const r = await fetch(
        `/api/profiles/read?name=${encodeURIComponent(activeProfile!)}`,
      )
      if (!r.ok) return null
      const data = (await r.json()) as { profile: { config: ProfileConfig } }
      return data.profile.config
    },
    enabled: !!activeProfile,
    staleTime: 60_000,
  })

  // Edit mode: fetch the full detail for the profile being edited
  const editDetailQuery = useQuery({
    queryKey: ['profile-detail', editProfileName],
    queryFn: async () => {
      const r = await fetch(
        `/api/profiles/read?name=${encodeURIComponent(editProfileName!)}`,
      )
      if (!r.ok) return null
      const data = (await r.json()) as { profile: ProfileDetail }
      return data.profile
    },
    enabled: open && !!editProfileName,
    staleTime: 30_000,
  })

  // Seeding guard — reset when wizard closes or editProfileName changes
  const seededRef = useRef(false)

  // Effect A: reset seed guard when wizard closes or edit target changes
  useEffect(() => {
    if (!open) {
      seededRef.current = false
    }
  }, [open])

  // Also reset when editProfileName changes so switching profiles re-seeds
  useEffect(() => {
    seededRef.current = false
  }, [editProfileName])

  // Effect B: seed draft once per open — and, in the same pass, apply the
  // deep-linked step. Doing it here rather than in an effect of its own is what
  // keeps seeding and step-setting from fighting: `seededRef` already means
  // "this open has been initialised", so both writes happen exactly once, in
  // one commit, and a later re-render with the same props re-enters and bails
  // at the guard above instead of dragging the user back to `?step=`.
  useEffect(() => {
    if (!open || seededRef.current) return

    if (mode === 'edit') {
      // Edit mode: seed from fetched profile config
      if (!editDetailQuery.data) return
      const config = editDetailQuery.data.config
      dispatch({
        type: 'SET_DRAFT',
        patch: draftFromConfig(editProfileName!, config),
      })
      if (initialStep && initialStep !== 1) {
        dispatch({ type: 'SET_STEP', step: initialStep })
      }
      seededRef.current = true
    } else {
      // Create mode: inherit Tier-1 active config + random Matrix name
      if (!activeConfigQuery.data) return
      const config = activeConfigQuery.data
      const modelObj = typeof config.model === 'object' ? config.model : null
      const modelStr = typeof config.model === 'string' ? config.model : ''

      const patch: Partial<NewAgentDraft> = {
        name: randomMatrixName(existingNames),
        model: modelObj?.default ?? modelStr,
        provider: modelObj?.provider ?? '',
        memory_enabled: true,
        memory_provider: config.memory?.provider ?? 'hindsight',
        reasoning_effort: config.agent?.reasoning_effort ?? 'medium',
        max_turns: config.agent?.max_turns ?? 200,
      }

      dispatch({ type: 'SET_DRAFT', patch })
      // `initialStep` is intentionally NOT applied in create mode — see the
      // prop's doc comment and the screen, which never sends it for a create.
      seededRef.current = true
    }
  }, [
    open,
    mode,
    editProfileName,
    editDetailQuery.data,
    activeConfigQuery.data,
    existingNames,
    initialStep,
  ])

  const allTags = Array.from(
    new Set(
      (profilesQuery.data?.profiles ?? []).flatMap(
        (p) => p.agent_ui?.tags ?? [],
      ),
    ),
  )

  const canAdvance = useCallback(() => {
    const errs = validateStep(
      state.step,
      state.draft,
      existingNames,
      editProfileName || undefined,
    )
    return errs.length === 0
  }, [state.step, state.draft, existingNames])

  function handleNext() {
    const errs = validateStep(
      state.step,
      state.draft,
      existingNames,
      editProfileName || undefined,
    )
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

  const [confirmDiscard, setConfirmDiscard] = useState(false)

  function handleCancel() {
    if (isDraftDirty(state.draft)) {
      setConfirmDiscard(true)
      return
    }
    dispatch({ type: 'RESET' })
    onClose()
  }

  function confirmDiscardClose() {
    setConfirmDiscard(false)
    dispatch({ type: 'RESET' })
    onClose()
  }

  // P-16. Escape routes through `handleCancel`, never straight to `onClose`, so
  // a dirty draft still raises the discard confirmation — Escape must not be a
  // quiet way to throw away nine steps of input.
  const modalRef = useRef<HTMLDivElement>(null)
  useFocusTrap(open, modalRef, handleCancel)

  function handleJumpTo(step: WizardStep) {
    dispatch({ type: 'SET_STEP', step })
  }

  async function handleCreate() {
    // Final validation across all required steps
    const allErrs = validateStep(
      9,
      state.draft,
      existingNames,
      editProfileName ?? undefined,
    )
    if (allErrs.length > 0) {
      dispatch({ type: 'SET_ERRORS', step: 9, errors: allErrs })
      return
    }

    dispatch({ type: 'SET_SUBMITTING', value: true })
    dispatch({ type: 'SET_SUBMIT_ERROR', error: null })

    try {
      const { draft } = state

      if (mode === 'edit') {
        // Edit mode: POST /api/profiles/update
        // NOTE: agent_ui MUST NOT include tier or status (update rejects them)
        const payload = buildUpdatePayload(draft)

        await postJson('/api/profiles/update', payload)
        await queryClient.invalidateQueries({ queryKey: ['profiles'] })
        dispatch({ type: 'RESET' })
        onSuccess(draft.name)
        onClose()
      } else {
        // Create mode: POST /api/profiles/create
        const payload = buildCreatePayload(draft)

        await postJson('/api/profiles/create', payload)
        await queryClient.invalidateQueries({ queryKey: ['profiles'] })
        dispatch({ type: 'RESET' })
        onSuccess(draft.name)
        onClose()
      }
    } catch (err) {
      dispatch({
        type: 'SET_SUBMIT_ERROR',
        error:
          err instanceof Error
            ? err.message
            : mode === 'edit'
              ? 'Failed to save agent'
              : 'Failed to create agent',
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
            existingNames={existingNames}
            onChange={(patch) => dispatch({ type: 'SET_DRAFT', patch })}
            editing={mode === 'edit'}
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
          <WizardStepToolset
            draft={draft}
            errors={errors}
            onChange={(patch) => dispatch({ type: 'SET_DRAFT', patch })}
          />
        )
      case 7:
        return (
          <WizardStepMemory
            draft={draft}
            errors={errors}
            onChange={(patch) => dispatch({ type: 'SET_DRAFT', patch })}
          />
        )
      case 8:
        return (
          <WizardStepConfig
            draft={draft}
            errors={errors}
            onChange={(patch) => dispatch({ type: 'SET_DRAFT', patch })}
            config={mode === 'edit' ? editDetailQuery.data?.config : undefined}
          />
        )
      case 9:
        return (
          <WizardStepReview
            draft={draft}
            errors={state.errors[9] ?? []}
            submitError={state.submitError}
            onJumpTo={handleJumpTo}
          />
        )
      default:
        return null
    }
  }

  const isEditMode = mode === 'edit'
  const wizardTitle = isEditMode ? 'Edit Agent' : 'New Agent'
  const submitLabel = isEditMode
    ? submitting
      ? 'Saving…'
      : 'Save changes'
    : submitting
      ? 'Creating…'
      : 'Create Agent'

  return (
    <>
      {/* Backdrop */}
      <div className="wiz-backdrop" onClick={handleCancel} />

      {/* Modal shell */}
      <div
        ref={modalRef}
        className="wiz-modal"
        role="dialog"
        aria-modal="true"
        aria-label={wizardTitle}
      >
        {/* Header */}
        <div className="wiz-head">
          <h2>{wizardTitle}</h2>
          <button
            type="button"
            className="x"
            onClick={handleCancel}
            aria-label="Close wizard"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Step rail */}
        <div className="wiz-steps">
          {(Object.keys(STEP_LABELS) as unknown as Array<WizardStep>).map(
            (s, i) => {
              const sNum = Number(s) as WizardStep
              const isDone = sNum < step
              const isCurrent = sNum === step
              // Edit mode: every step is reachable (data is already valid) — jump freely,
              // forward or back. Create mode: only completed steps are clickable so users
              // don't skip ahead past unfilled required fields (progressive lock).
              const canJump = mode === 'edit' ? !isCurrent : isDone
              const isLocked = !canJump && !isCurrent
              return (
                <div key={s} style={{ display: 'contents' }}>
                  <div
                    className={`wiz-step${isDone ? ' done' : ''}${isCurrent ? ' on' : ''}${isLocked ? ' locked' : ''}`}
                    style={{ cursor: canJump ? 'pointer' : 'default' }}
                    onClick={() => {
                      if (canJump) handleJumpTo(sNum)
                    }}
                  >
                    <div className="n">{isDone ? '✓' : sNum}</div>
                    {STEP_LABELS[sNum]}
                  </div>
                  {i < TOTAL_STEPS - 1 && <div className="wiz-step-sep" />}
                </div>
              )
            },
          )}
        </div>

        {/* Body */}
        <div className="wiz-body">{renderStep()}</div>

        {/* Footer */}
        <div className="wiz-foot">
          <div className="lhs">
            Step <b>{step}</b> / {TOTAL_STEPS}
          </div>
          <div className="actions">
            <button type="button" className="btn" onClick={handleCancel}>
              Cancel
            </button>
            {step > 1 && (
              <button
                type="button"
                className="btn"
                onClick={handleBack}
                disabled={submitting}
              >
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
                {submitLabel}
              </button>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDiscard}
        title="Discard changes?"
        message="You have unsaved wizard input. Close without saving?"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onConfirm={confirmDiscardClose}
        onCancel={() => setConfirmDiscard(false)}
      />
    </>
  )
}
