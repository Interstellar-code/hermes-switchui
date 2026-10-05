import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { ChatMessage } from '../types'
import { textFromMessage } from '../utils'

/**
 * Pre-fork options for the message-anchored "Branch from here" action.
 *
 * Visual pattern mirrors the sidebar's InlineBranchDialog
 * (sidebar-card-context-menu-v2.tsx) — fixed overlay, centered card, inline
 * styles over theme CSS vars, cancel/confirm button pair — because that is
 * the app's precedent for exactly this confirmation shape. The fork itself
 * only fires on confirm; this dialog IS the confirmation step.
 */

const PREVIEW_MAX_CHARS = 80

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

type BranchMessageDialogProps = {
  message: ChatMessage
  /** Messages the fork will copy — position of the anchor in the history. */
  messageCount: number
  /** Source session's current model; preselects the picker when present. */
  defaultModel?: string
  /** Same /api/models id list the composer picker draws from. */
  modelOptions?: Array<string>
  onConfirm: (opts: {
    title?: string
    endSource: boolean
    model?: string
  }) => void
  onClose: () => void
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
  minWidth: 280,
  maxWidth: 380,
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

export function BranchMessageDialog({
  message,
  messageCount,
  defaultModel,
  modelOptions,
  onConfirm,
  onClose,
}: BranchMessageDialogProps) {
  const [title, setTitle] = useState('')
  const [closeOriginal, setCloseOriginal] = useState(false)
  const [pickedModel, setPickedModel] = useState<string | null>(null)

  const modelList = modelOptions ?? []
  const showModelSelector = modelList.length > 0
  const selectedModel =
    pickedModel ?? defaultModel ?? modelOptions?.[0] ?? undefined
  const preview = previewFromMessage(message)

  function submit() {
    const trimmed = title.trim()
    onConfirm({
      ...(trimmed ? { title: trimmed } : {}),
      endSource: closeOriginal,
      ...(showModelSelector && selectedModel
        ? { model: selectedModel }
        : {}),
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
        <p style={{ marginBottom: 8, fontSize: 13, color: 'var(--theme-text)' }}>
          Branch from this message
        </p>
        <p
          style={{
            marginBottom: preview ? 8 : 12,
            fontSize: 11,
            color: 'var(--theme-text-muted, #888)',
          }}
        >
          Will copy {messageCount} message{messageCount === 1 ? '' : 's'} to a
          new session.
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
        <input
          type="text"
          autoFocus
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
          <select
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
        ) : null}
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 12,
            fontSize: 12,
            color: 'var(--theme-text)',
            cursor: 'pointer',
            userSelect: 'none',
          }}
        >
          <input
            type="checkbox"
            checked={closeOriginal}
            onChange={(e) => setCloseOriginal(e.target.checked)}
          />
          Close original session after branching
        </label>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={cancelBtnStyle}>
            Cancel
          </button>
          <button type="button" onClick={submit} style={confirmBtnStyle}>
            Branch
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
