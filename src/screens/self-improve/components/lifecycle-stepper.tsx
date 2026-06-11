'use client'

import type { Experiment } from '@/lib/self-improve-types'

// ── Props ─────────────────────────────────────────────────────────────────────

export interface LifecycleStepperProps {
  exp: Experiment
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTs(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

interface Step {
  label: string
  ts: string | null
  key: 'proposed' | 'approved' | 'live' | 'verified'
}

const STATE_ORDER: Record<string, number> = {
  proposed: 0,
  approved: 1,
  live: 2,
  verified: 3,
  reverted: 2, // treat as reached "applied" but then reverted
  rejected: 0, // only proposed step completed
}

// ── Component ─────────────────────────────────────────────────────────────────

export function LifecycleStepper({ exp }: LifecycleStepperProps) {
  const stateIdx = STATE_ORDER[exp.state] ?? 0
  const isReverted = exp.state === 'reverted'
  const isRejected = exp.state === 'rejected'

  const steps: Array<Step> = [
    { label: 'Proposed', ts: exp.created_at, key: 'proposed' },
    { label: 'Approved', ts: exp.approved_at, key: 'approved' },
    { label: 'Applied', ts: exp.applied_at, key: 'live' },
    { label: 'Verified', ts: exp.verified_at, key: 'verified' },
  ]

  return (
    <div className="si-stepper">
      {steps.map((step, i) => {
        const done = i < stateIdx || (i === stateIdx && (isReverted || exp.state === step.key))
        const current = !done && i === stateIdx && !isReverted && !isRejected
        const stepClass = done
          ? 'si-stepper-step--done'
          : current
            ? 'si-stepper-step--current'
            : 'si-stepper-step--pending'

        return (
          <div key={step.key} className="si-stepper-item">
            {i > 0 && <div className={`si-stepper-connector${done ? ' si-stepper-connector--done' : ''}`} />}
            <div className={`si-stepper-step ${stepClass}`}>
              <div className="si-stepper-dot">
                {done ? '✓' : current ? '●' : '○'}
              </div>
              <div className="si-stepper-label">{step.label}</div>
              {done && step.ts && (
                <div className="si-stepper-ts">{fmtTs(step.ts)}</div>
              )}
            </div>
          </div>
        )
      })}

      {/* Terminal step for reverted */}
      {isReverted && (
        <div className="si-stepper-item">
          <div className="si-stepper-connector si-stepper-connector--done" />
          <div className="si-stepper-step si-stepper-step--reverted">
            <div className="si-stepper-dot">✕</div>
            <div className="si-stepper-label">Reverted</div>
            {exp.reverted_at && (
              <div className="si-stepper-ts">{fmtTs(exp.reverted_at)}</div>
            )}
          </div>
        </div>
      )}

      {/* Terminal step for rejected */}
      {isRejected && (
        <div className="si-stepper-item">
          <div className="si-stepper-connector" />
          <div className="si-stepper-step si-stepper-step--reverted">
            <div className="si-stepper-dot">✕</div>
            <div className="si-stepper-label">Rejected</div>
            {exp.rejected_at && (
              <div className="si-stepper-ts">{fmtTs(exp.rejected_at)}</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
