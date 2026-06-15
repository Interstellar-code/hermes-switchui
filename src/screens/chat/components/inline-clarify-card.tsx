import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { PendingClarify } from '../../../stores/chat-store'
import { useChatStore } from '../../../stores/chat-store'

type InlineClarifyCardProps = {
  clarify: PendingClarify
  sessionKey: string
}

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
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionKey)}/clarify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clarify_id: clarify.clarifyId, answer: answer.trim() }),
      })
      if (!res.ok) {
        const json = (await res.json()) as { error?: string }
        throw new Error(json.error ?? `HTTP ${res.status}`)
      }
      setSubmitted(true)
      clearPendingClarify(sessionKey)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="inline-clarify-card inline-clarify-card--resolved">
        <p className="inline-clarify-card__resolved-label">Answer submitted — resuming…</p>
      </div>
    )
  }

  return (
    <div className={cn('inline-clarify-card', submitting && 'inline-clarify-card--submitting')}>
      <div className="inline-clarify-card__header">
        <span className="inline-clarify-card__icon">❓</span>
        <span className="inline-clarify-card__label">Clarification needed</span>
      </div>
      <p className="inline-clarify-card__question">{clarify.question}</p>

      {clarify.choices && clarify.choices.length > 0 && (
        <div className="inline-clarify-card__choices">
          {clarify.choices.map((choice) => (
            <button
              key={choice}
              type="button"
              className="inline-clarify-card__choice-btn"
              disabled={submitting}
              onClick={() => submit(choice)}
            >
              {choice}
            </button>
          ))}
        </div>
      )}

      <form
        className="inline-clarify-card__freetext-form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit(freeText)
        }}
      >
        <input
          type="text"
          className="inline-clarify-card__input"
          placeholder="Type your answer…"
          value={freeText}
          disabled={submitting}
          onChange={(e) => setFreeText(e.target.value)}
        />
        <button
          type="submit"
          className="inline-clarify-card__submit-btn"
          disabled={submitting || !freeText.trim()}
        >
          {submitting ? 'Sending…' : 'Send'}
        </button>
      </form>

      {error && <p className="inline-clarify-card__error">{error}</p>}
    </div>
  )
}
