// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MapRail } from './map-rail'
import { EDGE_ORDER, KIND_ORDER } from './map-kinds'
import type { MapRailProps } from './map-rail'

;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({
  onColourBy: vi.fn(),
  onSelectCluster: vi.fn(),
  onToggleType: vi.fn(),
  onToggleKind: vi.fn(),
  onMinConnections: vi.fn(),
  onReset: vi.fn(),
}))

const CLUSTERS = {
  clusterOf: new Map<string, number>(),
  clusters: [
    { id: 0, name: 'alpha', size: 5, slot: 0 },
    { id: -1, name: 'Other', size: 2, slot: null },
  ],
}

let host: HTMLDivElement | null = null
let root: ReturnType<typeof createRoot> | null = null

function mount(over: Partial<MapRailProps> = {}) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  const types = Object.fromEntries(EDGE_ORDER.map((t) => [t, true]))
  const kinds = Object.fromEntries(KIND_ORDER.map((k) => [k, true]))
  act(() =>
    root!.render(
      <MapRail
        types={types as MapRailProps['types']}
        kinds={kinds as MapRailProps['kinds']}
        minDegree={0}
        defaultTypes={types as MapRailProps['types']}
        defaultKinds={kinds as MapRailProps['kinds']}
        colourBy="kind"
        counts={{ gist: 3 }}
        maxConn={9}
        clusters={CLUSTERS}
        selectedCluster={null}
        {...h}
        {...over}
      />,
    ),
  )
  return host
}
const q = (sel: string) => host!.querySelector(sel) as HTMLElement
const click = (el: Element) =>
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  Object.values(h).forEach((f) => f.mockClear())
})

describe('MapRail', () => {
  it('colour-by is a radiogroup that calls onColourBy', () => {
    mount()
    expect(q('[role=radiogroup]')).toBeTruthy()
    expect(q('[data-seg=kind]').getAttribute('aria-checked')).toBe('true')
    click(q('[data-seg=cluster]'))
    expect(h.onColourBy).toHaveBeenCalledWith('cluster')
  })

  it('kind and edge-type toggles call handlers, with counts', () => {
    mount()
    const gist = q('[aria-label="gist (3)"]')
    expect(gist.getAttribute('aria-pressed')).toBe('true')
    click(gist)
    expect(h.onToggleKind).toHaveBeenCalledWith('gist')
    click(q('[aria-label="Edge type filters"] button'))
    expect(h.onToggleType).toHaveBeenCalledWith('mentions')
  })

  it('cluster click selects, clicking the selected one deselects', () => {
    mount()
    click(q('[aria-label="Cluster alpha (5)"]'))
    expect(h.onSelectCluster).toHaveBeenCalledWith(0)
    click(q('[aria-label="Cluster Other (2)"]'))
    expect(h.onSelectCluster).toHaveBeenCalledWith(-1)
    act(() => root!.unmount())
    host!.remove()
    mount({ selectedCluster: 0 })
    click(q('[aria-label="Cluster alpha (5)"]'))
    expect(h.onSelectCluster).toHaveBeenLastCalledWith(null)
  })

  it('shows a hint without clusters', () => {
    mount({ clusters: null })
    expect(host!.textContent).toMatch(/Clusters appear/)
  })

  it('slider is labelled and reports changes', () => {
    mount()
    const r = q('input[aria-label="Minimum connections"]') as HTMLInputElement
    const set = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!
    act(() => {
      set.call(r, '4')
      r.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(h.onMinConnections).toHaveBeenCalledWith(4)
  })

  it('Home/End move the colour-by selection', () => {
    mount()
    const seg = q('[data-seg=kind]')
    act(() => {
      seg.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
      )
    })
    expect(h.onColourBy).toHaveBeenLastCalledWith('age')
    act(() => {
      seg.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Home', bubbles: true }),
      )
    })
    expect(h.onColourBy).toHaveBeenLastCalledWith('cluster')
  })

  it('flags active filters on the collapse button', () => {
    mount()
    expect(q('.mm-rail-collapse').getAttribute('aria-label')).not.toMatch(
      /filters active/,
    )
    act(() => root!.unmount())
    host!.remove()
    mount({ minDegree: 2 })
    expect(q('.mm-rail-collapse').getAttribute('aria-label')).toMatch(
      /filters active/,
    )
  })

  it('hint reflects cluster state', () => {
    mount({ colourBy: 'cluster', clusters: null })
    expect(host!.textContent).toMatch(/Computing clusters/)
  })

  it('collapses via the toggle', () => {
    mount()
    click(q('.mm-rail-collapse'))
    expect(q('[role=radiogroup]')).toBeNull()
  })
})
