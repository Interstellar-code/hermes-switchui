'use client'

import { memo, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { buildCompactionNotice } from './streaming-lifecycle-ui'
import { cn } from '@/lib/utils'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/shadcn/ui/popover'
import {
  PreviewCard,
  PreviewCardPopup,
  PreviewCardTrigger,
} from '@/components/ui/preview-card'
import { useCompressSession } from '@/screens/chat/hooks/use-compress-session'
import { useSessionStatus } from '@/hooks/use-session-status'
import {
  isTrackedContextSession,
  useContextUsageStore,
} from '@/stores/context-usage-store'
import { chatQueryKeys, fetchSessions } from '@/screens/chat/chat-queries'
import { useChatStore } from '@/stores/chat-store'
import { activeScopeKey } from '@/lib/session-scope'

type ModelCatalogEntry = {
  id?: string
  model?: string
  name?: string
  provider?: string
  contextLength?: number
}

type ModelsResponse = {
  data?: Array<ModelCatalogEntry>
  models?: Array<ModelCatalogEntry>
}

async function fetchModelCatalog(): Promise<Array<ModelCatalogEntry>> {
  const response = await fetch('/api/models')
  if (!response.ok) return []
  const payload = (await response.json()) as
    | ModelsResponse
    | Array<ModelCatalogEntry>
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload.data)) return payload.data
  if (Array.isArray(payload.models)) return payload.models
  return []
}

type LiveModelInfo = { activeModel: string; activeProvider: string }

async function fetchActiveModelInfo(): Promise<LiveModelInfo> {
  try {
    const response = await fetch('/api/model/info')
    if (!response.ok) return { activeModel: '', activeProvider: '' }
    const payload = (await response.json()) as {
      activeModel?: string | null
      activeProvider?: string | null
    }
    return {
      activeModel:
        typeof payload.activeModel === 'string' ? payload.activeModel : '',
      activeProvider:
        typeof payload.activeProvider === 'string'
          ? payload.activeProvider
          : '',
    }
  } catch {
    return { activeModel: '', activeProvider: '' }
  }
}

function normalizeModelId(value: string): string {
  return value.trim().toLowerCase()
}

function matchesModel(
  candidate: ModelCatalogEntry,
  activeModel: string,
): boolean {
  const model = normalizeModelId(activeModel)
  if (!model) return false
  const ids = [candidate.id, candidate.model, candidate.name]
    .filter((value): value is string => typeof value === 'string')
    .map(normalizeModelId)
  const modelName = model.split('/').pop()
  return ids.some(
    (id) => id === model || id.split('/').pop() === model || id === modelName,
  )
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

const MAX_SOURCE_LABEL: Record<string, string> = {
  gateway: 'reported by gateway',
  config: 'from config.yaml',
  catalog: 'model catalog',
  default: 'default — model window unknown',
}

function ContextBarComponent({
  compact = false,
  sessionId,
  busy = false,
}: {
  compact?: boolean
  sessionId?: string
  /** A reply is streaming — compress is disabled until it finishes. */
  busy?: boolean
}) {
  const status = useSessionStatus(sessionId)
  const { compress, compressing } = useCompressSession(sessionId)
  const [menuOpen, setMenuOpen] = useState(false)
  // Live percent pushed from the SSE stream (usage.update / compaction events).
  // Updates instantly during a turn; the 15s status poll only refreshes between.
  const liveContextPercent = useContextUsageStore((s) =>
    isTrackedContextSession(s, sessionId) ? s.contextPercent : 0,
  )
  const compactionCount = useContextUsageStore((s) =>
    isTrackedContextSession(s, sessionId) ? s.compactionCount : 0,
  )
  const messagesBefore = useContextUsageStore((s) =>
    isTrackedContextSession(s, sessionId) ? s.messagesBefore : null,
  )
  const messagesAfter = useContextUsageStore((s) =>
    isTrackedContextSession(s, sessionId) ? s.messagesAfter : null,
  )
  const liveCompacting = useContextUsageStore(
    (s) => isTrackedContextSession(s, sessionId) && s.compactingSince !== null,
  )
  const sessionsQuery = useQuery({
    queryKey: chatQueryKeys.sessionsRaw,
    queryFn: fetchSessions,
    staleTime: 30_000,
    enabled: Boolean(sessionId),
  })
  // Unique key — the bare ['models'] key is also used elsewhere (chat-screen)
  // with a queryFn that returns the raw response OBJECT, not an array; sharing
  // the key poisons this cache and makes `.find` throw on tab refocus.
  const modelsQuery = useQuery({
    queryKey: ['models', 'context-bar-catalog'],
    queryFn: fetchModelCatalog,
    staleTime: 5 * 60 * 1000,
  })
  const modelCatalog = Array.isArray(modelsQuery.data) ? modelsQuery.data : []
  // The gateway's live active model (what the agent actually runs, e.g.
  // manifest/auto). session-status can report the upstream-resolved name
  // (gpt-5.x) which has no catalog contextLength — matching the live model
  // ensures we find the right window size (e.g. manifest/auto → 300K).
  const modelInfoQuery = useQuery({
    queryKey: ['model-info', 'active'],
    queryFn: fetchActiveModelInfo,
    staleTime: 30_000,
  })
  const meta = (sessionsQuery.data ?? []).find((s) => s.key === sessionId)
  const fallbackUsed =
    typeof meta?.tokenCount === 'number'
      ? meta.tokenCount
      : typeof (meta as { totalTokens?: number } | undefined)?.totalTokens ===
          'number'
        ? Number((meta as { totalTokens?: number }).totalTokens)
        : 0
  const liveModel = modelInfoQuery.data?.activeModel || ''
  const liveProvider = modelInfoQuery.data?.activeProvider || ''
  // The gateway's per-session model switch is sticky and server-confirmed —
  // the meta-bar chip (session-selectors-v2.tsx) already prefers it over
  // every local/polled source for exactly this reason: `/api/model/info` and
  // `/api/session-status` can be stale relative to a switch the server just
  // confirmed on `run.started`, and two chips disagreeing about the current
  // model is worse than either being slightly stale. Match that precedence
  // here so this chip never shows something different from the meta-bar one.
  const modelSwitchKey = sessionId ? activeScopeKey(sessionId) : ''
  const effectiveModelId = useChatStore((s) =>
    modelSwitchKey ? (s.modelSwitch[modelSwitchKey]?.effective ?? null) : null,
  )
  const activeModel =
    effectiveModelId || liveModel || status.model || meta?.model || ''
  // Prefer an exact provider+model catalog match for the live gateway model,
  // then fall back to name-only matching against the resolved active model.
  const matchingModel =
    (liveModel &&
      modelCatalog.find(
        (model) =>
          matchesModel(model, liveModel) &&
          (!liveProvider || model.provider === liveProvider),
      )) ||
    modelCatalog.find((model) => matchesModel(model, activeModel))
  const fallbackMax =
    typeof matchingModel?.contextLength === 'number' &&
    Number.isFinite(matchingModel.contextLength) &&
    matchingModel.contextLength > 0
      ? matchingModel.contextLength
      : 200_000
  const fallbackPct =
    fallbackMax > 0 ? Math.min(100, (fallbackUsed / fallbackMax) * 100) : 0
  // Prefer the model catalog contextLength (from config) as the authoritative
  // window size — session-status maxTokens can be stale or smaller than the
  // configured value. Fall back to status.maxTokens only when no catalog entry
  // has a contextLength.
  // Server limits from the gateway or config.yaml are authoritative; the
  // client catalog only beats a server default (routing models like
  // manifest/auto have no catalog entry and used to read as 200k).
  const serverHasRealMax =
    status.maxTokens > 0 && status.maxSource !== 'default'
  const catalogMax =
    typeof matchingModel?.contextLength === 'number' &&
    Number.isFinite(matchingModel.contextLength) &&
    matchingModel.contextLength > 0
      ? matchingModel.contextLength
      : 0
  const effectiveMax = serverHasRealMax
    ? status.maxTokens
    : catalogMax > 0
      ? catalogMax
      : status.maxTokens > 0
        ? status.maxTokens
        : fallbackMax
  const maxSource = serverHasRealMax
    ? status.maxSource
    : catalogMax > 0
      ? 'catalog'
      : status.maxSource
  const threshold = status.compressionThreshold
  const thresholdPct = threshold !== null ? threshold * 100 : null
  const effectiveUsed = status.usedTokens > 0 ? status.usedTokens : fallbackUsed
  // Recompute percent from used/max so the bar stays consistent with the
  // displayed token counts when effectiveMax differs from the server's value.
  const serverPct =
    effectiveUsed > 0 && effectiveMax > 0
      ? Math.min(100, (effectiveUsed / effectiveMax) * 100)
      : liveContextPercent > 0
        ? Math.max(liveContextPercent, status.contextPercent)
        : status.contextPercent > 0
          ? status.contextPercent
          : fallbackPct
  const effectivePct =
    liveContextPercent > 0 ? Math.max(liveContextPercent, serverPct) : serverPct
  const [showLabel, setShowLabel] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)')
    const update = () => setIsMobile(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (!showLabel) return
    const id = setTimeout(() => setShowLabel(false), 3000)
    return () => clearTimeout(id)
  }, [showLabel])

  const pct = effectivePct
  const clampedPct = Math.min(Math.max(pct, 0), 100)

  if (!compact && clampedPct === 0 && effectiveUsed === 0) return null
  const isCritical = clampedPct > 90
  const isDanger = clampedPct >= 75 && clampedPct <= 90
  const isWarning = clampedPct >= 50 && clampedPct < 75

  const barColor = isCritical
    ? 'bg-red-500'
    : isDanger
      ? 'bg-orange-500'
      : isWarning
        ? 'bg-yellow-400'
        : 'bg-emerald-500'

  const barBg = isCritical
    ? 'bg-red-100'
    : isDanger
      ? 'bg-orange-100'
      : isWarning
        ? 'bg-yellow-100'
        : 'bg-emerald-100'

  const textColor = isCritical
    ? 'text-red-600'
    : isDanger
      ? 'text-orange-600'
      : isWarning
        ? 'text-yellow-600'
        : 'text-emerald-600'

  const ringColor = isCritical
    ? '#ef4444'
    : isDanger
      ? '#f97316'
      : isWarning
        ? '#facc15'
        : 'var(--theme-accent)'
  const circumference = 61.261056745
  const dashOffset = circumference * (1 - clampedPct / 100)
  const compactLabel = Math.round(clampedPct)
  const compactionNotice = buildCompactionNotice({
    compactionCount,
    messagesBefore,
    messagesAfter,
  })

  if (compact) {
    // Point on the ring where auto-compaction fires (ring starts at 12 o'clock).
    const tick =
      thresholdPct !== null
        ? (() => {
            const angle = (thresholdPct / 100) * 2 * Math.PI
            return {
              x1: 12 + 7.6 * Math.sin(angle),
              y1: 12 - 7.6 * Math.cos(angle),
              x2: 12 + 11.9 * Math.sin(angle),
              y2: 12 - 11.9 * Math.cos(angle),
            }
          })()
        : null
    const tokensToCompaction =
      threshold !== null
        ? Math.max(0, Math.round(effectiveMax * threshold - effectiveUsed))
        : null

    const ringLabel = [
      `Context window: ${compactLabel}% used`,
      liveCompacting ? 'Compacting context…' : compactionNotice,
    ]
      .filter(Boolean)
      .join(' · ')

    return (
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger
          className="group inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-primary-500 transition hover:-translate-y-px hover:bg-primary-100/70 dark:hover:bg-primary-800/60"
          aria-label={ringLabel}
          title={ringLabel}
        >
          <span
            className={cn(
              'relative inline-flex h-10 w-10 items-center justify-center',
              liveCompacting && 'animate-pulse',
            )}
          >
            <svg
              className="absolute inset-0 h-10 w-10 overflow-visible"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <g transform="rotate(-90 12 12)">
                <circle
                  cx="12"
                  cy="12"
                  r="9.75"
                  fill="none"
                  stroke="var(--theme-border)"
                  strokeOpacity="0.9"
                  strokeWidth="2.4"
                />
                <circle
                  cx="12"
                  cy="12"
                  r="9.75"
                  fill="none"
                  stroke={ringColor}
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  className="transition-[stroke-dashoffset,stroke] duration-500 ease-out"
                />
              </g>
              {tick ? (
                <line
                  {...tick}
                  stroke="var(--theme-text)"
                  strokeOpacity="0.7"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
              ) : null}
            </svg>
            <span className="relative flex h-[22px] min-w-[22px] items-center justify-center rounded-full border border-primary-500/15 bg-[var(--theme-bg)] px-[2px] text-[10px] font-bold leading-none text-primary-600 shadow-sm tabular-nums dark:bg-[var(--theme-card)]">
              {compactLabel}
            </span>
            {compactionCount > 0 || liveCompacting ? (
              // #364: compaction is visible without opening the popover.
              <span
                className="absolute -right-0.5 -top-0.5 inline-flex h-[15px] min-w-[15px] items-center justify-center gap-px rounded-full border border-[var(--theme-border)] bg-[var(--theme-bg)] px-[3px] text-[8px] font-bold leading-none text-primary-600 shadow-sm tabular-nums dark:bg-[var(--theme-card)]"
                aria-hidden="true"
                data-testid="context-ring-compaction-badge"
              >
                <span className="text-[8px]">🗜️</span>
                {compactionCount > 1 ? compactionCount : null}
              </span>
            ) : null}
          </span>
        </PopoverTrigger>

        <PopoverContent
          align="end"
          sideOffset={8}
          className="w-72 rounded-xl px-3 py-2.5"
        >
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-primary-900">
                Context window
              </span>
              <span
                className={cn('text-xs font-semibold tabular-nums', textColor)}
              >
                {status.estimated ? '~' : ''}
                {Math.round(clampedPct)}%
              </span>
            </div>
            <div
              className={cn(
                'relative h-2 w-full overflow-hidden rounded-full',
                barBg,
              )}
            >
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-500',
                  barColor,
                )}
                style={{ width: `${clampedPct}%` }}
              />
              {thresholdPct !== null ? (
                <div
                  className="absolute inset-y-0 w-0.5 bg-[var(--theme-text)] opacity-80"
                  style={{ left: `${thresholdPct}%` }}
                  title={`Auto-compacts at ${Math.round(thresholdPct)}%`}
                />
              ) : null}
            </div>
            <div className="flex items-center justify-between gap-3 text-[11px] text-primary-500">
              <span className="tabular-nums">
                {status.estimated ? '~' : ''}
                {formatTokens(effectiveUsed)} / {formatTokens(effectiveMax)}{' '}
                tokens
              </span>
              {activeModel ? (
                <span className="max-w-[100px] truncate text-primary-400">
                  {activeModel}
                </span>
              ) : null}
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px] text-primary-500">
              <dt>Used</dt>
              <dd className="text-right">
                {status.estimated
                  ? 'estimated from transcript'
                  : 'last prompt (gateway)'}
              </dd>
              <dt>Window</dt>
              <dd
                className={cn(
                  'text-right',
                  maxSource === 'default' && 'text-orange-600',
                )}
              >
                {MAX_SOURCE_LABEL[maxSource] ?? maxSource}
              </dd>
              <dt>Auto-compact</dt>
              <dd className="text-right">
                {thresholdPct !== null && tokensToCompaction !== null
                  ? `at ${Math.round(thresholdPct)}% · ${
                      tokensToCompaction > 0
                        ? `${formatTokens(tokensToCompaction)} to go`
                        : 'due next turn'
                    }`
                  : 'off'}
              </dd>
            </dl>
            {liveCompacting ? (
              <p className="text-[11px] font-medium text-primary-600">
                🗜️ Compacting context…
              </p>
            ) : null}
            {compactionNotice ? (
              <p className="text-[11px] text-primary-500">
                🗜️ {compactionNotice}
              </p>
            ) : null}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                disabled={!sessionId || busy || compressing}
                title={
                  busy ? 'Wait for the current reply to finish' : undefined
                }
                onClick={() => {
                  void compress().then((ok) => {
                    if (ok) setMenuOpen(false)
                  })
                }}
                className="flex-1 rounded-lg border border-primary-300 px-2 py-1.5 text-[11px] font-medium text-primary-800 transition-colors hover:bg-primary-50 disabled:opacity-50 dark:hover:bg-primary-800/60"
              >
                {compressing ? 'Compressing…' : 'Compress now'}
              </button>
              <a
                href="/new"
                className="flex-1 rounded-lg bg-primary-900 px-2 py-1.5 text-center text-[11px] font-medium text-white transition-colors hover:bg-primary-800"
              >
                New chat
              </a>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    )
  }

  if (isMobile) {
    return (
      <div className="relative w-full">
        {/* Invisible tap target */}
        <button
          type="button"
          className="absolute inset-x-0 -top-2 -bottom-2 z-10"
          onClick={() => setShowLabel((prev) => !prev)}
          aria-label={`Context: ${Math.round(clampedPct)}% used`}
        />
        {/* Bar — always 3px, never moves */}
        <div className={cn('w-full h-[3px]', barBg)}>
          <div
            className={cn(
              'h-full transition-all duration-700 ease-out',
              barColor,
            )}
            style={{ width: `${clampedPct}%` }}
          />
        </div>
        {/* Label floats below bar on tap */}
        {showLabel && (
          <div className="absolute right-2 top-[5px] z-20 flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary-900/85 shadow-sm animate-in fade-in duration-150">
            <span className="text-[10px] font-semibold tabular-nums text-white">
              {Math.round(clampedPct)}%
            </span>
            <span className="text-[9px] text-white/70 tabular-nums">
              {formatTokens(effectiveUsed)}/{formatTokens(effectiveMax)}
            </span>
          </div>
        )}
      </div>
    )
  }

  return (
    <PreviewCard>
      <PreviewCardTrigger className="block w-full cursor-pointer">
        <div
          className={cn(
            'shrink-0 w-full h-2 transition-colors duration-300 relative',
            barBg,
          )}
        >
          <div
            className={cn(
              'h-full transition-all duration-700 ease-out',
              barColor,
            )}
            style={{ width: `${clampedPct}%` }}
          />
          {/* % shown on hover via popup only */}
        </div>
      </PreviewCardTrigger>

      <PreviewCardPopup
        align="center"
        sideOffset={2}
        className="w-64 px-3 py-2.5 rounded-lg"
      >
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-primary-900">
              Context Window
            </span>
            <span
              className={cn(
                'text-[11px] font-semibold tabular-nums',
                textColor,
              )}
            >
              {Math.round(clampedPct)}%
            </span>
          </div>
          <div className={cn('w-full h-2 rounded-full overflow-hidden', barBg)}>
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                barColor,
              )}
              style={{ width: `${clampedPct}%` }}
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-primary-500 tabular-nums">
              {formatTokens(effectiveUsed)} / {formatTokens(effectiveMax)}{' '}
              tokens
            </span>
            {activeModel && (
              <span className="text-[10px] text-primary-400 truncate max-w-[100px]">
                {activeModel}
              </span>
            )}
          </div>
          {isCritical && (
            <p className="text-[10px] text-red-600 font-medium">
              Context almost full — consider starting a new chat
            </p>
          )}
          {compactionNotice && (
            <p className="text-[10px] text-primary-500">{compactionNotice}</p>
          )}
        </div>
      </PreviewCardPopup>
    </PreviewCard>
  )
}

export const ContextBar = memo(ContextBarComponent)
