// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { scrollChatToBottom } from './chat-screen-utils'

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('scrollChatToBottom', () => {
  it('scrolls the viewport to its scrollHeight with the given behavior', () => {
    const viewport = document.createElement('div')
    viewport.setAttribute('data-chat-scroll-viewport', '')
    Object.defineProperty(viewport, 'scrollHeight', { value: 1234 })
    const scrollTo = vi.fn()
    viewport.scrollTo = scrollTo as unknown as Element['scrollTo']
    document.body.appendChild(viewport)

    scrollChatToBottom('auto')

    expect(scrollTo).toHaveBeenCalledWith({ top: 1234, behavior: 'auto' })
  })

  it('defaults to smooth behavior', () => {
    const viewport = document.createElement('div')
    viewport.setAttribute('data-chat-scroll-viewport', '')
    Object.defineProperty(viewport, 'scrollHeight', { value: 10 })
    const scrollTo = vi.fn()
    viewport.scrollTo = scrollTo as unknown as Element['scrollTo']
    document.body.appendChild(viewport)

    scrollChatToBottom()

    expect(scrollTo).toHaveBeenCalledWith({ top: 10, behavior: 'smooth' })
  })

  it('is a no-op when the viewport is absent', () => {
    expect(() => scrollChatToBottom()).not.toThrow()
  })
})
