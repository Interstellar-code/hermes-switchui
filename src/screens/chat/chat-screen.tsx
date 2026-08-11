import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { Bot } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'

import { useMcpServers } from '../mcp/hooks/use-mcp-servers'
import { deriveFriendlyIdFromKey, textFromMessage } from './utils'
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
import { useRunStop } from './hooks/use-run-stop'
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
import {
  countSessionAgents,
  hasActiveSessionAgents,
  useDelegations,
} from './hooks/use-delegations'
import { useDisplayMessages } from './hooks/use-display-messages'
import { useDrainWatchdog } from './hooks/use-drain-watchdog'
import { useChatMobile } from './hooks/use-chat-mobile'
import { useChatSessions } from './hooks/use-chat-sessions'
import { useErrorRedirect } from './hooks/use-error-redirect'
import { useAutoSessionTitle } from './hooks/use-auto-session-title'
import { useRenameSession } from './hooks/use-rename-session'
import { useContextAlert } from './hooks/use-context-alert'
import { useSendMessageState } from './hooks/use-send-message-state'
import { useSessionLifecycle } from './hooks/use-session-lifecycle'
import { useComposerSend } from './hooks/use-composer-send'
import { useMessageRetry } from './hooks/use-message-retry'
import { useRetryRecovery } from './hooks/use-retry-recovery'
import { useSlashCommands } from './hooks/use-slash-commands'
import { useThinkingLevel } from './hooks/use-thinking-level'
import { rekeySessionModel } from './components/chat-composer-services'
import { ChatHeaderV2 } from './components/v2/chat-header-v2'
import { ChatMetaBarV2 } from './components/v2/chat-meta-bar-v2'
import { ChatSkillsTabV2 } from './components/v2/chat-skills-tab-v2'
import { ToolTabView } from './components/v2/chat-tab-views-v2'
import { DelegationSidebarOverlay } from './components/v2/delegation-tab-view'
import type {
  ChatComposerAttachment,
  ChatComposerHandle,
  ChatComposerHelpers,
} from './components/chat-composer-types'
import type { ChatAttachment, ChatMessage, SessionMeta } from './types'
import type { AgentActivity } from '@/stores/chat-activity-store'
import type { StreamingDelegation } from '@/stores/chat-store'
import { usePendingApprovalQueue } from '@/hooks/use-approval-queue'
import {
  activeScopeKey,
  profileBody,
  readSendFailure,
} from '@/lib/session-scope'

import { cn } from '@/lib/utils'
import { FileExplorerSidebar } from '@/components/file-explorer'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useTerminalPanelStore } from '@/stores/terminal-panel-store'
import {
  useEnabledUserCommands,
} from '@/lib/commands-api'
import { MobileSessionsPanel } from '@/components/mobile-sessions-panel'
import { ContextAlertModal } from '@/components/usage-meter/context-alert-modal'
import { ErrorToastContainer } from '@/components/error-toast'
// ContextMeter removed — ContextBar (PR #32) replaces it
import {
  normalizeMessageQueueSessionKey,
  useChatStore,
} from '@/stores/chat-store'
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
  // Approval recovery must run wherever a chat can be blocked on one — the
  // full-page route AND the compact side panel (ChatPanel renders this same
  // component with `compact`) — so it lives on the unconditional root here
  // rather than inside the `!compact`-gated ChatHeaderV2/ApprovalsBell tree.
  // ApprovalsBell still calls this hook too, for its display data; both
  // subscribers share one query-cache entry (same query key) and the
  // seeding effect's `alreadyHeld` guard in use-approval-queue.ts is what
  // makes calling it from two mounted components safe — see that file's
  // header before touching either.
  usePendingApprovalQueue()
  const [creatingSession, setCreatingSession] = useState(false)
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [agentsOpen, setAgentsOpen] = useState(false)
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
    handleToggleFileExplorer,
    handleInsertFileReference,
    handleAttachWorkspaceImage,
    handleAttachWorkspaceFile,
  } = useFocusMode({ compact, composerHandleRef })
  const { isMobile } = useChatMobile(queryClient)

  // File explorer overlays the sessions-sidebar footprint (portal-into-node).
  // It renders into the sidebar-shell-v2 DOM node so it lands exactly over the
  // 320px sessions panel with zero coordinate math; the panel stays mounted
  // underneath. Resolve the target once the explorer opens (the sidebar shell
  // is a sibling rendered by WorkspaceShell, so it may not exist on first paint).
  const fileExplorerOpen = !fileExplorerCollapsed && !isMobile
  const [fileExplorerNode, setFileExplorerNode] = useState<HTMLElement | null>(
    null,
  )
  useEffect(() => {
    if (!fileExplorerOpen) return
    setFileExplorerNode(
      document.querySelector<HTMLElement>('[data-testid="sidebar-shell-v2"]'),
    )
  }, [fileExplorerOpen])
  useEffect(() => {
    if (!fileExplorerOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleToggleFileExplorer()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fileExplorerOpen, handleToggleFileExplorer])
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

  // Canonical per-session key for model persistence (useSessionModelStore).
  // MUST be the single source of truth both the read side (useThinkingLevel)
  // and the write side (SessionSelectorsV2, via ChatMetaBarV2's
  // selectorSessionKey prop) key off of — a mismatched precedence between
  // read and write is what silently dropped the per-session model on new
  // chats (#348 task 5). Falls all the way back to activeFriendlyId (the
  // 'new' sentinel pre-resolution) so a model picked before the first
  // message has somewhere to live; rekeySessionModel below moves it once a
  // real session id arrives.
  const modelSessionKey =
    forcedSessionKey ||
    resolvedSessionKey ||
    activeSessionKey ||
    activeFriendlyId ||
    undefined

  // Store maps are keyed by the composite profile::session key.
  const waitingStoreKey = activeScopeKey(resolvedSessionKey)
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
      resolvedSessionKey
        ? (s.pendingClarify[activeScopeKey(resolvedSessionKey)] ?? null)
        : null,
    [resolvedSessionKey],
  )
  const activeClarify = useChatStore(selectActiveClarify)
  const waitingForResponse = waitingStoreKey
    ? storeWaitingForSession
    : hasPendingSend() || hasPendingGeneration()

  // Mirrored to the live value during render at the derivation site below.
  // `activeIsRealtimeStreaming` is derived from useRealtimeChatHistory's
  // return, which is declared later, so the ref starts false.
  const activeRealtimeStreamingRef = useRef(false)

  // --- Bridge refs for sendMessage dependencies (seam #4 PR 2) ---
  // These values are produced by hooks called AFTER useSendMessageState in
  // the render order (the waitingForResponseRef → useRealtimeChatHistory
  // chain). They are synced during render right
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

  // The gateway half of Stop. Declared before useSendMessageState because
  // handleAbortStreaming calls requestStop; it depends on nothing but the
  // query client, so it needs no bridge ref of its own.
  const { requestStop, stopNotice, dismissStopNotice } = useRunStop({
    queryClient,
  })
  const requestStopRef = useRef(requestStop)
  requestStopRef.current = requestStop

  // Re-key the per-session model store the moment a new chat resolves to a
  // real session id — a model picked before that point was persisted under
  // `modelSessionKey`'s pre-resolution value (activeFriendlyId, i.e. the
  // 'new' sentinel), which nothing else moves. See rekeySessionModel's doc
  // comment (#348 task 5) for why this can't be a generic effect diffing
  // `modelSessionKey` across renders: that would also fire on ordinary
  // navigation between two already-resolved sessions and cross-contaminate
  // their model picks. This wrapper only fires on the actual resolution
  // event for THIS chat, closing over the modelSessionKey that was current
  // at send time.
  const handleSessionResolvedForModel = useCallback(
    (resolved: { sessionKey: string; friendlyId: string }) => {
      rekeySessionModel(modelSessionKey, resolved.sessionKey)
      onSessionResolvedProp?.(resolved)
    },
    [modelSessionKey, onSessionResolvedProp],
  )

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
    onSessionResolved: handleSessionResolvedForModel,
    navigate,
    embedded,
    cancelStreamingRef,
    requestStopRef,
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

  const mcpServersQuery = useMcpServers({
    tab: 'all',
    category: 'All',
    search: '',
  })
  const mcpToolNames = useMemo(
    () =>
      new Set(
        (mcpServersQuery.data?.servers ?? [])
          .flatMap((server) => server.discoveredTools)
          .map((tool) => tool.name.toLowerCase()),
      ),
    [mcpServersQuery.data],
  )

  const {
    activeTab,
    setActiveTab,
    toolDisplayMode,
    cycleToolDisplayMode,
    totalToolCount,
    totalTodoCount,
    totalMcpCount,
    totalFileCount,
    totalSkillCount,
  } = useToolDisplay({ realtimeMessages, activeToolCalls, mcpToolNames })

  const { delegations } = useDelegations(activeSessionKey || activeFriendlyId)
  const streamingDelegations = useChatStore(
    useCallback(
      (state) =>
        resolvedSessionKey
          ? state.streamingState.get(activeScopeKey(resolvedSessionKey))
              ?.delegations ??
            EMPTY_STREAMING_DELEGATIONS
          : EMPTY_STREAMING_DELEGATIONS,
      [resolvedSessionKey],
    ),
  )
  const agentCount = useMemo(
    () => countSessionAgents(delegations, streamingDelegations),
    [delegations, streamingDelegations],
  )
  const hasActiveAgents = useMemo(
    () => hasActiveSessionAgents(delegations, streamingDelegations),
    [delegations, streamingDelegations],
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
  } = useThinkingLevel({ activeFriendlyId, modelSessionKey })

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
  // effects declared above this point already read the correct value on their
  // first synchronous mount check.
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
          body: JSON.stringify({
            ...(preferredFriendlyId && preferredFriendlyId.trim().length > 0
              ? { friendlyId: preferredFriendlyId }
              : {}),
            // Creating the row is itself a write — it must land in the
            // selected profile's state.db, not the gateway's active one.
            ...profileBody(),
          }),
        })
        if (!res.ok) throw new Error(await readSendFailure(res))

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
    handleAbortStreaming,
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
    // Session creation is part of sending: its failures (e.g. a 409 profile
    // refusal from POST /api/sessions) go to the same place every other send
    // failure does, instead of rejecting into the console.
    onError,
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
  //
  // When nothing is queued behind the lost run (dropped completion OR gateway
  // restart mid-stream), releasing busy alone would just revert to idle — a
  // misleading silent stop. So we additionally mark the session interrupted,
  // which surfaces the existing "interrupted — resend" banner (chat-notice-
  // banners) instead of the stuck thinking bubble. When a message IS queued the
  // drain effect owns recovery, so we skip the banner to avoid shadowing it.
  const reconcileLostRun = useCallback(
    (key: string) => {
      reconcileStuckBusyState(key)
      if (!key) return
      const store = useChatStore.getState()
      const queued = store.messageQueue[normalizeMessageQueueSessionKey(key)]
      if (Array.isArray(queued) && queued.length > 0) return
      store.setSessionInterrupted(key)
    },
    [reconcileStuckBusyState],
  )

  useDrainWatchdog({
    sessionKey: activeQueueSessionKey || lastQueueSessionKeyRef.current,
    isComposerLoading,
    reconcile: reconcileLostRun,
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
  // Task #9: an approval-kind clarify is a security prompt, not tool chrome.
  // It gets its own unconditional surface (mounted as a sibling of the
  // composer below, via `approvalCard`) instead of the message-list surfaces
  // (thinking bubble / last-assistant-message attachment) that `clarifyCard`
  // feeds — those are gated on toolDisplayMode, thinkingIndicatorVisible, and
  // the existence of a last assistant message / active message search, any
  // of which can silently hide an approval. Excluding approval-kind entries
  // here (rather than filtering in chat-message-list) keeps the two surfaces
  // mutually exclusive so the card never double-renders. Non-approval
  // clarifies are unaffected — they keep flowing through `clarifyCard`
  // exactly as before.
  const isApprovalClarify = activeClarify?.kind === 'approval'
  const clarifyCard = useMemo(
    () =>
      activeClarify && resolvedSessionKey && !isApprovalClarify ? (
        <InlineClarifyCard
          clarify={activeClarify}
          sessionKey={resolvedSessionKey}
        />
      ) : null,
    [activeClarify, resolvedSessionKey, isApprovalClarify],
  )
  // The always-present approval surface (task #9). Renders whenever the
  // active clarify is approval-kind, independent of tool display mode, the
  // thinking indicator, message search, or whether a last assistant message
  // exists to anchor to.
  const approvalCard = useMemo(
    () =>
      activeClarify && resolvedSessionKey && isApprovalClarify ? (
        <InlineClarifyCard
          clarify={activeClarify}
          sessionKey={resolvedSessionKey}
        />
      ) : null,
    [activeClarify, resolvedSessionKey, isApprovalClarify],
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

  // Pull-to-refresh offset removed

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
              : 'grid grid-cols-[minmax(0,1fr)_auto] grid-rows-[minmax(0,1fr)]',
        )}
      >
        {/* File explorer overlays the sessions-sidebar footprint via a portal
            into the sidebar-shell-v2 node. Kept mounted once opened so the tree
            and expanded state persist; toggled invisible when collapsed. The
            sessions panel stays mounted underneath. When the sessions sidebar is
            collapsed to its rail, this anchors to the (narrow) rail region. */}
        {fileExplorerNode &&
          !hideUi &&
          !compact &&
          !isFocusMode &&
          !isMobile &&
          createPortal(
            <div
              className={cn(
                'absolute inset-0 z-20 m-2 flex flex-col overflow-hidden rounded-md border transition-opacity duration-150',
                fileExplorerCollapsed && 'pointer-events-none opacity-0',
              )}
              style={{
                borderColor: 'var(--theme-border)',
                background: 'var(--theme-sidebar)',
              }}
              aria-hidden={fileExplorerCollapsed}
            >
              <FileExplorerSidebar
                collapsed={false}
                onToggle={handleToggleFileExplorer}
                onInsertReference={handleInsertFileReference}
                onAttachImage={handleAttachWorkspaceImage}
                onAttachFile={handleAttachWorkspaceFile}
              />
            </div>,
            fileExplorerNode,
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
                fileExplorerCollapsed={fileExplorerCollapsed}
                onToggleFileExplorer={handleToggleFileExplorer}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                tabCounts={{
                  chat: finalDisplayMessages.length,
                  tool: totalToolCount,
                  todos: totalTodoCount,
                  mcp: totalMcpCount,
                  skills: totalSkillCount,
                  files: totalFileCount,
                }}
              />
              <ChatMetaBarV2
                sessionKey={activeSessionKey || activeFriendlyId}
                selectorSessionKey={modelSessionKey}
                profileMutable={isNewChat && !creatingSession}
                toolCount={totalToolCount}
                thinkingLevel={thinkingLevel}
                onThinkingLevelChange={handleThinkingLevelChange}
              />
            </>
          ) : null}

          <ChatNoticeBanners
            errorNotice={errorNotice}
            isCurrentSessionInterrupted={isCurrentSessionInterrupted}
            onResendInterrupted={handleResendInterrupted}
            stopNotice={stopNotice}
            onDismissStopNotice={dismissStopNotice}
          />

          {activeTab === 'tool' ? (
            <ToolTabView
              messages={realtimeMessages}
              streamingToolCalls={activeToolCalls}
              events={realtimeLifecycleEvents}
              mcpToolNames={mcpToolNames}
            />
          ) : activeTab === 'todos' ? (
            <ToolTabView
              messages={realtimeMessages}
              streamingToolCalls={activeToolCalls}
              view="todos"
            />
          ) : activeTab === 'mcp' ? (
            <ToolTabView
              messages={realtimeMessages}
              streamingToolCalls={activeToolCalls}
              view="mcp"
              mcpToolNames={mcpToolNames}
            />
          ) : activeTab === 'files' ? (
            <ToolTabView
              messages={realtimeMessages}
              streamingToolCalls={activeToolCalls}
              view="files"
              mcpToolNames={mcpToolNames}
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
            <>
              {/* Task #9: approval-kind clarifies render here — a stable
                  surface next to the composer that isn't gated by tool
                  display mode, the thinking indicator, message search, or
                  message-list anchoring. See `approvalCard` above. */}
              {approvalCard}
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
              {!compact && !hideUi && !isMobile && !isFocusMode ? (
                <button
                  type="button"
                  aria-label={agentsOpen ? 'Close agents' : `Show ${agentCount} agents`}
                  aria-pressed={agentsOpen}
                  title={agentsOpen ? 'Close agents' : `Show ${agentCount} agents`}
                  onClick={() => setAgentsOpen((open) => !open)}
                  className={cn(
                    'absolute right-4 sm:right-6 z-30 flex h-8 items-center gap-1.5 rounded-full border px-3 font-mono text-[11px] shadow-md backdrop-blur-md transition-colors',
                    agentsOpen
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-primary/60 bg-card/90 text-primary hover:bg-primary/10',
                    hasActiveAgents && !agentsOpen && 'attention-pulse',
                  )}
                  style={{
                    bottom: `calc(${terminalPanelInset}px + var(--chat-composer-height, 90px) + 12px)`,
                  }}
                >
                  <Bot className="size-4" aria-hidden="true" />
                  <span className="hidden sm:inline">agents</span>
                  <span className="tabular-nums opacity-80">{agentCount}</span>
                </button>
              ) : null}
            </>
          ) : null}
        </main>
      </div>
      {!compact && agentsOpen ? (
        <DelegationSidebarOverlay
          sessionKey={activeSessionKey || activeFriendlyId}
          onClose={() => setAgentsOpen(false)}
        />
      ) : null}

      {isMobile && (
        <MobileSessionsPanel
          open={sessionsOpen}
          onClose={() => setSessionsOpen(false)}
          sessions={sessions}
          activeFriendlyId={activeFriendlyId}
          onSelectSession={(session) => {
            setSessionsOpen(false)
            void navigate({
              to: '/chat/$sessionKey',
              params: { sessionKey: session.friendlyId },
              search: { profile: session.profile },
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
