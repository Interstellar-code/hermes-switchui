import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { PendingClarify } from '../../../stores/chat-store'
import { useChatStore } from '../../../stores/chat-store'

type InlineClarifyCardProps = {
  clarify: PendingClarify
  sessionKey: string
}

/**
 * Interactive clarify card (P3). Renders the agent's mid-turn question with a
 * button per choice (when present) plus an always-available free-text input.
 * Submitting POSTs the answer to the resume route, which unblocks the agent's
 * turn on the gateway. Styling mirrors InlineApprovalCard (indigo accent).
 */
export function InlineClarifyCard({ clarify, sessionKey }: InlineClarifyCardProps) {
  const clearPendingClarify = useChatStore((s) => s.clearPendingClarify)
  const [freeText, setFreeText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (answer: string) => {
    if (submitting || submitted || !answer.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(sessionKey)}/clarify`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clarify_id: clarify.clarifyId,
            answer: answer.trim(),
          }),
        },
      )
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(json.error ?? `HTTP ${res.status}`)
      }
      setSubmitted(true)
      // Optimistically clear; the incoming clarify.responded SSE also clears.
      clearPendingClarify(sessionKey)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="my-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-800 dark:bg-emerald-950/30">
        <p className="text-[11px] font-medium text-neutral-500">
          ✓ Answer submitted — resuming…
        </p>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'my-2 rounded-lg border border-indigo-300 bg-indigo-50/80 p-3 transition-all dark:border-indigo-700 dark:bg-indigo-950/40',
        submitting && 'opacity-70',
      )}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-base">❓</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-indigo-800 dark:text-indigo-200">
              Clarification needed
            </span>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-xs text-neutral-700 dark:text-neutral-300">
            {clarify.question}
          </p>

          {clarify.choices && clarify.choices.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {clarify.choices.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  disabled={submitting}
                  onClick={() => void submit(choice)}
                  className="rounded-md border border-indigo-300 bg-white px-3 py-1 text-[11px] font-semibold text-indigo-700 transition-colors hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-700 dark:bg-neutral-800 dark:text-indigo-300 dark:hover:bg-indigo-950"
                >
                  {choice}
                </button>
              ))}
            </div>
          )}

          <form
            className="mt-2 flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void submit(freeText)
            }}
          >
            <input
              type="text"
              placeholder="Type your answer…"
              value={freeText}
              disabled={submitting}
              onChange={(e) => setFreeText(e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-800 placeholder:text-neutral-400 focus:border-indigo-400 focus:outline-none disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
            />
            <button
              type="submit"
              disabled={submitting || !freeText.trim()}
              className="rounded-md bg-indigo-600 px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
            >
              {submitting ? 'Sending…' : 'Send'}
            </button>
          </form>

          {error && (
            <p className="mt-1.5 text-[11px] font-medium text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
