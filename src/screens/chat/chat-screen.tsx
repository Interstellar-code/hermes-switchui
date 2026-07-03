import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import {
  deriveFriendlyIdFromKey,
  isMissingAuth,
  readError,
  textFromMessage,
} from './utils'
import { resolveNewChatBootstrapSession } from './new-chat-bootstrap'
import {
  advanceStickyStreamingText,
  createOptimisticMessage,
  readMessageText,
  scrollChatToBottom as scrollChatToBottomImpl,
  verbForTool,
} from './chat-screen-utils'
import {
  appendHistoryMessage,
  chatQueryKeys,
  clearHistoryMessages,
  fetchStatus,
  updateHistoryMessageByClientId,
  updateHistoryMessageByClientIdEverywhere,
} from './chat-queries'
import { ChatMessageList } from './components/chat-message-list'
import { ChatNoticeBanners } from './components/chat-notice-banners'
import { StreamingTextContext } from './components/streaming-text-context'
import { ChatEmptyState } from './components/chat-empty-state'
import { ChatComposerShadcn } from './components/chat-composer-shadcn'
import { InlineClarifyCard } from './components/inline-clarify-card'
import { ConnectionStatusMessage } from './components/connection-status-message'
import {
  consumePendingSend,
  hasPendingGeneration,
  hasPendingSend,
  isRecentSession,
  resetPendingSend,
  setPendingGeneration,
} from './pending-send'
import { useChatMeasurements } from './hooks/use-chat-measurements'
import { useChatHistory } from './hooks/use-chat-history'
import { useRealtimeChatHistory } from './hooks/use-realtime-chat-history'
import { useSmoothStreamingText } from './hooks/use-smooth-streaming-text'
import { useStreamingMessage } from './hooks/use-streaming-message'
import {
  isRecoverableActiveRun,
  useActiveRunCheck,
} from './hooks/use-active-run-check'
import { useFocusMode } from './hooks/use-focus-mode'
import { invalidateSessionLists } from './sessions-feed'
import { useToolDisplay } from './hooks/use-tool-display'
import type {
  ChatComposerAttachment,
  ChatComposerHandle,
  ChatComposerHelpers,
} from './components/chat-composer-types'
import type { ChatAttachment, ChatMessage, SessionMeta } from './types'
import type { ChatRunCommandDetail } from './chat-events'
import type {AgentActivity} from '@/stores/chat-activity-store';
import { playChatComplete } from '@/lib/sounds'
import { useChatSettingsStore } from '@/hooks/use-chat-settings'
import { useDrainWatchdog } from './hooks/use-drain-watchdog'
import { useChatMobile } from './hooks/use-chat-mobile'
import { useChatSessions } from './hooks/use-chat-sessions'
import { useAutoSessionTitle } from './hooks/use-auto-session-title'
import { useRenameSession } from './hooks/use-rename-session'
import { useContextAlert } from './hooks/use-context-alert'
import { usePendingApprovals } from './hooks/use-pending-approvals'
import { useSendMessageState } from './hooks/use-send-message-state'
import {
  CHAT_OPEN_SETTINGS_EVENT,
  CHAT_PENDING_COMMAND_STORAGE_KEY,
  CHAT_RUN_COMMAND_EVENT,
} from './chat-events'
import { stripQueuedWrapper } from '@/lib/strip-queued-wrapper'
import { cn } from '@/lib/utils'
import { toast } from '@/components/ui/toast'
import { hapticTap } from '@/lib/haptics'
import { FileExplorerSidebar } from '@/components/file-explorer'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { TerminalPanel } from '@/components/terminal-panel'
import { AgentViewPanel } from '@/components/agent-view/agent-view-panel'
import { ErrorBoundary } from '@/components/error-boundary'
import { useTerminalPanelStore } from '@/stores/terminal-panel-store'
import { useModelSuggestions } from '@/hooks/use-model-suggestions'
import {
  expandUserCommandPrompt,
  findEnabledCommandBySlash,
  useEnabledUserCommands,
} from '@/lib/commands-api'
import { ModelSuggestionToast } from '@/components/model-suggestion-toast'
import { MobileSessionsPanel } from '@/components/mobile-sessions-panel'
import { useThinkingLevel } from './hooks/use-thinking-level'
import { ContextAlertModal } from '@/components/usage-meter/context-alert-modal'
import { ErrorToastContainer, showErrorToast } from '@/components/error-toast'
// ContextMeter removed — ContextBar (PR #32) replaces it
import { useChatStore } from '@/stores/chat-store'
import { useContextUsageStore } from '@/stores/context-usage-store'
import { useResearchCard } from '@/hooks/use-research-card'
// MOBILE_TAB_BAR_OFFSET removed — tab bar always hidden in chat
import { useTapDebug } from '@/hooks/use-tap-debug'
import { useChatMode } from '@/hooks/use-chat-mode'
import {
  
  useChatActivityStore
} from '@/stores/chat-activity-store'
import { ChatHeaderV2 } from './components/v2/chat-header-v2'
import { ChatMetaBarV2 } from './components/v2/chat-meta-bar-v2'
import { ToolTabView } from './components/v2/chat-tab-views-v2'
import { ChatSkillsTabV2 } from './components/v2/chat-skills-tab-v2'

type ChatScreenProps = {
  activeFriendlyId: string
  isNewChat?: boolean
  onSessionResolved?: (payload: {
    sessionKey: string
    friendlyId: string
  }) => void
  forcedSessionKey?: string
  /** Hide header + file explorer + terminal for panel mode */
  compact?: boolean
  /**
   * Disables internal `navigate()` side effects so the chat can be embedded
   * in other routes (e.g. Operations orchestrator card) without yanking the
   * user out to /chat/<uuid> on mount, refresh, or after send.
   */
  embedded?: boolean
}

function normalizeMessageValue(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : ''
}

function sanitizeExportToken(value: string): string {
  return value
    .trim()
    .replace(/[^a-z0-9-_]+/gi, '-')
    .replace(/^-+|-+$/g, '')
}

function exportConversationTranscript(payload: {
  sessionLabel: string
  messages: Array<ChatMessage>
}) {
  if (typeof document === 'undefined') return false

  const sessionToken =
    sanitizeExportToken(payload.sessionLabel) || 'conversation'
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const body = payload.messages
    .map((message) => {
      const role =
        typeof message.role === 'string' && message.role.trim()
          ? message.role.trim().toUpperCase()
          : 'MESSAGE'
      const text = textFromMessage(message).trim()
      const attachments = Array.isArray(message.attachments)
        ? message.attachments
            .map((attachment) => attachment?.name?.trim())
            .filter((value): value is string => Boolean(value))
        : []

      const lines = [`## ${role}`]
      if (text) lines.push(text)
      if (attachments.length > 0) {
        lines.push('', 'Attachments:')
        for (const attachment of attachments) {
          lines.push(`- ${attachment}`)
        }
      }
      return lines.join('\n')
    })
    .join('\n\n')
    .trim()

  const content = `# Hermes Conversation Export\n\nSession: ${payload.sessionLabel}\nExported: ${new Date().toISOString()}\n\n${body || '_No messages in this conversation._'}\n`
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${sessionToken}-${timestamp}.md`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
  return true
}

function messageFallbackSignature(message: ChatMessage): string {
  const raw = message as Record<string, unknown>
  const timestamp = normalizeMessageValue(
    typeof raw.timestamp === 'number' ? String(raw.timestamp) : raw.timestamp,
  )

  const contentParts = Array.isArray(message.content)
    ? message.content
        .map((part: any) => {
          if (part.type === 'text') {
            return `t:${typeof part.text === 'string' ? part.text.trim() : ''}`
          }
          if (part.type === 'thinking') {
            return `th:${typeof part.thinking === 'string' ? part.thinking : ''}`
          }
          if (part.type === 'toolCall') {
            const toolPart = part
            return `tc:${toolPart.id ?? ''}:${toolPart.name ?? ''}`
          }
          return `p:${part.type ?? ''}`
        })
        .join('|')
    : ''

  const attachments = Array.isArray(message.attachments)
    ? message.attachments
        .map((attachment) => {
          const name =
            typeof attachment?.name === 'string' ? attachment.name : ''
          const size =
            typeof attachment?.size === 'number' ? String(attachment.size) : ''
          const type =
            typeof attachment?.contentType === 'string'
              ? attachment.contentType
              : ''
          return `${name}:${size}:${type}`
        })
        .join('|')
    : ''

  return `${message.role ?? 'unknown'}:${timestamp}:${contentParts}:${attachments}`
}

function getMessageClientId(message: ChatMessage): string {
  const raw = message as Record<string, unknown>
  const directClientId = normalizeMessageValue(raw.clientId)
  if (directClientId) return directClientId

  const alternateClientId = normalizeMessageValue(raw.client_id)
  if (alternateClientId) return alternateClientId

  const optimisticId = normalizeMessageValue(raw.__optimisticId)
  if (optimisticId.startsWith('opt-')) {
    return optimisticId.slice(4)
  }
  return ''
}

function getRetryMessageKey(message: ChatMessage): string {
  const clientId = getMessageClientId(message)
  if (clientId) return `client:${clientId}`

  const raw = message as Record<string, unknown>
  const optimisticId = normalizeMessageValue(raw.__optimisticId)
  if (optimisticId) return `optimistic:${optimisticId}`

  const messageId = normalizeMessageValue(raw.id)
  if (messageId) return `id:${messageId}`

  const timestamp = normalizeMessageValue(
    typeof raw.timestamp === 'number' ? String(raw.timestamp) : raw.timestamp,
  )
  const messageText = textFromMessage(message).trim()
  return `fallback:${message.role ?? 'unknown'}:${timestamp}:${messageText}`
}

function isRetryableQueuedMessage(message: ChatMessage): boolean {
  if ((message.role || '') !== 'user') return false
  const raw = message as Record<string, unknown>
  const status = normalizeMessageValue(raw.status)
  return status === 'error'
}

const commandHelpers: ChatComposerHelpers = {
  reset() {},
  setValue() {},
  setAttachments() {},
}

function getMessageRetryAttachments(
  message: ChatMessage,
): Array<ChatAttachment> {
  if (!Array.isArray(message.attachments)) return []
  return message.attachments.filter((attachment) => {
    return Boolean(attachment) && typeof attachment === 'object'
  })
}

function getMessageStatusValue(message: ChatMessage): string {
  return normalizeMessageValue((message as Record<string, unknown>).status)
}

function getMessageTimestampValue(message: ChatMessage): number | null {
  const raw = message as Record<string, unknown>
  const candidates = [
    raw.timestamp,
    raw.__createdAt,
    raw.createdAt,
    raw.created_at,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate < 1_000_000_000_000 ? candidate * 1000 : candidate
    }
    if (typeof candidate === 'string') {
      const parsed = Date.parse(candidate)
      if (!Number.isNaN(parsed)) return parsed
    }
  }

  return null
}

function getMessageAttachmentSignature(message: ChatMessage): string {
  if (!Array.isArray(message.attachments) || message.attachments.length === 0) {
    return ''
  }

  return message.attachments
    .map((attachment) => {
      const name = typeof attachment?.name === 'string' ? attachment.name : ''
      const size =
        typeof attachment?.size === 'number' ? String(attachment.size) : ''
      const type =
        typeof attachment?.contentType === 'string'
          ? attachment.contentType
          : ''
      return `${name}:${size}:${type}`
    })
    .sort()
    .join('|')
}

function isOptimisticUserMessage(message: ChatMessage): boolean {
  const raw = message as Record<string, unknown>
  return (
    normalizeMessageValue(raw.__optimisticId).length > 0 ||
    ['sending', 'sent', 'done'].includes(getMessageStatusValue(message))
  )
}

function shouldCollapseTextDuplicate(
  existing: ChatMessage,
  candidate: ChatMessage,
): boolean {
  if (existing.role !== candidate.role) return false

  if (candidate.role === 'assistant') {
    return true
  }

  if (candidate.role !== 'user') return false

  const existingTs = getMessageTimestampValue(existing)
  const candidateTs = getMessageTimestampValue(candidate)
  if (existingTs !== null && candidateTs !== null) {
    if (Math.abs(existingTs - candidateTs) > 15_000) return false
  }

  // Collapse same-turn user duplicates even after the optimistic marker has been
  // cleared. The send path can leave us with an optimistic local message plus a
  // confirmed/history copy after completion; requiring one side to still look
  // optimistic misses that handoff and leaves both visible.
  const existingSig = getMessageAttachmentSignature(existing)
  const candidateSig = getMessageAttachmentSignature(candidate)
  if (existingSig && candidateSig) {
    return existingSig === candidateSig
  }

  return true
}

function stripQueuedWrapperFromUserMessage(message: ChatMessage): ChatMessage {
  if (message.role !== 'user') return message

  const text = textFromMessage(message)
  const cleanedText = stripQueuedWrapper(text)
  if (cleanedText === text) return message

  return {
    ...message,
    content: [{ type: 'text', text: cleanedText }],
    text: cleanedText,
    body: cleanedText,
    message: cleanedText,
  }
}

export function ChatScreen({
  activeFriendlyId,
  isNewChat = false,
  onSessionResolved,
  forcedSessionKey,
  compact = false,
  embedded = false,
}: ChatScreenProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const userCommandsQuery = useEnabledUserCommands()
  const enabledUserCommands = userCommandsQuery.data
  const [_creatingSession, setCreatingSession] = useState(false)
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isRedirecting, setIsRedirecting] = useState(false)
  const { headerRef, composerRef, mainRef, pinGroupMinHeight, headerHeight } =
    useChatMeasurements()
  useTapDebug(mainRef, { label: 'chat-main' })
  const chatMode = useChatMode()
  const isPortableMode = chatMode === 'portable'
  const portableChatFriendlyId = isPortableMode ? 'main' : activeFriendlyId
  const [liveToolActivity, setLiveToolActivity] = useState<
    Array<{ name: string; timestamp: number }>
  >([])
  const lastAssistantSignature = useRef('')
  const retriedQueuedMessageKeysRef = useRef(new Set<string>())
  const hasSeenDisconnectRef = useRef(false)
  const hadErrorRef = useRef(false)
  const [isCompacting, setIsCompacting] = useState(false)
  const [researchResetKey, setResearchResetKey] = useState(0)
  // Reply-to state — cleared on session change
  const [replyTo, setReplyTo] = useState<{
    seq: number
    role: string
    preview: string
  } | null>(null)
  // System-messages visibility toggle (default: hidden)
  const [hideSystemMessages, setHideSystemMessages] = useState(true)
  const { alertOpen, alertThreshold, alertPercent, dismissAlert } =
    useContextAlert(activeFriendlyId)

  useEffect(() => {
    useContextUsageStore.getState().setSessionKey(activeFriendlyId || null)
  }, [activeFriendlyId])

  // Clear reply-to when the user navigates to a different session.
  useEffect(() => {
    setReplyTo(null)
  }, [activeFriendlyId, isNewChat])

  const pendingStartRef = useRef(false)
  const composerHandleRef = useRef<ChatComposerHandle | null>(null)
  const {
    chatFocusMode,
    isFocusMode,
    fileExplorerCollapsed,
    handleToggleFocusMode,
    handleToggleSidebarCollapse,
    handleToggleFileExplorer,
    handleInsertFileReference,
  } = useFocusMode({ compact, composerHandleRef })
  const { isMobile } = useChatMobile(queryClient)
  const mobileKeyboardInset = useWorkspaceStore((s) => s.mobileKeyboardInset)
  const mobileComposerFocused = useWorkspaceStore(
    (s) => s.mobileComposerFocused,
  )
  const mobileKeyboardActive = mobileKeyboardInset > 0 || mobileComposerFocused
  void mobileKeyboardActive // kept for future use
  const isTerminalPanelOpen = useTerminalPanelStore(
    (state) => state.isPanelOpen,
  )
  const terminalPanelHeight = useTerminalPanelStore(
    (state) => state.panelHeight,
  )
  const { renameSession, renaming: renamingSessionTitle } = useRenameSession()

  const {
    sessionsQuery,
    sessions,
    activeSession,
    activeExists,
    activeSessionKey,
    activeTitle,
    sessionsError,
    sessionsLoading: _sessionsLoading,
    sessionsFetching: _sessionsFetching,
    refetchSessions: _refetchSessions,
  } = useChatSessions({ activeFriendlyId, isNewChat, forcedSessionKey })
  const {
    historyQuery,
    historyMessages,
    messageCount,
    historyError,
    resolvedSessionKey,
    activeCanonicalKey,
    sessionKeyForHistory,
  } = useChatHistory({
    activeFriendlyId: portableChatFriendlyId,
    activeSessionKey,
    forcedSessionKey,
    isNewChat,
    isRedirecting,
    activeExists,
    sessionsReady: sessionsQuery.isSuccess,
    queryClient,
    historyRefetchInterval: 5_000,
    portableMode: isPortableMode,
  })

  const waitingStoreKey = resolvedSessionKey
  const selectWaitingForSession = useCallback(
    (s: ReturnType<typeof useChatStore.getState>) =>
      waitingStoreKey ? s.waitingSessionKeys.has(waitingStoreKey) : false,
    [waitingStoreKey],
  )
  const storeWaitingForSession = useChatStore(selectWaitingForSession)
  // Interactive clarify (P3): subscribe only to the ACTIVE session's clarify
  // entry so background-session clarify events don't re-render this component.
  // resolvedSessionKey is already available here (from useChatHistory above).
  const selectActiveClarify = useCallback(
    (s: ReturnType<typeof useChatStore.getState>) =>
      resolvedSessionKey ? (s.pendingClarify[resolvedSessionKey] ?? null) : null,
    [resolvedSessionKey],
  )
  const activeClarify = useChatStore(selectActiveClarify)
  const waitingForResponse = waitingStoreKey
    ? storeWaitingForSession
    : hasPendingSend() || hasPendingGeneration()

  // activeRealtimeStreamingRef is initialized false here (activeIsRealtimeStreaming
  // is derived later from useRealtimeChatHistory's return, which itself needs
  // applyApprovalRequest from usePendingApprovals — a cycle). It is mirrored to
  // the live value during render at the derivation site below, so E28's first
  // synchronous mount read already sees the correct value.
  const activeRealtimeStreamingRef = useRef(false)

  // --- Bridge refs for sendMessage dependencies (seam #4 PR 2) ---
  // These values are produced by hooks called AFTER useSendMessageState in
  // the render order (due to the waitingForResponseRef → usePendingApprovals
  // → useRealtimeChatHistory chain). They are synced during render right
  // after their source hooks so sendMessage always reads the latest value.
  const thinkingLevelBridgeRef = useRef<string>('off')
  const setLocalActivity = useChatActivityStore((s) => s.setLocalActivity)
  const clearCompletedStreamingRef = useRef<() => void>(() => {})
  const startStreamingRef = useRef<
    (params: {
      sessionKey: string
      friendlyId: string
      message: string
      history?: Array<{
        role: 'user' | 'assistant' | 'system'
        content: string
      }>
      thinking?: string
      fastMode?: boolean
      attachments?: Array<ChatAttachment>
      idempotencyKey?: string
      model?: string
    }) => Promise<void>
  >(async () => {})
  const finalDisplayMessagesRef = useRef<Array<ChatMessage>>([])
  const currentModelRef = useRef<string | undefined>(undefined)

  const {
    sending,
    setSending,
    activeSendRef,
    waitingForResponseRef,
    sessionKeyForWaiting,
    lastSendKeyRef,
    lastSendAtRef,
    streamTimer,
    failsafeTimerRef,
    refreshHistoryRef,
    streamStop,
    streamStart,
    streamFinish,
    setWaitingForResponse,
    syncLastCompletedRunAt,
    sendMessage,
  } = useSendMessageState({
    activeFriendlyId,
    isNewChat,
    waitingForResponse,
    activeRealtimeStreamingRef,
    thinkingLevelRef: thinkingLevelBridgeRef,
    setLocalActivity,
    setError,
    clearCompletedStreamingRef,
    startStreamingRef,
    queryClient,
    finalDisplayMessagesRef,
    currentModelRef,
    setResearchResetKey,
  })

  const activeQueueSessionKey = useMemo(() => {
    if (isPortableMode) return 'main'
    const activeSendSessionKey = activeSendRef.current?.sessionKey
    if (activeSendSessionKey) return activeSendSessionKey
    return (
      forcedSessionKey ||
      resolvedSessionKey ||
      activeSessionKey ||
      activeCanonicalKey ||
      (!isNewChat ? activeFriendlyId : '')
    )
  }, [
    activeCanonicalKey,
    activeFriendlyId,
    activeSessionKey,
    forcedSessionKey,
    isNewChat,
    isPortableMode,
    resolvedSessionKey,
    sending,
    waitingForResponse,
  ])
  const lastQueueSessionKeyRef = useRef('')

  // Keep the waiting-state ref in sync after commit; mutating it during render
  // can create inconsistent reads when React replays renders in DevTools/StrictMode.
  useEffect(() => {
    sessionKeyForWaiting.current = resolvedSessionKey
  }, [resolvedSessionKey])

  useEffect(() => {
    if (activeQueueSessionKey) {
      lastQueueSessionKeyRef.current = activeQueueSessionKey
    }
  }, [activeQueueSessionKey])

  // Snapshot cached history for the recovery predicate. Cheap reference
  // pass; the predicate runs only on mount/relist of the active session.
  const recoveryMessages = (historyQuery.data as { messages?: Array<ChatMessage> })?.messages

  // On remount, check if the server still has an active run for this session.
  // If so, re-set waitingForResponse in the store so the UI shows the spinner.
  // Phase 1.2: also consult the history predicate (clear-only, with F1 guard)
  // to surface the "interrupted" affordance when liveness is silent but the
  // latest user turn was never answered.
  useActiveRunCheck({
    sessionKey: resolvedSessionKey,
    enabled:
      !isNewChat && resolvedSessionKey.length > 0 && historyQuery.isSuccess,
    messages: recoveryMessages,
  })

  const { pendingApprovals, resolvePendingApproval, applyApprovalRequest } =
    usePendingApprovals({ waitingForResponseRef, activeRealtimeStreamingRef })

  // Wire SSE realtime stream for instant message delivery
  const {
    messages: realtimeMessages,
    lastCompletedRunAt,
    isRealtimeStreaming,
    realtimeStreamingText,
    realtimeStreamingThinking,
    realtimeLifecycleEvents,
    completedStreamingText,
    completedStreamingThinking,
    clearCompletedStreaming,
    streamingRunId,
    activeToolCalls,
  } = useRealtimeChatHistory({
    sessionKey: isPortableMode
      ? 'main'
      : isNewChat
        ? 'new'
        : resolvedSessionKey ||
          sessionKeyForHistory ||
          activeCanonicalKey ||
          'main',
    friendlyId: portableChatFriendlyId,
    historyMessages,
    portableMode: isPortableMode,
    enabled:
      // Always enable for new chats in portable mode (no sessions API to resolve).
      // In enhanced mode, wait for session resolution before subscribing.
      ((isPortableMode && isNewChat) ||
        (!isNewChat &&
          Boolean(
            resolvedSessionKey || sessionKeyForHistory || activeCanonicalKey,
          ))) &&
      !isRedirecting,
    onUserMessage: useCallback(() => {
      // External message arrived (e.g. from Telegram) — show thinking indicator
      setWaitingForResponse(true)
      setPendingGeneration(true)
    }, []),
    onApprovalRequest: applyApprovalRequest,
    onCompactionStart: useCallback(() => {
      setIsCompacting(true)
    }, []),
    onCompactionEnd: useCallback(() => {
      setIsCompacting(false)
    }, []),
  })

  // Sync lastCompletedRunAt into the send-message-state hook (decoupled from
  // the realtime-hook → pending-approvals → send-state cycle).
  syncLastCompletedRunAt(lastCompletedRunAt)
  // Sync bridge ref for sendMessage (seam #4 PR 2)
  clearCompletedStreamingRef.current = clearCompletedStreaming

  const {
    activeTab,
    setActiveTab,
    toolDisplayMode,
    cycleToolDisplayMode,
    totalToolCount,
    totalSkillCount,
  } = useToolDisplay({ realtimeMessages, activeToolCalls })

  // Keep activity stream open persistently — opens on mount so it's ready
  // before the first tool call fires (avoids connection latency gap).
  useEffect(() => {
    const events = new EventSource('/api/events')
    const onActivity = (event: MessageEvent) => {
      // Only populate pills while waiting — but connection stays warm always
      if (!waitingForResponseRef.current) return
      try {
        const payload = JSON.parse(event.data) as {
          type?: unknown
          title?: unknown
        }
        if (payload.type !== 'tool' || typeof payload.title !== 'string') {
          return
        }
        const name = payload.title.replace(/^Tool activity:\s*/i, '').trim()
        if (!name) return
        setLiveToolActivity((prev) => {
          const filtered = prev.filter((entry) => entry.name !== name)
          return [{ name, timestamp: Date.now() }, ...filtered].slice(0, 5)
        })
      } catch {
        // Ignore malformed activity events.
      }
    }
    events.addEventListener('activity', onActivity)
    return () => {
      events.removeEventListener('activity', onActivity)
      events.close()
    }
  }, []) // mount only — stays open for session lifetime

  // Clear tool pills after response arrives (with brief delay so last pill is visible)
  useEffect(() => {
    if (waitingForResponse) return
    const timer = window.setTimeout(() => setLiveToolActivity([]), 800)
    return () => window.clearTimeout(timer)
  }, [waitingForResponse])

  useEffect(() => {
    if (!waitingForResponse) return
    clearCompletedStreaming()
  }, [clearCompletedStreaming, waitingForResponse])

  refreshHistoryRef.current = function refreshHistory() {
    if (historyQuery.isFetching) return

    // Snapshot any unconfirmed optimistic user messages BEFORE refetch.
    // The refetch replaces the query cache with server data — if the server
    // hasn't processed the user's POST yet, the optimistic message vanishes.
    const currentMessages = (historyQuery.data as any)?.messages as
      | Array<ChatMessage>
      | undefined
    const pendingOptimistic = (currentMessages ?? []).filter((msg) => {
      const raw = msg as Record<string, unknown>
      return (
        msg.role === 'user' &&
        (normalizeMessageValue(raw.__optimisticId).startsWith('opt-') ||
          normalizeMessageValue(raw.status) === 'sending')
      )
    })

    void historyQuery.refetch().then(() => {
      // Re-inject optimistic messages that weren't in the server response
      if (pendingOptimistic.length === 0) return
      const historySessionKey = isPortableMode
        ? 'main'
        : activeSessionKey ||
          sessionKeyForHistory ||
          resolvedSessionKey ||
          'main'
      if (!portableChatFriendlyId || !historySessionKey) return

      for (const optimistic of pendingOptimistic) {
        appendHistoryMessage(
          queryClient,
          portableChatFriendlyId,
          historySessionKey,
          optimistic,
        )
      }
    })
  }

  const clearTimerRef = useRef<number | null>(null)

  // Issue #43 polling fallback: when waiting but SSE hasn't reconnected,
  // poll the active-run endpoint every 5s to detect completion.
  useEffect(() => {
    if (!waitingForResponse || !resolvedSessionKey) return
    const interval = window.setInterval(async () => {
      try {
        const res = await fetch(
          `/api/sessions/${encodeURIComponent(resolvedSessionKey)}/active-run`,
        )
        if (!res.ok) return
        const data = await res.json()
        if (!data.ok) return
        const hasLocalRuntimeActivity =
          Boolean(activeSendRef.current) || activeRealtimeStreamingRef.current
        // A persisted waiting flag can survive refresh/gateway restart after the
        // actual run has disappeared. Once the server confirms there is no
        // recoverable run and this tab has no local send/stream, clear the stale
        // waiting state instead of letting the thinking bubble self-perpetuate.
        if (!isRecoverableActiveRun(data.run) && !hasLocalRuntimeActivity) {
          streamFinish()
          refreshHistoryRef.current()
        }
      } catch {
        // ignore network errors
      }
    }, 5000)
    return () => window.clearInterval(interval)
  }, [waitingForResponse, resolvedSessionKey, streamFinish])

  // Live progress: while waiting, poll the gateway run and surface a short
  // human summary of what the agent is doing (a tool in flight, tools done, or
  // an assistant-text tail) in the thinking bubble. DISPLAY ONLY — never clears
  // the waiting state. Skips updates while live text is already streaming in.
  const [liveProgressLabel, setLiveProgressLabel] = useState('')
  useEffect(() => {
    if (!waitingForResponse || !resolvedSessionKey) {
      setLiveProgressLabel('')
      return
    }
    const ac = new AbortController()
    const poll = async () => {
      // Always poll while waiting. The thinking bubble that shows this label is
      // already hidden once real assistant text streams in (showTypingIndicator
      // goes false), so we don't need to gate on streaming state here — gating
      // on it made the label go stale during the silent tool phase while the
      // bubble was still visible.
      try {
        const res = await fetch(
          `/api/sessions/${encodeURIComponent(resolvedSessionKey)}/active-run`,
          { signal: ac.signal },
        )
        if (!res.ok) return
        const data = await res.json()
        if (ac.signal.aborted || !data.ok || !data.run) return
        const run = data.run
        const tools: Array<{
          name?: string
          phase?: string
          preview?: string
        }> = Array.isArray(run.toolCalls) ? run.toolCalls : []
        const inFlight = [...tools]
          .reverse()
          .find((t) => t.phase === 'calling' || t.phase === 'running')
        let label = ''
        if (inFlight) {
          label = verbForTool(inFlight.name ?? '')
          // Gateway previews can lead with an emoji/symbol (e.g. "🔎 *");
          // strip leading non-word chars and cap length for a tidy label.
          const preview = (inFlight.preview ?? '')
            .replace(/^[^\p{L}\p{N}/.~_-]+/u, '')
            .replace(/\s+/g, ' ')
            .trim()
          if (preview && preview !== inFlight.name) {
            label = `${label}: ${preview.length > 48 ? `${preview.slice(0, 48)}…` : preview}`
          }
        } else {
          const done = tools.filter(
            (t) =>
              t.phase === 'complete' ||
              t.phase === 'done' ||
              t.phase === 'result',
          ).length
          if (done > 0) {
            label = `Ran ${done} ${done === 1 ? 'tool' : 'tools'}…`
          } else if (
            typeof run.assistantText === 'string' &&
            run.assistantText.trim()
          ) {
            const tail = run.assistantText.trim().replace(/\s+/g, ' ')
            label = tail.length > 80 ? `…${tail.slice(-80)}` : tail
          }
        }
        // Already returned above if aborted; no await since, so safe to set.
        setLiveProgressLabel(label)
      } catch {
        // ignore network/abort errors
      }
    }
    void poll()
    const interval = window.setInterval(poll, 3000)
    return () => {
      ac.abort()
      window.clearInterval(interval)
    }
  }, [waitingForResponse, resolvedSessionKey])

  useAutoSessionTitle({
    friendlyId: activeFriendlyId,
    sessionKey: resolvedSessionKey,
    activeSession,
    messages: historyMessages,
    messageCount,
    enabled:
      !isNewChat && Boolean(resolvedSessionKey) && historyQuery.isSuccess,
  })

  // C6: thinking-level + model-query cluster
  const {
    thinkingLevel,
    thinkingLevelRef,
    handleThinkingLevelChange,
    currentModel,
    availableModelIds,
    modelsQuery,
    currentModelQuery,
  } = useThinkingLevel({ activeFriendlyId, resolvedSessionKey, forcedSessionKey })

  // Sync bridge refs for sendMessage (seam #4 PR 2)
  thinkingLevelBridgeRef.current = thinkingLevel
  currentModelRef.current = currentModel

  const { suggestion, dismiss, dismissForSession } = useModelSuggestions({
    currentModel, // Real model from session-status (fail closed if empty)
    sessionKey: resolvedSessionKey || 'main',
    messages: historyMessages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: textFromMessage(m),
    })),
    availableModels: availableModelIds,
  })

  const {
    isStreaming: localIsStreaming,
    streamingText: localStreamingText,
    streamingMessageId: localStreamingMessageId,
    startStreaming,
    cancelStreaming,
  } = useStreamingMessage({
    onSessionResolved: useCallback(
      ({
        sessionKey,
        friendlyId,
      }: {
        sessionKey: string
        friendlyId: string
      }) => {
        const activeSend = activeSendRef.current
        if (activeSend) {
          activeSendRef.current = {
            ...activeSend,
            sessionKey,
            friendlyId,
          }
        }
        if (
          sessionKey === activeFriendlyId &&
          friendlyId === activeFriendlyId
        ) {
          return
        }
        onSessionResolved?.({ sessionKey, friendlyId })
      },
      [activeFriendlyId, onSessionResolved],
    ),
    onStarted: useCallback(
      ({ runId }: { runId: string | null }) => {
        const activeSend = activeSendRef.current
        if (!activeSend?.clientId) return
        updateHistoryMessageByClientIdEverywhere(
          queryClient,
          activeSend.clientId,
          (message) => ({
            ...message,
            status: 'sent',
            runId: runId ?? message.runId,
          }),
        )
        setSending(false)
      },
      [queryClient],
    ),
    onComplete: useCallback(() => {
      const activeSend = activeSendRef.current
      if (activeSend?.clientId) {
        updateHistoryMessageByClientIdEverywhere(
          queryClient,
          activeSend.clientId,
          (message) => ({
            ...message,
            status: 'done',
          }),
        )
      }
      activeSendRef.current = null
      refreshHistoryRef.current()
      setSending(false)
      // Invalidate both session-list caches so the session moves into today's
      // bucket immediately after the assistant response completes (last_active is
      // freshest at this point — gateway updatedAt reflects the just-finished turn) (#218).
      invalidateSessionLists(queryClient)
      // Clear waitingForResponse so ThinkingBubble hides and message renders
      streamFinish()
      // Play notification sound if the user opted in (Settings → Chat).
      // Read directly from the store to avoid re-creating this callback on every settings change.
      if (useChatSettingsStore.getState().settings.soundOnChatComplete) {
        playChatComplete()
      }
    }, [queryClient, streamFinish]),
    onError: useCallback(
      (messageText: string) => {
        const activeSend = activeSendRef.current
        if (activeSend?.clientId && !isMissingAuth(messageText)) {
          updateHistoryMessageByClientIdEverywhere(
            queryClient,
            activeSend.clientId,
            (message) => ({
              ...message,
              status: 'error',
            }),
          )
        }
        activeSendRef.current = null
        setSending(false)
        if (isMissingAuth(messageText)) {
          // Clear waiting before the early return — otherwise an auth-failure
          // error strands waitingSessionKeys for the full 120s TTL and the
          // composer shows a stuck spinner if the user returns to the session
          // within that window. See #120.
          setPendingGeneration(false)
          setWaitingForResponse(false)
          if (!embedded) {
            try {
              navigate({ to: '/', replace: true })
            } catch {
              /* router not ready */
            }
          }
          return
        }
        const errorMessage = `Failed to send message. ${messageText}`
        setError(errorMessage)
        toast('Failed to send message', { type: 'error' })
        showErrorToast(messageText)
        setPendingGeneration(false)
        setWaitingForResponse(false)
      },
      [navigate, queryClient],
    ),
    onMessageAccepted: useCallback(
      (_sessionKey: string, friendlyId: string, clientId: string) => {
        // HTTP 200 received — server accepted the message. Clear "sending"
        // status immediately so the Retry timer never fires. This is the
        // primary confirmation path since the server does NOT echo user
        // messages back via SSE.
        updateHistoryMessageByClientId(
          queryClient,
          friendlyId,
          _sessionKey,
          clientId,
          (message) => ({
            ...message,
            status: 'queued',
          }),
        )
        updateHistoryMessageByClientIdEverywhere(
          queryClient,
          clientId,
          (message) => ({
            ...message,
            status: 'queued',
          }),
        )
      },
      [queryClient],
    ),
    onAbort: useCallback(() => {
      activeSendRef.current = null
      setSending(false)
      setPendingGeneration(false)
      setWaitingForResponse(false)
    }, [setWaitingForResponse]),
    acceptedTimeoutMs: modelsQuery.data?.streamAcceptedTimeoutMs,
    handoffTimeoutMs: modelsQuery.data?.streamHandoffTimeoutMs,
  })

  // Sync bridge ref for sendMessage (seam #4 PR 2)
  startStreamingRef.current = startStreaming

  // Cancel any in-flight stream when the user navigates between sessions or
  // starts a new chat. Without this, an SSE stream from session A keeps
  // running after the user navigates away — and any chunks it had already
  // buffered before abort takes effect could land in session B. See #297.
  // useStreamingMessage also has a generation-token guard for the buffered
  // chunk race, but cancelling here is the cleaner navigation contract.
  const navCancelKeyRef = useRef<string | null>(null)
  useEffect(() => {
    const navKey = `${activeCanonicalKey}::${isNewChat ? 'new' : activeFriendlyId}`
    if (navCancelKeyRef.current === null) {
      navCancelKeyRef.current = navKey
      return
    }
    if (navCancelKeyRef.current !== navKey) {
      navCancelKeyRef.current = navKey
      cancelStreaming()
    }
  }, [activeCanonicalKey, activeFriendlyId, isNewChat, cancelStreaming])

  const activeIsRealtimeStreaming = isPortableMode
    ? localIsStreaming
    : isRealtimeStreaming
  // Mirror the latest value into the ref during render (not in an effect) so
  // usePendingApprovals' E28 poller — whose effect runs before any effect
  // declared here — reads the correct value on its first synchronous mount
  // check, preserving the 2 s active-stream cadence when mounting onto an
  // already-active stream.
  activeRealtimeStreamingRef.current = activeIsRealtimeStreaming
  const activeRealtimeStreamingText = isPortableMode
    ? localStreamingText
    : realtimeStreamingText
  const smoothActiveStreamingText = useSmoothStreamingText(
    activeRealtimeStreamingText,
    activeIsRealtimeStreaming,
  )
  const stickyStreamingTextRef = useRef<{ runId: string | null; text: string }>(
    {
      runId: null,
      text: '',
    },
  )
  stickyStreamingTextRef.current = advanceStickyStreamingText({
    isStreaming: activeIsRealtimeStreaming,
    runId: streamingRunId ?? null,
    rawText: activeRealtimeStreamingText,
    smoothedText: smoothActiveStreamingText,
    previousState: stickyStreamingTextRef.current,
  })
  const stableActiveStreamingText = activeIsRealtimeStreaming
    ? smoothActiveStreamingText ||
      activeRealtimeStreamingText ||
      stickyStreamingTextRef.current.text
    : ''

  // Use realtime-merged messages for display (SSE + history)
  // Re-apply display filter to realtime messages
  const finalDisplayMessages = useMemo(() => {
    const filtered = realtimeMessages.filter((msg) => {
      if (msg.role === 'user') {
        const text = stripQueuedWrapper(textFromMessage(msg))
        if (text.startsWith('A subagent task')) return false
        return true
      }
      if (msg.role === 'assistant') {
        if (msg.__streamingStatus === 'streaming') return true
        if ((msg as any).__optimisticId && !msg.content?.length) return true
        if (textFromMessage(msg).trim().length > 0) return true
        const content = Array.isArray(msg.content) ? msg.content : []
        const hasToolCalls = content.some((part) => part.type === 'toolCall')
        const hasStreamToolCalls =
          Array.isArray((msg as any).__streamToolCalls) &&
          (msg as any).__streamToolCalls.length > 0
        return hasToolCalls || hasStreamToolCalls
      }
      return false
    })

    const sortedForDedup = [...filtered].sort((a, b) => {
      const aRaw = a as Record<string, unknown>
      const bRaw = b as Record<string, unknown>
      const aIsOptimistic =
        normalizeMessageValue(aRaw.__optimisticId).startsWith('opt-') &&
        !normalizeMessageValue(aRaw.id)
      const bIsOptimistic =
        normalizeMessageValue(bRaw.__optimisticId).startsWith('opt-') &&
        !normalizeMessageValue(bRaw.id)
      if (aIsOptimistic && !bIsOptimistic) return 1
      if (!aIsOptimistic && bIsOptimistic) return -1
      return 0
    })

    const seen = new Set<string>()
    const seenByText = new Map<string, ChatMessage>()
    const dedupedSet = new Set<ChatMessage>()
    for (const msg of sortedForDedup) {
      const raw = msg as Record<string, unknown>
      const rawOptimisticId = normalizeMessageValue(raw.__optimisticId)
      const bareOptimisticUuid = rawOptimisticId.startsWith('opt-')
        ? rawOptimisticId.slice(4)
        : ''
      const idCandidates = [
        normalizeMessageValue(raw.id),
        normalizeMessageValue(raw.messageId),
        normalizeMessageValue(raw.clientId),
        normalizeMessageValue(raw.client_id),
        normalizeMessageValue(raw.nonce),
        normalizeMessageValue(raw.idempotencyKey),
        bareOptimisticUuid,
        rawOptimisticId,
      ].filter(Boolean)

      const primaryKey =
        idCandidates.length > 0
          ? `${msg.role}:id:${idCandidates[0]}`
          : `${msg.role}:fallback:${messageFallbackSignature(msg)}`

      if (seen.has(primaryKey)) continue

      const text = stripQueuedWrapper(textFromMessage(msg)).trim()
      if (text.length > 0) {
        const normalizedText = text.replace(/\s+/g, ' ')
        const textKey = `${msg.role}:text:${normalizedText}`
        const existingTextMatch = seenByText.get(textKey)
        if (
          existingTextMatch &&
          shouldCollapseTextDuplicate(existingTextMatch, msg)
        ) {
          continue
        }
        if (!existingTextMatch) {
          seenByText.set(textKey, msg)
        }
      }

      seen.add(primaryKey)
      for (const candidate of idCandidates.slice(1)) {
        seen.add(`${msg.role}:id:${candidate}`)
      }
      dedupedSet.add(msg)
    }

    const deduped = filtered
      .filter((msg) => dedupedSet.has(msg))
      .map((msg) => stripQueuedWrapperFromUserMessage(msg))

    if (!activeIsRealtimeStreaming) {
      return deduped
    }

    const nextMessages = [...deduped]
    const streamToolCalls = activeToolCalls.map((toolCall) => ({
      ...toolCall,
      phase: toolCall.phase,
    }))

    // The live streaming text is intentionally NOT baked into the array here.
    // Embedding the per-frame text (stableActiveStreamingText) would change the
    // memo's output identity on every requestAnimationFrame tick (~60×/sec),
    // forcing ChatMessageList — and its full filter/dedup/sort/group/signature
    // pipeline — to recompute over the entire message set each frame (#212).
    // Instead the placeholder carries STABLE content and the live text reaches
    // the streaming bubble exclusively via the dedicated `streamingText` prop on
    // ChatMessageList → MessageItem. The `streamingText` prop on MessageItem
    // takes precedence over message.__streamingText, so the typewriter reveal is
    // driven entirely by that prop path and only the streaming leaf re-renders.
    const streamingMsg = {
      role: 'assistant',
      content: [],
      __optimisticId: 'streaming-current',
      __streamingStatus: 'streaming',
      __streamingText: '',
      __streamingThinking: realtimeStreamingThinking,
      __streamToolCalls: streamToolCalls,
    } as ChatMessage

    const existingStreamIdx = nextMessages.findIndex(
      (message) => message.__streamingStatus === 'streaming',
    )

    if (existingStreamIdx >= 0) {
      nextMessages[existingStreamIdx] = {
        ...nextMessages[existingStreamIdx],
        ...streamingMsg,
      }
      return nextMessages
    }

    const lastUserIdx = nextMessages.reduce(
      (lastIdx, msg, idx) => (msg.role === 'user' ? idx : lastIdx),
      -1,
    )
    if (lastUserIdx >= 0 && lastUserIdx === nextMessages.length - 1) {
      nextMessages.push(streamingMsg)
    } else if (lastUserIdx >= 0) {
      nextMessages.splice(lastUserIdx + 1, 0, streamingMsg)
    } else {
      nextMessages.push(streamingMsg)
    }
    return nextMessages
    // NOTE: activeRealtimeStreamingText / stableActiveStreamingText are
    // deliberately excluded from deps. The per-frame live text must NOT change
    // this array's identity (#212); it flows to the streaming bubble via the
    // dedicated `streamingText` prop on ChatMessageList instead.
  }, [
    activeToolCalls,
    activeIsRealtimeStreaming,
    realtimeMessages,
    realtimeStreamingThinking,
  ])

  // Sync bridge ref for sendMessage (seam #4 PR 2)
  finalDisplayMessagesRef.current = finalDisplayMessages

  const derivedStreamingInfo = useMemo(() => {
    if (activeIsRealtimeStreaming) {
      const last = finalDisplayMessages[finalDisplayMessages.length - 1]
      const id = isPortableMode
        ? localStreamingMessageId
        : last?.role === 'assistant'
          ? (last as any).__optimisticId || (last as any).id || null
          : null
      return { isStreaming: true, streamingMessageId: id }
    }
    if (waitingForResponse && finalDisplayMessages.length > 0) {
      const last = finalDisplayMessages[finalDisplayMessages.length - 1]
      if (last && last.role === 'assistant') {
        const isStreamingPlaceholder =
          (last as any).__streamingStatus === 'streaming'
        if (!isStreamingPlaceholder) {
          return {
            isStreaming: false,
            streamingMessageId: null as string | null,
          }
        }
        const id = (last as any).__optimisticId || (last as any).id || null
        return { isStreaming: true, streamingMessageId: id }
      }
    }
    return { isStreaming: false, streamingMessageId: null as string | null }
  }, [
    waitingForResponse,
    finalDisplayMessages,
    activeIsRealtimeStreaming,
    isPortableMode,
    localStreamingMessageId,
  ])
  // Phase 2.2 cutover (complete): selectIsComposerBusy is the sole composer
  // busy signal, read reactively so runPhase transitions re-render the
  // composer. Returns a boolean primitive — safe as a Zustand selector.
  const isComposerLoading = useChatStore((s) =>
    s.selectIsComposerBusy(
      resolvedSessionKey,
      { hasActiveSend: Boolean(activeSendRef.current) },
      {
        activeIsRealtimeStreaming,
        derivedIsStreaming: derivedStreamingInfo.isStreaming,
      },
      {
        hasPendingSend: hasPendingSend(),
        hasPendingGeneration: hasPendingGeneration(),
      },
    ),
  )
  const isComposerLoadingRef = useRef(isComposerLoading)

  const messageCountAtSendRef = useRef(0)
  const lastAssistantIdAtSendRef = useRef<string | null>(null)
  const prevIsRealtimeStreamingRef = useRef(activeIsRealtimeStreaming)

  useEffect(() => {
    isComposerLoadingRef.current = isComposerLoading
  }, [isComposerLoading])

  useEffect(() => {
    if (waitingForResponse) {
      messageCountAtSendRef.current = finalDisplayMessages.length
      const lastMsg = finalDisplayMessages[finalDisplayMessages.length - 1]
      if (lastMsg?.role === 'assistant') {
        const raw = lastMsg as Record<string, unknown>
        lastAssistantIdAtSendRef.current = String(
          raw.__optimisticId ??
            raw.id ??
            raw.messageId ??
            raw.__realtimeSequence ??
            '',
        )
      } else {
        lastAssistantIdAtSendRef.current = null
      }
    }
  }, [waitingForResponse, finalDisplayMessages])

  useEffect(() => {
    if (!waitingForResponse) {
      if (clearTimerRef.current) {
        window.clearTimeout(clearTimerRef.current)
        clearTimerRef.current = null
      }
      return
    }
    const last = finalDisplayMessages[finalDisplayMessages.length - 1]
    if (!last || last.role !== 'assistant') return
    if ((last as any).__streamingStatus === 'streaming') return
    const countGrew =
      finalDisplayMessages.length > messageCountAtSendRef.current
    const raw = last as Record<string, unknown>
    const currentId = String(
      raw.__optimisticId ??
        raw.id ??
        raw.messageId ??
        raw.__realtimeSequence ??
        '',
    )
    const identityChanged =
      currentId.length > 0 &&
      currentId !== (lastAssistantIdAtSendRef.current ?? '')
    const noAssistantAtSend = lastAssistantIdAtSendRef.current === null
    if (countGrew || identityChanged || noAssistantAtSend) {
      if (clearTimerRef.current) return
      clearTimerRef.current = window.setTimeout(() => {
        clearTimerRef.current = null
        streamFinish()
      }, 50)
    }
  }, [finalDisplayMessages, waitingForResponse, streamFinish])

  useEffect(() => {
    const wasStreaming = prevIsRealtimeStreamingRef.current
    prevIsRealtimeStreamingRef.current = activeIsRealtimeStreaming
    if (wasStreaming && !activeIsRealtimeStreaming && waitingForResponse) {
      if (clearTimerRef.current) return
      clearTimerRef.current = window.setTimeout(() => {
        clearTimerRef.current = null
        streamFinish()
      }, 100)
    }
  }, [activeIsRealtimeStreaming, waitingForResponse, streamFinish])

  const handleSwitchModel = useCallback(async () => {
    if (!suggestion) return

    try {
      const res = await fetch('/api/model-switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionKey: resolvedSessionKey || 'main',
          model: suggestion.suggestedModel,
        }),
      })

      if (res.ok) {
        dismiss()
        // Optionally show success toast or update UI
      }
    } catch (err) {
      setError(
        `Failed to switch model. ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }, [suggestion, resolvedSessionKey, dismiss])

  // Sync chat activity to global store for sidebar orchestrator avatar
  useEffect(() => {
    if (liveToolActivity.length > 0) {
      setLocalActivity('tool-use')
    } else if (activeIsRealtimeStreaming) {
      setLocalActivity('responding')
    } else if (waitingForResponse) {
      setLocalActivity('thinking')
    } else {
      setLocalActivity('idle')
    }
  }, [
    waitingForResponse,
    activeIsRealtimeStreaming,
    liveToolActivity,
    setLocalActivity,
  ])

  const statusQuery = useQuery({
    queryKey: ['claude', 'status'],
    queryFn: fetchStatus,
    retry: 2,
    retryDelay: 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: true,
    staleTime: 30_000,
    refetchInterval: 60_000, // Re-check every 60s to clear stale errors
  })
  const serverError = sessionsError ?? historyError
  const serverErrorStatus: number | undefined = undefined
  const showErrorNotice = Boolean(serverError) && !isNewChat
  const handleRefetch = useCallback(() => {
    void statusQuery.refetch()
    void sessionsQuery.refetch()
    void historyQuery.refetch()
  }, [statusQuery, sessionsQuery, historyQuery])

  const handleRefreshHistory = useCallback(() => {
    void historyQuery.refetch()
  }, [historyQuery])

  useEffect(() => {
    const handleRefreshRequest = () => {
      void historyQuery.refetch()
    }
    window.addEventListener('claude:chat-refresh', handleRefreshRequest)
    return () => {
      window.removeEventListener('claude:chat-refresh', handleRefreshRequest)
    }
  }, [historyQuery])

  // Overlap guard: ensures at most one poll-until-done loop runs at a time.
  const returnPollActiveRef = useRef(false)

  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState !== 'visible') return
      // Always do one immediate refetch on return (existing behaviour).
      void historyQuery.refetch()

      // Issue #208 (RC2): if the session is still waiting for a response when
      // the tab becomes visible again, one refetch may not be enough — the
      // answer might not be committed to history yet.  Start a bounded poll
      // loop (up to 20 × 3 s = 60 s) that keeps re-fetching until the
      // answer lands (waitingForResponse clears) or the cap is hit.
      if (!waitingForResponseRef.current) return
      if (returnPollActiveRef.current) return // another loop already running
      returnPollActiveRef.current = true
      let attempt = 0
      const POLL_INTERVAL_MS = 3_000
      const POLL_MAX_ATTEMPTS = 20
      function scheduleNext() {
        if (!returnPollActiveRef.current) return // cleanup cancelled us
        if (!waitingForResponseRef.current) {
          returnPollActiveRef.current = false
          return // answer arrived — stop
        }
        if (attempt >= POLL_MAX_ATTEMPTS) {
          returnPollActiveRef.current = false
          return // cap reached — stop
        }
        attempt++
        window.setTimeout(() => {
          void historyQuery.refetch()
          scheduleNext()
        }, POLL_INTERVAL_MS)
      }
      scheduleNext()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      returnPollActiveRef.current = false // cancel any in-flight loop
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [historyQuery]) // waitingForResponseRef is a stable ref — no dep needed

  // Re-mount catch-up: when navigating back to chat from another tab (Skills,
  // Memory, etc.), the component re-mounts. If a response finished while we
  // were away, the initial refetch may hit stale data.  When still waiting,
  // run the same bounded poll loop so we keep retrying until the answer lands.
  // See: https://github.com/outsourc-e/hermes-workspace/issues/43, #208
  useEffect(() => {
    // Always schedule the original 2 s delayed refetch.
    const timer = window.setTimeout(() => {
      void historyQuery.refetch()
    }, 2000)

    // If waiting, also start the bounded poll loop (guard against overlap with
    // the visibilitychange loop via the shared returnPollActiveRef).
    if (waitingForResponseRef.current && !returnPollActiveRef.current) {
      returnPollActiveRef.current = true
      let attempt = 0
      const POLL_INTERVAL_MS = 3_000
      const POLL_MAX_ATTEMPTS = 20
      function scheduleNext() {
        if (!returnPollActiveRef.current) return
        if (!waitingForResponseRef.current) {
          returnPollActiveRef.current = false
          return
        }
        if (attempt >= POLL_MAX_ATTEMPTS) {
          returnPollActiveRef.current = false
          return
        }
        attempt++
        window.setTimeout(() => {
          void historyQuery.refetch()
          scheduleNext()
        }, POLL_INTERVAL_MS)
      }
      scheduleNext()
    }

    return () => {
      window.clearTimeout(timer)
      returnPollActiveRef.current = false
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- mount-only; waitingForResponseRef + returnPollActiveRef are stable refs

  const terminalPanelInset =
    !isMobile && isTerminalPanelOpen && !chatFocusMode ? terminalPanelHeight : 0
  // --chat-composer-height is the measured offsetHeight of the composer wrapper,
  // which already includes its own paddingBottom (tab bar + safe area).
  // So content just needs composer-height + a small breathing gap.
  const mobileScrollBottomOffset = useMemo(() => {
    if (!isMobile) return 0
    return 'var(--chat-composer-height, 56px)'
  }, [isMobile])

  // Keep message list clear of composer, keyboard, and desktop terminal panel.
  const stableContentStyle = useMemo<React.CSSProperties>(() => {
    if (isMobile) {
      return {
        paddingBottom: 'calc(var(--chat-composer-height, 56px) + 8px)',
      }
    }
    return {
      paddingBottom:
        terminalPanelInset > 0 ? `${terminalPanelInset + 16}px` : '16px',
    }
  }, [isMobile, terminalPanelInset])

  const shouldRedirectToNew =
    !isNewChat &&
    !forcedSessionKey &&
    !isRecentSession(activeFriendlyId) &&
    sessionsQuery.isSuccess &&
    sessions.length > 0 &&
    !sessions.some((session) => session.friendlyId === activeFriendlyId) &&
    !historyQuery.isFetching &&
    !historyQuery.isSuccess

  useEffect(() => {
    if (isRedirecting) {
      if (error) setError(null)
      return
    }
    if (shouldRedirectToNew) {
      if (error) setError(null)
      return
    }
    if (
      sessionsQuery.isSuccess &&
      !activeExists &&
      !sessionsError &&
      !historyError
    ) {
      if (error) setError(null)
      return
    }
    const messageText = sessionsError ?? historyError
    if (!messageText) {
      if (error?.startsWith('Failed to load')) {
        setError(null)
      }
      return
    }
    if (isMissingAuth(messageText) && !embedded) {
      navigate({ to: '/', replace: true })
    }
    const message = sessionsError
      ? `Failed to load sessions. ${sessionsError}`
      : historyError
        ? `Failed to load history. ${historyError}`
        : null
    if (message) setError(message)
  }, [
    activeExists,
    error,
    historyError,
    isRedirecting,
    navigate,
    sessionsError,
    sessionsQuery.isSuccess,
    shouldRedirectToNew,
  ])

  useEffect(() => {
    if (!isRedirecting) return
    if (isNewChat) {
      setIsRedirecting(false)
      return
    }
    if (!shouldRedirectToNew && sessionsQuery.isSuccess) {
      setIsRedirecting(false)
    }
  }, [isNewChat, isRedirecting, sessionsQuery.isSuccess, shouldRedirectToNew])

  useEffect(() => {
    if (embedded) return
    if (isNewChat) return
    if (!sessionsQuery.isSuccess) return
    if (sessions.length === 0) return
    if (!shouldRedirectToNew) return
    resetPendingSend()
    clearHistoryMessages(queryClient, activeFriendlyId, sessionKeyForHistory)
    const latestSession = sessions[0]?.friendlyId ?? 'new'
    navigate({
      to: '/chat/$sessionKey',
      params: { sessionKey: latestSession },
      replace: true,
    })
  }, [
    activeFriendlyId,
    historyQuery.isFetching,
    historyQuery.isSuccess,
    isNewChat,
    navigate,
    queryClient,
    sessionKeyForHistory,
    sessions,
    sessionsQuery.isSuccess,
    shouldRedirectToNew,
    embedded,
  ])

  const hideUi = shouldRedirectToNew || isRedirecting
  const showComposer = !isRedirecting

  // Reset state when session changes
  useEffect(() => {
    const resetKey = isNewChat ? 'new' : activeFriendlyId
    if (!resetKey) return
    retriedQueuedMessageKeysRef.current.clear()
    if (pendingStartRef.current) {
      pendingStartRef.current = false
      return
    }
    if (hasPendingSend() || hasPendingGeneration()) {
      setWaitingForResponse(true)
      return
    }
    streamStop()
    lastAssistantSignature.current = ''
    setWaitingForResponse(false)
  }, [activeFriendlyId, isNewChat, streamStop])

  useLayoutEffect(() => {
    if (isNewChat) return
    const pending = consumePendingSend(
      isPortableMode
        ? 'main'
        : forcedSessionKey || resolvedSessionKey || activeSessionKey,
      portableChatFriendlyId,
    )
    if (!pending) return
    pendingStartRef.current = true
    const historyKey = chatQueryKeys.history(
      pending.friendlyId,
      pending.sessionKey,
    )
    const cached = queryClient.getQueryData(historyKey)
    const cachedMessages = Array.isArray((cached as any)?.messages)
      ? (cached as any).messages
      : []
    const alreadyHasOptimistic = cachedMessages.some((message: any) => {
      if (pending.optimisticMessage.clientId) {
        if (message.clientId === pending.optimisticMessage.clientId) return true
        if (message.__optimisticId === pending.optimisticMessage.clientId)
          return true
      }
      if (pending.optimisticMessage.__optimisticId) {
        if (message.__optimisticId === pending.optimisticMessage.__optimisticId)
          return true
      }
      return false
    })
    if (!alreadyHasOptimistic) {
      appendHistoryMessage(
        queryClient,
        pending.friendlyId,
        pending.sessionKey,
        pending.optimisticMessage,
      )
    }
    setWaitingForResponse(true)
    sendMessage(
      pending.sessionKey,
      pending.friendlyId,
      pending.message,
      pending.attachments,
      false,
      true,
      typeof pending.optimisticMessage.clientId === 'string'
        ? pending.optimisticMessage.clientId
        : '',
    )
  }, [
    activeSessionKey,
    forcedSessionKey,
    isNewChat,
    isPortableMode,
    portableChatFriendlyId,
    queryClient,
    resolvedSessionKey,
    sendMessage,
  ])

  const retryQueuedMessage = useCallback(
    function retryQueuedMessage(message: ChatMessage, mode: 'manual' | 'auto') {
      if (!isRetryableQueuedMessage(message)) return false

      const body = textFromMessage(message).trim()
      const attachments = getMessageRetryAttachments(message)
      if (body.length === 0 && attachments.length === 0) return false

      const retryKey = getRetryMessageKey(message)
      if (
        mode === 'auto' &&
        retriedQueuedMessageKeysRef.current.has(retryKey)
      ) {
        return false
      }

      const sessionKeyForSend = isPortableMode
        ? 'main'
        : forcedSessionKey || resolvedSessionKey || activeSessionKey || 'main'
      const sessionKeyForMessage = sessionKeyForHistory || sessionKeyForSend
      const existingClientId = getMessageClientId(message)

      if (existingClientId) {
        updateHistoryMessageByClientId(
          queryClient,
          portableChatFriendlyId,
          sessionKeyForMessage,
          existingClientId,
          function markSending(currentMessage) {
            return { ...currentMessage, status: 'sending' }
          },
        )
        updateHistoryMessageByClientIdEverywhere(
          queryClient,
          existingClientId,
          function markSendingEverywhere(currentMessage) {
            return { ...currentMessage, status: 'sending' }
          },
        )
      }

      if (mode === 'auto') {
        retriedQueuedMessageKeysRef.current.add(retryKey)
      }

      sendMessage(
        sessionKeyForSend,
        portableChatFriendlyId,
        body,
        attachments,
        false,
        true,
        existingClientId,
      )
      return true
    },
    [
      activeSessionKey,
      forcedSessionKey,
      isPortableMode,
      portableChatFriendlyId,
      queryClient,
      resolvedSessionKey,
      sessionKeyForHistory,
      sendMessage,
    ],
  )

  const flushRetryableMessages = useCallback(
    function flushRetryableMessages() {
      for (const message of finalDisplayMessages) {
        retryQueuedMessage(message, 'auto')
      }
    },
    [finalDisplayMessages, retryQueuedMessage],
  )

  const handleRetryMessage = useCallback(
    function handleRetryMessage(message: ChatMessage) {
      const retryKey = getRetryMessageKey(message)
      retriedQueuedMessageKeysRef.current.delete(retryKey)
      retryQueuedMessage(message, 'manual')
    },
    [retryQueuedMessage],
  )

  useEffect(() => {
    if (false) {
      // Server connection checks removed — Hermes Agent uses direct API
      hasSeenDisconnectRef.current = true
      retriedQueuedMessageKeysRef.current.clear()
      return
    }

    if (hasSeenDisconnectRef.current) {
      hasSeenDisconnectRef.current = false
      flushRetryableMessages()
    }
  }, [flushRetryableMessages])

  useEffect(() => {
    const isHealthy = statusQuery.data?.ok === true
    if (isHealthy && hadErrorRef.current) {
      hadErrorRef.current = false
      flushRetryableMessages()
    }
  }, [flushRetryableMessages, statusQuery.data])

  useEffect(() => {
    function handleHealthRestored() {
      retriedQueuedMessageKeysRef.current.clear()
      hadErrorRef.current = false
      flushRetryableMessages()
      handleRefetch()
    }

    window.addEventListener('claude:health-restored', handleHealthRestored)
    return () => {
      window.removeEventListener('claude:health-restored', handleHealthRestored)
    }
  }, [flushRetryableMessages, handleRefetch])

  const createSessionForMessage = useCallback(
    async (preferredFriendlyId?: string) => {
      setCreatingSession(true)
      try {
        const res = await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(
            preferredFriendlyId && preferredFriendlyId.trim().length > 0
              ? { friendlyId: preferredFriendlyId }
              : {},
          ),
        })
        if (!res.ok) throw new Error(await readError(res))

        const data = (await res.json()) as {
          sessionKey?: string
          friendlyId?: string
        }

        const sessionKey =
          typeof data.sessionKey === 'string' ? data.sessionKey : ''
        const friendlyId =
          typeof data.friendlyId === 'string' &&
          data.friendlyId.trim().length > 0
            ? data.friendlyId.trim()
            : (preferredFriendlyId?.trim() ?? '') ||
              deriveFriendlyIdFromKey(sessionKey)

        if (!sessionKey || !friendlyId) {
          throw new Error('Invalid session response')
        }

        invalidateSessionLists(queryClient)
        return { sessionKey, friendlyId }
      } finally {
        setCreatingSession(false)
      }
    },
    [queryClient],
  )

  const upsertSessionInCache = useCallback(
    (friendlyId: string, lastMessage: ChatMessage) => {
      if (!friendlyId) return
      queryClient.setQueryData(
        chatQueryKeys.sessions,
        function upsert(existing: unknown) {
          const sessions = Array.isArray(existing)
            ? (existing as Array<SessionMeta>)
            : []
          const now = Date.now()
          const existingIndex = sessions.findIndex((session) => {
            return (
              session.friendlyId === friendlyId || session.key === friendlyId
            )
          })

          if (existingIndex === -1) {
            return [
              {
                key: friendlyId,
                friendlyId,
                updatedAt: now,
                lastMessage,
                titleStatus: 'idle',
              },
              ...sessions,
            ]
          }

          return sessions.map((session, index) => {
            if (index !== existingIndex) return session
            return {
              ...session,
              updatedAt: now,
              lastMessage,
            }
          })
        },
      )
    },
    [queryClient],
  )

  const scrollChatToBottom = useCallback(
    (behavior: ScrollBehavior = 'smooth') => scrollChatToBottomImpl(behavior),
    [],
  )

  const handleUiSlashCommand = useCallback(
    (command: string) => {
      const trimmedCommand = command.trim()
      if (!trimmedCommand.startsWith('/')) return false

      // Token + argument split (commands like `/title <name>` carry an arg).
      const [slashToken = '', ...slashArgParts] = trimmedCommand.split(/\s+/)
      const slashArg = slashArgParts.join(' ').trim()

      if (trimmedCommand === '/new' || trimmedCommand === '/reset') {
        // Use the explicit 'new' session sentinel rather than '/chat' alone.
        // The /chat index route redirects to the last-active session via
        // localStorage, so '/new' must route directly to the new sentinel.
        navigate({
          to: '/chat/$sessionKey',
          params: { sessionKey: 'new' },
        })
        return true
      }

      if (trimmedCommand === '/clear') {
        const sessionKey =
          forcedSessionKey ||
          resolvedSessionKey ||
          activeSessionKey ||
          activeFriendlyId
        clearHistoryMessages(queryClient, activeFriendlyId, sessionKey)
        toast('Chat cleared', { type: 'success' })
        return true
      }

      if (trimmedCommand === '/model' || trimmedCommand === '/skin') {
        window.dispatchEvent(
          new CustomEvent(CHAT_OPEN_SETTINGS_EVENT, {
            detail: {
              section: trimmedCommand === '/skin' ? 'appearance' : 'claude',
            },
          }),
        )
        return true
      }

      if (trimmedCommand === '/skills') {
        navigate({ to: '/skills' })
        return true
      }

      if (trimmedCommand === '/save') {
        const exported = exportConversationTranscript({
          sessionLabel: activeFriendlyId || 'conversation',
          messages: finalDisplayMessages,
        })
        if (exported) {
          toast('Conversation exported', { type: 'success' })
        }
        return true
      }

      if (slashToken === '/stop') {
        // Inline abort — mirrors handleAbortStreaming, which is declared later
        // in the component; referencing it here would hit the same render-time
        // TDZ as the interrupted-affordance handlers.
        const activeSend = activeSendRef.current
        if (activeSend?.clientId) {
          updateHistoryMessageByClientIdEverywhere(
            queryClient,
            activeSend.clientId,
            (message) => ({ ...message, status: 'sent' }),
          )
        }
        activeSendRef.current = null
        cancelStreaming()
        setSending(false)
        setPendingGeneration(false)
        setWaitingForResponse(false)
        toast('Agent stopped', { type: 'info' })
        return true
      }

      if (slashToken === '/title') {
        if (!slashArg) {
          toast('Usage: /title <name>', { type: 'info' })
          return true
        }
        const sessionKey =
          forcedSessionKey ||
          resolvedSessionKey ||
          activeSessionKey ||
          activeFriendlyId
        if (sessionKey) {
          void renameSession(sessionKey, activeFriendlyId ?? null, slashArg)
          toast(`Title set: ${slashArg}`, { type: 'success' })
        }
        return true
      }

      if (slashToken === '/reasoning') {
        const level = slashArg.toLowerCase()
        if (level === 'off' || level === 'low' || level === 'adaptive') {
          handleThinkingLevelChange(level)
          toast(`Reasoning: ${level}`, { type: 'success' })
        } else {
          toast('Usage: /reasoning <off | low | adaptive>', { type: 'info' })
        }
        return true
      }

      return false
    },
    [
      activeFriendlyId,
      activeSessionKey,
      cancelStreaming,
      finalDisplayMessages,
      forcedSessionKey,
      handleThinkingLevelChange,
      navigate,
      queryClient,
      renameSession,
      resolvedSessionKey,
    ],
  )

  const expandCustomSlashCommand = useCallback(
    (body: string): string | null => {
      const trimmed = body.trim()
      if (!trimmed.startsWith('/')) return null
      const [slashToken = '', ...inputParts] = trimmed.split(/\s+/)
      const command = findEnabledCommandBySlash(enabledUserCommands, slashToken)
      if (!command) return null
      return expandUserCommandPrompt(command, inputParts.join(' '))
    },
    [enabledUserCommands],
  )

  const send = useCallback(
    async (
      body: string,
      attachments: Array<ChatComposerAttachment>,
      fastMode: boolean,
      helpers: ChatComposerHelpers,
    ) => {
      const trimmedBody = body.trim()
      if (trimmedBody.length === 0 && attachments.length === 0) return
      if (attachments.length === 0 && handleUiSlashCommand(trimmedBody)) return
      const messageBody = expandCustomSlashCommand(trimmedBody) ?? trimmedBody

      // Deduplicate sends with identical content within a 500ms window.
      // This prevents double-fire from paste events that trigger multiple send paths.
      const sendKey = `${messageBody}|${attachments.map((a) => `${a.name}:${a.size}`).join(',')}`
      const now = Date.now()
      if (
        sendKey === lastSendKeyRef.current &&
        now - lastSendAtRef.current < 500
      )
        return
      lastSendKeyRef.current = sendKey
      lastSendAtRef.current = now

      const queueSessionKeyForSend =
        activeQueueSessionKey ||
        activeSendRef.current?.sessionKey ||
        lastQueueSessionKeyRef.current ||
        (isPortableMode
          ? 'main'
          : forcedSessionKey ||
            resolvedSessionKey ||
            activeSessionKey ||
            activeCanonicalKey ||
            activeFriendlyId)
      const shouldQueueInsteadOfSend =
        Boolean(queueSessionKeyForSend) &&
        (isComposerLoadingRef.current ||
          Boolean(activeSendRef.current) ||
          hasPendingGeneration() ||
          (queueSessionKeyForSend
            ? useChatStore.getState().isSessionWaiting(queueSessionKeyForSend)
            : false))

      if (shouldQueueInsteadOfSend && queueSessionKeyForSend) {
        useChatStore.getState().enqueue(queueSessionKeyForSend, {
          id: crypto.randomUUID(),
          text: messageBody,
          attachments: attachments.map((attachment) => ({ ...attachment })),
        })
        helpers.reset()
        return
      }

      // Haptic feedback on mobile when message is sent
      if (isMobile) hapticTap()

      helpers.reset()

      // Scroll to bottom immediately so user sees their message + incoming response
      requestAnimationFrame(() => scrollChatToBottom('smooth'))

      const attachmentPayload: Array<ChatAttachment> = attachments.map(
        (attachment) => ({
          ...attachment,
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime safety
          id: attachment.id ?? crypto.randomUUID(),
        }),
      )

      if (isNewChat) {
        // Create/resolve the concrete session before first send. The old flow
        // generated a UUID, fired createSession() in the background, and then
        // immediately streamed against the UUID. If registration lagged or the
        // backend returned a different persisted id, the first send hit
        // /api/sessions/<uuid>/chat/stream with a session that never existed.
        const { sessionKey: threadId, friendlyId: routeFriendlyId } =
          await resolveNewChatBootstrapSession({
            createSessionForMessage,
            generateThreadId: () => crypto.randomUUID(),
            isPortableMode,
          })
        const { optimisticMessage } = createOptimisticMessage(
          messageBody,
          attachmentPayload,
        )
        appendHistoryMessage(
          queryClient,
          routeFriendlyId,
          threadId,
          optimisticMessage,
        )
        upsertSessionInCache(routeFriendlyId, optimisticMessage)
        setPendingGeneration(true)
        setSending(true)
        setWaitingForResponse(true)

        sendMessage(
          threadId,
          routeFriendlyId,
          messageBody,
          attachmentPayload,
          fastMode,
          true,
          typeof optimisticMessage.clientId === 'string'
            ? optimisticMessage.clientId
            : '',
        )
        // In portable mode, navigate to /chat/main instead of a transient UUID.
        if (!embedded) {
          navigate({
            to: '/chat/$sessionKey',
            params: { sessionKey: routeFriendlyId },
            replace: true,
          })
        }
        return
      }

      const sessionKeyForSend = isPortableMode
        ? 'main'
        : forcedSessionKey || resolvedSessionKey || activeSessionKey || 'main'
      sendMessage(
        sessionKeyForSend,
        isPortableMode ? 'main' : activeFriendlyId,
        messageBody,
        attachmentPayload,
        fastMode,
      )
    },
    [
      activeFriendlyId,
      activeSessionKey,
      activeCanonicalKey,
      activeQueueSessionKey,
      createSessionForMessage,
      forcedSessionKey,
      isComposerLoadingRef,
      isNewChat,
      isPortableMode,
      navigate,
      onSessionResolved,
      scrollChatToBottom,
      sendMessage,
      upsertSessionInCache,
      queryClient,
      resolvedSessionKey,
      handleUiSlashCommand,
      expandCustomSlashCommand,
    ],
  )

  // Phase 1.2: interrupted affordance handlers. Placed AFTER `send` so
  // the closure can capture it without a temporal-dead-zone error.
  const isCurrentSessionInterrupted = useChatStore((state) =>
    resolvedSessionKey ? state.isSessionInterrupted(resolvedSessionKey) : false,
  )

  const handleResendInterrupted = useCallback(() => {
    if (!resolvedSessionKey) return
    const store = useChatStore.getState()
    store.clearSessionInterrupted(resolvedSessionKey)
    const lastUser = [...finalDisplayMessages]
      .reverse()
      .find((m) => m?.role === 'user' && !m.__optimisticId)
    if (lastUser && typeof lastUser.content !== 'undefined') {
      const text = readMessageText(lastUser)
      if (text.trim()) {
        send(text, [], false, commandHelpers)
      }
    } else {
      // No user message found — still clear the flag and let the user
      // re-type. This handles the "interrupted but history is empty" edge.
      void historyQuery.refetch()
    }
  }, [resolvedSessionKey, finalDisplayMessages, send, commandHelpers, historyQuery])

  useEffect(() => {
    if (isComposerLoading) return

    const sessionKey = activeQueueSessionKey || lastQueueSessionKeyRef.current
    if (!sessionKey) return

    const nextQueued = useChatStore.getState().dequeue(sessionKey)
    if (!nextQueued) return

    send(nextQueued.text, nextQueued.attachments, false, commandHelpers)
  }, [activeQueueSessionKey, isComposerLoading, send])

  // Drain-watchdog escape hatch (Phase 1.1). If an SSE completion event is
  // dropped, the busy signals never clear and the queue stalls. This watchdog
  // arms only while a non-empty queue is blocked behind a busy composer; on
  // sustained SSE silence it asks the server whether the run is still live and,
  // if not, releases the stuck busy state so the drain effect above fires.
  //
  // reconcile reuses the happy-path finalize so isComposerLoading goes false:
  //   - activeSendRef.current = null  (clears hasActiveSend)
  //   - clearStreamingSession         (clears any stuck realtime streaming state)
  //   - streamFinish()                (clears sending / waitingForResponse /
  //                                     pendingGeneration — same as onComplete)
  // It deliberately does NOT dequeue/send; the drain effect owns that, so there
  // is no double-send.
  const reconcileStuckBusyState = useCallback(
    (sessionKey: string) => {
      activeSendRef.current = null
      if (sessionKey) {
        useChatStore.getState().clearStreamingSession(sessionKey)
      }
      streamFinish()
    },
    [streamFinish],
  )
  useDrainWatchdog({
    sessionKey: activeQueueSessionKey || lastQueueSessionKeyRef.current,
    isComposerLoading,
    reconcile: reconcileStuckBusyState,
  })

  const handleAbortStreaming = useCallback(() => {
    const activeSend = activeSendRef.current
    if (activeSend?.clientId) {
      updateHistoryMessageByClientIdEverywhere(
        queryClient,
        activeSend.clientId,
        (message) => ({
          ...message,
          status: 'sent',
        }),
      )
    }
    activeSendRef.current = null
    cancelStreaming()
    setSending(false)
    setPendingGeneration(false)
    setWaitingForResponse(false)
  }, [cancelStreaming, queryClient])

  const runPaletteSlashCommand = useCallback(
    (command: string) => {
      const trimmedCommand = command.trim()
      if (!trimmedCommand.startsWith('/')) return
      if (handleUiSlashCommand(trimmedCommand)) return
      send(trimmedCommand, [], false, commandHelpers)
    },
    [commandHelpers, handleUiSlashCommand, send],
  )

  useEffect(() => {
    function handleRunCommand(event: Event) {
      const detail = (event as CustomEvent<ChatRunCommandDetail>).detail
      if (!detail?.command) return
      runPaletteSlashCommand(detail.command)
    }

    window.addEventListener(CHAT_RUN_COMMAND_EVENT, handleRunCommand)
    return () => {
      window.removeEventListener(CHAT_RUN_COMMAND_EVENT, handleRunCommand)
    }
  }, [runPaletteSlashCommand])

  useEffect(() => {
    if (userCommandsQuery.isPending) return
    const pendingCommand = window.sessionStorage.getItem(
      CHAT_PENDING_COMMAND_STORAGE_KEY,
    )
    if (!pendingCommand) return

    window.sessionStorage.removeItem(CHAT_PENDING_COMMAND_STORAGE_KEY)
    runPaletteSlashCommand(pendingCommand)
  }, [runPaletteSlashCommand, userCommandsQuery.isPending])

  const historyLoading =
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime safety
    (historyQuery.isLoading && !historyQuery.data) || isRedirecting
  const historyEmpty = !historyLoading && finalDisplayMessages.length === 0
  const errorNotice = useMemo(() => {
    if (!showErrorNotice) return null
    if (!serverError) return null
    return (
      <ConnectionStatusMessage
        state="error"
        error={serverError}
        status={serverErrorStatus}
        onRetry={handleRefetch}
      />
    )
  }, [serverError, serverErrorStatus, handleRefetch, showErrorNotice])

  const mobileHeaderStatus: 'connected' | 'connecting' | 'disconnected' =
    'connected'

  const activeHeaderToolName =
    liveToolActivity[0]?.name || activeToolCalls[0]?.name || undefined
  const headerStatusMode: 'idle' | 'sending' | 'streaming' | 'tool' =
    activeHeaderToolName
      ? 'tool'
      : derivedStreamingInfo.isStreaming
        ? 'streaming'
        : sending || waitingForResponse
          ? 'sending'
          : 'idle'
  const researchCard = useResearchCard({
    sessionKey: resolvedSessionKey || activeCanonicalKey,
    isStreaming: derivedStreamingInfo.isStreaming,
    resetKey: `${resolvedSessionKey || activeCanonicalKey || 'main'}:${researchResetKey}`,
  })

  const sessionModelFallback =
    (typeof (activeSession as { model?: unknown } | null | undefined)?.model ===
    'string'
      ? ((activeSession as { model?: string }).model as string)
      : undefined) ?? undefined

  // Pull-to-refresh offset removed

  const handleOpenAgentDetails = useCallback(() => {
    // agent view panel removed
  }, [])

  const handleRenameActiveSessionTitle = useCallback(
    async (nextTitle: string) => {
      const sessionKey =
        resolvedSessionKey || activeSession?.key || activeSessionKey || ''
      if (!sessionKey) return
      await renameSession(
        sessionKey,
        activeSession?.friendlyId ?? null,
        nextTitle,
      )
    },
    [
      activeSession?.friendlyId,
      activeSession?.key,
      activeSessionKey,
      renameSession,
      resolvedSessionKey,
    ],
  )

  // Listen for mobile header agent-details tap
  useEffect(() => {
    const handler = () => {
      /* agent view removed */
    }
    window.addEventListener('claude:chat-agent-details', handler)
    return () =>
      window.removeEventListener('claude:chat-agent-details', handler)
  }, [])

  return (
    <div
      className={cn(
        'relative min-w-0 flex flex-col overflow-hidden',
        compact ? 'h-full flex-1 min-h-0' : 'h-full',
      )}
      style={{ background: 'var(--theme-bg)' }}
    >
      <div
        className={cn(
          'flex-1 min-h-0 overflow-hidden',
          compact
            ? 'flex min-h-0 w-full flex-col'
            : isMobile
              ? 'flex flex-col'
              : 'grid grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[minmax(0,1fr)]',
        )}
      >
        {hideUi || compact || isFocusMode ? null : isMobile ? null : (
          <FileExplorerSidebar
            collapsed={fileExplorerCollapsed}
            onToggle={handleToggleFileExplorer}
            onInsertReference={handleInsertFileReference}
          />
        )}

        <main
          className={cn(
            'flex h-full flex-1 min-h-0 min-w-0 flex-col overflow-hidden transition-[margin-bottom] duration-200',
            (activeIsRealtimeStreaming || hasPendingGeneration()) &&
              'chat-streaming-glow',
          )}
          style={{
            marginBottom:
              terminalPanelInset > 0 ? `${terminalPanelInset}px` : undefined,
          }}
          ref={mainRef}
        >
          {!compact ? (
            <>
              <ChatHeaderV2
                activeTitle={activeTitle}
                sessionKey={activeSessionKey || activeFriendlyId}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                tabCounts={{
                  chat: finalDisplayMessages.length,
                  tool: totalToolCount,
                  skills: totalSkillCount,
                }}
              />
              <ChatMetaBarV2
                sessionKey={activeSessionKey || activeFriendlyId}
                selectorSessionKey={
                  isNewChat
                    ? undefined
                    : forcedSessionKey || resolvedSessionKey || activeSessionKey
                }
                isStreaming={isRealtimeStreaming}
                toolCount={totalToolCount}
                modelFallback={sessionModelFallback}
                thinkingLevel={thinkingLevel}
                onThinkingLevelChange={handleThinkingLevelChange}
              />
            </>
          ) : null}

          <ChatNoticeBanners
            errorNotice={errorNotice}
            isCurrentSessionInterrupted={isCurrentSessionInterrupted}
            onResendInterrupted={handleResendInterrupted}
            pendingApprovals={pendingApprovals}
            onResolveApproval={resolvePendingApproval}
          />

          {activeTab === 'tool' ? (
            <ToolTabView
              messages={realtimeMessages}
              streamingToolCalls={activeToolCalls}
              events={realtimeLifecycleEvents}
            />
          ) : activeTab === 'skills' ? (
            <ChatSkillsTabV2
              messages={realtimeMessages}
              streamingToolCalls={activeToolCalls}
              events={realtimeLifecycleEvents}
            />
          ) : null}
          {hideUi || activeTab !== 'chat' ? null : (
            <StreamingTextContext.Provider
              value={
                stableActiveStreamingText ||
                completedStreamingText.current ||
                ''
              }
            >
            <ChatMessageList
              messages={finalDisplayMessages}
              onRetryMessage={handleRetryMessage}
              onReplyMessage={(msg, selectedText) => {
                const preview = (selectedText && selectedText.trim().length > 0
                  ? selectedText
                  : (textFromMessage(msg) ?? '')
                      .replace(/```[\s\S]*?```/g, ' ')
                      .replace(/`([^`]+)`/g, '$1')
                      .replace(/^\s*#{1,6}\s+/gm, '')
                      .replace(/^\s*>\s?/gm, '')
                      .replace(/^\s*\|.*$/gm, '')
                      .replace(/^\s*[-*+]\s+/gm, '')
                      .replace(/\*\*([^*]+)\*\*/g, '$1')
                      .replace(/\*([^*]+)\*/g, '$1')
                      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'))
                  .replace(/\s+/g, ' ')
                  .trim()
                const seq = finalDisplayMessages.indexOf(msg) + 1
                setReplyTo({
                  seq,
                  role: msg.role ?? 'assistant',
                  preview,
                })
              }}
              onRefresh={handleRefreshHistory}
              loading={historyLoading}
              empty={historyEmpty}
              emptyState={
                <ChatEmptyState
                  compact={compact}
                  onSuggestionClick={(prompt) => {
                    composerHandleRef.current?.setValue(prompt + ' ')
                  }}
                />
              }
              notice={null}
              noticePosition="end"
              waitingForResponse={waitingForResponse}
              sessionKey={activeCanonicalKey}
              pinToTop={false}
              pinGroupMinHeight={pinGroupMinHeight}
              headerHeight={headerHeight}
              contentStyle={stableContentStyle}
              bottomOffset={
                isMobile ? mobileScrollBottomOffset : terminalPanelInset
              }
              isStreaming={derivedStreamingInfo.isStreaming}
              streamingMessageId={derivedStreamingInfo.streamingMessageId}
              hasStreamingText={Boolean(
                (stableActiveStreamingText || completedStreamingText.current || '').trim(),
              )}
              streamingThinking={
                realtimeStreamingThinking ||
                completedStreamingThinking.current ||
                undefined
              }
              lifecycleEvents={realtimeLifecycleEvents}
              hideSystemMessages={hideSystemMessages}
              activeToolCalls={activeToolCalls}
              liveToolActivity={liveToolActivity}
              researchCard={researchCard}
              isCompacting={isCompacting}
              liveProgressLabel={liveProgressLabel}
              sending={sending}
              toolDisplayMode={toolDisplayMode}
              clarifyCard={
                activeClarify && resolvedSessionKey ? (
                  <InlineClarifyCard
                    clarify={activeClarify}
                    sessionKey={resolvedSessionKey}
                  />
                ) : null
              }
            />
            </StreamingTextContext.Provider>
          )}
          {showComposer ? (
            <ChatComposerShadcn
              onSubmit={send}
              onAbort={handleAbortStreaming}
              isLoading={isComposerLoading}
              disabled={hideUi || (!!activeClarify && !activeClarify.resolved)}
              sessionKey={activeQueueSessionKey || undefined}
              wrapperRef={composerRef}
              composerRef={composerHandleRef}
              embedded={embedded}
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime safety
              focusKey={`${isNewChat ? 'new' : activeFriendlyId}:${activeCanonicalKey ?? ''}`}
              thinkingLevel={thinkingLevel}
              replyTo={replyTo}
              onClearReply={() => setReplyTo(null)}
              systemMessagesHidden={hideSystemMessages}
              onToggleSystemMessages={() => setHideSystemMessages((v) => !v)}
              toolDisplayMode={toolDisplayMode}
              onCycleToolDisplayMode={cycleToolDisplayMode}
              onNewSession={() => {
                if (!embedded) {
                  try {
                    navigate({ to: '/', replace: true })
                  } catch {
                    /* router not ready */
                  }
                }
              }}
            />
          ) : null}
        </main>
        {/* Isolated boundary: an AgentViewPanel crash (e.g. AnimatePresence
            re-render loop) must degrade to a retry card, never take down chat. */}
        {!compact && !isFocusMode && (
          <ErrorBoundary
            inline
            className="m-2 w-72 self-start"
            title="Agent panel crashed"
            description="Chat is unaffected. Retry to remount the panel."
          >
            <AgentViewPanel />
          </ErrorBoundary>
        )}
      </div>
      {!compact && !hideUi && !isMobile && !isFocusMode && <TerminalPanel />}

      {suggestion && (
        <ModelSuggestionToast
          suggestedModel={suggestion.suggestedModel}
          reason={suggestion.reason}
          costImpact={suggestion.costImpact}
          onSwitch={handleSwitchModel}
          onDismiss={dismiss}
          onDismissForSession={dismissForSession}
        />
      )}

      {isMobile && (
        <MobileSessionsPanel
          open={sessionsOpen}
          onClose={() => setSessionsOpen(false)}
          sessions={sessions}
          activeFriendlyId={activeFriendlyId}
          onSelectSession={(friendlyId) => {
            setSessionsOpen(false)
            void navigate({
              to: '/chat/$sessionKey',
              params: { sessionKey: friendlyId },
            })
          }}
          onNewChat={() => {
            setSessionsOpen(false)
            void navigate({
              to: '/chat/$sessionKey',
              params: { sessionKey: 'new' },
            })
          }}
        />
      )}

      <ContextAlertModal
        open={alertOpen}
        onClose={dismissAlert}
        threshold={alertThreshold}
        contextPercent={alertPercent}
      />

      <ErrorToastContainer />
    </div>
  )
}
