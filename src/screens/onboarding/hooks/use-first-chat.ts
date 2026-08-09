'use client'

/**
 * use-first-chat.ts — the gate's I/O half.
 *
 * One real round trip through `/api/send-stream`, aborted on unmount and on a
 * timeout so a hung provider cannot wedge the wizard. The state machine and
 * every piece of copy live in `chat-gate.ts`; the parser lives in
 * `first-chat.ts`. This file owns only the request and its lifetime.
 *
 * `skip()` is here rather than in the step body because it is a state
 * transition like any other, and because keeping it beside `send()` makes it
 * obvious in review that the two are the only ways the gate can settle.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { CHAT_GATE_UNTESTED } from '../lib/chat-gate'
import {
  FIRST_CHAT_PROMPT,
  looksLikeCredentialFailure,
  parseFirstChatStream,
} from '../lib/first-chat'
import type { ChatGateState } from '../lib/chat-gate'

const TIMEOUT_MS = 30_000

export type UseFirstChatResult = {
  state: ChatGateState
  send: () => Promise<void>
  skip: () => void
  reset: () => void
  /** The prompt that will be sent, so the step can show it verbatim. */
  prompt: string
}

export function useFirstChat(): UseFirstChatResult {
  const [state, setState] = useState<ChatGateState>(CHAT_GATE_UNTESTED)
  const mountedRef = useRef(true)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  const send = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    setState({ kind: 'sending' })

    try {
      const res = await fetch('/api/send-stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionKey: 'new',
          friendlyId: 'new',
          message: FIRST_CHAT_PROMPT,
        }),
        signal: controller.signal,
      })
      const body = await res.text().catch(() => '')
      if (!mountedRef.current || controller.signal.aborted) return
      const { reply, error } = parseFirstChatStream(body)

      if (error) {
        setState({
          kind: 'failed',
          // Verbatim. A paraphrase of "invalid_api_key" helps nobody.
          error,
          credentialLikely: looksLikeCredentialFailure(error),
        })
        return
      }
      if (!res.ok) {
        const message = `The chat request failed (HTTP ${res.status}).`
        setState({
          kind: 'failed',
          error: message,
          credentialLikely: res.status === 401 || res.status === 403,
        })
        return
      }
      if (!reply) {
        setState({
          kind: 'failed',
          error: 'The provider accepted the request but sent nothing back.',
          credentialLikely: false,
        })
        return
      }
      setState({ kind: 'passed', reply })
    } catch (err) {
      if (!mountedRef.current) return
      const aborted = err instanceof Error && err.name === 'AbortError'
      setState({
        kind: 'failed',
        error: aborted
          ? 'The provider did not answer within 30 seconds.'
          : err instanceof Error
            ? err.message
            : 'The chat request failed.',
        credentialLikely: false,
      })
    } finally {
      clearTimeout(timer)
    }
  }, [])

  const skip = useCallback(() => {
    abortRef.current?.abort()
    setState({ kind: 'skipped', at: Date.now() })
  }, [])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setState(CHAT_GATE_UNTESTED)
  }, [])

  return { state, send, skip, reset, prompt: FIRST_CHAT_PROMPT }
}
