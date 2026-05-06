import { useState } from 'react'
import { cn } from '@/lib/utils'
import { useSessionsLocalStore } from '@/stores/sessions-local-store'
import { useSessionStatus } from '@/hooks/use-session-status'

type ChatHeaderActionsV2Props = {
  sessionId: string
  sessionKey: string
  title: string
}

export function ChatHeaderActionsV2({ sessionId, sessionKey, title }: ChatHeaderActionsV2Props) {
  const isPinned = useSessionsLocalStore((s) => s.isPinned(sessionId))
  const isArchived = useSessionsLocalStore((s) => s.isArchived(sessionId))
  const togglePinned = useSessionsLocalStore((s) => s.togglePinned)
  const toggleArchived = useSessionsLocalStore((s) => s.toggleArchived)

  // Pull live session metadata for the copy payload
  const status = useSessionStatus(sessionKey)
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    const lines = [
      `Title: ${title}`,
      `Session: ${sessionKey}`,
      `URL: ${typeof window !== 'undefined' ? window.location.href : ''}`,
      status?.model ? `Model: ${status.model}` : null,
      status?.modelProvider ? `Provider: ${status.modelProvider}` : null,
      typeof status?.contextPercent === 'number'
        ? `Context: ${status.contextPercent}% (${status.usedTokens ?? 0} / ${status.maxTokens ?? 0})`
        : null,
      typeof status?.totalTokens === 'number'
        ? `Tokens: ${status.totalTokens}`
        : null,
    ].filter(Boolean)
    const text = lines.join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* noop */
    }
  }

  const btnClass =
    'flex items-center justify-center w-7 h-7 rounded transition-colors hover:bg-[var(--m-surface-2,rgba(255,255,255,0.06))]'
  const activeColor = 'var(--m-green,#4ade80)'
  const mutedColor = 'var(--m-muted,var(--theme-muted,#6b7280))'

  return (
    <div className="flex items-center gap-0.5">
      {/* Copy session details */}
      <button
        type="button"
        aria-label={copied ? 'Copied!' : 'Copy session details'}
        title={copied ? 'Copied!' : 'Copy session details'}
        onClick={handleCopy}
        className={cn(btnClass)}
        style={{ color: copied ? activeColor : mutedColor }}
      >
        {copied ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </button>

      {/* Pin (icon: star) — performs pinning so item appears in Pinned group */}
      <button
        type="button"
        aria-label={isPinned ? 'Unpin session' : 'Pin session'}
        aria-pressed={isPinned}
        onClick={() => togglePinned(sessionId)}
        className={cn(btnClass)}
        style={{ color: isPinned ? activeColor : mutedColor }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill={isPinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      </button>

      {/* Archive */}
      <button
        type="button"
        aria-label={isArchived ? 'Unarchive session' : 'Archive session'}
        aria-pressed={isArchived}
        onClick={() => toggleArchived(sessionId)}
        className={cn(btnClass)}
        style={{ color: isArchived ? activeColor : mutedColor }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <polyline points="21 8 21 21 3 21 3 8" />
          <rect x="1" y="3" width="22" height="5" />
          <line x1="10" y1="12" x2="14" y2="12" />
        </svg>
      </button>

      {/* More (placeholder — no dropdown in Phase 4) */}
      <button
        type="button"
        aria-label="More options"
        className={cn(btnClass)}
        style={{ color: mutedColor }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="19" cy="12" r="1.5" />
        </svg>
      </button>
    </div>
  )
}
