import { useRef, useState } from 'react'
import { useChatStore } from '../../../stores/chat-store'
import type { PendingClarify } from '../../../stores/chat-store'
import type { ChatMessage } from '../types'
import { cn } from '@/lib/utils'
import { normalizeClarifyChoices } from '@/lib/clarify-choices'

type InlineClarifyCardProps = {
  clarify: PendingClarify
  sessionKey: string
}

type InteractionReceipt = {
  type?: string
  kind?: string
  tool_name?: string
  toolName?: string
  interaction_id?: string
  interactionId?: string
  clarify_id?: string
  clarifyId?: string
  session_id?: string
  sessionId?: string
  run_id?: string
  runId?: string
  message_id?: string
  messageId?: string
  question?: string
  choices?: Array<string> | null
  answer?: string
  selected_answer?: string
  selectedAnswer?: string
  resolved?: boolean
  approved?: boolean
}

export function parseInteractionReceipt(message: ChatMessage): InteractionReceipt | null {
  if (message.role !== 'tool') return null
  const toolName =
    (typeof message.toolName === 'string' && message.toolName.trim()) ||
    ''
  if (toolName && !['clarify', 'approval'].includes(toolName.toLowerCase())) {
    return null
  }
  const candidates = Array.isArray(message.content) ? message.content : []
  const text = candidates
    .filter(
      (part): part is { type: 'text'; text?: string } =>
        part.type === 'text' && typeof part.text === 'string',
    )
    .map((part) => String(part.text ?? ''))
    .join('\n')
    .trim()
  if (!text) return null
  try {
    const parsed = JSON.parse(text) as InteractionReceipt
    if (parsed.type !== 'interaction_receipt') return null
    return parsed
  } catch {
    return null
  }
}

export function interactionReceiptToPendingClarify(
  receipt: InteractionReceipt,
): PendingClarify | null {
  const question = receipt.question?.trim()
  const answer = receipt.selected_answer || receipt.selectedAnswer || receipt.answer
  const clarifyId = receipt.clarify_id || receipt.clarifyId || receipt.interaction_id || receipt.interactionId || ''
  if (!question || !clarifyId) return null
  return {
    clarifyId,
    interactionId: receipt.interaction_id || receipt.interactionId || clarifyId,
    kind: receipt.kind || (receipt.approved !== undefined ? 'approval' : 'choice'),
    toolName: receipt.tool_name || receipt.toolName || 'clarify',
    question,
    choices: normalizeClarifyChoices(receipt.choices),
    runId: receipt.run_id || receipt.runId || null,
    requestedAt: Date.now(),
    resolved: true,
    answer: typeof answer === 'string' ? answer : undefined,
  }
}

function formatClarifyError(value: unknown): string {
  if (value instanceof Error) return value.message
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const message = record.message ?? record.error ?? record.detail
    if (typeof message === 'string') return message
    try {
      return JSON.stringify(value)
    } catch {
      return 'Clarify request failed'
    }
  }
  return 'Clarify request failed'
}

/**
 * Interactive clarify card (P3). Renders inside the Hermes clarify tool row,
 * keeps the tool-call transcript intact, and leaves a compact answered receipt
 * after the user chooses an option or submits free text.
 */
export function InlineClarifyCard({
  clarify,
  sessionKey,
}: InlineClarifyCardProps) {
  const markClarifyResolved = useChatStore((s) => s.markClarifyResolved)
  const [selectedChoice, setSelectedChoice] = useState('')
  const [freeText, setFreeText] = useState('')
  const [showOther, setShowOther] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const [error, setError] = useState<string | null>(null)

  const resolved = !!clarify.resolved
  const picked = clarify.answer?.trim() ?? ''

  const submit = async (answer: string) => {
    const trimmed = answer.trim()
    if (submittingRef.current || resolved || !trimmed) return

    // Optimistically record the chosen answer so the UI does not fall back to a
    // raw object/error state if the gateway resume request times out server-side.
    markClarifyResolved(sessionKey, clarify.clarifyId, trimmed)
    submittingRef.current = true
    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch(
        clarify.interactionId
          ? `/api/sessions/${encodeURIComponent(sessionKey)}/chat/interactions/${encodeURIComponent(clarify.interactionId)}/respond`
          : `/api/sessions/${encodeURIComponent(sessionKey)}/clarify`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            clarify.interactionId
              ? { answer: trimmed }
              : { clarify_id: clarify.clarifyId, answer: trimmed },
          ),
        },
      )
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as unknown
        throw new Error(formatClarifyError(json) || `HTTP ${res.status}`)
      }
    } catch (err) {
      // Keep the selected receipt visible; show a readable diagnostic only.
      setError(formatClarifyError(err))
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  if (resolved) {
    return (
      <div className="rounded-md border border-[color-mix(in_srgb,var(--theme-accent)_42%,transparent)] bg-[color-mix(in_srgb,var(--theme-accent)_7%,transparent)] px-3 py-2.5">
        <div className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--theme-accent)]">
          <span aria-hidden>✓</span>
          <span>{clarify.kind === 'approval' ? 'Approval recorded' : 'Answered'}</span>
        </div>
        <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-[color-mix(in_srgb,var(--theme-text)_76%,transparent)]">
          {clarify.question}
        </p>
        {picked ? (
          <div className="mt-2 rounded-md border border-[var(--theme-accent)] bg-[color-mix(in_srgb,var(--theme-accent)_18%,transparent)] px-3 py-2 text-[12px] font-semibold leading-snug text-[var(--theme-text)] shadow-[inset_3px_0_0_var(--theme-accent)]">
            <span className="mr-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--theme-accent)]">
              Selected
            </span>
            <span>{picked}</span>
          </div>
        ) : null}
        {error ? (
          <p className="mt-2 text-[11px] font-medium text-[var(--theme-danger,#ef4444)]">
            {error}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <div
      className={cn(
        'rounded-md border border-[color-mix(in_srgb,var(--theme-accent)_42%,transparent)] bg-[color-mix(in_srgb,var(--theme-accent)_7%,transparent)] px-3 py-2.5 shadow-[0_0_18px_2px_color-mix(in_srgb,var(--theme-accent)_8%,transparent)] transition-all',
        submitting && 'opacity-70',
      )}
    >
      <div className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--theme-accent)]">
        <span aria-hidden>?</span>
        <span>{clarify.kind === 'approval' ? 'Approval required' : 'Clarification needed'}</span>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--theme-text)]">
        {clarify.question}
      </p>

      {clarify.choices && clarify.choices.length > 0 ? (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {clarify.choices.map((choice, index) => (
            <button
              key={choice}
              type="button"
              disabled={submitting}
              aria-pressed={selectedChoice === choice}
              onClick={() => {
                setSelectedChoice(choice)
                setShowOther(false)
                setFreeText('')
              }}
              className={cn(
                'flex min-h-10 w-full items-start gap-2 rounded-md border px-3 py-2 text-left text-[12px] font-semibold leading-snug text-[var(--theme-text)] transition-colors hover:border-[var(--theme-accent)] disabled:opacity-50',
                selectedChoice === choice
                  ? 'border-[var(--theme-accent)] bg-[color-mix(in_srgb,var(--theme-accent)_20%,transparent)] shadow-[inset_3px_0_0_var(--theme-accent)]'
                  : 'border-[color-mix(in_srgb,var(--theme-accent)_55%,transparent)] bg-[color-mix(in_srgb,var(--theme-accent)_8%,transparent)] hover:bg-[color-mix(in_srgb,var(--theme-accent)_16%,transparent)]',
              )}
            >
              <span className="flex size-5 shrink-0 items-center justify-center rounded border border-[color-mix(in_srgb,var(--theme-accent)_60%,transparent)] font-mono text-[10px] text-[var(--theme-accent)]">
                {index + 1}
              </span>
              <span className="min-w-0 whitespace-normal break-words">
                {choice}
              </span>
            </button>
          ))}
          <button
            type="button"
            disabled={submitting}
            aria-expanded={showOther}
            aria-pressed={showOther}
            onClick={() => {
              setSelectedChoice('')
              setShowOther(true)
            }}
            className="flex min-h-10 w-full items-start gap-2 rounded-md border border-[color-mix(in_srgb,var(--theme-accent)_55%,transparent)] bg-[color-mix(in_srgb,var(--theme-accent)_8%,transparent)] px-3 py-2 text-left text-[12px] font-semibold leading-snug text-[var(--theme-text)] transition-colors hover:border-[var(--theme-accent)] hover:bg-[color-mix(in_srgb,var(--theme-accent)_16%,transparent)] disabled:opacity-50"
          >
            <span className="flex size-5 shrink-0 items-center justify-center rounded border border-[color-mix(in_srgb,var(--theme-accent)_60%,transparent)] font-mono text-[10px] text-[var(--theme-accent)]">
              {clarify.choices.length + 1}
            </span>
            <span>Other</span>
          </button>
        </div>
      ) : null}

      <form
        className="mt-3 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void submit(showOther || !clarify.choices?.length ? freeText : selectedChoice)
        }}
      >
        {(!clarify.choices?.length || showOther) ? <input
          type="text"
          placeholder={clarify.choices?.length ? 'Type another answer…' : 'Type your answer…'}
          aria-label="Clarification answer"
          autoFocus={showOther}
          value={freeText}
          disabled={submitting}
          onChange={(e) => setFreeText(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-[color-mix(in_srgb,var(--theme-accent)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-bg)_72%,transparent)] px-2.5 py-1.5 text-[12px] text-[var(--theme-text)] placeholder:text-[color-mix(in_srgb,var(--theme-muted)_70%,transparent)] focus:border-[var(--theme-accent)] focus:outline-none focus:ring-1 focus:ring-[color-mix(in_srgb,var(--theme-accent)_55%,transparent)] disabled:opacity-50"
        /> : <span className="min-w-0 flex-1 text-[11px] text-[var(--theme-muted)]">Select an option to continue</span>}
        <button
          type="submit"
          disabled={submitting || !(showOther || !clarify.choices?.length ? freeText.trim() : selectedChoice)}
          className="rounded-md bg-[var(--theme-accent)] px-3 py-1.5 text-[11px] font-semibold text-[var(--theme-bg)] transition-opacity hover:opacity-85 disabled:opacity-50"
        >
          {submitting ? 'Sending…' : 'Continue'}
        </button>
      </form>

      {error ? (
        <p className="mt-1.5 text-[11px] font-medium text-[var(--theme-danger,#ef4444)]">
          {error}
        </p>
      ) : null}
    </div>
  )
}
