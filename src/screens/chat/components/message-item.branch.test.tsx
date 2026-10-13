// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { fireEvent } from '@testing-library/dom'
import { MessageItem } from './message-item'
import type { Root } from 'react-dom/client'
import type { ChatMessage } from '../types'

/**
 * P1.1 (contract C1): the passage selected at right-click time must reach
 * `onBranchMessage` as its second argument, exactly the way the Quote action
 * passes it to `onReplyMessage`. The selection is captured by the bubble's
 * context-menu handler from the real DOM selection (jsdom Selection + Range).
 */

// React 19: without this flag, updates fired outside act() are scheduled but
// not flushed synchronously, so the context-menu portal never opens.

;

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// A YouTube-catalog-style report: heading, bullet list of tools, a link.
const CATALOG_TEXT = [
  '# YouTube catalog tools',
  '',
  '- yt-dlp — download a single video or the whole channel',
  '- gallery-dl — image sets from a channel page',
  '- ffmpeg — normalize audio and cut intro silence',
  '',
  '[Catalog notes](https://example.com/catalog-notes)',
].join('\n')

function makeMessage(): ChatMessage {
  return {
    role: 'assistant',
    id: 'msg-1042',
    content: [{ type: 'text', text: CATALOG_TEXT }],
  }
}

function renderMessageItem(ui: React.ReactElement): Root {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(ui)
  })
  return root
}

function openBranchMenu(bubble: HTMLElement) {
  act(() => {
    fireEvent.contextMenu(bubble, { clientX: 12, clientY: 12 })
  })
  const branchButton = findMenuButton('Branch from here')
  expect(branchButton).toBeDefined()
  return branchButton!
}

function findMenuButton(label: string): HTMLButtonElement | undefined {
  return Array.from(
    document.body.querySelectorAll<HTMLButtonElement>('[role="menu"] button'),
  ).find((button) => button.textContent === label)
}

/** Selects `length` chars starting at `needle` inside the bubble, through a
 * real DOM Selection so `getContainedSelectionText` reads it like in the app. */
function selectInsideBubble(
  bubble: HTMLElement,
  needle: string,
  length: number,
): string {
  const walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode() as Text | null
  while (node) {
    const index = node.data.indexOf(needle)
    if (index >= 0) {
      const range = document.createRange()
      range.setStart(node, index)
      range.setEnd(node, index + length)
      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      return selection.toString()
    }
    node = walker.nextNode() as Text | null
  }
  throw new Error(`text not found inside bubble: ${needle}`)
}

afterEach(() => {
  window.getSelection()?.removeAllRanges()
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('MessageItem branch action (contract C1)', () => {
  it('right-click with a selection, then Branch: onBranchMessage receives (message, selectedText)', () => {
    const onBranchMessage = vi.fn()
    const message = makeMessage()
    renderMessageItem(
      <MessageItem message={message} onBranchMessage={onBranchMessage} />,
    )

    const bubble = document.querySelector(
      '[data-chat-message-bubble="assistant"]',
    ) as HTMLElement
    expect(bubble).not.toBeNull()

    const selected = selectInsideBubble(bubble, 'yt-dlp', 'yt-dlp'.length)
    expect(selected).toBe('yt-dlp')

    const branchButton = openBranchMenu(bubble)
    act(() => {
      fireEvent.click(branchButton)
    })

    expect(onBranchMessage).toHaveBeenCalledTimes(1)
    expect(onBranchMessage.mock.calls[0][0]).toBe(message)
    // The passage itself — this is the assertion that fails before P1.1.
    expect(onBranchMessage.mock.calls[0][1]).toBe('yt-dlp')
  })

  it('right-click without a selection: onBranchMessage receives (message, undefined)', () => {
    const onBranchMessage = vi.fn()
    const message = makeMessage()
    renderMessageItem(
      <MessageItem message={message} onBranchMessage={onBranchMessage} />,
    )

    const bubble = document.querySelector(
      '[data-chat-message-bubble="assistant"]',
    ) as HTMLElement
    window.getSelection()?.removeAllRanges()

    const branchButton = openBranchMenu(bubble)
    act(() => {
      fireEvent.click(branchButton)
    })

    expect(onBranchMessage).toHaveBeenCalledTimes(1)
    expect(onBranchMessage.mock.calls[0][0]).toBe(message)
    expect(onBranchMessage.mock.calls[0][1]).toBeUndefined()
  })
})
