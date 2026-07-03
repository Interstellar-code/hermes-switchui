import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'

import { useChatStore } from '@/stores/chat-store'
import { setPendingGeneration } from '../pending-send'

export type ActiveSendRecord = {
  sessionKey: string
  friendlyId: string
  clientId: string
}

/**
 * useSendMessageState — owns the send-path state flags, refs, and
 * timer/stream-lifecycle functions extracted from chat-screen.tsx
 * (seam #4 PR 1).
 *
 * Group A: state declarations + refs (sending, activeSendRef,
 * waitingForResponseRef, sessionKeyForWaiting, streamTimer,
 * failsafeTimerRef, refreshHistoryRef, lastSendKeyRef, lastSendAtRef).
 *
 * Group B: timer/stream lifecycle (streamStop, streamStart,
 * streamFinish + cleanup + failsafe effects).
 *
 * `setWaitingForResponse` is also owned here because it closes over
 * `sessionKeyForWaiting.current` — moving it avoids a circular
 * dependency between the hook and the screen.
 *
 * `lastCompletedRunAt` cannot be a direct param due to a dependency
 * cycle (this hook's `waitingForResponseRef` → usePendingApprovals →
 * useRealtimeChatHistory → lastCompletedRunAt). Instead the screen
 * calls `syncLastCompletedRunAt` after the realtime hook returns; a
 * state bump re-triggers the 10 s failsafe effect exactly as before.
 */
export function useSendMessageState(params: {
  activeFriendlyId: string | undefined
  isNewChat: boolean
  waitingForResponse: boolean
  activeRealtimeStreamingRef: RefObject<boolean>
}): {
  // State
  sending: boolean
  setSending: Dispatch<SetStateAction<boolean>>
  // Refs (exposed because Groups C-G still read them)
  activeSendRef: RefObject<ActiveSendRecord | null>
  waitingForResponseRef: RefObject<boolean>
  sessionKeyForWaiting: RefObject<string | undefined>
  lastSendKeyRef: RefObject<string>
  lastSendAtRef: RefObject<number>
  streamTimer: RefObject<number | null>
  failsafeTimerRef: RefObject<number | null>
  refreshHistoryRef: RefObject<() => void>
  // Stream lifecycle functions
  streamStop: () => void
  streamStart: () => void
  streamFinish: () => void
  // Waiting-state setter (moved here — closes over sessionKeyForWaiting)
  setWaitingForResponse: (waiting: boolean) => void
  // Late-sync for lastCompletedRunAt (decoupled from realtime hook cycle)
  syncLastCompletedRunAt: (value: number | null) => void
} {
  const { activeFriendlyId, isNewChat, waitingForResponse, activeRealtimeStreamingRef } = params

  // --- Group A: State declarations + refs ---

  const [sending, setSending] = useState(false)

  // --- Issue #43 fix: lift waitingForResponse into persistent Zustand store ---
  // The store survives component unmount, so navigating away mid-stream
  // doesn't lose the "waiting" flag. sessionStorage backup handles reloads.
  const sessionKeyForWaiting = useRef<string | undefined>(undefined)

  const streamTimer = useRef<number | null>(null)
  const failsafeTimerRef = useRef<number | null>(null)

  const refreshHistoryRef = useRef<() => void>(() => {})

  // Idempotency guard prevents duplicate sends on paste/attach double-fire.
  const lastSendKeyRef = useRef('')
  const lastSendAtRef = useRef(0)
  const activeSendRef = useRef<ActiveSendRecord | null>(null)

  // Hoist refs before useRealtimeChatHistory so applyApprovalRequest (returned
  // by usePendingApprovals) is available when the hook is called. These refs
  // are read non-reactively inside E28's timer callback.
  const waitingForResponseRef = useRef(waitingForResponse)
  useEffect(() => {
    waitingForResponseRef.current = waitingForResponse
  }, [waitingForResponse])

  // setWaitingForResponse — moved from chat-screen.tsx because it closes over
  // sessionKeyForWaiting.current which lives in this hook now.
  const setWaitingForResponse = useCallback((waiting: boolean) => {
    const store = useChatStore.getState()
    const key = sessionKeyForWaiting.current
    if (!key) return
    if (waiting) {
      store.setSessionWaiting(key)
    } else {
      store.clearSessionWaiting(key)
    }
  }, [])

  // lastCompletedRunAt decoupling: the realtime chat-history hook depends on
  // applyApprovalRequest (from usePendingApprovals) which depends on
  // waitingForResponseRef (from this hook) — a cycle. The screen calls
  // syncLastCompletedRunAt after the realtime hook returns; the state bump
  // re-triggers the 10 s failsafe effect exactly as the original dep did.
  const lastCompletedRunAtRef = useRef<number | null>(null)
  const [lastCompletedRunAtVersion, setLastCompletedRunAtVersion] = useState(0)
  const syncLastCompletedRunAt = useCallback((value: number | null) => {
    if (lastCompletedRunAtRef.current !== value) {
      lastCompletedRunAtRef.current = value
      setLastCompletedRunAtVersion((v) => v + 1)
    }
  }, [])

  // --- Group B: Timer/stream lifecycle functions ---

  // --- Stream management ---
  const streamStop = useCallback(() => {
    if (streamTimer.current) {
      window.clearTimeout(streamTimer.current)
      streamTimer.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      streamStop()
      if (failsafeTimerRef.current) {
        window.clearTimeout(failsafeTimerRef.current)
        failsafeTimerRef.current = null
      }
    }
  }, [streamStop])

  const streamFinish = useCallback(() => {
    streamStop()
    if (failsafeTimerRef.current) {
      window.clearTimeout(failsafeTimerRef.current)
      failsafeTimerRef.current = null
    }
    setPendingGeneration(false)
    setWaitingForResponse(false)
    // Issue #53 — also drop the local `sending` flag. The composer's
    // disabled state is keyed off `sending`, so without this the 120s
    // failsafe (see send flow below) clears the spinner but leaves the
    // composer + model selector unclickable until the page is reloaded.
    setSending(false)
  }, [streamStop]) // eslint-disable-line react-hooks/exhaustive-deps -- setWaitingForResponse + setSending + setPendingGeneration are stable

  const streamStart = useCallback(() => {
    if (!activeFriendlyId || isNewChat) return
    // Bug #3 fix: no more 350ms polling loop — SSE handles realtime updates.
    // Single delayed fetch as fallback to catch the initial response.
    if (streamTimer.current) window.clearTimeout(streamTimer.current)
    streamTimer.current = window.setTimeout(() => {
      if (activeRealtimeStreamingRef.current) return
      refreshHistoryRef.current()
    }, 2000)
  }, [activeFriendlyId, isNewChat]) // eslint-disable-line react-hooks/exhaustive-deps -- activeRealtimeStreamingRef + refreshHistoryRef are stable refs

  // Failsafe: clear after done event + 10s if response never shows in display
  useEffect(() => {
    if (lastCompletedRunAtRef.current && waitingForResponse) {
      const timer = window.setTimeout(() => streamFinish(), 10000)
      return () => window.clearTimeout(timer)
    }
  }, [lastCompletedRunAtVersion, waitingForResponse, streamFinish])

  // Hard failsafe: if waiting for 5s+ and SSE missed the done event, refetch history
  useEffect(() => {
    if (!waitingForResponse) return
    const fallback = window.setTimeout(() => {
      if (activeRealtimeStreamingRef.current) return
      refreshHistoryRef.current()
    }, 5000)
    return () => window.clearTimeout(fallback)
  }, [waitingForResponse]) // eslint-disable-line react-hooks/exhaustive-deps -- activeRealtimeStreamingRef + refreshHistoryRef are stable refs

  return {
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
  }
}
