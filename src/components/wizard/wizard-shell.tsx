'use client'

/**
 * wizard-shell.tsx — the chrome every wizard shares: a 4-row grid
 * (head / stepper / body / footer), a focus trap, Escape-to-dismiss, and a
 * scroll lock. It knows nothing about steps or validation; feed it the output
 * of `useWizard` and it lays it out.
 *
 * Two variants:
 *   fullscreen — `.wz-surface`, min-height 100dvh, safe-area insets. Onboarding.
 *   modal      — `.wz-modal`, a fixed centred box. Providers / crons / agents.
 *
 * The `backdrop` prop is an *in-dialog* decorative layer (matrix rain, gradient
 * wash), not a viewport scrim: `wizard.css` is scoped to `[data-wizard]`, so it
 * cannot style a sibling overlay. A modal host that wants a dimming scrim
 * paints its own.
 */
import { useCallback, useEffect, useId, useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import './wizard.css'
import { cn } from '@/lib/utils'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export type WizardShellProps = {
  /** Screen slug — becomes `data-screen` and the `data-testid` suffix. */
  screen: string
  variant?: 'fullscreen' | 'modal'
  /** Extra class(es) appended to the shell's own root class, for a screen
   * stylesheet (e.g. `matrix-onboarding.css`) to hook onto the same node
   * that carries `data-screen`. */
  className?: string
  title: ReactNode
  subtitle?: ReactNode
  headActions?: ReactNode
  /** Usually `<WizardStepper …/>`; omit and the row collapses entirely. */
  stepper?: ReactNode
  /** Decorative layer painted behind the body. Never interactive. */
  backdrop?: ReactNode
  scanline?: boolean
  /** Omit to make the wizard non-dismissible — no Escape handler is attached. */
  onDismiss?: () => void
  footer: ReactNode
  children: ReactNode
}

export function WizardShell({
  screen,
  variant = 'fullscreen',
  className,
  title,
  subtitle,
  headActions,
  stepper,
  backdrop,
  scanline = false,
  onDismiss,
  footer,
  children,
}: WizardShellProps) {
  const titleId = useId()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const titleRef = useRef<HTMLHeadingElement | null>(null)

  // Move focus into the dialog so a screen reader announces the title and the
  // trap below has something inside the dialog to cycle from.
  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  // The page behind a wizard must not scroll; both variants cover it.
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape' && onDismiss) {
        event.stopPropagation()
        onDismiss()
        return
      }
      if (event.key !== 'Tab') return

      const root = rootRef.current
      if (!root) return
      const targets = Array.from(
        root.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter(
        (node) => node.offsetParent !== null || node === titleRef.current,
      )
      if (targets.length === 0) return

      const first = targets[0]
      const last = targets[targets.length - 1]
      const active = document.activeElement

      if (event.shiftKey && (active === first || active === titleRef.current)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    },
    [onDismiss],
  )

  return (
    <div
      ref={rootRef}
      data-wizard
      data-screen={screen}
      data-variant={variant}
      data-stepper={stepper ? 'true' : 'false'}
      /**
       * LOAD-BEARING: `src/routes/__root.tsx` dismisses the boot splash by
       * polling `document.querySelector('nav, aside, .workspace-shell,
       * [data-testid]')`. A wizard that owns the whole viewport (onboarding)
       * renders none of the first three, so this attribute is the only signal
       * that the app has painted. Remove it and the splash never lifts.
       */
      data-testid={`wizard-${screen}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className={cn(variant === 'modal' ? 'wz-modal' : 'wz-surface', className)}
      onKeyDown={handleKeyDown}
    >
      {backdrop ? (
        <div className="wz-backdrop" aria-hidden="true">
          {backdrop}
        </div>
      ) : null}
      {scanline ? <div className="wz-scan" aria-hidden="true" /> : null}

      <header className="wz-head">
        <div className="wz-head-text">
          <h2 id={titleId} ref={titleRef} tabIndex={-1}>
            {title}
          </h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {headActions ? (
          <div className="wz-head-actions">{headActions}</div>
        ) : null}
      </header>

      {stepper ? <div className="wz-rail">{stepper}</div> : null}

      <div className="wz-body">{children}</div>

      <div className="wz-foot">{footer}</div>
    </div>
  )
}
