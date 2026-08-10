import type React from 'react'

import type { RunStopNotice } from '../hooks/use-run-stop'
import { Button } from '@/components/ui/button'

interface ChatNoticeBannersProps {
  errorNotice: React.ReactNode
  isCurrentSessionInterrupted: boolean
  onResendInterrupted: () => void
  /**
   * Progress of an explicit Stop. Distinct from `isCurrentSessionInterrupted`:
   * that one means "we lost the run, resend?", this one means "you asked it to
   * stop, here is how far that got". Both can be on screen at once — a stop
   * that failed leaves the recovery affordance armed on purpose.
   */
  stopNotice?: RunStopNotice | null
  onDismissStopNotice?: () => void
}

/**
 * Reuses the interrupted banner's amber treatment for anything the user may
 * need to act on, and the neutral border/muted treatment for pure progress, so
 * "Stopping…" does not read as an error while it is merely slow.
 */
const STOP_TONE_CLASSES: Record<RunStopNotice['tone'], string> = {
  info: 'border-border bg-muted/60 text-muted-foreground',
  warning:
    'border-amber-300/60 bg-amber-50/90 text-amber-900 dark:border-amber-700/50 dark:bg-amber-900/15 dark:text-amber-200',
}

export function ChatNoticeBanners({
  errorNotice,
  isCurrentSessionInterrupted,
  onResendInterrupted,
  stopNotice,
  onDismissStopNotice,
}: ChatNoticeBannersProps): React.JSX.Element | null {
  if (!errorNotice && !isCurrentSessionInterrupted && !stopNotice) {
    return null
  }

  return (
    <>
      {errorNotice && (
        <div className="sticky top-0 z-20 px-4 py-2">{errorNotice}</div>
      )}
      {stopNotice && (
        <div
          role="status"
          aria-live="polite"
          data-stop-phase={stopNotice.phase}
          className={`mx-4 mb-2 flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-sm ${STOP_TONE_CLASSES[stopNotice.tone]}`}
        >
          <span className="min-w-0 flex-1">{stopNotice.message}</span>
          {onDismissStopNotice && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onDismissStopNotice}
              aria-label="Dismiss stop status"
            >
              Dismiss
            </Button>
          )}
        </div>
      )}
      {isCurrentSessionInterrupted && (
        <div
          role="status"
          className="mx-4 mb-2 flex items-center justify-between gap-3 rounded-xl border border-amber-300/60 bg-amber-50/90 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-700/50 dark:bg-amber-900/15 dark:text-amber-200"
        >
          <span className="min-w-0 flex-1">
            Run may have continued server-side — resend?
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={onResendInterrupted}
            aria-label="Resend last user message"
          >
            Resend
          </Button>
        </div>
      )}
    </>
  )
}
