'use client'

/**
 * setup-checklist-card.tsx — the dashboard's own view of "what's left from
 * setup", reusing the same `OnboardingChecklist` the wizard's summary and
 * finish steps render (not forked — see `use-onboarding-checklist.ts`'s
 * header for why skipped/never-done items must stay reachable after the
 * wizard closes).
 *
 * Styling: `./setup-checklist-card.css` gives the reused `ob-list*`/`wz-btn`
 * class names dashboard-local rules instead of pulling in
 * `matrix-onboarding.css`/`wizard.css`'s attribute-scoped stylesheets — see
 * that file's header comment for why (short version: `[data-wizard]` carries
 * a `display: grid` layout side effect that would fight this card's own
 * layout). The card's own chrome (border, heading, dismiss control) is built
 * from the same `var(--theme-*)` + Tailwind-layout-utility convention
 * `dashboard-screen.tsx`'s `GlassCard`/`SecondaryAction` already use, rather
 * than importing `GlassCard` itself, to avoid a circular import between this
 * file and `dashboard-screen.tsx`.
 */
import { useEffect, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon } from '@hugeicons/core-free-icons'
import type { ChecklistItem } from '@/screens/onboarding/lib/checklist'
import { OnboardingChecklist } from '@/screens/onboarding/components/onboarding-checklist'
import { outstandingRequiredCount } from '@/screens/onboarding/lib/checklist'
import { useOnboardingChecklist } from '@/screens/onboarding/hooks/use-onboarding-checklist'
import { useSetupWizardStore } from '@/stores/setup-wizard-store'
import './setup-checklist-card.css'

const DISMISS_KEY = 'hermes-onboarding-card-dismissed'

function readDismissed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(DISMISS_KEY) === 'true'
  } catch {
    return false
  }
}

function writeDismissed(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(DISMISS_KEY, 'true')
  } catch {
    /* Storage may be unavailable (private browsing, quota); the card just
       reappears next load, which is a safe fallback, not a bug. */
  }
}

/**
 * Pure visibility predicate, extracted so the "should this render" rule is
 * unit-testable without mounting the card or mocking localStorage/TanStack
 * Query.
 */
export function shouldShowSetupChecklistCard(input: {
  ready: boolean
  outstanding: number
  dismissed: boolean
}): boolean {
  return input.ready && input.outstanding > 0 && !input.dismissed
}

/**
 * The headline text, extracted so it is unit-testable without mounting the
 * card. Answers "what must I still do" — the required steps specifically —
 * rather than the all-items `outstanding` count the card used before: that
 * count (via `outstandingCount`) deliberately excludes `blocked` items (e.g.
 * `chat` before a provider exists) so the sidebar/palette badges can reach
 * zero, but the same exclusion means it can undercount required work still
 * ahead. A provider not yet connected reads as "1 step left" from
 * `outstanding` (just `provider`) even though the now-blocked `chat` is also
 * required and unfinished; `outstandingRequiredCount` counts `blocked`
 * required items too, so `2 of 4 required steps left` is what actually shows.
 */
export function describeRequiredSteps(items: Array<ChecklistItem>): string {
  const total = items.filter((item) => item.required).length
  const left = outstandingRequiredCount(items)
  return `${left} of ${total} required step${total === 1 ? '' : 's'} left.`
}

export function SetupChecklistCard() {
  const { items, outstanding, ready } = useOnboardingChecklist()
  const openSetupWizard = useSetupWizardStore((s) => s.openSetupWizard)
  const requiredStepsLabel = describeRequiredSteps(items)
  // Client-only read: SSR never has a dismissal to honour, and this render
  // is already gated by `ready` (also client-only), so there is nothing to
  // flash between the SSR pass and this effect settling.
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    setDismissed(readDismissed())
  }, [])

  if (!shouldShowSetupChecklistCard({ ready, outstanding, dismissed })) {
    return null
  }

  return (
    <div
      className="setup-checklist-card relative flex flex-col gap-2 overflow-hidden rounded-xl border p-3"
      style={{
        background:
          'linear-gradient(150deg, color-mix(in srgb, var(--theme-card) 96%, transparent), color-mix(in srgb, var(--theme-card) 90%, transparent))',
        borderColor: 'var(--theme-border)',
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full opacity-15 blur-3xl"
        style={{ background: 'var(--theme-warning)' }}
      />
      <div className="flex items-center justify-between gap-2">
        <h3
          className="text-[10px] font-semibold uppercase tracking-[0.18em]"
          style={{ color: 'var(--theme-text)' }}
        >
          Finish setting up
        </h3>
        <button
          type="button"
          aria-label="Dismiss setup checklist"
          title="Dismiss"
          onClick={() => {
            writeDismissed()
            setDismissed(true)
          }}
          className="inline-flex size-6 items-center justify-center rounded-md transition-colors hover:bg-[var(--theme-card2)]"
          style={{ color: 'var(--theme-muted)' }}
        >
          <HugeiconsIcon icon={Cancel01Icon} size={13} strokeWidth={1.6} />
        </button>
      </div>
      <p className="text-[11px]" style={{ color: 'var(--theme-muted)' }}>
        {requiredStepsLabel}
      </p>
      <OnboardingChecklist
        items={items}
        onJump={(stepId) => openSetupWizard(stepId)}
      />
    </div>
  )
}
