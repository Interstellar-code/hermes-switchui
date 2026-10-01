// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UnifiedSearch } from './unified-search'
import { useWikiFocusStore } from './wiki-focus-store'
import {
  useBrowseFocusStore,
  useMemoryScreenStore,
} from '@/stores/memory-screen-store'

const body = {
  agentFiles: [{ path: 'memories/MEMORY.md', line: 4, text: 'switchui notes' }],
  wiki: [
    {
      path: 'projects/switchui.md',
      title: 'SwitchUI',
      line: 1,
      text: '# SwitchUI',
    },
  ],
  memories: [{ kind: 'fact', text: 'Rohit builds switchui', score: 1 }],
  failed: [],
}

let urls: Array<string>

beforeEach(() => {
  urls = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      urls.push(String(url))
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(body)),
      })
    }),
  )
  useMemoryScreenStore.setState({ activeTab: 'map', profile: 'hermes-switch' })
  useWikiFocusStore.setState({ path: null })
  useBrowseFocusStore.setState({ focus: null })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function search() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <UnifiedSearch />
    </QueryClientProvider>,
  )
  const input = screen.getByRole('combobox')
  fireEvent.change(input, { target: { value: 'switchui' } })
  await screen.findByRole('option', { name: /SwitchUI/ })
  return input
}

describe('UnifiedSearch', () => {
  it('queries the profile and groups results by source', async () => {
    await search()
    expect(urls[0]).toBe(
      '/api/memory/unified-search?q=switchui&profile=hermes-switch',
    )
    const groups = screen.getAllByRole('group').map((g) => g.textContent)
    expect(groups[0]).toMatch(/^Agent files \(all profiles\)/)
    expect(screen.getByRole('status').textContent).toBe(
      '3 matches · Enter to open',
    )
    expect(groups[1]).toMatch(/^Wiki/)
    expect(groups[2]).toMatch(/^Memories/)
  })

  it('wiki hit → focuses the page and switches to the Wiki tab', async () => {
    await search()
    fireEvent.mouseDown(screen.getByRole('option', { name: /SwitchUI/ }))
    expect(useWikiFocusStore.getState().path).toBe('projects/switchui.md')
    expect(useMemoryScreenStore.getState().activeTab).toBe('wiki')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('memory hit → Browse filtered by kind + the hit words', async () => {
    await search()
    fireEvent.mouseDown(screen.getByRole('option', { name: /Rohit builds/ }))
    expect(useBrowseFocusStore.getState().focus).toEqual({
      type: 'fact',
      q: 'Rohit builds switchui',
    })
    expect(useMemoryScreenStore.getState().activeTab).toBe('browse')
  })

  it('keyboard: Enter on the active option opens the agent-files tab', async () => {
    const input = await search()
    expect(input.getAttribute('aria-activedescendant')).toBe('mem-search-0')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(useMemoryScreenStore.getState().activeTab).toBe('memory')
  })
})
