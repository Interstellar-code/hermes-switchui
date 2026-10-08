// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ChatMessageList } from './chat-message-list'
import type { ChatMessage } from '../types'
import { useSessionReasoningStore } from '@/stores/session-reasoning-store'
import { useChatSettingsStore } from '@/hooks/use-chat-settings'
/**
 * Wiring for the per-session reasoning override, verified by rendering the
 * real ChatMessageList with a live streaming turn: the list must compute the
 * effective value (global default + session override) and thread it into
 * MessageItem, where it gates the streaming thinking surface.
 */

const SESSION_KEY = 'chat:wiring-1'
const THINKING_TEXT = 'Weighing two approaches before answering.'

function ensureMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: () => ({
      matches: false,
      media: '',
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

function streamingAssistant(): ChatMessage {
  return {
    id: 'a1',
    role: 'assistant',
    content: [],
    timestamp: 1,
  }
}

function renderStreamingList() {
  return render(
    <ChatMessageList
      messages={[streamingAssistant()]}
      loading={false}
      empty={false}
      waitingForResponse={false}
      sessionKey={SESSION_KEY}
      pinToTop={false}
      pinGroupMinHeight={0}
      headerHeight={0}
      streamingMessageId="a1"
      hasStreamingText={false}
      streamingThinking={THINKING_TEXT}
      isStreaming
    />,
  )
}

beforeEach(() => {
  ensureMatchMedia()
  window.localStorage.clear()
  useSessionReasoningStore.setState({ overrides: {} })
  useChatSettingsStore.setState({
    settings: {
      ...useChatSettingsStore.getState().settings,
      showReasoningBlocks: false,
    },
  })
})

afterEach(cleanup)

describe('ChatMessageList per-session reasoning wiring', () => {
  it('hides streaming reasoning when the global default is off and no override exists', () => {
    renderStreamingList()
    expect(screen.queryByText(THINKING_TEXT)).toBeNull()
  })

  it('shows streaming reasoning when the session override turns it on', () => {
    useSessionReasoningStore.getState().setOverride(SESSION_KEY, true)
    renderStreamingList()
    expect(screen.getByText(THINKING_TEXT)).toBeDefined()
  })

  it('hides streaming reasoning when the session override turns it off against a global on', () => {
    useChatSettingsStore.setState({
      settings: {
        ...useChatSettingsStore.getState().settings,
        showReasoningBlocks: true,
      },
    })
    useSessionReasoningStore.getState().setOverride(SESSION_KEY, false)
    renderStreamingList()
    expect(screen.queryByText(THINKING_TEXT)).toBeNull()
  })

  it('shows streaming reasoning when the global default is on and no override exists', () => {
    useChatSettingsStore.setState({
      settings: {
        ...useChatSettingsStore.getState().settings,
        showReasoningBlocks: true,
      },
    })
    renderStreamingList()
    expect(screen.getByText(THINKING_TEXT)).toBeDefined()
  })
})
