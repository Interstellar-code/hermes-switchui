/**
 * Fixed-size dialog shell for the create-workflow wizard. Same structure and
 * CSS classes as the Run-workflow dialog (launch-wizard.tsx): header, step
 * rail, scrolling body, footer — so both wizards look and behave alike.
 */
import { useRef } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import '@/styles/workflow-ui.css'
import '@/styles/workflow-wizard-v2.css'
import { useFocusTrap } from '@/components/ui/use-focus-trap'

export const WIZARD_STEPS = [
  { id: 'source', title: 'Source' },
  { id: 'design', title: 'Design' },
  { id: 'configure', title: 'Configure' },
  { id: 'review', title: 'Review & Save' },
] as const

export type WizardStepId = (typeof WIZARD_STEPS)[number]['id']

interface ShellProps {
  title?: string
  /** Muted text next to the title (source kind, draft id, …). */
  meta?: string
  /** 0-based index into WIZARD_STEPS. */
  stepIndex: number
  onStepClick: (index: number) => void
  /** Chips shown at the right end of the rail. */
  railRight?: ReactNode
  footerNote?: ReactNode
  onBack: (() => void) | null
  /** Primary / secondary actions, rendered after Cancel. */
  actions: ReactNode
  onClose: () => void
  children: ReactNode
}

export function WizardShell({
  title = 'New workflow',
  meta,
  stepIndex,
  onStepClick,
  railRight,
  footerNote,
  onBack,
  actions,
  onClose,
  children,
}: ShellProps) {
  const modalRef = useRef<HTMLDivElement>(null)
  useFocusTrap(true, modalRef, onClose)
  return createPortal(
    <div data-wf-ui>
      <div className="wfw-backdrop" onClick={onClose}>
        <div
          ref={modalRef}
          className="wfl-dlg wz2-dlg"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="wfl-hd">
            <span className="wfl-t">{title.toUpperCase()}</span>
            {meta && <span className="wfl-meta">{meta}</span>}
            <span className="wfl-grow" />
            <button
              type="button"
              className="wfw-close-btn wfl-x"
              onClick={onClose}
              aria-label="Close dialog"
            >
              ✕ Esc
            </button>
          </div>
          <div className="wfl-rail">
            <ol className="wfl-steps" aria-label="Steps">
              {WIZARD_STEPS.map((s, i) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className={`wfl-pill${i === stepIndex ? ' is-on' : ''}${i < stepIndex ? ' is-done' : ''}`}
                    aria-current={i === stepIndex ? 'step' : undefined}
                    aria-label={i < stepIndex ? `${s.title} (done)` : undefined}
                    disabled={i > stepIndex}
                    onClick={() => onStepClick(i)}
                  >
                    {i + 1} {i < stepIndex ? '✓' : s.title.toUpperCase()}
                  </button>
                </li>
              ))}
            </ol>
            <span className="wfl-grow" />
            {railRight}
          </div>
          <div className="wfl-body wz2-body">{children}</div>
          <div className="wfw-footer">
            {footerNote ?? (
              <span className="wfl-meta">
                Step {stepIndex + 1} of {WIZARD_STEPS.length}
              </span>
            )}
            <div className="wfw-footer-spacer" />
            {onBack && (
              <button
                type="button"
                className="wfw-btn wfw-btn--secondary"
                onClick={onBack}
              >
                ◀ Back
              </button>
            )}
            <button
              type="button"
              className="wfw-btn wfw-btn--secondary"
              onClick={onClose}
            >
              Cancel
            </button>
            {actions}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
