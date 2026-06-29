import type React from 'react'

import { Button } from '@/components/ui/button'
import type { ApprovalRequest } from '@/screens/gateway/lib/approvals-store'

interface ChatNoticeBannersProps {
  errorNotice: React.ReactNode
  isCurrentSessionInterrupted: boolean
  onResendInterrupted: () => void
  pendingApprovals: Array<ApprovalRequest>
  onResolveApproval: (
    approval: ApprovalRequest,
    status: 'approved' | 'denied',
  ) => void
}

export function ChatNoticeBanners({
  errorNotice,
  isCurrentSessionInterrupted,
  onResendInterrupted,
  pendingApprovals,
  onResolveApproval,
}: ChatNoticeBannersProps): React.JSX.Element | null {
  if (
    !errorNotice &&
    !isCurrentSessionInterrupted &&
    pendingApprovals.length === 0
  ) {
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
      {pendingApprovals.length > 0 && (
        <div className="mx-4 mb-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800/50 dark:bg-amber-900/15">
          <div className="space-y-2">
            {pendingApprovals.map((approval) => (
              <div
                key={approval.id}
                className="flex items-center justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                    {'\uD83D\uDD10'} Approval Required -{' '}
                    {approval.agentName || 'Agent'}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-amber-600 dark:text-amber-500">
                    {approval.action}
                  </p>
                  {approval.context ? (
                    <p className="mt-0.5 truncate text-[10px] font-mono text-amber-500 dark:text-amber-600">
                      {approval.context.slice(0, 100)}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void onResolveApproval(approval, 'approved')
                    }}
                    className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void onResolveApproval(approval, 'denied')
                    }}
                    className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 dark:border-red-800/50 dark:bg-red-900/10 dark:text-red-400"
                  >
                    Deny
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
