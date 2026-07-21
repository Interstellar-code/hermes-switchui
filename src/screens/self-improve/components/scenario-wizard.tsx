import { useEffect, useRef, useState } from 'react'
import type {
  CreateScenarioBody,
  ScenarioCheck,
} from '@/lib/self-improve-types'
import { Button } from '@/components/shadcn/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/shadcn/ui/dialog'
import { Input } from '@/components/shadcn/ui/input'

export type ScenarioWizardPayload = CreateScenarioBody & {
  input: string
  checks: Array<ScenarioCheck>
}

export interface ScenarioWizardProps {
  open: boolean
  profile: string
  pending: boolean
  error?: string | null
  onOpenChange: (open: boolean) => void
  onCreate: (payload: ScenarioWizardPayload) => void
}

type CheckType = ScenarioCheck['type']
type TemplateKey =
  | 'custom'
  | 'factual'
  | 'format'
  | 'safety'
  | 'tool'
  | 'delegation'
  | 'concise'

interface CheckDraft {
  id: number
  type: CheckType
  value: string
}

const CHECK_OPTIONS: Array<{
  type: CheckType
  label: string
  placeholder: string
}> = [
  {
    type: 'must_contain',
    label: 'Must contain',
    placeholder: 'Required text',
  },
  {
    type: 'must_not_contain',
    label: 'Must not contain',
    placeholder: 'Forbidden text',
  },
  {
    type: 'max_tokens',
    label: 'Maximum tokens',
    placeholder: '120',
  },
  { type: 'tool_used', label: 'Tool used', placeholder: 'Tool name' },
  {
    type: 'judge',
    label: 'Judge rubric',
    placeholder: 'Describe the behavior that must pass',
  },
]

const TEMPLATES: Record<
  TemplateKey,
  {
    label: string
    description: string
    name: string
    check: Omit<CheckDraft, 'id'>
  }
> = {
  custom: {
    label: 'Custom',
    description: 'Start with a blank deterministic check.',
    name: '',
    check: { type: 'must_contain', value: '' },
  },
  factual: {
    label: 'Factual accuracy',
    description: 'Judge whether the answer is correct and directly supported.',
    name: 'factual-accuracy',
    check: {
      type: 'judge',
      value:
        'The response is factually correct and directly answers the prompt.',
    },
  },
  format: {
    label: 'Response format',
    description: 'Require a stable marker or output shape.',
    name: 'response-format',
    check: { type: 'must_contain', value: '' },
  },
  safety: {
    label: 'Safety',
    description: 'Reject a forbidden phrase or unsafe behavior.',
    name: 'safe-response',
    check: { type: 'must_not_contain', value: '' },
  },
  tool: {
    label: 'Tool usage',
    description: 'Require the agent to call a specific tool.',
    name: 'required-tool',
    check: { type: 'tool_used', value: '' },
  },
  delegation: {
    label: 'Delegation',
    description: 'Judge whether work is delegated only when appropriate.',
    name: 'delegation-behavior',
    check: {
      type: 'judge',
      value:
        'The response delegates only when it materially improves the result.',
    },
  },
  concise: {
    label: 'Conciseness',
    description: 'Keep the response within a token budget.',
    name: 'concise-response',
    check: { type: 'max_tokens', value: '120' },
  },
}

const STEP_LABELS = ['Setup', 'Prompt', 'Checks & review']

function checkIsValid(check: CheckDraft) {
  if (check.type !== 'max_tokens') return check.value.trim().length > 0
  const value = Number(check.value)
  return Number.isInteger(value) && value > 0
}

function toScenarioCheck(check: CheckDraft): ScenarioCheck {
  if (check.type === 'max_tokens') {
    return { type: check.type, value: Number(check.value) }
  }
  if (check.type === 'judge') {
    return { type: check.type, rubric: check.value.trim() }
  }
  return { type: check.type, value: check.value.trim() }
}

function checkSummary(check: CheckDraft) {
  const label = CHECK_OPTIONS.find(
    (option) => option.type === check.type,
  )?.label
  return `${label}: ${check.value}`
}

export function ScenarioWizard({
  open,
  profile,
  pending,
  error,
  onOpenChange,
  onCreate,
}: ScenarioWizardProps) {
  const nextCheckId = useRef(1)
  const [step, setStep] = useState(0)
  const [template, setTemplate] = useState<TemplateKey>('custom')
  const [name, setName] = useState('')
  const [input, setInput] = useState('')
  const [holdout, setHoldout] = useState(false)
  const [checks, setChecks] = useState<Array<CheckDraft>>([
    { id: 0, type: 'must_contain', value: '' },
  ])
  const [showErrors, setShowErrors] = useState(false)

  useEffect(() => {
    if (open) return
    setStep(0)
    setTemplate('custom')
    setName('')
    setInput('')
    setHoldout(false)
    setChecks([{ id: 0, type: 'must_contain', value: '' }])
    setShowErrors(false)
    nextCheckId.current = 1
  }, [open])

  const setupValid = name.trim().length > 0
  const promptValid = input.trim().length > 0
  const checksValid = checks.length > 0 && checks.every(checkIsValid)

  function selectTemplate(next: TemplateKey) {
    const preset = TEMPLATES[next]
    setTemplate(next)
    setName(preset.name)
    setChecks([{ id: nextCheckId.current++, ...preset.check }])
    setShowErrors(false)
  }

  function goNext() {
    const valid = step === 0 ? setupValid : promptValid
    if (!valid) {
      setShowErrors(true)
      return
    }
    setShowErrors(false)
    setStep((current) => Math.min(current + 1, 2))
  }

  function create() {
    if (!checksValid || pending) {
      setShowErrors(true)
      return
    }
    onCreate({
      profile,
      name: name.trim(),
      input: input.trim(),
      checks: checks.map(toScenarioCheck),
      holdout,
    })
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (step < 2) goNext()
    else create()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!pending || nextOpen) onOpenChange(nextOpen)
      }}
    >
      <DialogContent className="si-wizard" showCloseButton={!pending}>
        <DialogHeader className="si-wizard-header">
          <div className="si-wizard-eyebrow">Behavior evaluation</div>
          <DialogTitle className="si-wizard-title">New scenario</DialogTitle>
          <DialogDescription className="si-wizard-description">
            Define one prompt and the objective checks that decide whether it
            passes.
          </DialogDescription>
        </DialogHeader>

        <ol className="si-wizard-steps" aria-label="Scenario creation progress">
          {STEP_LABELS.map((label, index) => (
            <li
              key={label}
              className={
                index <= step ? 'si-wizard-step is-active' : 'si-wizard-step'
              }
              aria-current={index === step ? 'step' : undefined}
            >
              <span>{index + 1}</span>
              {label}
            </li>
          ))}
        </ol>

        <form className="si-wizard-form" onSubmit={submit}>
          <div className="si-wizard-body">
            {step === 0 && (
              <section
                className="si-wizard-panel"
                aria-labelledby="si-wizard-setup"
              >
                <div className="si-wizard-panel-heading">
                  <h3 id="si-wizard-setup">Choose a starting point</h3>
                  <p>Templates fill sensible defaults that you can edit.</p>
                </div>

                <div className="si-wizard-scope">
                  <span>Profile</span>
                  <strong className="si-wizard-profile-badge">{profile}</strong>
                </div>

                <label className="si-wizard-field">
                  <span>Scenario type</span>
                  <select
                    aria-label="Scenario type"
                    value={template}
                    onChange={(event) =>
                      selectTemplate(event.target.value as TemplateKey)
                    }
                  >
                    {Object.entries(TEMPLATES).map(([key, value]) => (
                      <option key={key} value={key}>
                        {value.label}
                      </option>
                    ))}
                  </select>
                  <small>{TEMPLATES[template].description}</small>
                </label>

                <label className="si-wizard-field">
                  <span>
                    Name <b aria-hidden="true">*</b>
                  </span>
                  <Input
                    aria-label="Name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="e.g. concise-status-answer"
                    aria-invalid={showErrors && !setupValid}
                    autoFocus
                  />
                  {showErrors && !setupValid && (
                    <small className="si-wizard-field-error">
                      Name is required.
                    </small>
                  )}
                </label>

                <label className="si-wizard-field">
                  <span>Evaluation split</span>
                  <select
                    aria-label="Evaluation split"
                    value={holdout ? 'holdout' : 'training'}
                    onChange={(event) =>
                      setHoldout(event.target.value === 'holdout')
                    }
                  >
                    <option value="training">Training</option>
                    <option value="holdout">Held-out</option>
                  </select>
                  <small>
                    {holdout
                      ? 'Reserved for unbiased evaluation; not used to guide improvements.'
                      : 'Used to evaluate and guide profile improvements.'}
                  </small>
                </label>
              </section>
            )}

            {step === 1 && (
              <section
                className="si-wizard-panel"
                aria-labelledby="si-wizard-prompt"
              >
                <div className="si-wizard-panel-heading">
                  <h3 id="si-wizard-prompt">Write the user prompt</h3>
                  <p>Use the exact input the profile should handle.</p>
                </div>
                <label className="si-wizard-field">
                  <span>
                    Input <b aria-hidden="true">*</b>
                  </span>
                  <textarea
                    aria-label="Input"
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    placeholder="What should the agent respond to?"
                    rows={8}
                    aria-invalid={showErrors && !promptValid}
                    autoFocus
                  />
                  {showErrors && !promptValid && (
                    <small className="si-wizard-field-error">
                      Input is required.
                    </small>
                  )}
                </label>
              </section>
            )}

            {step === 2 && (
              <section
                className="si-wizard-panel"
                aria-labelledby="si-wizard-checks"
              >
                <div className="si-wizard-panel-heading si-wizard-panel-heading--row">
                  <div>
                    <h3 id="si-wizard-checks">Add pass criteria</h3>
                    <p>Every check must pass for this scenario to pass.</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="si-wizard-secondary"
                    onClick={() =>
                      setChecks((current) => [
                        ...current,
                        {
                          id: nextCheckId.current++,
                          type: 'must_contain',
                          value: '',
                        },
                      ])
                    }
                  >
                    + Add check
                  </Button>
                </div>

                <div className="si-wizard-checks">
                  {checks.map((check, index) => {
                    const option = CHECK_OPTIONS.find(
                      (candidate) => candidate.type === check.type,
                    )
                    return (
                      <div className="si-wizard-check" key={check.id}>
                        <span className="si-wizard-check-number">
                          {index + 1}
                        </span>
                        <select
                          aria-label={`Check ${index + 1} type`}
                          value={check.type}
                          onChange={(event) =>
                            setChecks((current) =>
                              current.map((item) =>
                                item.id === check.id
                                  ? {
                                      ...item,
                                      type: event.target.value as CheckType,
                                      value: '',
                                    }
                                  : item,
                              ),
                            )
                          }
                        >
                          {CHECK_OPTIONS.map((candidate) => (
                            <option key={candidate.type} value={candidate.type}>
                              {candidate.label}
                            </option>
                          ))}
                        </select>
                        <Input
                          type={check.type === 'max_tokens' ? 'number' : 'text'}
                          min={check.type === 'max_tokens' ? 1 : undefined}
                          step={check.type === 'max_tokens' ? 1 : undefined}
                          aria-label={`Check ${index + 1} value`}
                          aria-invalid={showErrors && !checkIsValid(check)}
                          value={check.value}
                          placeholder={option?.placeholder}
                          onChange={(event) =>
                            setChecks((current) =>
                              current.map((item) =>
                                item.id === check.id
                                  ? { ...item, value: event.target.value }
                                  : item,
                              ),
                            )
                          }
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="si-wizard-remove"
                          aria-label={`Remove check ${index + 1}`}
                          onClick={() =>
                            setChecks((current) =>
                              current.filter((item) => item.id !== check.id),
                            )
                          }
                        >
                          Remove
                        </Button>
                      </div>
                    )
                  })}
                </div>

                {showErrors && !checksValid && (
                  <p className="si-wizard-field-error" role="alert">
                    Add at least one complete check. Maximum tokens must be a
                    positive whole number.
                  </p>
                )}

                <div className="si-wizard-review">
                  <h4>Review</h4>
                  <dl>
                    <div>
                      <dt>Profile</dt>
                      <dd>{profile}</dd>
                    </div>
                    <div>
                      <dt>Split</dt>
                      <dd>{holdout ? 'Held-out' : 'Training'}</dd>
                    </div>
                    <div>
                      <dt>Name</dt>
                      <dd>{name.trim()}</dd>
                    </div>
                    <div>
                      <dt>Prompt</dt>
                      <dd>{input.trim()}</dd>
                    </div>
                    <div>
                      <dt>Checks</dt>
                      <dd>
                        {checks.length > 0
                          ? checks.map(checkSummary).join(' · ')
                          : 'None'}
                      </dd>
                    </div>
                  </dl>
                </div>
              </section>
            )}

            {error && (
              <div className="si-wizard-api-error" role="alert">
                {error}
              </div>
            )}
          </div>

          <footer className="si-wizard-footer">
            <Button
              type="button"
              variant="ghost"
              className="si-wizard-cancel"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <div className="si-wizard-footer-actions">
              {step > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  className="si-wizard-secondary"
                  disabled={pending}
                  onClick={() => {
                    setShowErrors(false)
                    setStep((current) => current - 1)
                  }}
                >
                  Back
                </Button>
              )}
              {step < 2 ? (
                <Button type="submit" className="si-wizard-primary">
                  Continue
                </Button>
              ) : (
                <Button
                  type="submit"
                  className="si-wizard-primary"
                  disabled={pending}
                  aria-busy={pending}
                >
                  {pending ? 'Creating…' : 'Create scenario'}
                </Button>
              )}
            </div>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  )
}
