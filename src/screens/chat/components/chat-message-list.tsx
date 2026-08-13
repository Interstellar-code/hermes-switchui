import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp01Icon, Robot01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  getMessageTimestamp,
  getToolCallsFromMessage,
  textFromMessage,
} from '../utils'
import { MessageItem, withoutDelegateTaskToolSections } from './message-item'
import { StreamingMessageItem } from './streaming-text-context'
import { TuiActivityCard, attachClarifyCard } from './tui-activity-card'
import {
  InlineClarifyCard,
  interactionReceiptToPendingClarify,
  parseInteractionReceipt,
} from './inline-clarify-card'
import { ScrollToBottomButton } from './scroll-to-bottom-button'
import type { ToolDisplayMode } from './message-item'
import type { ChatMessage } from '../types'
import {
  ChatContainerContent,
  ChatContainerRoot,
  ChatContainerScrollAnchor,
} from '@/components/prompt-kit/chat-container'
import { AssistantAvatar } from '@/components/avatars'
import { cn } from '@/lib/utils'
import { hapticTap } from '@/lib/haptics'
import { CHAT_OPEN_MESSAGE_SEARCH_EVENT } from '@/screens/chat/chat-events'
import { useSharedTicker } from '@/screens/chat/hooks/use-shared-ticker'

/** Duration (ms) the thinking indicator stays visible after waitingForResponse
 *  clears, giving the first response message time to render before the
 *  indicator disappears — prevents a flash of blank space (Bug 2 fix).
 *  Keep this short so tool pills appear immediately and the shimmer only
 *  bridges the gap until the first tool/text event arrives. */
const THINKING_GRACE_PERIOD_MS = 300

const TOOL_EMOJIS: Record<string, string> = {
  web_search: '🔍',
  search: '🔍',
  search_files: '🔍',
  session_search: '🔍',
  web_fetch: '🌐',
  terminal: '💻',
  exec: '💻',
  shell: '💻',
  bash: '💻',
  Read: '📖',
  read: '📖',
  read_file: '📖',
  file_read: '📖',
  pdf: '📄',
  Write: '✏️',
  write: '✏️',
  write_file: '✏️',
  edit: '✏️',
  Edit: '✏️',
  memory: '🧠',
  memory_search: '🧠',
  memory_get: '🧠',
  save_memory: '🧠',
  browser: '🌐',
  browser_navigate: '🌐',
  navigate: '🌐',
  image: '🖼️',
  vision: '🖼️',
  skill: '📦',
  skill_view: '📦',
  skill_load: '📦',
  delegate: '🤖',
  spawn: '🤖',
  subagents: '🤖',
  agents_list: '🤖',
  todo: '✅',
  cron: '⏰',
  message: '💬',
  voice_call: '📞',
  canvas: '🎨',
  nodes: '📱',
  gateway: '⚙️',
  lcm_grep: '🔍',
  lcm_expand: '🔍',
  lcm_describe: '🔍',
  lcm_expand_query: '🔍',
  sessions_send: '📤',
  session_status: '📊',
  sessions_yield: '⏸️',
  tts: '🗣️',
}

function getToolEmoji(name: string): string {
  if (TOOL_EMOJIS[name]) return TOOL_EMOJIS[name]
  if (name.includes('search')) return '🔍'
  if (name.includes('read') || name.includes('Read')) return '📖'
  if (name.includes('write') || name.includes('Write') || name.includes('edit'))
    return '✏️'
  if (name.includes('exec') || name.includes('terminal')) return '💻'
  if (name.includes('memory')) return '🧠'
  if (name.includes('browser')) return '🌐'
  if (name.includes('skill')) return '📦'
  return '⚡'
}

function getToolVerb(name: string): string {
  if (name.includes('search')) return 'Searching'
  if (name.includes('read') || name.includes('Read')) return 'Reading'
  if (name.includes('write') || name.includes('Write') || name.includes('edit'))
    return 'Writing'
  if (name.includes('exec') || name.includes('terminal')) return 'Executing'
  if (name.includes('memory')) return 'Remembering'
  if (name.includes('browser')) return 'Browsing'
  if (name.includes('skill')) return 'Loading skill'
  return 'Working'
}

function ToolCallCard({ name, phase }: { name: string; phase: string }) {
  const isDone =
    phase === 'done' || phase === 'complete' || phase === 'completed'
  const isError = phase === 'error' || phase === 'failed'
  const isRunning = !isDone && !isError

  // Issue #214: derive elapsed from a shared 1s ticker instead of a per-card
  // interval. The start time is captured once when the card enters the running
  // state; the tick value only forces a re-render.
  const startRef = useRef<number>(Date.now())
  const runStartedRef = useRef(false)
  if (isRunning && !runStartedRef.current) {
    startRef.current = Date.now()
    runStartedRef.current = true
  } else if (!isRunning && runStartedRef.current) {
    runStartedRef.current = false
  }
  useSharedTicker(1000, isRunning)
  const dotTick = useSharedTicker(400, isRunning)
  const dots = '.'.repeat(dotTick % 4)
  const elapsed = isRunning
    ? Math.floor((Date.now() - startRef.current) / 1000)
    : 0

  const elapsedLabel =
    elapsed >= 60
      ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
      : `${elapsed}s`
  const emoji = getToolEmoji(name)
  const verb = getToolVerb(name)
  const displayName = name.replace(/_/g, ' ')

  return (
    <div
      className="rounded-lg border border-primary-200 bg-primary-50 text-[11px] overflow-hidden"
      style={{
        borderLeftWidth: '3px',
        borderLeftColor: isRunning ? '#6366f1' : isDone ? '#22c55e' : '#ef4444',
        boxShadow: isRunning ? '0 0 8px rgba(99,102,241,0.12)' : 'none',
      }}
    >
      <div className="flex items-center gap-1.5 px-2.5 py-1.5">
        <span className="text-sm leading-none">{emoji}</span>
        <span className="font-mono font-semibold text-ink">{displayName}</span>
        <span className="flex-1" />
        {isRunning && (
          <span className="text-[10px] tabular-nums text-primary-400">
            {elapsedLabel}
          </span>
        )}
        {isDone && <span className="text-xs text-green-500">✅</span>}
        {isError && <span className="text-xs text-red-500">❌</span>}
        {isRunning && (
          <span className="size-1.5 rounded-full animate-pulse bg-indigo-500" />
        )}
      </div>
      {isRunning && (
        <div className="px-2.5 pb-1.5 text-[10px] text-primary-400">
          {verb}
          {dots}
        </div>
      )}
    </div>
  )
}

type ThinkingBubbleProps = {
  activeToolCalls?: Array<{ id: string; name: string; phase: string }>
  liveToolActivity?: Array<{ name: string; timestamp: number }>
  isCompacting?: boolean
  /** Live, human-readable summary of what the agent is doing right now,
   *  polled from the gateway run during long quiet waits. Display only. */
  liveProgressLabel?: string
}

/**
 * Premium shimmer thinking bubble — matches the assistant message position
 * with three bouncing dots, a gradient shimmer sweep, and a dynamic status
 * label that reflects what's actually happening (tool calls, etc.).
 */
function ThinkingBubble({
  activeToolCalls: _activeToolCalls = [],
  liveToolActivity: _liveToolActivity = [],
  isCompacting = false,
  liveProgressLabel = '',
}: ThinkingBubbleProps) {
  const statusLabel = isCompacting ? 'Compacting context...' : 'Thinking…'

  // Issue #214: elapsed time derived from the shared 1s ticker. The start time
  // resets whenever the status label changes (a new tool), captured in a ref.
  const elapsedStartRef = useRef<number>(Date.now())
  const elapsedLabelRef = useRef(statusLabel)
  if (elapsedLabelRef.current !== statusLabel) {
    elapsedLabelRef.current = statusLabel
    elapsedStartRef.current = Date.now()
  }
  useSharedTicker(1000)
  const elapsed = Math.floor((Date.now() - elapsedStartRef.current) / 1000)

  const elapsedLabel =
    elapsed >= 60
      ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
      : `${elapsed}s`

  const isStale = elapsed >= 30
  const isVeryStale = elapsed >= 60

  // Track displayed label with a small delay so we fade between changes
  const [displayedLabel, setDisplayedLabel] = useState(statusLabel)
  const [visible, setVisible] = useState(true)
  const prevLabelRef = useRef(statusLabel)

  useEffect(() => {
    if (statusLabel === prevLabelRef.current) return
    // Fade out, swap, fade in
    setVisible(false)
    const swapTimer = window.setTimeout(() => {
      setDisplayedLabel(statusLabel)
      prevLabelRef.current = statusLabel
      setVisible(true)
    }, 150)
    return () => window.clearTimeout(swapTimer)
  }, [statusLabel])

  // Keep the bottom thinking bubble visible while inline Hermes activity handles tool details.

  return (
    <div className="flex items-end gap-2">
      {/* Avatar with the response activity indicator. */}
      <div className="flex shrink-0 items-center gap-1">
        <div className="thinking-avatar-glow rounded-lg">
          <AssistantAvatar size={28} />
        </div>
        {!isCompacting && (
          <span
            className="flex items-center gap-0.5"
            role="status"
            aria-label="Hermes is responding"
          >
            <span className="thinking-dot thinking-dot-1" />
            <span className="thinking-dot thinking-dot-2" />
            <span className="thinking-dot thinking-dot-3" />
          </span>
        )}
      </div>

      {/* Chat bubble */}
      <div
        className="relative max-w-[36rem] overflow-hidden rounded-2xl rounded-bl-sm thinking-shimmer-bubble"
        style={{
          background: 'var(--theme-card, rgba(0,255,65,0.04))',
          border: '1px solid color-mix(in srgb, var(--m-green-500, var(--theme-accent, #4ade80)) 35%, var(--theme-border))',
          boxShadow: '0 0 12px color-mix(in srgb, var(--m-green-500, var(--theme-accent, #4ade80)) 18%, transparent)',
        }}>
        {/* Shimmer overlay */}
        <div
          className="thinking-shimmer-sweep pointer-events-none absolute inset-0"
          aria-hidden="true"
        />

        <div className="relative flex flex-col gap-2 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                {isCompacting ? (
                  <span
                    className="inline-block size-3 rounded-full border border-primary-300 border-t-primary-500 animate-spin"
                    aria-hidden="true"
                  />
                ) : null}
                <span
                  className="thinking-label ml-1.5 text-xs font-mono font-medium transition-opacity duration-300"
                  style={{
                    opacity: visible ? 1 : 0,
                    color: isStale
                      ? 'var(--m-yellow, #d6ff5f)'
                      : 'var(--m-green-400, var(--theme-accent, #4ade80))',
                  }}
                >
                  {displayedLabel}{' '}
                  {elapsed >= 3 ? (
                    <span className="text-[10px] opacity-60">
                      {elapsedLabel}
                    </span>
                  ) : null}
                </span>
              </div>
              {liveProgressLabel && !isCompacting ? (
                <div
                  className="mt-1 truncate font-mono text-[11px] opacity-70"
                  style={{ color: 'var(--theme-muted)' }}
                  title={liveProgressLabel}
                >
                  {liveProgressLabel}
                </div>
              ) : null}
            </div>
          </div>

          {isStale ? (
            <span className="text-[11px] font-mono animate-pulse" style={{ color: 'var(--m-yellow, #d6ff5f)' }}>
              {isVeryStale
                ? 'Still thinking… this is taking a while'
                : 'Taking longer than usual…'}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}

const NEAR_BOTTOM_THRESHOLD = 200
// Pull-to-refresh constants removed

// Issue #213: long sessions used to mount N full markdown subtrees because
// virtualization was disabled (scroll glitches). Instead of reviving the
// fragile fixed-row-height spacer windowing against an externally-owned scroll
// viewport, we render only the tail of long threads and collapse the older head
// behind a "Show earlier messages" affordance. The tail always contains the
// streaming entry, the pinned last user+assistant group, and everything near
// the bottom viewport, so streaming / pin-to-bottom / auto-scroll are untouched.
// Below the threshold, behavior is byte-identical to before.
const COLLAPSE_THRESHOLD = 80
const COLLAPSE_KEEP_TAIL = 60

/**
 * Pure helper: how many leading entries to hide (collapse) at the head of the
 * thread. Returns 0 (no collapsing — fully equivalent to prior behavior) unless
 * the thread is long, the head is not expanded, and we are not in search mode.
 *
 * Hiding only the head keeps every absolute index into `visibleEntries`
 * (spacing/grouping classes, pin-group slicing, search match indices) valid —
 * we trim what gets *rendered*, never the array the rest of the component
 * reasons about.
 */
export function computeCollapsedHeadCount(params: {
  totalEntries: number
  expanded: boolean
  searchActive: boolean
  threshold?: number
  keepTail?: number
}): number {
  const {
    totalEntries,
    expanded,
    searchActive,
    threshold = COLLAPSE_THRESHOLD,
    keepTail = COLLAPSE_KEEP_TAIL,
  } = params
  // Search must see every match — never collapse while searching.
  if (searchActive) return 0
  if (expanded) return 0
  if (totalEntries <= threshold) return 0
  return Math.max(0, totalEntries - keepTail)
}

function ShowEarlierMessagesButton({
  hiddenCount,
  onExpand,
}: {
  hiddenCount: number
  onExpand: () => void
}) {
  return (
    <div className="mb-2 flex justify-center md:mb-3">
      <button
        type="button"
        onClick={onExpand}
        className="inline-flex items-center gap-1.5 rounded-full border border-primary-200 bg-primary-50/90 px-3 py-1.5 text-xs font-medium text-primary-600 transition-colors hover:bg-primary-100 hover:text-primary-800 dark:border-primary-800 dark:bg-primary-900/80 dark:text-primary-300 dark:hover:bg-primary-800 dark:hover:text-primary-100"
        aria-label={`Show ${hiddenCount} earlier messages`}
      >
        <HugeiconsIcon icon={ArrowUp01Icon} size={14} strokeWidth={1.8} />
        Show {hiddenCount} earlier{' '}
        {hiddenCount === 1 ? 'message' : 'messages'}
      </button>
    </div>
  )
}

const HIDDEN_SYSTEM_USER_PREFIXES = [
  'Pre-compaction memory flush',
  'Read HEARTBEAT.md',
  'HEARTBEAT_OK',
  'Execute your Session Startup sequence',
  '[Queued messages',
  'Heartbeat prompt',
  '[Fri ',
  '[Mon ',
  '[Tue ',
  '[Wed ',
  '[Thu ',
  '[Sat ',
  '[Sun ',
] as const

function shouldHideSystemInjectedUserMessage(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  // Only hide messages that begin with known system-injected prompts. User
  // context summaries may quote these phrases later in the message and must
  // remain visible/persistent in the chat UI.
  return HIDDEN_SYSTEM_USER_PREFIXES.some((prefix) => trimmed.startsWith(prefix))
}

function getChronologyRank(message: ChatMessage): number {
  const role =
    typeof message.role === 'string' ? message.role.toLowerCase() : ''
  const content = Array.isArray(message.content) ? message.content : []
  const hasToolCalls =
    content.some((part) => part.type === 'toolCall') ||
    (Array.isArray((message as any).streamToolCalls) &&
      (message as any).streamToolCalls.length > 0) ||
    (Array.isArray((message as any).__streamToolCalls) &&
      (message as any).__streamToolCalls.length > 0)

  if (role === 'user') return 0
  if (role === 'assistant' && hasToolCalls) return 1
  if (role === 'tool' || role === 'toolresult' || role === 'tool_result')
    return 2
  if (role === 'assistant') return 3
  return 4
}

function sortMessagesChronologically(
  messages: Array<ChatMessage>,
): Array<ChatMessage> {
  return messages
    .map((message, index) => ({ message, index }))
    .sort((left, right) => {
      const leftTimestamp = getMessageTimestamp(left.message)
      const rightTimestamp = getMessageTimestamp(right.message)
      if (leftTimestamp !== rightTimestamp)
        return leftTimestamp - rightTimestamp

      const leftRank = getChronologyRank(left.message)
      const rightRank = getChronologyRank(right.message)
      if (leftRank !== rightRank) return leftRank - rightRank

      const leftHistoryIndex =
        typeof (left.message as any).__historyIndex === 'number'
          ? (left.message as any).__historyIndex
          : undefined
      const rightHistoryIndex =
        typeof (right.message as any).__historyIndex === 'number'
          ? (right.message as any).__historyIndex
          : undefined
      if (
        leftHistoryIndex !== undefined &&
        rightHistoryIndex !== undefined &&
        leftHistoryIndex !== rightHistoryIndex
      ) {
        return leftHistoryIndex - rightHistoryIndex
      }

      const leftRealtimeSequence =
        typeof (left.message as any).__realtimeSequence === 'number'
          ? (left.message as any).__realtimeSequence
          : undefined
      const rightRealtimeSequence =
        typeof (right.message as any).__realtimeSequence === 'number'
          ? (right.message as any).__realtimeSequence
          : undefined
      if (
        leftRealtimeSequence !== undefined &&
        rightRealtimeSequence !== undefined &&
        leftRealtimeSequence !== rightRealtimeSequence
      ) {
        return leftRealtimeSequence - rightRealtimeSequence
      }

      return left.index - right.index
    })
    .map(({ message }) => message)
}

type MessageSearchMatch = {
  stableId: string
  messageIndex: number
}

type DisplayEntry = {
  message: ChatMessage
  sourceIndex: number
  attachedToolMessages: Array<ChatMessage>
}

function isAssistantToolCallOnlyMessage(message: ChatMessage): boolean {
  if (message.role !== 'assistant') return false
  const hasToolCalls = getToolCallsFromMessage(message).length > 0
  const text = textFromMessage(message)
  return hasToolCalls && text.trim().length === 0
}

export function buildDisplayEntries(
  displayMessages: Array<ChatMessage>,
): Array<DisplayEntry> {
  const entries: Array<DisplayEntry> = []
  let pendingAssistantToolMessages: Array<ChatMessage> = []

  displayMessages.forEach((message, index) => {
    if (isAssistantToolCallOnlyMessage(message)) {
      pendingAssistantToolMessages.push(message)
      return
    }

    if (message.role === 'tool' || message.role === 'toolResult') {
      const previousEntry = entries.at(-1)
      if (previousEntry?.message.role === 'assistant') {
        previousEntry.attachedToolMessages.push(message)
      } else if (pendingAssistantToolMessages.length > 0 || !previousEntry) {
        pendingAssistantToolMessages.push(message)
      }
      return
    }

    const entry: DisplayEntry = {
      message,
      sourceIndex: index,
      attachedToolMessages: [],
    }

    if (message.role === 'assistant' && pendingAssistantToolMessages.length > 0) {
      entry.attachedToolMessages.push(...pendingAssistantToolMessages)
      pendingAssistantToolMessages = []
    }

    entries.push(entry)
  })

  return entries
}

export type TrailingToolOnlyTurnSummary = {
  count: number
  toolNames: Array<string>
  hasFinalAssistantText: boolean
}

/**
 * Returns a summary of trailing tool-only assistant turns (and their tool
 * results) that come after the last text-bearing assistant message, or null
 * if the thread already ends with an assistant text message.
 */
export function getTrailingToolOnlyTurnSummary(
  messages: Array<ChatMessage>,
): TrailingToolOnlyTurnSummary | null {
  // Find the last assistant message that has text
  let lastTextAssistantIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'assistant' && textFromMessage(msg).trim().length > 0) {
      lastTextAssistantIdx = i
      break
    }
  }

  // If the last text-bearing assistant message is the final message, nothing trailing
  if (lastTextAssistantIdx === messages.length - 1) return null
  // If no text assistant at all, nothing to summarize
  if (lastTextAssistantIdx === -1) return null

  const trailing = messages.slice(lastTextAssistantIdx + 1)
  if (trailing.length === 0) return null

  const toolNamesSet = new Set<string>()
  let count = 0

  for (const msg of trailing) {
    if (isAssistantToolCallOnlyMessage(msg)) {
      count++
      for (const tc of getToolCallsFromMessage(msg)) {
        if (tc.name) toolNamesSet.add(tc.name)
      }
    } else if (msg.role === 'tool' || msg.role === 'toolResult') {
      count++
    }
  }

  if (count === 0) return null

  return {
    count,
    toolNames: Array.from(toolNamesSet),
    hasFinalAssistantText: lastTextAssistantIdx >= 0,
  }
}

function escapeAttributeSelector(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }

  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

type ChatMessageListProps = {
  messages: Array<ChatMessage>
  onRetryMessage?: (message: ChatMessage) => void
  onReplyMessage?: (message: ChatMessage, selectedText?: string) => void
  onRefresh?: () => void | Promise<unknown>
  onThinkingIndicatorChange?: (visible: boolean) => void
  loading: boolean
  empty: boolean
  emptyState?: React.ReactNode
  notice?: React.ReactNode
  noticePosition?: 'start' | 'end'
  /**
   * Interactive clarify card, rendered inside the matching Hermes clarify tool
   * row so the question, choices, and selected answer stay with tool activity.
   */
  clarifyCard?: React.ReactNode
  /**
   * Non-persisted agent slash-command output, rendered after the transcript.
   * Deliberately a sibling of `messages` rather than an entry in it — see
   * `stores/command-output-store.ts` for why it must never be a chat message.
   */
  commandOutputs?: React.ReactNode
  waitingForResponse: boolean
  sessionKey?: string
  pinToTop: boolean
  pinGroupMinHeight: number
  headerHeight: number
  contentStyle?: React.CSSProperties
  // Streaming support
  streamingMessageId?: string | null
  hasStreamingText?: boolean
  streamingThinking?: string
  lifecycleEvents?: Array<{
    text: string
    emoji: string
    timestamp: number
    isError: boolean
  }>
  isStreaming?: boolean
  bottomOffset?: number | string
  activeToolCalls?: Array<{ id: string; name: string; phase: string }>
  liveToolActivity?: Array<{ name: string; timestamp: number }>
  hideSystemMessages?: boolean
  isCompacting?: boolean
  /** Live progress summary polled from the gateway run during long waits. */
  liveProgressLabel?: string
  /** True while the HTTP send request is in-flight (before waitingForResponse
   *  can confirm the server received it). Keeps the thinking indicator visible
   *  during the very first render after the user submits. */
  sending?: boolean
  /** Controls how tool-call sections render: expanded, collapsed (default), or hidden. */
  toolDisplayMode?: ToolDisplayMode
}

export function isThinkingIndicatorSurfaceVisible({
  showTypingIndicator,
  isCompacting,
  liveToolActivityCount,
  isStreaming,
  hasStreamingText,
  activeToolCallCount,
}: {
  showTypingIndicator: boolean
  isCompacting: boolean
  liveToolActivityCount: number
  isStreaming: boolean
  hasStreamingText: boolean
  activeToolCallCount: number
}): boolean {
  if (isStreaming && hasStreamingText) {
    return false
  }

  return (
    showTypingIndicator ||
    isCompacting ||
    liveToolActivityCount > 0 ||
    (isStreaming && !hasStreamingText) ||
    (isStreaming && activeToolCallCount > 0)
  )
}

function ChatMessageListComponent({
  messages,
  onRetryMessage,
  onReplyMessage,
  onRefresh: _onRefresh,
  onThinkingIndicatorChange,
  loading,
  empty,
  emptyState,
  notice,
  noticePosition = 'start',
  clarifyCard,
  commandOutputs,
  waitingForResponse,
  sessionKey,
  pinToTop,
  pinGroupMinHeight,
  headerHeight,
  contentStyle,
  streamingMessageId,
  hasStreamingText = false,
  streamingThinking,
  lifecycleEvents = [],
  isStreaming = false,
  bottomOffset = 0,
  activeToolCalls = [],
  liveToolActivity = [],
  hideSystemMessages = false,
  isCompacting = false,
  liveProgressLabel = '',
  sending = false,
  toolDisplayMode = 'collapsed',
}: ChatMessageListProps) {
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const lastUserRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const prevSessionKeyRef = useRef<string | undefined>(sessionKey)
  const stickToBottomRef = useRef(true)
  const lastScrollTopRef = useRef(0)
  const isNearBottomRef = useRef(true)
  const [isNearBottom, setIsNearBottom] = useState(true)
  const [unreadCount, setUnreadCount] = useState(0)
  // Issue #213: when a long thread collapses its older head, this flips to true
  // once the user clicks "Show earlier messages" to render the full history.
  const [headExpanded, setHeadExpanded] = useState(false)
  // Bug 2 fix: grace period — keep thinking indicator alive briefly after
  // waitingForResponse clears so the response message has time to render.
  const [thinkingGrace, setThinkingGrace] = useState(false)
  const thinkingGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )
  const [isMessageSearchOpen, setIsMessageSearchOpen] = useState(false)
  const [messageSearchValue, setMessageSearchValue] = useState('')
  const [activeSearchMatchIndex, setActiveSearchMatchIndex] = useState(0)
  const [isMobileViewport, setIsMobileViewport] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(max-width: 767px)').matches
  })
  // Pull-to-refresh removed (was buggy on mobile)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const media = window.matchMedia('(max-width: 767px)')
    const updateIsMobile = () => setIsMobileViewport(media.matches)
    updateIsMobile()
    media.addEventListener('change', updateIsMobile)
    return () => media.removeEventListener('change', updateIsMobile)
  }, [])

  // Issue #213: re-collapse the older head when switching sessions so a freshly
  // opened long thread starts windowed (cheap) instead of inheriting a prior
  // session's expanded state.
  useEffect(() => {
    setHeadExpanded(false)
  }, [sessionKey])

  // Bug 2 fix: refs used by grace-period effects (declared here so hooks run in
  // consistent order; actual logic is after displayMessages useMemo below).
  const prevWaitingRef = useRef(waitingForResponse)
  const assistantMessageCountRef = useRef(0)

  // Pull-to-refresh handlers removed

  // contentContainerStyle removed with pull-to-refresh

  const chatContentStyle = useMemo<React.CSSProperties | undefined>(() => {
    if (!isMobileViewport) return contentStyle
    return {
      ...contentStyle,
      paddingBottom:
        contentStyle?.paddingBottom ??
        'calc(var(--chat-composer-height, 56px) + var(--safe-b) + 8px)',
    }
  }, [contentStyle, isMobileViewport])

  // Simple scroll handler — only tracks if user is near bottom via refs (no state updates)
  const handleUserScroll = useCallback(function trackUserScroll(metrics: {
    scrollTop: number
    scrollHeight: number
    clientHeight: number
  }) {
    const distanceFromBottom =
      metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight
    const nearBottom = distanceFromBottom <= NEAR_BOTTOM_THRESHOLD
    const wasScrollingUp = metrics.scrollTop < lastScrollTopRef.current - 5
    lastScrollTopRef.current = metrics.scrollTop

    if (wasScrollingUp && !nearBottom) {
      stickToBottomRef.current = false
      isNearBottomRef.current = false
    } else if (nearBottom) {
      stickToBottomRef.current = true
      isNearBottomRef.current = true
    }
  }, [])

  // Simple scroll to bottom — find viewport and scroll
  const scrollToBottom = useCallback(function scrollViewportToBottom(
    behavior: ScrollBehavior = 'auto',
  ) {
    const anchor = anchorRef.current
    if (!anchor) return
    const viewport = anchor.closest('[data-chat-scroll-viewport]')
    if (viewport instanceof HTMLElement && typeof viewport.scrollTo === 'function') {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior })
    }
  }, [])

  // Filter messages — toolResult handled by grouping into assistant bubble below
  const displayMessages = useMemo(() => {
    const filteredMessages = messages.filter((msg) => {
      // Hide tool messages — rendered as pills on the assistant message instead
      if (msg.role === 'tool') return false

      const cleanedText = textFromMessage(msg).trim()

      if (msg.role === 'assistant') {
        if (cleanedText === 'HEARTBEAT_OK') return false
        // Hide NO_REPLY messages (agent had nothing to say, or used message tool instead)
        if (cleanedText === 'NO_REPLY') return false
        // Hide truncated NO_REPLY variants (e.g. "NO_" or "NO")
        if (/^NO_?(?:REPLY)?$/i.test(cleanedText)) return false
        return true
      }

      if (msg.role === 'user') {
        const rawText = (Array.isArray(msg.content) ? msg.content : [])
          .map((part) => (part.type === 'text' ? String(part.text ?? '') : ''))
          .join('')
          .trim()
        const hasAttachments =
          Array.isArray((msg as any).attachments) &&
          (msg as any).attachments.length > 0
        const hasInlineImages =
          Array.isArray((msg as any).inlineImages) &&
          (msg as any).inlineImages.length > 0
        const isPendingOptimisticUserMessage =
          typeof (msg as any).__optimisticId === 'string' ||
          msg.status === 'sending' ||
          msg.status === 'queued'

        // Keep optimistic/pending user messages visible for the whole response cycle,
        // even if the server hasn't echoed normalized text content back yet.
        if (cleanedText.length === 0 && !hasAttachments && !hasInlineImages) {
          if (!isPendingOptimisticUserMessage) return false
        }

        const isSystemPrefixed = /^System:/i.test(rawText)
        if (hideSystemMessages && isSystemPrefixed) return false
        if (
          hideSystemMessages &&
          shouldHideSystemInjectedUserMessage(cleanedText)
        ) {
          return false
        }
        if (!isSystemPrefixed) return true

        const normalizedText = cleanedText.toLowerCase()
        const containsSystemFailure =
          normalizedText.includes('exec failed') ||
          normalizedText.includes('serverrestart') ||
          normalizedText.includes('signal sigkill')
        const matchesHeartbeatPrompt =
          /read heartbeat\.md if it exists.*?reply heartbeat_ok\./is.test(
            cleanedText,
          )

        if (containsSystemFailure || matchesHeartbeatPrompt) return false
      }

      return true
    })

    const seenMessageIds = new Set<string>()
    const deduped = filteredMessages.filter((message) => {
      const messageId =
        (message as any).id ||
        (message as any).messageId ||
        (message as any).clientId ||
        (message as any).client_id ||
        (message as any).nonce ||
        (message as any).__optimisticId
      if (typeof messageId !== 'string' || messageId.trim().length === 0) {
        return true
      }
      const scopedId = `${message.role}:${messageId.trim()}`
      if (seenMessageIds.has(scopedId)) return false
      seenMessageIds.add(scopedId)
      return true
    })
    return sortMessagesChronologically(deduped)
  }, [hideSystemMessages, messages])

  const displayEntries = useMemo<Array<DisplayEntry>>(
    () => buildDisplayEntries(displayMessages),
    [displayMessages],
  )

  // Bug 2 fix: grace-period effects — placed after displayMessages so they can
  // reference it safely.

  // Early-cancel grace when streaming text actually starts flowing — this is the
  // primary exit path (not the 10s ceiling timer). Ensures zero blank gap.
  useEffect(() => {
    if (thinkingGrace && hasStreamingText) {
      if (thinkingGraceTimerRef.current) {
        clearTimeout(thinkingGraceTimerRef.current)
        thinkingGraceTimerRef.current = null
      }
      setThinkingGrace(false)
    }
  }, [hasStreamingText, thinkingGrace])

  useEffect(() => {
    const currentAssistantCount = displayEntries.filter(
      ({ message }) => message.role === 'assistant',
    ).length

    // Cancel grace period early when a new assistant message appears
    if (
      thinkingGrace &&
      currentAssistantCount > assistantMessageCountRef.current
    ) {
      if (thinkingGraceTimerRef.current) {
        clearTimeout(thinkingGraceTimerRef.current)
        thinkingGraceTimerRef.current = null
      }
      setThinkingGrace(false)
    }

    assistantMessageCountRef.current = currentAssistantCount
  }, [displayEntries, messages, thinkingGrace])

  useEffect(() => {
    const wasWaiting = prevWaitingRef.current
    prevWaitingRef.current = waitingForResponse

    if (wasWaiting && !waitingForResponse) {
      // Snapshot assistant count at the moment waiting cleared
      assistantMessageCountRef.current = displayEntries.filter(
        ({ message }) => message.role === 'assistant',
      ).length
      setThinkingGrace(true)
      if (thinkingGraceTimerRef.current)
        clearTimeout(thinkingGraceTimerRef.current)
      thinkingGraceTimerRef.current = setTimeout(() => {
        thinkingGraceTimerRef.current = null
        setThinkingGrace(false)
      }, THINKING_GRACE_PERIOD_MS)
    }

    return () => {
      if (thinkingGraceTimerRef.current) {
        clearTimeout(thinkingGraceTimerRef.current)
      }
    }
  }, [displayEntries, waitingForResponse])

  const normalizedMessageSearch = useMemo(
    function getNormalizedMessageSearch() {
      return messageSearchValue.trim().toLocaleLowerCase()
    },
    [messageSearchValue],
  )

  const isMessageSearchActive =
    isMessageSearchOpen && normalizedMessageSearch.length > 0

  const messageSearchMatches = useMemo<Array<MessageSearchMatch>>(
    function getMessageSearchMatches() {
      if (!isMessageSearchActive) return []

      const matches: Array<MessageSearchMatch> = []
      for (const [index, entry] of displayEntries.entries()) {
        const message = entry.message
        const messageText = textFromMessage(message).trim().toLocaleLowerCase()
        if (!messageText.includes(normalizedMessageSearch)) continue
        matches.push({
          stableId: getStableMessageId(message, entry.sourceIndex),
          messageIndex: index,
        })
      }
      return matches
    },
    [displayEntries, isMessageSearchActive, normalizedMessageSearch],
  )

  const messageSearchMatchIndexById = useMemo(
    function getMessageSearchMatchIndexById() {
      const indexById = new Map<string, number>()
      for (const [index, match] of messageSearchMatches.entries()) {
        indexById.set(match.stableId, index)
      }
      return indexById
    },
    [messageSearchMatches],
  )

  const activeSearchMatch = messageSearchMatches[activeSearchMatchIndex] ?? null

  const focusSearchInput = useCallback(function focusSearchField() {
    window.requestAnimationFrame(function focusSearchInputField() {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    })
  }, [])

  const closeMessageSearch = useCallback(function closeSearch() {
    setIsMessageSearchOpen(false)
    setMessageSearchValue('')
    setActiveSearchMatchIndex(0)
  }, [])

  const openMessageSearch = useCallback(
    function openSearch() {
      setIsMessageSearchOpen(true)
      setActiveSearchMatchIndex(0)
      focusSearchInput()
    },
    [focusSearchInput],
  )

  const jumpToPreviousMatch = useCallback(
    function selectPreviousMatch() {
      if (messageSearchMatches.length === 0) return
      setActiveSearchMatchIndex(function setPreviousMatchIndex(currentIndex) {
        return (
          (currentIndex - 1 + messageSearchMatches.length) %
          messageSearchMatches.length
        )
      })
    },
    [messageSearchMatches.length],
  )

  const jumpToNextMatch = useCallback(
    function selectNextMatch() {
      if (messageSearchMatches.length === 0) return
      setActiveSearchMatchIndex(function setNextMatchIndex(currentIndex) {
        return (currentIndex + 1) % messageSearchMatches.length
      })
    },
    [messageSearchMatches.length],
  )

  const scrollToMessageById = useCallback(function scrollToMessage(
    messageId: string,
    behavior: ScrollBehavior = 'smooth',
  ) {
    const anchor = anchorRef.current
    if (!anchor) return

    const viewport = anchor.closest('[data-chat-scroll-viewport]')
    if (!viewport) return

    const escapedMessageId = escapeAttributeSelector(messageId)
    const selector = `[data-chat-message-id="${escapedMessageId}"]`
    const target = viewport.querySelector(selector)
    if (!target) return

    stickToBottomRef.current = false
    isNearBottomRef.current = false
    setIsNearBottom(false)
    target.scrollIntoView({ behavior, block: 'center', inline: 'nearest' })
  }, [])

  const toolResultsByCallId = useMemo(() => {
    const map = new Map<string, ChatMessage>()
    for (const message of messages) {
      // Path A: realtime SSE — separate message with role 'toolResult' and
      // a top-level toolCallId field.
      if (message.role === 'toolResult') {
        const toolCallId = message.toolCallId
        if (typeof toolCallId === 'string' && toolCallId.trim().length > 0) {
          map.set(toolCallId, message)
        }
        continue
      }
      // Path B: history reload — hermes-api.ts embeds tool results as
      // tool_result content blocks inside the role:'tool' message; no
      // separate toolResult-role message exists on this path.
      if (message.role === 'tool' && Array.isArray(message.content)) {
        for (const block of message.content) {
          const b = block as Record<string, unknown>
          if (b.type !== 'tool_result' && b.type !== 'toolResult') continue
          const callId = typeof b.toolCallId === 'string' ? b.toolCallId : ''
          if (!callId) continue
          // Synthesise a ChatMessage-shaped object so mapToolCallToToolPart /
          // extractToolResultText can read it without changes.
          const text =
            typeof b.text === 'string'
              ? b.text
              : Array.isArray(b.content)
                ? (b.content as Array<{ type?: string; text?: string }>)
                    .filter((p) => p.type === 'text')
                    .map((p) => p.text ?? '')
                    .join('')
                : ''
          const synthetic: ChatMessage = {
            ...message,
            role: 'toolResult',
            toolCallId: callId,
            toolName:
              typeof b.toolName === 'string' ? b.toolName : message.toolName,
            isError: b.isError === true,
            content: text ? [{ type: 'text', text }] : [],
          }
          map.set(callId, synthetic)
        }
      }
    }
    return map
  }, [messages])

  const hasUserVisibleTextMessages = useMemo(() => {
    return displayEntries.some(({ message }) => {
      const role = message.role || 'assistant'
      if (role !== 'user' && role !== 'assistant') return false
      return textFromMessage(message).trim().length > 0
    })
  }, [displayEntries])

  const visibleEntries = useMemo<Array<DisplayEntry>>(
    function getVisibleEntries() {
      if (!isMessageSearchActive) return displayEntries

      return displayEntries.filter((entry) =>
        textFromMessage(entry.message)
          .trim()
          .toLocaleLowerCase()
          .includes(normalizedMessageSearch),
      )
    },
    [displayEntries, isMessageSearchActive, normalizedMessageSearch],
  )

  const toolInteractionCount = useMemo(() => {
    const seenToolCallIds = new Set<string>()
    let count = 0

    for (const message of messages) {
      const toolCalls = getToolCallsFromMessage(message)
      for (const toolCall of toolCalls) {
        const toolCallId = (toolCall.id || '').trim()
        if (toolCallId.length > 0) {
          if (seenToolCallIds.has(toolCallId)) continue
          seenToolCallIds.add(toolCallId)
        }
        count += 1
      }

      if (message.role !== 'toolResult') continue
      const toolCallId = (message.toolCallId || '').trim()
      if (toolCallId.length > 0 && seenToolCallIds.has(toolCallId)) continue
      if (toolCallId.length > 0) {
        seenToolCallIds.add(toolCallId)
      }
      count += 1
    }

    return count
  }, [messages])

  const showToolOnlyNotice =
    !isMessageSearchActive &&
    !loading &&
    !empty &&
    visibleEntries.length > 0 &&
    !hasUserVisibleTextMessages &&
    toolInteractionCount > 0

  const lastAssistantIndex = visibleEntries
    .filter(({ message }) => message.role === 'assistant')
    .map(({ sourceIndex }) => sourceIndex)
    .pop()
  const lastUserIndex = visibleEntries
    .map(({ message, sourceIndex }, index) => ({ message, sourceIndex, index }))
    .filter(({ message }) => message.role === 'user')
    .map(({ index }) => index)
    .pop()
  // Show typing indicator when waiting for response and no visible text yet.
  // Bug 2 fix: also show during grace period (thinkingGrace) so there's no
  // blank-space flash between waitingForResponse clearing and the response
  // message actually rendering.
  // Gap fix: also show whenever isStreaming=true but streamingText is still
  // empty — this covers ALL cases where the stream has started (SSE connected,
  // tool calls in flight OR just completed) but the first text chunk hasn't
  // arrived yet. Removing the old `activeToolCalls.length > 0` gate ensures
  // the indicator stays alive even after tool calls finish and before text flows.
  const showTypingIndicator = (() => {
    // sending covers the instant the HTTP request fires before waitingForResponse
    // is confirmed by the server (they're typically batched but this is belt+suspenders)
    const effectivelyWaiting = waitingForResponse || thinkingGrace || sending
    const hasInThreadStreamingActivity =
      isStreaming &&
      (activeToolCalls.length > 0 ||
        liveToolActivity.length > 0 ||
        lifecycleEvents.length > 0 ||
        Boolean(streamingThinking && streamingThinking.trim().length > 0))
    // Streaming-but-empty only needs the detached thinking bubble when the
    // in-thread streaming row has nothing to show yet.
    const streamingButEmpty =
      isStreaming &&
      !hasStreamingText &&
      !hasInThreadStreamingActivity
    if (isCompacting) return true
    if (streamingButEmpty) return true
    if (!effectivelyWaiting) return false
    // If streaming has visible text, hide indicator — response is rendering
    if (isStreaming && hasStreamingText) return false
    const lastEntry = visibleEntries.at(-1)
    if (!lastEntry) return true
    const lastMessage = lastEntry.message
    if (lastMessage.role === 'assistant') {
      // If we're in grace period waiting for a NEW response, the last assistant
      // message is from the PREVIOUS turn — don't let its text hide the bubble.
      // Only suppress once we know this IS the new response (i.e. not waiting).
      if (thinkingGrace || waitingForResponse || sending) return true
      // Check if assistant message has visible text — if not, keep showing indicator
      const msgText = textFromMessage(lastMessage)
      if (!msgText || msgText.trim().length === 0) return true
      return false
    }
    return true
  })()

  const thinkingIndicatorVisible = isThinkingIndicatorSurfaceVisible({
    showTypingIndicator,
    isCompacting,
    liveToolActivityCount: liveToolActivity.length,
    isStreaming,
    hasStreamingText,
    activeToolCallCount: activeToolCalls.length,
  })

  useEffect(() => {
    onThinkingIndicatorChange?.(thinkingIndicatorVisible)
  }, [onThinkingIndicatorChange, thinkingIndicatorVisible])

  useEffect(
    () => () => {
      onThinkingIndicatorChange?.(false)
    },
    [onThinkingIndicatorChange],
  )

  const shouldBottomPin =
    visibleEntries.length > 0 ||
    showToolOnlyNotice ||
    showTypingIndicator ||
    !!clarifyCard ||
    liveToolActivity.length > 0 ||
    (isStreaming && !hasStreamingText) ||
    (isStreaming && activeToolCalls.length > 0)

  const normalizedStreamingToolCalls = useMemo<
    Array<{
      id: string
      name: string
      phase: 'calling' | 'running' | 'done' | 'error'
      args?: unknown
      preview?: string
      result?: string
    }>
  >(() => {
    if (activeToolCalls.length > 0) {
      return activeToolCalls.map((toolCall) => {
        const tcAny = toolCall as unknown as Record<string, unknown>
        return {
          id: toolCall.id,
          name: toolCall.name,
          phase:
            toolCall.phase === 'complete' || toolCall.phase === 'completed'
              ? 'done'
              : toolCall.phase === 'start'
                ? 'calling'
                : toolCall.phase === 'failed' || toolCall.phase === 'error'
                  ? 'error'
                  : toolCall.phase === 'calling' ||
                      toolCall.phase === 'running'
                    ? toolCall.phase
                    : 'calling',
          args: tcAny.args,
          preview:
            typeof tcAny.preview === 'string'
              ? (tcAny.preview)
              : undefined,
          result:
            typeof tcAny.result === 'string'
              ? (tcAny.result)
              : undefined,
        }
      })
    }

    return liveToolActivity.map((entry, index) => ({
      id: `live-${entry.name}-${index}`,
      name: entry.name,
      phase: 'running' as const,
    }))
  }, [activeToolCalls, liveToolActivity])

  const clarifyReceiptCard = useMemo(() => {
    if (clarifyCard) return clarifyCard
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i]
      const receipt = parseInteractionReceipt(msg)
      if (!receipt) continue
      const pending = interactionReceiptToPendingClarify(receipt)
      if (pending && sessionKey) {
        return <InlineClarifyCard clarify={pending} sessionKey={sessionKey} />
      }
    }
    return null
  }, [clarifyCard, messages, sessionKey])

  const clarifyResolved = Boolean(clarifyCard)

  const clarifyToolCalls = useMemo(() => {
    const visibleToolCalls = withoutDelegateTaskToolSections(normalizedStreamingToolCalls)
    if (!clarifyReceiptCard) return visibleToolCalls

    // While a Hermes clarify request is active, live activity may also contain
    // a low-information generic `tool` row. Drop that duplicate shell and attach
    // the clarify UI to the real clarify row, or synthesize exactly one clarify
    // row if the tool event has not arrived yet.
    const meaningfulToolCalls = visibleToolCalls.filter(
      (tc) => tc.name.toLowerCase() !== 'tool',
    )
    return meaningfulToolCalls
  }, [clarifyReceiptCard, normalizedStreamingToolCalls])

  // Pin the last user+assistant group without adding bottom padding.
  const groupStartIndex = typeof lastUserIndex === 'number' ? lastUserIndex : -1
  const hasGroup = pinToTop && groupStartIndex >= 0

  // Issue #213: number of leading entries to hide. 0 => render everything (the
  // prior behavior, exact for short threads). For long threads it hides all but
  // the last COLLAPSE_KEEP_TAIL entries until the user expands the head. We only
  // trim the *rendered* head — `visibleEntries` itself is never sliced, so every
  // absolute-index consumer (spacing/group classes, pin slicing, search) stays
  // correct. The collapsed head is clamped below groupStartIndex so the pinned
  // last user+assistant group is never collapsed away.
  const rawCollapsedHeadCount = computeCollapsedHeadCount({
    totalEntries: visibleEntries.length,
    expanded: headExpanded,
    searchActive: isMessageSearchActive,
  })
  const collapsedHeadCount =
    hasGroup && groupStartIndex >= 0
      ? Math.min(rawCollapsedHeadCount, groupStartIndex)
      : rawCollapsedHeadCount
  const hiddenHeadCount = collapsedHeadCount

  const handleExpandHead = useCallback(() => {
    setHeadExpanded(true)
  }, [])

  function isMessageStreaming(message: ChatMessage, index: number) {
    if (!isStreaming || !streamingMessageId) return false
    const messageId = message.__optimisticId || (message as any).id
    return (
      messageId === streamingMessageId ||
      (message.role === 'assistant' && index === lastAssistantIndex)
    )
  }

  function renderMessage(entry: DisplayEntry, entryIndex: number) {
    const chatMessage = entry.message
    const realIndex = entry.sourceIndex
    const messageIsStreaming = isMessageStreaming(chatMessage, realIndex)
    const stableId = getStableMessageId(chatMessage, realIndex)
    const spacingClass = cn(
      getMessageSpacingClass(visibleEntries, entryIndex),
      getToolGroupClass(visibleEntries, entryIndex),
    )
    const forceActionsVisible =
      typeof lastAssistantIndex === 'number' && realIndex === lastAssistantIndex
    const hasToolCalls =
      chatMessage.role === 'assistant' &&
      (getToolCallsFromMessage(chatMessage).length > 0 ||
        entry.attachedToolMessages.length > 0)

    const searchMatchIndex = messageSearchMatchIndexById.get(stableId)
    const isSearchMatch = typeof searchMatchIndex === 'number'
    const isActiveMatch =
      isSearchMatch && searchMatchIndex === activeSearchMatchIndex

    // If this is a user message and an assistant reply exists after it,
    // the send obviously succeeded — never show Retry.
    const hasAssistantReply =
      chatMessage.role === 'user' &&
      entryIndex + 1 < visibleEntries.length &&
      visibleEntries[entryIndex + 1]?.message.role === 'assistant'
    const effectiveOnRetry = hasAssistantReply ? undefined : onRetryMessage

    // For the live streaming placeholder: wrap in a stable div whose key never
    // changes for the lifetime of the stream. The div's opacity toggles between
    // 0 (no text yet) and 1 (text flowing) without unmounting the inner
    // MessageItem — preserving its reveal-timer state so text streams word-by-word.
    // ThinkingBubble stays visible via `streamingButEmpty` in showTypingIndicator
    // while this wrapper is invisible.
    if (messageIsStreaming) {
      const hasStreamingActivity =
        normalizedStreamingToolCalls.length > 0 ||
        liveToolActivity.length > 0 ||
        lifecycleEvents.length > 0 ||
        Boolean(streamingThinking && streamingThinking.trim().length > 0)
      const isEmptyPlaceholder =
        !hasStreamingText &&
        !hasStreamingActivity
      return (
        <div
          key={LIVE_STREAM_KEY}
          style={{
            display: isEmptyPlaceholder ? 'none' : undefined,
            opacity: isEmptyPlaceholder ? 0 : 1,
            pointerEvents: isEmptyPlaceholder ? 'none' : undefined,
            transition: 'opacity 150ms ease',
          }}
          aria-hidden={isEmptyPlaceholder ? true : undefined}
        >
          <StreamingMessageItem
            message={chatMessage}
            attachedToolMessages={entry.attachedToolMessages}
            onRetryMessage={effectiveOnRetry}
            onReplyMessage={onReplyMessage}
            toolResultsByCallId={hasToolCalls ? toolResultsByCallId : undefined}
            forceActionsVisible={forceActionsVisible}
            wrapperClassName={spacingClass}
            wrapperDataMessageId={stableId}
            bubbleClassName={
              isActiveMatch
                ? 'ring-2 ring-amber-400 bg-amber-50/50'
                : isSearchMatch
                  ? 'bg-amber-50/30'
                  : undefined
            }
            toolCalls={normalizedStreamingToolCalls}
            isStreaming={messageIsStreaming}
            streamingThinking={streamingThinking}
            lifecycleEvents={lifecycleEvents}
            clarifyCard={realIndex === lastAssistantIndex ? clarifyCard : undefined}
            toolDisplayMode={toolDisplayMode}
          />
        </div>
      )
    }

    return (
      <MessageItem
        key={stableId}
        message={chatMessage}
        attachedToolMessages={entry.attachedToolMessages}
        onRetryMessage={effectiveOnRetry}
        onReplyMessage={onReplyMessage}
        toolResultsByCallId={hasToolCalls ? toolResultsByCallId : undefined}
        forceActionsVisible={forceActionsVisible}
        wrapperClassName={spacingClass}
        wrapperDataMessageId={stableId}
        bubbleClassName={
          isActiveMatch
            ? 'ring-2 ring-amber-400 bg-amber-50/50'
            : isSearchMatch
              ? 'bg-amber-50/30'
              : undefined
        }
        toolCalls={undefined}
        isStreaming={false}
        streamingThinking={undefined}
        lifecycleEvents={undefined}
        clarifyCard={realIndex === lastAssistantIndex ? clarifyCard : undefined}
        toolDisplayMode={toolDisplayMode}
      />
    )
  }

  // Sync near-bottom ref to state every 500ms for button visibility
  useEffect(() => {
    const timer = window.setInterval(() => {
      setIsNearBottom((prev) => {
        const current = isNearBottomRef.current
        return prev === current ? prev : current
      })
    }, 500)
    return () => window.clearInterval(timer)
  }, [])

  // Simple: scroll to bottom when messages change and we should stick
  useEffect(() => {
    if (loading) return
    let frameId: number | null = null
    const sessionChanged = prevSessionKeyRef.current !== sessionKey
    prevSessionKeyRef.current = sessionKey

    // Always scroll on session change (instant)
    if (sessionChanged) {
      stickToBottomRef.current = true
      frameId = window.requestAnimationFrame(() => scrollToBottom('auto'))
      return () => {
        if (frameId !== null) window.cancelAnimationFrame(frameId)
      }
    }

    // Scroll to bottom only if the user is already near the bottom
    if (isNearBottomRef.current) {
      // Use smooth scroll only when user is near bottom (<200px) and new messages arrive;
      // use instant scroll during streaming to avoid choppiness.
      const behavior: ScrollBehavior = !isStreaming ? 'smooth' : 'auto'
      frameId = window.requestAnimationFrame(() => scrollToBottom(behavior))
    }

    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId)
    }
  }, [
    loading,
    visibleEntries.length,
    isStreaming,
    sessionKey,
    scrollToBottom,
    hasStreamingText,
  ])

  useEffect(() => {
    if (!isMessageSearchOpen) return

    function handleSearchShortcuts(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return
      if (event.altKey) return

      const hasCommand = event.metaKey || event.ctrlKey
      if (hasCommand && !event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        event.stopPropagation()
        openMessageSearch()
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeMessageSearch()
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        if (event.shiftKey) {
          jumpToPreviousMatch()
          return
        }
        jumpToNextMatch()
        return
      }

      const isInputFocused = document.activeElement === searchInputRef.current
      if (!isInputFocused) return

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        event.stopPropagation()
        jumpToPreviousMatch()
        return
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        event.stopPropagation()
        jumpToNextMatch()
      }
    }

    window.addEventListener('keydown', handleSearchShortcuts, true)
    return () => {
      window.removeEventListener('keydown', handleSearchShortcuts, true)
    }
  }, [
    closeMessageSearch,
    isMessageSearchOpen,
    jumpToNextMatch,
    jumpToPreviousMatch,
    openMessageSearch,
  ])

  useEffect(() => {
    function handleOpenMessageSearch() {
      openMessageSearch()
    }

    window.addEventListener(
      CHAT_OPEN_MESSAGE_SEARCH_EVENT,
      handleOpenMessageSearch,
    )
    return () => {
      window.removeEventListener(
        CHAT_OPEN_MESSAGE_SEARCH_EVENT,
        handleOpenMessageSearch,
      )
    }
  }, [openMessageSearch])

  useEffect(() => {
    function handleOpenSearchShortcut(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return
      if (event.altKey || event.shiftKey) return
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key.toLowerCase() !== 'f') return

      event.preventDefault()
      event.stopPropagation()
      openMessageSearch()
    }

    window.addEventListener('keydown', handleOpenSearchShortcut, true)
    return () => {
      window.removeEventListener('keydown', handleOpenSearchShortcut, true)
    }
  }, [openMessageSearch])

  useEffect(() => {
    if (!isMessageSearchActive) {
      setActiveSearchMatchIndex(0)
      return
    }

    setActiveSearchMatchIndex(function clampActiveMatchIndex(currentIndex) {
      if (messageSearchMatches.length === 0) return 0
      return Math.min(currentIndex, messageSearchMatches.length - 1)
    })
  }, [isMessageSearchActive, messageSearchMatches.length])

  useEffect(() => {
    if (messageSearchMatches.length === 0) return
    const activeMatch = messageSearchMatches[activeSearchMatchIndex]

    const frameId = window.requestAnimationFrame(
      function scrollToActiveMatch() {
        scrollToMessageById(activeMatch.stableId, 'smooth')
      },
    )

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [activeSearchMatchIndex, messageSearchMatches, scrollToMessageById])

  const handleScrollToBottom = useCallback(
    function handleBottomButton() {
      stickToBottomRef.current = true
      isNearBottomRef.current = true
      setIsNearBottom(true)
      setUnreadCount(0)
      // Haptic feedback on mobile scroll-to-bottom tap
      if (isMobileViewport) hapticTap()
      scrollToBottom('smooth')
    },
    [isMobileViewport, scrollToBottom],
  )

  const scrollToBottomOverlay = useMemo(() => {
    const isVisible = !isNearBottom && displayEntries.length > 0
    const hasVisibleEntries = visibleEntries.length > 0
    const overlayGap = isMobileViewport ? 8 : 24
    const overlayBottom =
      typeof bottomOffset === 'number'
        ? `${bottomOffset + overlayGap}px`
        : `calc(${bottomOffset} + ${overlayGap}px)`
    return (
      <div
        className="pointer-events-none absolute z-40 left-1/2 -translate-x-1/2 md:left-1/2 md:-translate-x-1/2 max-md:left-auto max-md:translate-x-0 max-md:right-4"
        style={{ bottom: overlayBottom }}
      >
        <ScrollToBottomButton
          isVisible={isVisible && hasVisibleEntries}
          unreadCount={unreadCount}
          onClick={handleScrollToBottom}
        />
      </div>
    )
  }, [
    bottomOffset,
    displayEntries.length,
    handleScrollToBottom,
    visibleEntries.length,
    isMobileViewport,
    isNearBottom,
    unreadCount,
  ])

  return (
    // mt-2 is to fix the prompt-input cut off
    <>
      <ChatContainerRoot
        className="h-full flex-1 min-h-0"
        stickToBottom={stickToBottomRef.current}
        onUserScroll={handleUserScroll}
        overlay={scrollToBottomOverlay}
      >
        <div className="w-full">
          {isMessageSearchOpen && (
            <div className="sticky top-0 z-30 flex items-center gap-2 border-b border-primary-200 bg-primary-50/95 px-3 py-2 backdrop-blur-sm">
              <input
                ref={searchInputRef}
                type="text"
                value={messageSearchValue}
                onChange={(e) => setMessageSearchValue(e.target.value)}
                placeholder="Search messages..."
                className="min-w-0 flex-1 rounded-md border border-primary-200 bg-primary-50 px-2.5 py-1.5 text-sm text-primary-900 outline-none placeholder:text-primary-400 focus:border-primary-400 focus:ring-1 focus:ring-primary-400"
              />
              {isMessageSearchActive && (
                <span className="shrink-0 text-xs text-primary-500 dark:text-neutral-400">
                  {messageSearchMatches.length > 0
                    ? `${activeSearchMatchIndex + 1} of ${messageSearchMatches.length}`
                    : 'No matches'}
                </span>
              )}
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  onClick={jumpToPreviousMatch}
                  disabled={messageSearchMatches.length === 0}
                  className="rounded p-1 text-primary-500 dark:text-neutral-400 hover:bg-primary-200 dark:hover:bg-primary-800 hover:text-primary-700 dark:hover:text-neutral-200 disabled:opacity-30"
                  aria-label="Previous match"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M4 10l4-4 4 4"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={jumpToNextMatch}
                  disabled={messageSearchMatches.length === 0}
                  className="rounded p-1 text-primary-500 dark:text-neutral-400 hover:bg-primary-200 dark:hover:bg-primary-800 hover:text-primary-700 dark:hover:text-neutral-200 disabled:opacity-30"
                  aria-label="Next match"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M4 6l4 4 4-4"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={closeMessageSearch}
                  className="rounded p-1 text-primary-500 dark:text-neutral-400 hover:bg-primary-200 dark:hover:bg-primary-800 hover:text-primary-700 dark:hover:text-neutral-200"
                  aria-label="Close search"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M4 4l8 8M12 4l-8 8"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>
            </div>
          )}
          <ChatContainerContent
            className="pt-2.5 md:pt-6 flex min-h-full flex-col"
            style={chatContentStyle}
          >
            {notice && noticePosition === 'start' ? notice : null}
            {shouldBottomPin ? (
              <div className="flex-1" aria-hidden="true" />
            ) : null}
            {showToolOnlyNotice ? (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <HugeiconsIcon
                      icon={Robot01Icon}
                      size={20}
                      strokeWidth={1.5}
                      className="mt-0.5 shrink-0 text-amber-600"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-amber-800 text-balance">
                        This session contains{' '}
                        <span className="tabular-nums">
                          {toolInteractionCount}
                        </span>{' '}
                        tool interactions
                      </p>
                      <p className="mt-1 text-sm text-amber-700 text-pretty">
                        Most content is AI agent tool usage (file reads, code
                        execution, etc.)
                      </p>
                    </div>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium',
                      toolDisplayMode === 'expanded'
                        ? 'border-amber-300 bg-amber-100 text-amber-700'
                        : toolDisplayMode === 'hidden'
                          ? 'border-amber-300 bg-amber-100/80 text-amber-500'
                          : 'border-amber-300 bg-amber-100/80 text-amber-800',
                    )}
                    aria-label={`Tool sections: ${toolDisplayMode}`}
                  >
                    {toolDisplayMode === 'expanded'
                      ? '✓ Expanded'
                      : toolDisplayMode === 'hidden'
                        ? '⊘ Hidden'
                        : 'Collapsed'}
                  </span>
                </div>
              </div>
            ) : null}
            {loading && displayEntries.length === 0 ? (
              <div className="flex flex-col gap-4 animate-pulse">
                <div className="flex gap-3">
                  <div className="size-6 rounded-full bg-primary-200" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-primary-200 rounded w-3/4" />
                    <div className="h-4 bg-primary-200 rounded w-1/2" />
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="size-6 rounded-full bg-primary-200" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-primary-200 rounded w-2/3" />
                    <div className="h-4 bg-primary-200 rounded w-5/6" />
                    <div className="h-4 bg-primary-200 rounded w-1/3" />
                  </div>
                </div>
              </div>
            ) : empty && !notice && !isMessageSearchActive ? (
              (emptyState ?? <div aria-hidden></div>)
            ) : isMessageSearchActive && visibleEntries.length === 0 ? (
              <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-6 text-sm text-primary-600">
                No messages match “{messageSearchValue.trim()}”.
              </div>
            ) : hasGroup ? (
              <>
                {hiddenHeadCount > 0 ? (
                  <ShowEarlierMessagesButton
                    hiddenCount={hiddenHeadCount}
                    onExpand={handleExpandHead}
                  />
                ) : null}
                {visibleEntries
                  .slice(hiddenHeadCount, groupStartIndex)
                  .map((entry, index) =>
                    renderMessage(entry, hiddenHeadCount + index),
                  )}
                {/* // Keep the last exchange pinned without extra tail gap. // Account
              for space-y-6 (24px) when pinning. */}
                <div
                  className="my-2 flex flex-col gap-2 md:my-3 md:gap-3"
                  style={{
                    minHeight: `${Math.max(0, pinGroupMinHeight - 12)}px`,
                  }}
                >
                  {visibleEntries.slice(groupStartIndex).map((entry, index) => {
                    const chatMessage = entry.message
                    const realIndex = entry.sourceIndex
                    const entryIndex = groupStartIndex + index
                    const messageIsStreaming = isMessageStreaming(
                      chatMessage,
                      realIndex,
                    )
                    const stableId = getStableMessageId(chatMessage, realIndex)
                    const forceActionsVisible =
                      typeof lastAssistantIndex === 'number' &&
                      realIndex === lastAssistantIndex
                    const wrapperRef =
                      entryIndex === lastUserIndex ? lastUserRef : undefined
                    const wrapperClassName = cn(
                      getMessageSpacingClass(visibleEntries, entryIndex),
                      getToolGroupClass(visibleEntries, entryIndex),
                      entryIndex === lastUserIndex ? 'scroll-mt-0' : '',
                    )
                    const wrapperScrollMarginTop =
                      entryIndex === lastUserIndex ? headerHeight : undefined
                    const hasToolCalls =
                      chatMessage.role === 'assistant' &&
                      (getToolCallsFromMessage(chatMessage).length > 0 ||
                        entry.attachedToolMessages.length > 0)
                    const sharedItemProps = {
                      message: chatMessage,
                      attachedToolMessages: entry.attachedToolMessages,
                      onRetryMessage: onRetryMessage,
                      toolResultsByCallId: hasToolCalls
                        ? toolResultsByCallId
                        : undefined,
                      forceActionsVisible: forceActionsVisible,
                      wrapperRef: wrapperRef,
                      wrapperClassName: wrapperClassName,
                      wrapperScrollMarginTop: wrapperScrollMarginTop,
                      isStreaming: messageIsStreaming,
                      streamingThinking: messageIsStreaming
                        ? streamingThinking
                        : undefined,
                      lifecycleEvents: messageIsStreaming
                        ? lifecycleEvents
                        : undefined,
                      toolDisplayMode: toolDisplayMode,
                      isLastAssistant: forceActionsVisible,
                    }
                    return messageIsStreaming ? (
                      <StreamingMessageItem
                        key={LIVE_STREAM_KEY}
                        {...sharedItemProps}
                      />
                    ) : (
                      <MessageItem key={stableId} {...sharedItemProps} />
                    )
                  })}
                </div>
              </>
            ) : (
              <>
                {hiddenHeadCount > 0 ? (
                  <ShowEarlierMessagesButton
                    hiddenCount={hiddenHeadCount}
                    onExpand={handleExpandHead}
                  />
                ) : null}
                {visibleEntries
                  .slice(hiddenHeadCount)
                  .map((entry, index) =>
                    renderMessage(entry, hiddenHeadCount + index),
                  )}
              </>
            )}
            {/* Bottom shimmer + branch TUI card. Hide as soon as the
                streaming text starts arriving — the per-message TUI card
                above the assistant bubble takes over from there to avoid
                a duplicated activity surface. */}
            {thinkingIndicatorVisible ? (
              <div
                className="flex flex-col gap-1 py-1.5 px-1 animate-in fade-in duration-300 md:gap-1.5 md:py-2"
                role="status"
                aria-live="polite"
              >
                <ThinkingBubble
                  activeToolCalls={activeToolCalls}
                  liveToolActivity={liveToolActivity}
                  isCompacting={isCompacting}
                  liveProgressLabel={liveProgressLabel}
                />
                {/* Branch from the thinking bubble into a single compact
                    TUI-style tool activity card. Use normalized streaming calls
                    so the card appears for both structured tool events and the
                    lighter live activity feed. */}
                {clarifyToolCalls.length > 0 ? (
                  <div className="flex max-w-[var(--chat-content-max-width)]">
                    <div
                      className="ml-[14px] mr-2 w-px shrink-0"
                      style={{
                        background:
                          'linear-gradient(to bottom, color-mix(in srgb, var(--theme-accent) 35%, transparent), color-mix(in srgb, var(--theme-border) 60%, transparent))',
                      }}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1 pt-1">
                      <TuiActivityCard
                        toolSections={attachClarifyCard(
                          clarifyToolCalls.map((tc) => {
                            const phase = tc.phase
                            const isClarifyTool = tc.name.toLowerCase().includes('clarify')
                            const state =
                              phase === 'error'
                                ? ('output-error' as const)
                                : isClarifyTool && clarifyResolved
                                  ? ('output-available' as const)
                                  : phase === 'done'
                                    ? ('output-available' as const)
                                    : phase === 'running'
                                      ? ('input-streaming' as const)
                                      : ('input-available' as const)
                            return {
                              key: tc.id,
                              type: tc.name,
                              input:
                                tc.args &&
                                typeof tc.args === 'object' &&
                                !Array.isArray(tc.args)
                                  ? (tc.args as Record<string, unknown>)
                                  : undefined,
                              preview: tc.preview,
                              outputText:
                                state === 'output-available'
                                  ? tc.result || ''
                                  : '',
                              errorText:
                                state === 'output-error'
                                  ? tc.result || 'Tool failed'
                                  : undefined,
                              state,
                            }
                          }),
                          clarifyReceiptCard,
                          'input-streaming',
                        )}
                        thinking={null}
                        isStreaming={true}
                        formatLabel={(name) => name.replace(/_/g, ' ')}
                        formatArg={(_name, args) => {
                          if (!args) return null
                          const first = Object.values(args).find(
                            (v) => typeof v === 'string' && v.trim(),
                          )
                          return typeof first === 'string'
                            ? first.trim()
                            : null
                        }}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            {commandOutputs}
            {notice && noticePosition === 'end' ? notice : null}
            <ChatContainerScrollAnchor ref={anchorRef} />
          </ChatContainerContent>
        </div>
      </ChatContainerRoot>
    </>
  )
}

function getMessageSpacingClass(
  messages: Array<any>,
  index: number,
): string {
  if (index === 0) return 'mt-0'
  const currentRole = messages[index]?.role ?? 'assistant'
  const previousRole = messages[index - 1]?.role ?? 'assistant'
  if (currentRole === previousRole) {
    return 'mt-1 md:mt-1.5'
  }
  if (currentRole === 'assistant') {
    return 'mt-2 md:mt-2.5'
  }
  return 'mt-2 md:mt-2.5'
}

function getToolGroupClass(
  messages: Array<any>,
  index: number,
): string {
  const message = messages[index]
  if (!message || message.role !== 'assistant') return ''
  const hasToolCalls = getToolCallsFromMessage(message).length > 0
  if (!hasToolCalls) return ''

  let previousUserIndex = -1
  for (let i = index - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') {
      previousUserIndex = i
      break
    }
  }

  let nextUserIndex = -1
  for (let i = index + 1; i < messages.length; i += 1) {
    if (messages[i]?.role === 'user') {
      nextUserIndex = i
      break
    }
  }

  if (previousUserIndex === -1 || nextUserIndex === -1) return ''
  return 'border-l border-primary-200/70 pl-3'
}

// Constant key for the single live streaming bubble. The underlying message
// identity swaps mid-run — synthetic `streaming-current` placeholder ⇄ the real
// assistant row the gateway republishes after each tool/code-execution round —
// so keying the wrapper by its per-message stableId remounts the bubble every
// round, resetting MessageItem's reveal state and re-typing the whole answer
// from scratch (the "streams in a loop while execute code runs" bug). A stable
// key keeps the one live bubble mounted for the stream's lifetime; it flips to
// the real stableId only once, when the message settles.
const LIVE_STREAM_KEY = '__live_stream__'

function getStableMessageId(message: ChatMessage, index: number): string {
  if (message.__optimisticId) return message.__optimisticId

  const idCandidates = ['id', 'messageId', 'uuid', 'clientId'] as const
  for (const key of idCandidates) {
    const value = (message as Record<string, unknown>)[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value
    }
  }

  const timestamp = getRawMessageTimestamp(message)
  if (timestamp) {
    return `${message.role ?? 'assistant'}-${timestamp}-${index}`
  }

  return `${message.role ?? 'assistant'}-${index}`
}

function getRawMessageTimestamp(message: ChatMessage): number | null {
  const candidates = [
    (message as any).createdAt,
    (message as any).created_at,
    (message as any).timestamp,
    (message as any).time,
    (message as any).ts,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      if (candidate < 1_000_000_000_000) return candidate * 1000
      return candidate
    }
    if (typeof candidate === 'string') {
      const parsed = Date.parse(candidate)
      if (!Number.isNaN(parsed)) return parsed
    }
  }
  return null
}

function areChatMessageListEqual(
  prev: ChatMessageListProps,
  next: ChatMessageListProps,
) {
  return (
    prev.messages === next.messages &&
    prev.onRetryMessage === next.onRetryMessage &&
    prev.onReplyMessage === next.onReplyMessage &&
    prev.onRefresh === next.onRefresh &&
    prev.onThinkingIndicatorChange === next.onThinkingIndicatorChange &&
    prev.loading === next.loading &&
    prev.empty === next.empty &&
    prev.emptyState === next.emptyState &&
    prev.notice === next.notice &&
    prev.noticePosition === next.noticePosition &&
    prev.clarifyCard === next.clarifyCard &&
    prev.commandOutputs === next.commandOutputs &&
    prev.waitingForResponse === next.waitingForResponse &&
    prev.sessionKey === next.sessionKey &&
    prev.pinToTop === next.pinToTop &&
    prev.pinGroupMinHeight === next.pinGroupMinHeight &&
    prev.headerHeight === next.headerHeight &&
    prev.contentStyle === next.contentStyle &&
    prev.streamingMessageId === next.streamingMessageId &&
    prev.hasStreamingText === next.hasStreamingText &&
    prev.streamingThinking === next.streamingThinking &&
    prev.lifecycleEvents === next.lifecycleEvents &&
    prev.isStreaming === next.isStreaming &&
    prev.bottomOffset === next.bottomOffset &&
    prev.activeToolCalls === next.activeToolCalls &&
    prev.liveToolActivity === next.liveToolActivity &&
    prev.hideSystemMessages === next.hideSystemMessages &&
    prev.isCompacting === next.isCompacting &&
    prev.liveProgressLabel === next.liveProgressLabel &&
    prev.sending === next.sending &&
    prev.toolDisplayMode === next.toolDisplayMode
  )
}

const MemoizedChatMessageList = memo(
  ChatMessageListComponent,
  areChatMessageListEqual,
)

export { MemoizedChatMessageList as ChatMessageList }
