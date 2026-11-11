// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatTab } from './chat-tab'
import {
  useBrowseFocusStore,
  useMemoryChatStore,
  useMemoryScreenStore,
} from '@/stores/memory-screen-store'

vi.mock('@/components/ui/toast', () => ({ toast: vi.fn() }))

// jsdom does not implement scrollIntoView; ChatTab calls it on every message update.
Element.prototype.scrollIntoView = vi.fn()

type FileMatch = { path: string; line: number; text: string }
type MnemoMatch = {
  kind: 'gist' | 'fact' | 'episodic'
  text: string
  score: number
}
type SearchFailures = Partial<
  Record<'files' | 'mnemo', 'http' | 'network' | 'json'>
>

function makeStream(str: string) {
  return new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode(str))
      c.close()
    },
  })
}

function mockFetch(
  fileResults: Array<FileMatch>,
  mnemoResults: Array<MnemoMatch>,
  sseText: string,
  failures: SearchFailures = {},
) {
  return vi.fn((url: string) => {
    const u = String(url)
    const source = u.includes('/api/memory/mnemosyne-search')
      ? 'mnemo'
      : u.includes('/api/memory/search')
        ? 'files'
        : null
    if (source) {
      const failure = failures[source]
      if (failure === 'network') {
        return Promise.reject(new Error('Network unavailable'))
      }
      if (failure === 'http') {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({}),
        })
      }
      if (failure === 'json') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.reject(new Error('Invalid JSON')),
        })
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            results: source === 'files' ? fileResults : mnemoResults,
          }),
      })
    }
    if (u.includes('/api/memory/chat')) {
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

  it('gates on empty memory context: no /api/memory/chat call, exact "not in memory" reply', async () => {
    const fetchMock = mockFetch([], [], '')
    vi.stubGlobal('fetch', fetchMock)
    render(<ChatTab />)

    send('What is my favorite color?')

    await waitFor(() => {
      expect(screen.getByText("I don't have that in my memory.")).toBeTruthy()
    })
    expect(
      fetchMock.mock.calls.some((call) =>
        String(call[0]).includes('/api/memory/chat'),
      ),
    ).toBe(false)
  })

  it.each([
    {
      name: 'both searches fail',
      failures: { files: 'http', mnemo: 'network' } satisfies SearchFailures,
    },
    {
      name: 'the files search fails and Mnemosyne returns no matches',
      failures: { files: 'http' } satisfies SearchFailures,
    },
    {
      name: 'the Mnemosyne search fails and files returns no matches',
      failures: { mnemo: 'network' } satisfies SearchFailures,
    },
    {
      name: 'a search returns invalid JSON and the other returns no matches',
      failures: { files: 'json' } satisfies SearchFailures,
    },
  ])('reports a retrieval error when $name', async ({ failures }) => {
    const fetchMock = mockFetch([], [], '', failures)
    vi.stubGlobal('fetch', fetchMock)
    render(<ChatTab />)

    send('What is my favorite color?')

    expect(
      await screen.findByText('Error: Memory search failed. Please try again.'),
    ).toBeTruthy()
    expect(
      fetchMock.mock.calls.some((call) =>
        String(call[0]).includes('/api/memory/chat'),
      ),
    ).toBe(false)
  })

  it.each([
    {
      source: 'memory files',
      files: [{ path: 'MEMORY.md', line: 1, text: 'Favorite color is blue.' }],
      mnemo: [],
      failures: { mnemo: 'network' } satisfies SearchFailures,
    },
    {
      source: 'Mnemosyne',
      files: [],
      mnemo: [
        { kind: 'fact' as const, text: 'Favorite color is blue.', score: 2 },
      ],
      failures: { files: 'http' } satisfies SearchFailures,
    },
  ])(
    'uses partial context from $source when the other search fails',
    async ({ files, mnemo, failures }) => {
      const fetchMock = mockFetch(
        files,
        mnemo,
        'event: chunk\ndata: {"text":"Blue"}\n\n',
        failures,
      )
      vi.stubGlobal('fetch', fetchMock)
      render(<ChatTab />)

      send('What is my favorite color?')

      expect(await screen.findByText('Blue')).toBeTruthy()
      expect(
        fetchMock.mock.calls.some((call) =>
          String(call[0]).includes('/api/memory/chat'),
        ),
      ).toBe(true)
    },
  )

  it('streams a reply from /api/memory/chat when memory context is found', async () => {
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
      fetchMock.mock.calls.some((call) =>
        String(call[0]).includes('/api/memory/chat'),
      ),
    ).toBe(true)
  })

  it('source links open Browse filtered by kind and notify the drawer', async () => {
    const SSE_TEXT = 'event: chunk\ndata: {"text":"ok"}\n\n'
    vi.stubGlobal(
      'fetch',
      mockFetch(
        [],
        [{ kind: 'fact', text: 'Rohit likes fox', score: 2 }],
        SSE_TEXT,
      ),
    )
    const onNavigate = vi.fn()
    render(<ChatTab onNavigate={onNavigate} />)
    send('fox?')
    fireEvent.click(
      await screen.findByRole('button', { name: 'matrix-memory:fact' }),
    )
    expect(useMemoryScreenStore.getState().activeTab).toBe('browse')
    expect(useBrowseFocusStore.getState().focus).toEqual({
      type: 'fact',
      q: '',
    })
    expect(onNavigate).toHaveBeenCalled()
  })

  it('prefills the input from a chat seed without sending; same question re-prefills', () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('should not fetch')))
    vi.stubGlobal('fetch', fetchMock)
    useMemoryChatStore.setState({ chatRequest: null })
    render(<ChatTab />)
    const box = () =>
      screen.getByPlaceholderText<HTMLTextAreaElement>(/Ask about your memory/i)
    act(() => useMemoryChatStore.getState().askMemory('what is fox?'))
    expect(box().value).toBe('what is fox?')
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.change(box(), { target: { value: 'edited' } })
    act(() => useMemoryChatStore.getState().askMemory('what is fox?'))
    expect(box().value).toBe('what is fox?')
    act(() => useMemoryChatStore.getState().askMemory(null))
    expect(box().value).toBe('what is fox?')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('consumes a seed set before mount', () => {
    vi.stubGlobal('fetch', vi.fn())
    useMemoryChatStore.setState({ chatRequest: { seed: 'early', seq: 3 } })
    render(<ChatTab />)
    expect(
      screen.getByPlaceholderText<HTMLTextAreaElement>(/Ask about your memory/i)
        .value,
    ).toBe('early')
  })
})
