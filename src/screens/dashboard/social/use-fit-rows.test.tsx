// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { stubFitGeometry } from './fit-rows-test-utils'
import { useFitRows } from './use-fit-rows'

afterEach(cleanup)

let renders = 0
function List({ n }: { n: number }) {
  const { ref, count } = useFitRows(n, { min: 3, fallback: 5 })
  renders += 1
  return (
    <div ref={ref}>
      <ul>
        {Array.from({ length: n }, (_, i) => (
          <li key={i} data-fit-row="">
            {i < count ? `row ${i}` : 'hidden'}
          </li>
        ))}
      </ul>
    </div>
  )
}

describe('useFitRows', () => {
  it('does not re-render when the observer fires with an unchanged fit', () => {
    const geo = stubFitGeometry({ height: 140 })
    try {
      renders = 0
      render(<List n={8} />)
      const settled = renders
      geo.fire()
      geo.fire()
      expect(renders).toBe(settled)
    } finally {
      geo.restore()
    }
  })
})
