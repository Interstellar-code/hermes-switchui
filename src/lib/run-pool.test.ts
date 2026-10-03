import { describe, expect, it } from 'vitest'
import { runPool } from './run-pool'

describe('runPool', () => {
  it('caps concurrency, keeps order, settles failures, reports progress', async () => {
    let inFlight = 0
    let peak = 0
    const progress: Array<number> = []
    const results = await runPool(
      [1, 2, 3, 4, 5, 6, 7],
      3,
      async (n) => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, 8 - n))
        inFlight--
        if (n === 4) throw new Error('boom')
        return n * 10
      },
      (done) => progress.push(done),
    )
    expect(peak).toBe(3)
    expect(results.map((r) => r.status)).toEqual([
      'fulfilled',
      'fulfilled',
      'fulfilled',
      'rejected',
      'fulfilled',
      'fulfilled',
      'fulfilled',
    ])
    expect(results[0]).toEqual({ status: 'fulfilled', value: 10 })
    expect(progress).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('handles an empty list', async () => {
    expect(await runPool([], 4, async () => 1)).toEqual([])
  })
})
