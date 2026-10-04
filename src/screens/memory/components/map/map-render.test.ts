import { describe, expect, it } from 'vitest'
import {
  AGE_VARS,
  CLUSTER_SLOTS,
  ageOf,
  colourIndex,
  isDimmed,
  miniToSim,
  minimapTransform,
  nodeRadius,
  paletteFor,
  viewportRect,
} from './map-render'
import type { MapPalette } from './map-render'

const P: MapPalette = {
  kind: {
    gist: 'k-gist',
    working: 'k-working',
    fact: 'k-fact',
    entity: 'k-entity',
    episodic: 'k-episodic',
    wiki: 'k-wiki',
  },
  cluster: [...Array.from({ length: CLUSTER_SLOTS }, (_, i) => `c${i}`), 'cO'],
  age: [...AGE_VARS.map((_, i) => `a${i}`), 'undated'],
  text: 't',
  bg: 'b',
  accent: 'acc',
  edge: 'e',
}

describe('colour modes', () => {
  it('each mode selects its own palette', () => {
    expect(paletteFor('cluster', P)).toBe(P.cluster)
    expect(paletteFor('age', P)).toBe(P.age)
    expect(paletteFor('kind', P)).toEqual([
      'k-gist',
      'k-working',
      'k-fact',
      'k-entity',
      'k-episodic',
      'k-wiki',
    ])
  })

  it('cluster mode maps slots 0-7 and sends Other (-1) to the last colour', () => {
    const cols = paletteFor('cluster', P)
    expect(cols[colourIndex('cluster', 'fact', 3, null)]).toBe('c3')
    expect(cols[colourIndex('cluster', 'fact', -1, null)]).toBe('cO')
  })

  it('kind mode ignores cluster and age', () => {
    const cols = paletteFor('kind', P)
    expect(cols[colourIndex('kind', 'entity', 2, 0.9)]).toBe('k-entity')
  })

  it('age mode ramps oldest → newest; undated gets its own bucket', () => {
    const cols = paletteFor('age', P)
    expect(cols[colourIndex('age', 'fact', 0, 0)]).toBe('a0')
    expect(cols[colourIndex('age', 'fact', 0, 1)]).toBe(
      `a${AGE_VARS.length - 1}`,
    )
    expect(cols[colourIndex('age', 'fact', 0, null)]).toBe('undated')
    expect(colourIndex('age', 'fact', 0, 0.5)).toBeGreaterThan(0)
  })

  it('ageOf normalises into 0..1', () => {
    expect(ageOf(5, 0, 10)).toBe(0.5)
    expect(ageOf(null, 0, 10)).toBeNull()
    expect(ageOf(3, 3, 3)).toBe(1) // single timestamp → newest
  })
})

describe('isDimmed', () => {
  const none = { hits: null, neighbors: null, selectedCluster: null }
  it('nothing dims with no search, hover or cluster', () => {
    expect(isDimmed('a', 0, none)).toBe(false)
  })
  it('dims nodes outside the selected cluster', () => {
    const s = { ...none, selectedCluster: 2 }
    expect(isDimmed('a', 2, s)).toBe(false)
    expect(isDimmed('b', 1, s)).toBe(true)
    expect(isDimmed('c', -1, s)).toBe(true)
  })
  it('selecting Other keeps Other nodes lit', () => {
    expect(isDimmed('a', -1, { ...none, selectedCluster: -1 })).toBe(false)
  })
  it('combines search and neighbourhood dimming', () => {
    const s = {
      hits: new Set(['a']),
      neighbors: new Set(['a', 'b']),
      selectedCluster: null,
    }
    expect(isDimmed('a', 0, s)).toBe(false)
    expect(isDimmed('b', 0, s)).toBe(true) // neighbour but not a hit
  })
})

describe('nodeRadius', () => {
  it('grows with sqrt(degree) for every kind, capped at +6', () => {
    expect(nodeRadius('fact', 0)).toBe(2.6)
    expect(nodeRadius('fact', 4)).toBe(4.6)
    expect(nodeRadius('gist', 9)).toBeCloseTo(5.6)
    expect(nodeRadius('entity', 10_000)).toBe(9)
    expect(nodeRadius('wiki', 36)).toBe(nodeRadius('wiki', 1000))
  })
})

describe('minimap geometry', () => {
  const b = { minX: -100, minY: -50, maxX: 100, maxY: 50 }
  const m = minimapTransform(b, 150, 96, 6)

  it('fits bounds inside the minimap, centred', () => {
    // width-bound: (150 - 12) / 200
    expect(m.k).toBeCloseTo(0.69)
    expect(0 * m.k + m.x).toBeCloseTo(75)
    expect(0 * m.k + m.y).toBeCloseTo(48)
    expect(b.minX * m.k + m.x).toBeCloseTo(6)
  })

  it('maps the identity viewport to the minimap', () => {
    const r = viewportRect({ x: 0, y: 0, k: 1 }, 200, 100, m)
    expect(r.x).toBeCloseTo(m.x)
    expect(r.w).toBeCloseTo(200 * m.k)
    expect(r.h).toBeCloseTo(100 * m.k)
  })

  it('zooming in shrinks the viewport rect', () => {
    const r1 = viewportRect({ x: 0, y: 0, k: 1 }, 800, 600, m)
    const r2 = viewportRect({ x: 0, y: 0, k: 2 }, 800, 600, m)
    expect(r2.w).toBeCloseTo(r1.w / 2)
  })

  it('miniToSim inverts the transform', () => {
    const [sx, sy] = miniToSim(75, 48, m)
    expect(sx).toBeCloseTo(0)
    expect(sy).toBeCloseTo(0)
    const [x2] = miniToSim(b.maxX * m.k + m.x, 0, m)
    expect(x2).toBeCloseTo(100)
  })
})
