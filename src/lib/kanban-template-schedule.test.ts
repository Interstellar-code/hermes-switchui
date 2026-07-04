import { describe, expect, it } from 'vitest'
import {
  countScheduledTemplateTasks,
  describeTemplateRecurrence,
  summarizeTemplateSchedule,
} from './kanban-template-schedule'

describe('kanban-template-schedule', () => {
  it('counts only tasks with a non-empty scheduled_at value', () => {
    expect(
      countScheduledTemplateTasks({
        schema: 1,
        slug: 'demo',
        name: 'Demo',
        tasks: [
          { key: 'a', title: 'A', scheduled_at: '+2h' },
          { key: 'b', title: 'B', scheduled_at: '' },
          { key: 'c', title: 'C' },
        ],
      }),
    ).toBe(1)
  })

  it('describes recurrence compactly', () => {
    expect(describeTemplateRecurrence({ enabled: true, cron: '0 9 * * 1', timezone: 'UTC' })).toBe('0 9 * * 1 · UTC')
    expect(describeTemplateRecurrence({ enabled: false, cron: '0 9 * * 1' })).toBeNull()
  })

  it('summarizes scheduled tasks plus recurrence together', () => {
    expect(
      summarizeTemplateSchedule({
        schema: 1,
        slug: 'demo',
        name: 'Demo',
        recurrence: { enabled: true, cron: '0 9 * * 1', timezone: 'UTC' },
        tasks: [{ key: 'a', title: 'A', scheduled_at: '+1d' }],
      }),
    ).toEqual({
      scheduledTaskCount: 1,
      recurrenceLabel: '0 9 * * 1 · UTC',
    })
  })
})
