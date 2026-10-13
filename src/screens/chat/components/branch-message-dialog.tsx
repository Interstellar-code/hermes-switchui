import { useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { textFromMessage } from '../utils'
import type { ChatMessage } from '../types'

/**
 * Branch-from-message options.
 *
 * Two modes (plan `branch-selection`):
 * - `selection` (default): only the selected passage goes to a NEW session,
 *   as an editable "Context" blockquote plus a required prompt; the new
 *   session's first user message is quote + prompt.
 * - `full`: today's gateway fork — the whole transcript up to the anchor is
 *   copied via POST /api/sessions/:key/fork, with the close-original option.
 *
 * Visual pattern mirrors the sidebar's InlineBranchDialog
 * (sidebar-card-context-menu-v2.tsx) — fixed overlay, centered card, inline
 * styles over theme CSS vars, cancel/confirm button pair — because that is
 * the app's precedent for exactly this confirmation shape. The branch itself
 * only fires on confirm; this dialog IS the confirmation step.
 */

const PREVIEW_MAX_CHARS = 80

/** Confirm payload for both modes (contract C2). */
export type BranchMessageDialogConfirm = {
  mode: 'selection' | 'full'
  quote?: string
  prompt?: string
  title?: string
  model?: string
  endSource: boolean
}

/** Values restored into the form when a confirm failed and the dialog reopens. */
export type BranchMessageDialogInitial = {
  quote?: string
  prompt?: string
  title?: string
  model?: string
}

type BranchMessageDialogProps = {
  message: ChatMessage
  /** Messages the full fork will copy — position of the anchor in the history. */
  messageCount: number
  /** Passage captured by the right-click inside the bubble, if any. */
  selectedText?: string
  /** Source session's current model; preselects the picker when present. */
  defaultModel?: string
  /** Same /api/models id list the composer picker draws from. */
  modelOptions?: Array<string>
  /** Last confirm's values, when the dialog reopens after a failure. */
  initial?: BranchMessageDialogInitial
  onConfirm: (opts: BranchMessageDialogConfirm) => void
  onClose: () => void
}

/** Same markdown-strip chain the reply preview in chat-screen uses. */
function previewFromMessage(message: ChatMessage): string {
  const text = textFromMessage(message)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*\|.*$/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > PREVIEW_MAX_CHARS
    ? `${text.slice(0, PREVIEW_MAX_CHARS).trimEnd()}…`
    : text
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1300,
  background: 'rgba(0,0,0,0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

const dialogStyle: React.CSSProperties = {
  background: 'var(--theme-card, #0d1117)',
  border: '1px solid var(--theme-border)',
  borderRadius: 8,
  padding: 16,
  minWidth: 320,
  maxWidth: 560,
  width: 'min(560px, calc(100vw - 32px))',
  maxHeight: 'calc(100vh - 48px)',
  overflowY: 'auto',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: 4,
  fontSize: 11,
  color: 'var(--theme-text-muted, #888)',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '4px 8px',
  marginBottom: 8,
  background: 'var(--theme-sidebar)',
  border: '1px solid var(--theme-border)',
  borderRadius: 4,
  color: 'var(--theme-text)',
  fontSize: 12,
  boxSizing: 'border-box',
}

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: 'vertical',
  fontFamily: 'inherit',
  lineHeight: 1.5,
}

const cancelBtnStyle: React.CSSProperties = {
  padding: '4px 12px',
  fontSize: 12,
  borderRadius: 4,
  background: 'transparent',
  border: '1px solid var(--theme-border)',
  color: 'var(--theme-text)',
  cursor: 'pointer',
}

const confirmBtnStyle: React.CSSProperties = {
  padding: '4px 12px',
  fontSize: 12,
  borderRadius: 4,
  background: 'var(--theme-accent, #4CAF50)',
  border: 'none',
  color: '#fff',
  cursor: 'pointer',
}

const checkboxRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 12,
  fontSize: 12,
  color: 'var(--theme-text)',
  cursor: 'pointer',
  userSelect: 'none',
}

export function BranchMessageDialog({
  message,
  messageCount,
  selectedText,
  defaultModel,
  modelOptions,
  initial,
  onConfirm,
  onClose,
}: BranchMessageDialogProps) {
  const uid = useId()
  const [carryFullHistory, setCarryFullHistory] = useState(false)
  // Contract C4: quote = the captured selection when present, else the whole
  // message text. Restored `initial` values (a failed confirm) win over both.
  const [quote, setQuote] = useState(
    () =>
      initial?.quote ??
      (selectedText && selectedText.trim().length > 0
        ? selectedText
        : textFromMessage(message)),
  )
  const [prompt, setPrompt] = useState(() => initial?.prompt ?? '')
  const [title, setTitle] = useState(() => initial?.title ?? '')
  const [closeOriginal, setCloseOriginal] = useState(false)
  const [pickedModel, setPickedModel] = useState<string | null>(
    () => initial?.model ?? null,
  )

  // /api/models can list an id twice (e.g. `auto`); options are keyed by id.
  const modelList = Array.from(new Set(modelOptions ?? []))
  const showModelSelector = modelList.length > 0
  const selectedModel =
    pickedModel ?? defaultModel ?? modelOptions?.[0] ?? undefined
  const trimmedPrompt = prompt.trim()
  // Selection mode needs a prompt; full mode is today's form (always allowed).
  const canSubmit = carryFullHistory || trimmedPrompt.length > 0
  const preview = previewFromMessage(message)

  function submit() {
    if (!canSubmit) return
    const trimmedTitle = title.trim()
    const model =
      showModelSelector && selectedModel ? { model: selectedModel } : {}
    if (carryFullHistory) {
      onConfirm({
        mode: 'full',
        ...(trimmedTitle ? { title: trimmedTitle } : {}),
        ...model,
        endSource: closeOriginal,
      })
      return
    }
    const trimmedQuote = quote.trim()
    onConfirm({
      mode: 'selection',
      ...(trimmedQuote ? { quote: trimmedQuote } : {}),
      prompt: trimmedPrompt,
      ...(trimmedTitle ? { title: trimmedTitle } : {}),
      ...model,
      endSource: false,
    })
  }

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      style={overlayStyle}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <div
        role="dialog"
        aria-label="Branch from this message"
        style={dialogStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <p
          style={{
            marginBottom: 8,
            fontSize: 13,
            color: 'var(--theme-text)',
          }}
        >
          Branch from this message
        </p>
        <label style={checkboxRowStyle}>
          <input
            type="checkbox"
            checked={carryFullHistory}
            onChange={(e) => setCarryFullHistory(e.target.checked)}
          />
          Carry full thread history (fork)
        </label>
        {carryFullHistory ? (
          <>
            <p
              style={{
                marginBottom: preview ? 8 : 12,
                fontSize: 11,
                color: 'var(--theme-text-muted, #888)',
              }}
            >
              Will copy {messageCount} message
              {messageCount === 1 ? '' : 's'} to a new session.
            </p>
            {preview ? (
              <p
                style={{
                  margin: 0,
                  marginBottom: 12,
                  fontSize: 11,
                  color: 'var(--theme-text-muted, #888)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={preview}
              >
                “{preview}”
              </p>
            ) : null}
          </>
        ) : (
          <>
            <label htmlFor={`${uid}-context`} style={labelStyle}>
              Context
            </label>
            <textarea
              id={`${uid}-context`}
              rows={6}
              value={quote}
              onChange={(e) => setQuote(e.target.value)}
              style={textareaStyle}
            />
            <label htmlFor={`${uid}-prompt`} style={labelStyle}>
              Prompt
            </label>
            <textarea
              id={`${uid}-prompt`}
              rows={4}
              autoFocus
              value={prompt}
              placeholder="What should the agent do with this passage?"
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault()
                  submit()
                }
              }}
              style={textareaStyle}
            />
          </>
        )}
        <label htmlFor={`${uid}-title`} style={labelStyle}>
          Title (optional)
        </label>
        <input
          type="text"
          id={`${uid}-title`}
          value={title}
          maxLength={120}
          placeholder="New session title (optional)"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          style={inputStyle}
        />
        {showModelSelector ? (
          <>
            <label htmlFor={`${uid}-model`} style={labelStyle}>
              Model
            </label>
            <select
              id={`${uid}-model`}
              value={selectedModel ?? ''}
              onChange={(e) => setPickedModel(e.target.value)}
              style={{ ...inputStyle, marginBottom: 12 }}
              aria-label="Model for the new session"
            >
              {modelList.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </>
        ) : null}
        {carryFullHistory ? (
          <label style={checkboxRowStyle}>
            <input
              type="checkbox"
              checked={closeOriginal}
              onChange={(e) => setCloseOriginal(e.target.checked)}
            />
            Close original session after branching
          </label>
        ) : null}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={cancelBtnStyle}>
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            style={{
              ...confirmBtnStyle,
              ...(canSubmit ? {} : { opacity: 0.5, cursor: 'not-allowed' }),
            }}
          >
            Branch
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
