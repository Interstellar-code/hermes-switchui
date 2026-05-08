import { memo, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSessionStatus } from '@/hooks/use-session-status'
import { cn } from '@/lib/utils'

type ProfilesResponse = {
  activeProfile?: string
  profiles?: Array<{ name: string; active?: boolean }>
}

async function fetchProfiles(): Promise<ProfilesResponse> {
  const res = await fetch('/api/profiles/list')
  if (!res.ok) return {}
  return (await res.json()) as ProfilesResponse
}

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
  /** Fallback model name when session-status hasn't returned model yet */
  modelFallback?: string
}

function ChatMetaBarV2Component({
  sessionKey,
  isStreaming = false,
  tokPerSec = null,
  toolCount: toolCountProp,
  profile,
  modelFallback,
}: ChatMetaBarV2Props) {
  const status = useSessionStatus(sessionKey)

  const profilesQuery = useQuery({
    queryKey: ['profiles', 'list'],
    queryFn: fetchProfiles,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
  const resolvedProfile =
    profile ??
    profilesQuery.data?.activeProfile ??
    profilesQuery.data?.profiles?.find((p) => p.active)?.name ??
    null

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

  const pct = Math.round(Math.min(Math.max(status.contextPercent, 0), 100))
  const displayModel = status.model || modelFallback || '—'
  const effectiveTokPerSec = tokPerSec ?? derivedTokPerSec
  const displayTokPerSec =
    isStreaming && effectiveTokPerSec != null && effectiveTokPerSec > 0
      ? `${Math.round(effectiveTokPerSec)} tok/s`
      : null
  const displayToolCount = toolCountProp ?? 0
  const displayProfile = resolvedProfile ?? 'default'

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
        <span className="m-label m-label-accent">live</span>
        {displayTokPerSec && (
          <>
            <span className="opacity-40">·</span>
            <span className="m-timestamp" data-testid="tok-per-sec">{displayTokPerSec}</span>
          </>
        )}
      </span>

      <Sep />

      {/* Model */}
      <span className="m-mono shrink-0 truncate max-w-[140px]" data-testid="meta-model">
        {displayModel}
      </span>

      <Sep />

      {/* Context */}
      <span className="m-mono shrink-0 whitespace-nowrap" data-testid="meta-ctx">
        {pct > 0 || status.usedTokens > 0 ? (
          <>
            <span className="m-label">ctx</span>{' '}{pct}%
            {status.maxTokens > 0 && (
              <>
                {' '}·{' '}
                {formatTokensShort(status.usedTokens)} /{' '}
                {formatTokensShort(status.maxTokens)}
              </>
            )}
          </>
        ) : (
          <><span className="m-label">ctx</span>{' '}—</>
        )}
      </span>

      <Sep />

      {/* Tools */}
      <span className="shrink-0 whitespace-nowrap" data-testid="meta-tools">
        <span className="m-label">tools</span>{' · '}<span className="m-mono">{displayToolCount > 0 ? displayToolCount : '—'}</span>
      </span>

      <Sep />

      {/* Profile */}
      <span className="shrink-0 whitespace-nowrap" data-testid="meta-profile">
        <span className="m-label">profile</span>{' · '}<span className="m-mono">{displayProfile}</span>
      </span>

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
