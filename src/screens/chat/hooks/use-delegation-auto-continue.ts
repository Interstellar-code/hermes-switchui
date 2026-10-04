import { useEffect, useRef } from 'react'

import { getMessageTimestamp } from '../utils'
import type { ChatMessage } from '../types'

const KEY_PREFIX = 'deleg-continued:'
const KEY_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** The completion card that is the last message, if any. */
export function lastDelegationCompletion(
  messages: ReadonlyArray<ChatMessage>,
): ChatMessage | null {
  const last = messages.at(-1)
  return last?.__delegationComplete ? last : null
}

export function delegationContinueKey(
  sessionKey: string,
  message: ChatMessage,
): string {
  // Message id too: a "task failed" notice and its later batch-complete row
  // share one delegation id, and each deserves its own continue.
  const id = message.__delegationComplete?.delegationId ?? ''
  return `${KEY_PREFIX}${sessionKey}:${id}:${String(message.id ?? '')}`
}

export function shouldAutoContinue(
  messages: ReadonlyArray<ChatMessage>,
  state: { enabledAt: number | undefined; idle: boolean },
): ChatMessage | null {
  if (!state.enabledAt || !state.idle) return null
  const card = lastDelegationCompletion(messages)
  if (!card) return null
  // An early "one task failed" notice: siblings are still running, so wait
  // for the batch-complete row instead of starting a turn now.
  if (card.__delegationComplete?.isTaskFailure) return null
  // Rows that landed before the toggle was switched on stay manual.
  if (getMessageTimestamp(card) < state.enabledAt) return null
  return card
}

export function isDelegationContinued(key: string): boolean {
  return typeof localStorage !== 'undefined' && !!localStorage.getItem(key)
}

/** Record the card as handled (a manual send, Continue, or the auto nudge). */
export function markDelegationContinued(key: string): void {
  localStorage.setItem(key, String(Date.now()))
}

function pruneOldClaims(now: number) {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i)
    if (!k?.startsWith(KEY_PREFIX)) continue
    if (now - Number(localStorage.getItem(k)) > KEY_TTL_MS) {
      localStorage.removeItem(k)
    }
  }
}

/**
 * Once-only claim across tabs and reloads. The Web Lock serialises tabs that
 * race on the same completion; the localStorage key remembers the claim.
 */
export async function claimDelegationContinue(key: string): Promise<boolean> {
  const claim = () => {
    pruneOldClaims(Date.now())
    if (localStorage.getItem(key)) return false
    markDelegationContinued(key)
    return true
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- absent in older browsers / jsdom
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks
      .request(key, { ifAvailable: true }, (lock) => (lock ? claim() : false))
      .catch(() => claim())
  }
  // ponytail: no Web Locks → plain check-and-set, two tabs can race in the
  // same tick. Every browser SwitchUI targets ships navigator.locks.
  return claim()
}

/**
 * Opt-in auto-continue: when a new completion card is the last message and
 * the chat is idle, send the nudge once. A failed nudge is not retried: the
 * claim is already spent (Continue hides too), so the user types to resume.
 */
export function useDelegationAutoContinue({
  sessionKey,
  messages,
  enabledAt,
  idle,
  sendNudge,
}: {
  sessionKey: string | undefined
  messages: ReadonlyArray<ChatMessage>
  enabledAt: number | undefined
  idle: boolean
  sendNudge: () => void
}) {
  const card = sessionKey
    ? shouldAutoContinue(messages, { enabledAt, idle })
    : null
  const key =
    card && sessionKey ? delegationContinueKey(sessionKey, card) : null
  const sendNudgeRef = useRef(sendNudge)
  sendNudgeRef.current = sendNudge

  useEffect(() => {
    if (!key) return
    // No cleanup-cancel: under StrictMode the first run would win the claim
    // and then be cancelled, leaving nothing sent. The claim alone dedupes.
    void claimDelegationContinue(key).then((claimed) => {
      if (claimed) sendNudgeRef.current()
    })
  }, [key])
}
