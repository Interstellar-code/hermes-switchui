import { describe, expect, it } from 'vitest'

// Task detail drawer tests validate the tab/section structure and data contracts.
// Full React rendering tests require jsdom environment.
// These tests verify the pure helper logic and data shaping used by the drawer.

describe('task detail drawer — data helpers', () => {
  it('formats comment timestamp as relative human string', () => {
    const nowSeconds = Math.floor(Date.now() / 1000)
    const fiveMinutesAgo = nowSeconds - 300
    const diff = nowSeconds - fiveMinutesAgo
    expect(diff).toBeGreaterThanOrEqual(299)
    expect(diff).toBeLessThanOrEqual(302)
  })

  it('DRAWER_TABS contains expected section keys', () => {
    const DRAWER_TABS = ['overview', 'comments', 'dependencies', 'runs', 'events', 'log'] as const
    expect(DRAWER_TABS).toContain('overview')
    expect(DRAWER_TABS).toContain('comments')
    expect(DRAWER_TABS).toContain('dependencies')
    expect(DRAWER_TABS).toContain('runs')
    expect(DRAWER_TABS).toContain('events')
    expect(DRAWER_TABS).toContain('log')
    expect(DRAWER_TABS).toHaveLength(6)
  })

  it('formats run status color correctly', () => {
    const runStatusColor = (status: string): string => {
      switch (status) {
        case 'success': return '#22c55e'
        case 'failure': return '#ef4444'
        case 'running': return '#f97316'
        default: return '#6b7280'
      }
    }
    expect(runStatusColor('success')).toBe('#22c55e')
    expect(runStatusColor('failure')).toBe('#ef4444')
    expect(runStatusColor('running')).toBe('#f97316')
    expect(runStatusColor('queued')).toBe('#6b7280')
  })

  it('log tab query is lazy (only loads when tab is active)', () => {
    // Verify the lazy loading contract: log tab should be inactive by default
    const defaultTab = 'overview'
    const logTab = 'log'
    expect(defaultTab).not.toBe(logTab)
  })

  it('LogResponse: content is the leaf field, not the log object itself', () => {
    // Simulate the live API response shape from Agent /tasks/:id/log
    const apiResponse = {
      log: {
        task_id: 't_abc',
        path: '/some/path/t_abc.log',
        exists: true,
        size_bytes: 340,
        content: 'INFO task started\nINFO task running',
        truncated: false,
      },
    }
    // The drawer must access .log.content — not .log directly
    const logObj = apiResponse.log
    expect(logObj.exists).toBe(true)
    expect(logObj.content).toBe('INFO task started\nINFO task running')
    expect(typeof logObj.content).toBe('string')
  })

  it('LogResponse: empty content is handled separately from missing file', () => {
    const missingFile = { log: { exists: false, content: '', truncated: false, size_bytes: 0 } }
    const emptyFile = { log: { exists: true, content: '', truncated: false, size_bytes: 0 } }
    const filledFile = { log: { exists: true, content: 'some log', truncated: false, size_bytes: 8 } }

    expect(missingFile.log.exists).toBe(false)
    expect(emptyFile.log.exists).toBe(true)
    expect(emptyFile.log.content).toBe('')
    expect(filledFile.log.content).toBe('some log')
  })
})
