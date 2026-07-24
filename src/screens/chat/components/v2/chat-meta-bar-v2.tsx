import { memo } from 'react'
import { SessionSelectorsV2 } from './session-selectors-v2'
import type { ThinkingLevel } from '../chat-composer-types'
import { useSessionStatus } from '@/hooks/use-session-status'
import { formatCostUsd, formatTokens } from '@/lib/format'
import { cn } from '@/lib/utils'

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
  /** Session key the selectors use for per-session model persistence
   *  (undefined for new chats). Falls back to `sessionKey` if omitted. */
  selectorSessionKey?: string | null | undefined
  /** Number of tool_use blocks visible in message list */
  toolCount?: number
  /** Profile/model override label */
  profile?: string
  /** Fallback model name when session-status hasn't returned model yet */
  modelFallback?: string
  /** Current thinking level (controlled by chat-screen) for the selectors */
  thinkingLevel?: ThinkingLevel
  /** Setter for the thinking-level selector */
  onThinkingLevelChange?: (level: ThinkingLevel) => void
  /** Hide the model/profile/workspace/thinking selectors */
  hideSelectors?: boolean
}

function ChatMetaBarV2Component({
  sessionKey,
  selectorSessionKey,
  thinkingLevel,
  onThinkingLevelChange,
  hideSelectors = false,
}: ChatMetaBarV2Props) {
  const status = useSessionStatus(sessionKey)

  const displayCost = status.cost > 0 ? formatCostUsd(status.cost) : null

  const inTok = status.inputTokens || 0
  const outTok = status.outputTokens || 0
  const tokenBreakdown =
    status.cacheReadTokens || status.cacheWriteTokens || status.reasoningTokens
      ? `in ${formatTokens(inTok)} · out ${formatTokens(
          outTok,
        )} · cache r/w ${formatTokens(status.cacheReadTokens)}/${formatTokens(
          status.cacheWriteTokens,
        )} · reasoning ${formatTokens(status.reasoningTokens)}`
      : `in ${formatTokens(inTok)} · out ${formatTokens(outTok)}`

  const sessionLabel = sessionKey ?? '—'

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
        borderColor:
          'var(--m-border, var(--theme-border, rgba(255,255,255,0.08)))',
        color: 'var(--m-muted, var(--theme-muted, #9ca3af))',
      }}
    >
      {/* Cost — only when the provider actually bills (subscription gateways report 0) */}
      {displayCost && (
        <>
          <Sep />
          <span
            className="shrink-0 whitespace-nowrap"
            data-testid="meta-cost"
            title={tokenBreakdown}
          >
            <span className="m-label">cost</span>
            {' · '}
            <span className="m-mono">{displayCost}</span>
          </span>
        </>
      )}

      {!hideSelectors && (
        <>
          <Sep />
          {/* Relocated model / profile / workspace / thinking selectors */}
          <span className="shrink-0" data-testid="meta-selectors">
            <SessionSelectorsV2
              sessionKey={
                (selectorSessionKey === undefined
                  ? sessionKey
                  : selectorSessionKey) ?? undefined
              }
              thinkingLevel={thinkingLevel}
              onThinkingLevelChange={onThinkingLevelChange}
            />
          </span>
        </>
      )}

      {/* Spacer */}
      <span className="flex-1" />

      {/* Session id — right aligned */}
      <span
        className="m-timestamp shrink-0 whitespace-nowrap opacity-60"
        data-testid="meta-session-id"
      >
        session · {sessionLabel}
      </span>
    </div>
  )
}

export const ChatMetaBarV2 = memo(ChatMetaBarV2Component)
