'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { PendingApprovalEntry } from '@/hooks/use-approval-queue'
import {
  approvalSessionKey,
  usePendingApprovalQueue,
} from '@/hooks/use-approval-queue'
import { cn } from '@/lib/utils'

/**
 * Pending-approvals bell.
 *
 * **A pointer, never a decision point.** It counts approvals and takes you to
 * the card; it cannot approve or deny. Two reasons, both load-bearing:
 *
 *  - The gateway resolves by run id and pops the run's queue FIFO, so a second
 *    resolve surface racing the card can silently answer a different request
 *    than the one you were looking at.
 *  - An approve button in a dropdown is an approve button without the command,
 *    the description or the pattern keys in front of you. Approving something
 *    unread is the failure mode this whole feature exists to prevent.
 *
 * So the popover lists what is waiting and where, and every row is a link.
 */
export function ApprovalsBell({ className }: { className?: string } = {}) {
  const { approvals, count } = usePendingApprovalQueue()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [pulse, setPulse] = useState(false)
  const prevCountRef = useRef(0)
  const ref = useRef<HTMLDivElement>(null)

  const latestThree = useMemo(() => approvals.slice(0, 3), [approvals])

  useEffect(() => {
    if (count > prevCountRef.current) {
      setPulse(true)
      const timer = window.setTimeout(() => setPulse(false), 1200)
      prevCountRef.current = count
      return () => window.clearTimeout(timer)
    }
    prevCountRef.current = count
  }, [count])

  useEffect(() => {
    if (count === 0) setOpen(false)
  }, [count])

  useEffect(() => {
    if (!open) return
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function goToApproval(entry: PendingApprovalEntry) {
    setOpen(false)
    void navigate({
      to: '/chat/$sessionKey',
      params: { sessionKey: approvalSessionKey(entry) },
    })
  }

  // Nothing waiting: stay out of the way entirely rather than parking a dead
  // bell in a header that is already dense.
  if (count === 0) return null

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'relative flex min-h-7 items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-medium transition-all',
          'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-800/60 dark:bg-amber-900/20 dark:text-amber-400 dark:hover:bg-amber-900/30',
          pulse && 'ring-2 ring-amber-400/50',
        )}
        aria-label={`Approvals — ${count} pending`}
      >
        {pulse ? (
          <span className="pointer-events-none absolute inset-0 animate-ping rounded-lg border-2 border-amber-400 opacity-30" />
        ) : null}
        <span aria-hidden className="text-sm leading-none">
          🔔
        </span>
        <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold leading-none text-white">
          {count > 99 ? '99+' : count}
        </span>
      </button>

      {open ? (
        <div
          className={cn(
            'absolute right-0 top-full z-50 mt-2 flex w-[360px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white',
            'shadow-[0_8px_30px_rgba(0,0,0,0.15)] dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-[0_8px_30px_rgba(0,0,0,0.5)]',
          )}
          role="dialog"
          aria-label="Pending approvals"
        >
          <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-700">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-[var(--theme-text)]">
                Approvals
              </span>
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                {count} pending
              </span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md p-0.5 text-neutral-400 transition-colors hover:text-neutral-600 dark:hover:text-neutral-200"
              aria-label="Close"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path
                  d="M1 1l12 12M13 1L1 13"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>

          <div className="max-h-[420px] flex-1 space-y-2 overflow-y-auto p-3">
            {latestThree.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <span className="mb-2 text-2xl">🛡️</span>
                <p className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
                  All clear
                </p>
                <p className="mt-0.5 text-xs text-neutral-400 dark:text-neutral-500">
                  No pending approvals — approval-gated actions will pause here
                  when review is required.
                </p>
              </div>
            ) : (
              latestThree.map((entry) => (
                <button
                  key={`${entry.approval.runId}:${entry.clarifyId}`}
                  type="button"
                  onClick={() => goToApproval(entry)}
                  className="w-full rounded-lg border border-amber-200/70 bg-amber-50/50 p-3 text-left transition-colors hover:bg-amber-100/60 dark:border-amber-500/20 dark:bg-amber-900/10 dark:hover:bg-amber-900/20"
                >
                  <p className="truncate text-xs font-semibold text-neutral-800 dark:text-neutral-100">
                    {entry.question}
                  </p>
                  {entry.approval.command ? (
                    <p className="mt-1 truncate font-mono text-[11px] text-neutral-700 dark:text-neutral-300">
                      {entry.approval.command}
                    </p>
                  ) : null}
                  <p className="mt-1 text-[10px] text-neutral-400 dark:text-neutral-500">
                    Open the chat to read the full command and decide.
                  </p>
                </button>
              ))
            )}
          </div>

          {count > latestThree.length ? (
            <div className="border-t border-neutral-200 px-4 py-2 text-[10px] text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
              +{count - latestThree.length} more pending
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
