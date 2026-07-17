import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'

import {
  deriveFriendlyIdFromKey,
  readError,
  textFromMessage,
} from './utils'
import {
  advanceStickyStreamingText,
  scrollChatToBottom as scrollChatToBottomImpl,
} from './chat-screen-utils'
import {
  appendHistoryMessage,
  chatQueryKeys,
} from './chat-queries'
import { ChatMessageList } from './components/chat-message-list'
import { ChatNoticeBanners } from './components/chat-notice-banners'
import { StreamingTextContext } from './components/streaming-text-context'
import { ChatEmptyState } from './components/chat-empty-state'
import { ChatComposerShadcn } from './components/chat-composer-shadcn'
import { InlineClarifyCard } from './components/inline-clarify-card'
import { ConnectionStatusMessage } from './components/connection-status-message'
import {
  hasPendingGeneration,
  hasPendingSend,
  setPendingGeneration,
} from './pending-send'
import { useChatMeasurements } from './hooks/use-chat-measurements'
import { useChatHistory } from './hooks/use-chat-history'
import { useRealtimeChatHistory } from './hooks/use-realtime-chat-history'
import { useSmoothStreamingText } from './hooks/use-smooth-streaming-text'
import { useStreamingMessage } from './hooks/use-streaming-message'
import { useActiveRunCheck } from './hooks/use-active-run-check'
import { useActiveRunPoller } from './hooks/use-active-run-poller'
import { useFocusMode } from './hooks/use-focus-mode'
import { useActivityStream } from './hooks/use-activity-stream'
import { useHistoryPolling } from './hooks/use-history-polling'
import {
  classifySessionSource,
  findSessionSource,
  invalidateSessionLists,
  useSessionsFeed,
} from './sessions-feed'
import { useToolDisplay } from './hooks/use-tool-display'
import { useDisplayMessages } from './hooks/use-display-messages'
import { useDrainWatchdog } from './hooks/use-drain-watchdog'
import { useChatMobile } from './hooks/use-chat-mobile'
import { useChatSessions } from './hooks/use-chat-sessions'
import { useErrorRedirect } from './hooks/use-error-redirect'
import { useAutoSessionTitle } from './hooks/use-auto-session-title'
import { useRenameSession } from './hooks/use-rename-session'
import { useContextAlert } from './hooks/use-context-alert'
import { usePendingApprovals } from './hooks/use-pending-approvals'
import { useSendMessageState } from './hooks/use-send-message-state'
import { useSessionLifecycle } from './hooks/use-session-lifecycle'
import { useComposerSend } from './hooks/use-composer-send'
import { useMessageRetry } from './hooks/use-message-retry'
import { useRetryRecovery } from './hooks/use-retry-recovery'
import { useSlashCommands } from './hooks/use-slash-commands'
import { useThinkingLevel } from './hooks/use-thinking-level'
import { ChatHeaderV2 } from './components/v2/chat-header-v2'
import { ChatMetaBarV2 } from './components/v2/chat-meta-bar-v2'
import { ChatSkillsTabV2 } from './components/v2/chat-skills-tab-v2'
import { ToolTabView } from './components/v2/chat-tab-views-v2'
import { DelegationTabView } from './components/v2/delegation-tab-view'
import { ChatDelegations } from './components/v2/chat-delegations-strip'
import { extractDelegateTaskToolCalls, mergeChatDelegations } from './chat-delegations'
import { useDelegations } from './hooks/use-delegations'
import type {
  ChatComposerAttachment,
  ChatComposerHandle,
  ChatComposerHelpers,
} from './components/chat-composer-types'
import type { ChatAttachment, ChatMessage, SessionMeta } from './types'
import type { AgentActivity } from '@/stores/chat-activity-store'
import type { StreamingDelegation } from '@/stores/chat-store'

import { cn } from '@/lib/utils'
import { FileExplorerSidebar } from '@/components/file-explorer'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { TerminalPanel } from '@/components/terminal-panel'
import { AgentViewPanel } from '@/components/agent-view/agent-view-panel'
import { ErrorBoundary } from '@/components/error-boundary'
import { useTerminalPanelStore } from '@/stores/terminal-panel-store'
import {
  useEnabledUserCommands,
} from '@/lib/commands-api'
import { MobileSessionsPanel } from '@/components/mobile-sessions-panel'
import { ContextAlertModal } from '@/components/usage-meter/context-alert-modal'
import { ErrorToastContainer } from '@/components/error-toast'
// ContextMeter removed — ContextBar (PR #32) replaces it
import { useChatStore } from '@/stores/chat-store'
import { useContextUsageStore } from '@/stores/context-usage-store'
// MOBILE_TAB_BAR_OFFSET removed — tab bar always hidden in chat
import { useTapDebug } from '@/hooks/use-tap-debug'
import { useChatMode } from '@/hooks/use-chat-mode'
import {
  useChatActivityStore,
} from '@/stores/chat-activity-store'

const EMPTY_STREAMING_DELEGATIONS: Array<StreamingDelegation> = []

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

const commandHelpers: ChatComposerHelpers = {
  reset() {},
  setValue() {},
  setAttachments() {},
}

export function ChatScreen({
  activeFriendlyId,
  isNewChat = false,
  onSessionResolved: onSessionResolvedProp,
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
  const retriedQueuedMessageKeysRef = useRef(new Set<string>())
  const [isCompacting, setIsCompacting] = useState(false)
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
  const { items: sessionFeedItems } = useSessionsFeed({ raw: true })
  const activeSourceKind = useMemo(() => {
    return (
      findSessionSource(sessionFeedItems, [
        activeFriendlyId,
        activeSessionKey,
        activeSession?.key,
        activeSession?.friendlyId,
      ]) ??
      classifySessionSource(
        activeSession?.source,
        activeSessionKey || activeFriendlyId,
        false,
        activeSession?.kind,
      )
    )
  }, [activeFriendlyId, activeSession, activeSessionKey, sessionFeedItems])
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
  // Bridge ref for cancelStreaming (seam #4 PR 3) — synced after
  // useStreamingMessage returns, same pattern as startStreamingRef.
  const cancelStreamingRef = useRef<(() => void) | null>(null)

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
    onSessionResolved,
    onStarted,
    onComplete,
    onError,
    onMessageAccepted,
    onAbort,
    reconcileStuckBusyState,
    handleAbortStreaming,
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
    onSessionResolved: onSessionResolvedProp,
    navigate,
    embedded,
    cancelStreamingRef,
  })

  const { liveToolActivity } = useActivityStream({
    waitingForResponseRef,
    waitingForResponse,
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
  const recoveryMessages = (historyQuery.data as { messages?: Array<ChatMessage> } | undefined)?.messages

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

  const { delegations } = useDelegations(activeSessionKey || activeFriendlyId)
  const sessionStreamingDelegations = useChatStore(
    useCallback(
      (s) =>
        resolvedSessionKey
          ? s.streamingState.get(resolvedSessionKey)?.delegations
          : undefined,
      [resolvedSessionKey],
    ),
  )
  const streamingDelegations =
    sessionStreamingDelegations ?? EMPTY_STREAMING_DELEGATIONS
  const mergedDelegations = useMemo(
    () =>
      mergeChatDelegations({
        delegations,
        toolCalls: extractDelegateTaskToolCalls(realtimeMessages, activeToolCalls),
        streamingDelegations,
      }),
    [delegations, activeToolCalls, realtimeMessages, streamingDelegations],
  )

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

  // Seam #2: the 5s active-run completion poller and the 3s live-progress
  // display poller were extracted to hooks/use-active-run-poller.ts. Both
  // poll /api/sessions/:key/active-run while waitingForResponse is true.
  const { liveProgressLabel } = useActiveRunPoller({
    waitingForResponse,
    resolvedSessionKey,
    activeSendRef,
    activeRealtimeStreamingRef,
    streamFinish,
    refreshHistoryRef,
  })

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
    modelsQuery,
    currentModelQuery,
  } = useThinkingLevel({ activeFriendlyId, resolvedSessionKey, forcedSessionKey })

  // Sync bridge refs for sendMessage (seam #4 PR 2)
  thinkingLevelBridgeRef.current = thinkingLevel
  currentModelRef.current = currentModel

  const {
    isStreaming: localIsStreaming,
    streamingText: localStreamingText,
    streamingMessageId: localStreamingMessageId,
    startStreaming,
    cancelStreaming,
  } = useStreamingMessage({
    onSessionResolved,
    onStarted,
    onComplete,
    onError,
    onMessageAccepted,
    onAbort,
    acceptedTimeoutMs: modelsQuery.data?.streamAcceptedTimeoutMs,
    handoffTimeoutMs: modelsQuery.data?.streamHandoffTimeoutMs,
  })

  // Sync bridge refs (seam #4 PR 2 + PR 3)
  startStreamingRef.current = startStreaming
  cancelStreamingRef.current = cancelStreaming

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
  const { finalDisplayMessages } = useDisplayMessages({
    realtimeMessages,
    activeIsRealtimeStreaming,
    activeToolCalls,
    realtimeStreamingThinking,
  })

  // Sync bridge ref for sendMessage (seam #4 PR 2)
  finalDisplayMessagesRef.current = finalDisplayMessages

  const derivedStreamingInfo = useMemo(() => {
    if (activeIsRealtimeStreaming) {
      const last = finalDisplayMessages.at(-1)
      const id = isPortableMode
        ? localStreamingMessageId
        : last?.role === 'assistant'
          ? (last as any).__optimisticId || (last as any).id || null
          : null
      return { isStreaming: true, streamingMessageId: id }
    }
    if (waitingForResponse && finalDisplayMessages.length > 0) {
      const last = finalDisplayMessages.at(-1)
      if (last?.role === 'assistant') {
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
      const lastMsg = finalDisplayMessages.at(-1)
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
    const last = finalDisplayMessages.at(-1)
    if (last?.role !== 'assistant') return
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

  const {
    statusQuery,
    serverError,
    serverErrorStatus,
    showErrorNotice,
    handleRefetch,
    handleRefreshHistory,
    shouldRedirectToNew,
    hideUi,
    showComposer,
    historyLoading,
    historyEmpty,
  } = useErrorRedirect({
    sessionsQuery,
    historyQuery,
    sessionsError,
    historyError,
    navigate,
    embedded,
    isNewChat,
    activeExists,
    activeFriendlyId,
    forcedSessionKey,
    sessions,
    sessionKeyForHistory,
    queryClient,
    error,
    setError,
    isRedirecting,
    setIsRedirecting,
    messageCount: finalDisplayMessages.length,
  })

  useHistoryPolling({
    refetchHistory: () => {
      void historyQuery.refetch()
    },
    waitingForResponseRef,
  })

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

  useSessionLifecycle({
    isNewChat,
    activeFriendlyId,
    activeSessionKey,
    forcedSessionKey,
    resolvedSessionKey,
    isPortableMode,
    portableChatFriendlyId,
    queryClient,
    sendMessage,
    setWaitingForResponse,
    streamStop,
    retriedQueuedMessageKeysRef,
  })

  const { retryQueuedMessage, flushRetryableMessages, handleRetryMessage } =
    useRetryRecovery({
      sendMessage,
      queryClient,
      activeSessionKey,
      forcedSessionKey,
      resolvedSessionKey,
      isPortableMode,
      portableChatFriendlyId,
      sessionKeyForHistory,
      finalDisplayMessages,
      retriedQueuedMessageKeysRef,
      statusQuery,
      handleRefetch,
    })

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
          const cachedSessions = Array.isArray(existing)
            ? (existing as Array<SessionMeta>)
            : []
          const now = Date.now()
          const existingIndex = cachedSessions.findIndex((session) => {
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

  // sendRef bridge: useSlashCommands is called before useComposerSend (which
  // itself consumes handleUiSlashCommand/expandCustomSlashCommand from this
  // hook). The ref is populated immediately after useComposerSend returns.
  const sendRef = useRef<
    | ((
        body: string,
        attachments: Array<ChatComposerAttachment>,
        fastMode: boolean,
        helpers: ChatComposerHelpers,
      ) => Promise<void>)
    | null
  >(null)

  const { handleUiSlashCommand, expandCustomSlashCommand } = useSlashCommands({
    navigate,
    forcedSessionKey,
    resolvedSessionKey,
    activeSessionKey,
    activeFriendlyId,
    queryClient,
    finalDisplayMessages,
    enabledUserCommands,
    cancelStreaming,
    setSending,
    setWaitingForResponse,
    activeSendRef,
    handleThinkingLevelChange,
    renameSession,
    sendRef,
    commandHelpers,
    userCommandsPending: userCommandsQuery.isPending,
  })

  const { send } = useComposerSend({
    activeFriendlyId,
    activeSessionKey,
    activeCanonicalKey,
    activeQueueSessionKey,
    forcedSessionKey,
    resolvedSessionKey,
    isNewChat,
    isPortableMode,
    embedded,
    queryClient,
    lastSendKeyRef,
    lastSendAtRef,
    lastQueueSessionKeyRef,
    activeSendRef,
    isComposerLoadingRef,
    sendMessage,
    handleUiSlashCommand,
    expandCustomSlashCommand,
    scrollChatToBottom,
    createSessionForMessage,
    upsertSessionInCache,
    navigate,
    setSending,
    setWaitingForResponse,
    isMobile,
  })
  sendRef.current = send

  const { isCurrentSessionInterrupted, handleResendInterrupted } =
    useMessageRetry({
      resolvedSessionKey,
      finalDisplayMessages,
      isComposerLoading,
      activeQueueSessionKey,
      lastQueueSessionKeyRef,
      commandHelpers,
      send,
      refetchHistory: historyQuery.refetch,
    })

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
  useDrainWatchdog({
    sessionKey: activeQueueSessionKey || lastQueueSessionKeyRef.current,
    isComposerLoading,
    reconcile: reconcileStuckBusyState,
  })

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
  const handleReplyMessage = useCallback(
    (msg: ChatMessage, selectedText?: string) => {
      const preview = (selectedText && selectedText.trim().length > 0
        ? selectedText
        : textFromMessage(msg)
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
      setReplyTo({ seq, role: msg.role ?? 'assistant', preview })
    },
    [finalDisplayMessages],
  )
  const handleEmptyStateSuggestion = useCallback((prompt: string) => {
    composerHandleRef.current?.setValue(prompt + ' ')
  }, [])
  const emptyState = useMemo(
    () => (
      <ChatEmptyState
        compact={compact}
        onSuggestionClick={handleEmptyStateSuggestion}
      />
    ),
    [compact, handleEmptyStateSuggestion],
  )
  const clarifyCard = useMemo(
    () =>
      activeClarify && resolvedSessionKey ? (
        <InlineClarifyCard
          clarify={activeClarify}
          sessionKey={resolvedSessionKey}
        />
      ) : null,
    [activeClarify, resolvedSessionKey],
  )
  const handleClearReply = useCallback(() => setReplyTo(null), [])
  const handleToggleSystemMessages = useCallback(
    () => setHideSystemMessages((value) => !value),
    [],
  )
  const handleNewSession = useCallback(() => {
    if (embedded) return
    try {
      void navigate({ to: '/', replace: true })
    } catch {
      /* router not ready */
    }
  }, [embedded, navigate])

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
                sourceKind={activeSourceKind}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                tabCounts={{
                  chat: finalDisplayMessages.length,
                  tool: totalToolCount,
                  skills: totalSkillCount,
                  delegations: delegations.length,
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
          ) : activeTab === 'delegations' ? (
            <DelegationTabView sessionKey={activeSessionKey || activeFriendlyId} />
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
              onReplyMessage={handleReplyMessage}
              onRefresh={handleRefreshHistory}
              loading={historyLoading}
              empty={historyEmpty}
              emptyState={emptyState}
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
              isCompacting={isCompacting}
              liveProgressLabel={liveProgressLabel}
              sending={sending}
              toolDisplayMode={toolDisplayMode}
              clarifyCard={clarifyCard}
            />
            </StreamingTextContext.Provider>
          )}
          {showComposer ? (
            <ChatDelegations
              delegations={mergedDelegations}
            />
          ) : null}
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
              onClearReply={handleClearReply}
              systemMessagesHidden={hideSystemMessages}
              onToggleSystemMessages={handleToggleSystemMessages}
              toolDisplayMode={toolDisplayMode}
              onCycleToolDisplayMode={cycleToolDisplayMode}
              onNewSession={handleNewSession}
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
