// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { fireEvent } from '@testing-library/dom'
import { MessageContextMenu } from './message-context-menu'

const writeTextToClipboard = vi.fn(() => Promise.resolve())

vi.mock('@/lib/clipboard', () => ({
  writeTextToClipboard: (...args: Array<string>) => writeTextToClipboard(...args),
}))

function renderMenu(ui: React.ReactElement) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(ui)
  })
  return { container, root }
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: 720, configurable: true })
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('MessageContextMenu', () => {
  it('renders into document.body and exposes copy/reply/quote actions', () => {
    const onClose = vi.fn()
    const onReply = vi.fn()
    const onQuote = vi.fn()
    renderMenu(
      <MessageContextMenu
        position={{ x: 120, y: 80 }}
        text="hello world"
        onClose={onClose}
        onReply={onReply}
        onQuote={onQuote}
      />,
    )

    const menu = document.body.querySelector('[role="menu"][aria-label="Message actions"]')
    expect(menu).not.toBeNull()

    fireEvent.click(document.body.querySelector('[role="menuitem"]')!)
    expect(writeTextToClipboard).toHaveBeenCalledWith('hello world')
  })

  it('surfaces retry and closes on escape', () => {
    const onClose = vi.fn()
    const onRetry = vi.fn()
    renderMenu(
      <MessageContextMenu
        position={{ x: 1260, y: 700 }}
        text="failed message"
        onClose={onClose}
        onRetry={onRetry}
      />,
    )

    const retryButton = Array.from(
      document.body.querySelectorAll('[role="menuitem"]'),
    ).find((node) => node.textContent.includes('Retry'))

    expect(retryButton).toBeTruthy()
    fireEvent.click(retryButton!)
    expect(onRetry).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})


it('fires quote when the Quote action is clicked', () => {
  const onClose = vi.fn()
  const onQuote = vi.fn()
  renderMenu(
    <MessageContextMenu
      position={{ x: 120, y: 80 }}
      text="quoted text"
      onClose={onClose}
      onQuote={onQuote}
    />,
  )

  const quoteButton = Array.from(document.body.querySelectorAll('[role="menuitem"]')).find((node) => node.textContent?.includes('Quote'))
  expect(quoteButton).toBeTruthy()
  fireEvent.click(quoteButton!)
  expect(onQuote).toHaveBeenCalledTimes(1)
})
