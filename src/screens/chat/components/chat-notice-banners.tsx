import type React from 'react'

import { Button } from '@/components/ui/button'

interface ChatNoticeBannersProps {
  errorNotice: React.ReactNode
  isCurrentSessionInterrupted: boolean
  onResendInterrupted: () => void
}

export function ChatNoticeBanners({
  errorNotice,
  isCurrentSessionInterrupted,
  onResendInterrupted,
}: ChatNoticeBannersProps): React.JSX.Element | null {
  if (!errorNotice && !isCurrentSessionInterrupted) {
    return null
  }

  return (
    <>
      {errorNotice && (
        <div className="sticky top-0 z-20 px-4 py-2">{errorNotice}</div>
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
