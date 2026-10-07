import { describe, expect, it } from 'vitest'
import { getScheduleLabel, isScheduledYaml } from './schedule'

describe('schedule detection (shared by rail + table)', () => {
  it('finds a quoted and a bare cron value on one line', () => {
    expect(getScheduleLabel('schedule: "0 9 * * 1"\n')).toBe('0 9 * * 1')
    expect(getScheduleLabel('cron: 0 */2 * * *\n')).toBe('0 */2 * * *')
  })

  it('does not cross lines: a colon with the value on the next line is not a schedule', () => {
    expect(getScheduleLabel('schedule:\n  - 0 9 * * 1\n')).toBeNull()
  })

  it('ignores keys that merely contain the word schedule', () => {
    expect(getScheduleLabel('reschedule: never\n')).toBeNull()
    expect(isScheduledYaml('name: x\n')).toBe(false)
  })

  it('isScheduledYaml matches indented node-level keys only', () => {
    expect(
      isScheduledYaml('nodes:\n  - id: a\n    schedule: "0 9 * * 1"\n'),
    ).toBe(true)
    // top-level (unindented) key is workflow-level; detect it too via label
    expect(getScheduleLabel('schedule: "0 9 * * 1"\n')).toBe('0 9 * * 1')
  })
})
