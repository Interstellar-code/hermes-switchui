import { describe, expect, it } from 'vitest'
import { cronError, nextCronFire } from './schedules-client'

describe('cron helpers', () => {
  it('validates 5 fields', () => {
    expect(cronError('*/5 * * * *')).toBeNull()
    expect(cronError('0 9 * * 1-5')).toBeNull()
    expect(cronError('@daily')).toMatch(/Aliases/)
    expect(cronError('* * * *')).toMatch(/5 fields/)
    expect(cronError('a b c d e')).toMatch(/numbers/)
  })
  it('computes the next local fire', () => {
    const from = new Date(2026, 9, 7, 10, 30) // Wed
    expect(nextCronFire('0 9 * * *', from)).toEqual(new Date(2026, 9, 8, 9, 0))
    expect(nextCronFire('0 9 * * 1', from)).toEqual(new Date(2026, 9, 12, 9, 0))
    expect(nextCronFire('*/15 * * * *', from)).toEqual(
      new Date(2026, 9, 7, 10, 45),
    )
  })
})
