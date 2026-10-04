// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  useBrowseFocusStore,
  useMemoryChatStore,
  useMemoryScreenStore,
} from '../../../../stores/memory-screen-store'
import { MapInspector } from './map-inspector'
import type { GraphNode } from '../memory-map-graph'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const h = vi.hoisted(() => ({
  onClose: vi.fn(),
  onFocusNode: vi.fn(),
  onFocus: vi.fn(),
  onOpenInWiki: vi.fn(),
}))

const n = (id: string, kind: GraphNode['kind'], label = id): GraphNode => ({
  id,
  kind,
  label,
})
const rohit = n('e:rohit', 'entity', 'Rohit')
const neo = n('e:neo', 'entity', 'Neo')
const gist = n('g1', 'gist', 'Memory map note')
const epi = n(
  'ep1',
  'episodic',
  'Rohit Sharma is developing the Hermes Agent ecosyst…',
)
const nodes = [rohit, neo, gist, epi]
const model = {
  byId: new Map(nodes.map((x) => [x.id, x])),
  deg: new Map([
    ['e:rohit', 2],
    ['e:neo', 1],
    ['g1', 1],
  ]),
  dates: new Map([
    [
      'e:rohit',
      { first: '2026-03-12T00:00:00Z', last: '2026-10-03T00:00:00Z' },
    ],
    ['g1', { first: '2026-10-03T00:00:00Z', last: '2026-10-03T00:00:00Z' }],
  ]),
  adj: new Map([
    ['e:rohit', new Set(['e:neo', 'g1', 'ep1'])],
    ['e:neo', new Set(['e:rohit'])],
    ['g1', new Set(['e:rohit'])],
  ]),
}
const clusters = {
  clusterOf: new Map([
    ['e:rohit', 0],
    ['e:neo', 0],
  ]),
  clusters: [{ id: 0, name: 'Personal', size: 6, slot: 0 }],
}

let host: HTMLDivElement | null = null
let root: ReturnType<typeof createRoot> | null = null

async function mount() {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => ({
      ok: true,
      json: () => ({
        id: 'e:rohit',
        kind: 'entity',
        label: 'Rohit',
        text: 'Rohit',
        createdAt: null,
        updatedAt: null,
        source: { distinct_facts: 2, facts: 2 },
        facts: [
          {
            id: 'f1',
            text: 'Prefers terse replies',
            count: 4,
            firstAt: null,
            lastAt: null,
          },
          {
            id: 'f2',
            text: 'Lives in Bengaluru',
            count: 1,
            firstAt: null,
            lastAt: '2026-09-28T00:00:00Z',
          },
        ],
      }),
    })),
  )
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root!.render(
      <QueryClientProvider client={new QueryClient()}>
        <MapInspector
          profile="p"
          selected={rohit}
          model={model}
          clusters={clusters}
          {...h}
        />
      </QueryClientProvider>,
    )
  })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20))
  })
}

const btn = (label: RegExp) =>
  Array.from(host!.querySelectorAll('button')).find((b) =>
    label.test(b.textContent),
  ) as HTMLButtonElement

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  vi.unstubAllGlobals()
  Object.values(h).forEach((f) => f.mockReset())
})

describe('MapInspector', () => {
  it('renders header, facts, linked entities, mentioned-in', async () => {
    await mount()
    const t = host!.textContent
    expect(t).toContain('Personal')
    expect(t).toContain('2 connections')
    expect(t).toContain('first Mar 12')
    expect(t).toContain('Prefers terse replies')
    expect(t).toContain('×4')
    expect(btn(/^Neo$/)).toBeTruthy()
    expect(btn(/Gist · /)).toBeTruthy()
    expect(btn(/other neighbours · 1/)).toBeTruthy()
    expect(host!.querySelector('[aria-label^="fact: Prefers"]')).toBeTruthy()
    // collapsed until opened
    expect(btn(/episode/)).toBeFalsy()
    act(() => btn(/other neighbours/).click())
    act(() => btn(/episode/).click())
    expect(h.onFocusNode).toHaveBeenCalledWith('ep1')
  })

  it('actions call the right handlers', async () => {
    await mount()
    act(() => btn(/^FOCUS$/).click())
    expect(h.onFocus).toHaveBeenCalledWith('e:rohit')
    act(() => btn(/^Neo$/).click())
    expect(h.onFocusNode).toHaveBeenCalledWith('e:neo')

    act(() => btn(/OPEN IN BROWSE/).click())
    expect(useBrowseFocusStore.getState().focus).toEqual({
      type: 'entity',
      q: 'Rohit',
    })
    expect(useBrowseFocusStore.getState().focus!.type).toBe('entity')
    expect(useMemoryScreenStore.getState().activeTab).toBe('browse')

    act(() => btn(/ASK ABOUT/).click())
    expect(useMemoryChatStore.getState().chatRequest?.seed).toBe(
      'What do you know about Rohit?',
    )
  })

  it('Escape closes', async () => {
    await mount()
    act(() => {
      btn(/^FOCUS$/).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
    })
    expect(h.onClose).toHaveBeenCalled()
  })
})
