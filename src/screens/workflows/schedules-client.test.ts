import { describe, expect, it } from 'vitest'
import { cronError, nextCronFire } from './schedules-client'

describe('cron helpers', () => {
  it('validates 5 fields', () => {
    expect(cronError('*/5 * * * *')).toBeNull()
    expect(cronError('0 9 * * 1-5')).toBeNull()
    for (const a of ['@hourly', '@daily', '@weekly', '@monthly', '@yearly'])
      expect(cronError(a)).toBeNull()
    expect(cronError('@reboot')).toMatch(/Supported aliases/)
    expect(cronError('* * * *')).toMatch(/5 fields/)
    expect(cronError('a b c d e')).toMatch(/numbers/)
  })
  it('range-checks every field and step', () => {
    expect(cronError('60 * * * *')).toMatch(/minute must be 0-59/)
    expect(cronError('0 24 * * *')).toMatch(/hour must be 0-23/)
    expect(cronError('0 0 0 * *')).toMatch(/day must be 1-31/)
    expect(cronError('0 0 1 13 *')).toMatch(/month must be 1-12/)
    expect(cronError('0 0 * * 8')).toMatch(/weekday must be 0-7/)
    expect(cronError('*/0 * * * *')).toMatch(/steps 1 or more/)
    expect(cronError('5-1 * * * *')).toMatch(/minute/)
    expect(cronError('0 0 * * 7')).toBeNull()
  })
  it('handles aliases, Sunday as 7, and never-firing expressions quickly', () => {
    const from = new Date(2026, 9, 7, 10, 30) // Wed
    expect(nextCronFire('@daily', from)).toEqual(new Date(2026, 9, 8, 0, 0))
    expect(nextCronFire('0 0 * * 7', from)).toEqual(new Date(2026, 9, 11, 0, 0))
    expect(nextCronFire('0 0 29 2 *', from)).toEqual(
      new Date(2028, 1, 29, 0, 0),
    )
    const t = performance.now()
    expect(nextCronFire('0 0 31 2 *', from)).toBeNull()
    expect(nextCronFire('59 23 31 11 *', from)).toBeNull()
    expect(performance.now() - t).toBeLessThan(200)
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
