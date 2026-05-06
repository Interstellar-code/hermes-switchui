import { memo } from 'react'
import { useSessionStatus } from '@/hooks/use-session-status'
import { cn } from '@/lib/utils'

function formatTokensShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`
  return String(n)
}

function Sep() {
  return (
    <span
      aria-hidden="true"
      className="text-[var(--m-border,rgba(255,255,255,0.15))] select-none"
    >
      ·
    </span>
  )
}

type ChatMetaBarV2Props = {
  sessionKey: string | null | undefined
  /** Whether a streaming run is currently active */
  isStreaming?: boolean
  /** Approximate tok/s from parent, or null */
  tokPerSec?: number | null
  /** Number of tool_use blocks visible in message list */
  toolCount?: number
  /** Profile/model override label */
  profile?: string
}

function ChatMetaBarV2Component({
  sessionKey,
  isStreaming = false,
  tokPerSec = null,
  toolCount: toolCountProp,
  profile,
}: ChatMetaBarV2Props) {
  const status = useSessionStatus(sessionKey)

  const pct = Math.round(Math.min(Math.max(status.contextPercent, 0), 100))
  const displayModel = status.model || '—'
  const displayTokPerSec =
    isStreaming && tokPerSec != null ? `${Math.round(tokPerSec)} tok/s` : null
  const displayToolCount = toolCountProp ?? 0
  const displayProfile = profile ?? 'default'

  // Derive a short session label from the key
  const sessionLabel = sessionKey
    ? sessionKey.length > 12
      ? `t_${sessionKey.slice(-8)}`
      : sessionKey
    : '—'

  return (
    <div
      role="status"
      aria-label="Session meta"
      className={cn(
        'shrink-0 flex items-center gap-1.5 px-4 h-7 text-[10px] font-mono overflow-x-auto scrollbar-none',
        'border-b',
      )}
      style={{
        background: 'var(--m-surface-1, var(--theme-card, rgba(0,0,0,0.2)))',
        borderColor: 'var(--m-border, var(--theme-border, rgba(255,255,255,0.08)))',
        color: 'var(--m-muted, var(--theme-muted, #9ca3af))',
      }}
    >
      {/* Live indicator + tok/s */}
      <span className="flex items-center gap-1 shrink-0">
        <span
          aria-hidden="true"
          className={cn(
            'inline-block w-1.5 h-1.5 rounded-full',
            isStreaming
              ? 'bg-[var(--m-green,#4ade80)] animate-pulse'
              : 'bg-[var(--m-green,#4ade80)] opacity-70',
          )}
        />
        <span style={{ color: 'var(--m-green, #4ade80)' }}>live</span>
        {displayTokPerSec && (
          <>
            <span className="opacity-40">·</span>
            <span data-testid="tok-per-sec">{displayTokPerSec}</span>
          </>
        )}
      </span>

      <Sep />

      {/* Model */}
      <span className="shrink-0 truncate max-w-[140px]" data-testid="meta-model">
        {displayModel}
      </span>

      <Sep />

      {/* Context */}
      <span className="shrink-0 whitespace-nowrap" data-testid="meta-ctx">
        {pct > 0 || status.usedTokens > 0 ? (
          <>
            ctx {pct}%
            {status.maxTokens > 0 && (
              <>
                {' '}·{' '}
                {formatTokensShort(status.usedTokens)} /{' '}
                {formatTokensShort(status.maxTokens)}
              </>
            )}
          </>
        ) : (
          'ctx —'
        )}
      </span>

      <Sep />

      {/* Tools */}
      <span className="shrink-0 whitespace-nowrap" data-testid="meta-tools">
        tools · {displayToolCount > 0 ? displayToolCount : '—'}
      </span>

      <Sep />

      {/* Profile */}
      <span className="shrink-0 whitespace-nowrap" data-testid="meta-profile">
        profile · {displayProfile}
      </span>

      {/* Spacer */}
      <span className="flex-1" />

      {/* Session id — right aligned */}
      <span
        className="shrink-0 whitespace-nowrap opacity-60"
        data-testid="meta-session-id"
      >
        session · {sessionLabel}
      </span>
    </div>
  )
}

export const ChatMetaBarV2 = memo(ChatMetaBarV2Component)
