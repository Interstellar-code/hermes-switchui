'use client'

/**
 * wizard-primitives.tsx — the small parts every wizard step is built from.
 *
 * These exist so a step body is a list of intentions ("a field", "a warning",
 * "a choice") rather than a pile of divs with the right class names. The
 * accessibility wiring in `WizardField` in particular is the reason: hint and
 * error text only reach a screen reader if `aria-describedby` points at them,
 * and hand-rolling that per step is how it gets forgotten.
 */
import { useId } from 'react'
import type { ReactNode } from 'react'

// ── notes ────────────────────────────────────────────────────────────────────

export type WizardNoteProps = {
  tone?: 'info' | 'warn' | 'error' | 'ok'
  children: ReactNode
}

const NOTE_TONE = {
  info: '',
  warn: ' wz-warn',
  error: ' wz-err',
  ok: ' wz-ok',
} as const

export function WizardNote({ tone = 'info', children }: WizardNoteProps) {
  return (
    <div
      className={`wz-note${NOTE_TONE[tone]}`}
      role={tone === 'error' ? 'alert' : undefined}
    >
      {children}
    </div>
  )
}

// ── fields ───────────────────────────────────────────────────────────────────

export type WizardFieldProps = {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  /** Supply when the control is rendered by the caller with a fixed id. */
  htmlFor?: string
  /**
   * Receives the id to put on the control plus the ids to feed
   * `aria-describedby` / `aria-invalid`.
   */
  children: (props: {
    id: string
    'aria-describedby': string | undefined
    'aria-invalid': boolean | undefined
  }) => ReactNode
}

export function WizardField({
  label,
  hint,
  error,
  htmlFor,
  children,
}: WizardFieldProps) {
  const generated = useId()
  const id = htmlFor ?? generated
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className="wz-field">
      <label htmlFor={id}>{label}</label>
      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
      })}
      {hint ? (
        <span className="wz-hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="wz-hint wz-hint-error" id={errorId} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  )
}

export function WizardFieldRow({ children }: { children: ReactNode }) {
  return <div className="wz-field-row">{children}</div>
}

// ── choices ──────────────────────────────────────────────────────────────────

export type WizardPickProps = {
  selected: boolean
  onSelect: () => void
  title: ReactNode
  subtitle?: ReactNode
  tag?: ReactNode
  /** Logo / icon slot. */
  media?: ReactNode
  disabled?: boolean
}

export function WizardPick({
  selected,
  onSelect,
  title,
  subtitle,
  tag,
  media,
  disabled,
}: WizardPickProps) {
  return (
    <button
      type="button"
      className={`wz-pick${selected ? ' on' : ''}`}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
    >
      {media ? <span className="wz-pick-media">{media}</span> : null}
      <span className="wz-t">{title}</span>
      {subtitle ? <span className="wz-s">{subtitle}</span> : null}
      {tag ? <span className="wz-tag">{tag}</span> : null}
    </button>
  )
}

export function WizardGrid({ children }: { children: ReactNode }) {
  return <div className="wz-grid">{children}</div>
}

// ── panels ───────────────────────────────────────────────────────────────────

export type WizardPanelProps = {
  heading?: ReactNode
  children: ReactNode
}

export function WizardPanel({ heading, children }: WizardPanelProps) {
  return (
    <section className="wz-panel">
      {heading ? <h4>{heading}</h4> : null}
      {children}
    </section>
  )
}

// ── footer ───────────────────────────────────────────────────────────────────

export type WizardFooterProps = {
  /** Left-aligned slot: save state, validation summary, a spinner. */
  status?: ReactNode
  onBack?: () => void
  onSkip?: () => void
  onNext?: () => void
  backLabel?: string
  skipLabel?: string
  nextLabel?: string
  nextDisabled?: boolean
  /** Disables Next and swaps its label for `busyLabel`. */
  busy?: boolean
  busyLabel?: string
}

export function WizardFooter({
  status,
  onBack,
  onSkip,
  onNext,
  backLabel = 'Back',
  skipLabel = 'Skip',
  nextLabel = 'Next',
  nextDisabled = false,
  busy = false,
  busyLabel = 'Working…',
}: WizardFooterProps) {
  return (
    <div className="wz-foot-bar">
      <div className="wz-foot-status">{status}</div>
      <span className="wz-grow" />
      {onBack ? (
        <button type="button" className="wz-btn" onClick={onBack}>
          {backLabel}
        </button>
      ) : null}
      {onSkip ? (
        <button type="button" className="wz-btn" onClick={onSkip}>
          {skipLabel}
        </button>
      ) : null}
      {onNext ? (
        <button
          type="button"
          className="wz-btn wz-btn-primary"
          disabled={nextDisabled || busy}
          onClick={onNext}
        >
          {busy ? busyLabel : nextLabel}
        </button>
      ) : null}
    </div>
  )
}
