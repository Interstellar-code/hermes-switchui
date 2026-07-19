// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatTab } from './chat-tab'

vi.mock('@/components/ui/toast', () => ({ toast: vi.fn() }))

// jsdom does not implement scrollIntoView; ChatTab calls it on every message update.
Element.prototype.scrollIntoView = vi.fn()

type FileMatch = { path: string; line: number; text: string }
type MnemoMatch = { kind: 'gist' | 'fact' | 'episodic'; text: string; score: number }

function makeStream(str: string) {
  return new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode(str))
      c.close()
    },
  })
}

function mockFetch(fileResults: Array<FileMatch>, mnemoResults: Array<MnemoMatch>, sseText: string) {
  return vi.fn((url: string) => {
    const u = String(url)
    if (u.includes('/api/memory/mnemosyne-search')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: mnemoResults }) })
    }
    if (u.includes('/api/memory/search')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: fileResults }) })
    }
    if (u.includes('/api/send-stream')) {
      return Promise.resolve({ ok: true, body: makeStream(sseText) })
    }
    return Promise.reject(new Error(`unexpected fetch url: ${u}`))
  })
}

function send(text: string) {
  const textarea = screen.getByPlaceholderText(/Ask about your memory/i)
  fireEvent.change(textarea, { target: { value: text } })
  fireEvent.keyDown(textarea, { key: 'Enter' })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ChatTab', () => {
  it('renders the empty state before any message is sent', () => {
    vi.stubGlobal('fetch', mockFetch([], [], ''))
    render(<ChatTab />)
    expect(screen.getByText('Ask about your memory')).toBeTruthy()
  })

  it('gates on empty memory context: no /api/send-stream call, exact "not in memory" reply', async () => {
    const fetchMock = mockFetch([], [], '')
    vi.stubGlobal('fetch', fetchMock)
    render(<ChatTab />)

    send('What is my favorite color?')

    await waitFor(() => {
      expect(screen.getByText("I don't have that in my memory.")).toBeTruthy()
    })
    expect(
      fetchMock.mock.calls.some((call) => String(call[0]).includes('/api/send-stream')),
    ).toBe(false)
  })

  it('streams a reply from /api/send-stream when memory context is found', async () => {
    const SSE_TEXT =
      'event: chunk\ndata: {"text":"Sub"}\n\nevent: chunk\ndata: {"text":"sHero"}\n\n'
    const fetchMock = mockFetch(
      [],
      [{ kind: 'gist', text: 'SubsHero is a SaaS', score: 2 }],
      SSE_TEXT,
    )
    vi.stubGlobal('fetch', fetchMock)
    render(<ChatTab />)

    send('What is SubsHero?')

    await waitFor(() => {
      expect(screen.getByText('SubsHero')).toBeTruthy()
    })
    expect(
      fetchMock.mock.calls.some((call) => String(call[0]).includes('/api/send-stream')),
    ).toBe(true)
  })
})
