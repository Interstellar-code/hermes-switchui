import { memo, useEffect, useRef, useState } from 'react'
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
  /** Whether a streaming run is currently active */
  isStreaming?: boolean
  /** Approximate tok/s from parent, or null */
  tokPerSec?: number | null
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
  isStreaming = false,
  tokPerSec = null,
  thinkingLevel,
  onThinkingLevelChange,
  hideSelectors = false,
}: ChatMetaBarV2Props) {
  const status = useSessionStatus(sessionKey)

  // Derive tok/s from usedTokens deltas while streaming.
  const [derivedTokPerSec, setDerivedTokPerSec] = useState<number | null>(null)
  const lastSampleRef = useRef<{ tokens: number; t: number } | null>(null)
  useEffect(() => {
    if (!isStreaming) {
      lastSampleRef.current = null
      setDerivedTokPerSec(null)
      return
    }
    const now = Date.now()
    const tokens = status.usedTokens || status.outputTokens || 0
    const prev = lastSampleRef.current
    if (prev && tokens > prev.tokens && now > prev.t) {
      const dt = (now - prev.t) / 1000
      const dTok = tokens - prev.tokens
      if (dt > 0.25) setDerivedTokPerSec(dTok / dt)
    }
    lastSampleRef.current = { tokens, t: now }
  }, [isStreaming, status.usedTokens, status.outputTokens])

  const effectiveTokPerSec = tokPerSec ?? derivedTokPerSec
  const displayTokPerSec =
    isStreaming && effectiveTokPerSec != null && effectiveTokPerSec > 0
      ? `${Math.round(effectiveTokPerSec)} tok/s`
      : null

  const displayCost = status.cost > 0 ? formatCostUsd(status.cost) : null

  const inTok = status.inputTokens || 0
  const outTok = status.outputTokens || 0
  const totalTok = status.totalTokens || inTok + outTok
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
      {/* tok/s (while streaming) */}
      {displayTokPerSec != null && (
        <>
          <span className="m-mono shrink-0" data-testid="tok-per-sec">
            {displayTokPerSec}
          </span>
          <Sep />
        </>
      )}

      {/* Tokens (cache/reasoning breakdown in tooltip) */}
      {totalTok > 0 && (
        <span
          className="shrink-0 whitespace-nowrap"
          data-testid="meta-tokens"
          title={tokenBreakdown}
        >
          <span className="m-label">tok</span>
          {' · '}
          <span className="m-mono">{formatTokens(totalTok)}</span>
        </span>
      )}

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

      {/* API call count */}
      {status.apiCallCount > 0 && (
        <>
          <Sep />
          <span
            className="shrink-0 whitespace-nowrap"
            data-testid="meta-apicalls"
          >
            <span className="m-label">api</span>
            {' · '}
            <span className="m-mono">{status.apiCallCount}</span>
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
