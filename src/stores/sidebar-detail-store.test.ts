/**
 * sidebar-detail-store.test.ts — Unit tests for the detail drawer store.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { useSidebarDetailStore } from './sidebar-detail-store'

// Reset store state between tests
beforeEach(() => {
  useSidebarDetailStore.setState({ open: null })
})

describe('useSidebarDetailStore', () => {
  it('starts with open: null', () => {
    expect(useSidebarDetailStore.getState().open).toBeNull()
  })

  it('openDrawer sets open to the given kind and id', () => {
    useSidebarDetailStore.getState().openDrawer('task', 'task-42')
    expect(useSidebarDetailStore.getState().open).toEqual({ kind: 'task', id: 'task-42' })
  })

  it('openDrawer works for mem kind', () => {
    useSidebarDetailStore.getState().openDrawer('mem', 'MEMORY.md')
    expect(useSidebarDetailStore.getState().open).toEqual({ kind: 'mem', id: 'MEMORY.md' })
  })

  it('openDrawer works for cron-run kind', () => {
    useSidebarDetailStore.getState().openDrawer('cron-run', 'job-99')
    expect(useSidebarDetailStore.getState().open).toEqual({ kind: 'cron-run', id: 'job-99' })
  })

  it('closeDrawer sets open back to null', () => {
    useSidebarDetailStore.getState().openDrawer('task', 'task-1')
    useSidebarDetailStore.getState().closeDrawer()
    expect(useSidebarDetailStore.getState().open).toBeNull()
  })

  it('opening a second item replaces the first', () => {
    useSidebarDetailStore.getState().openDrawer('task', 'task-1')
    useSidebarDetailStore.getState().openDrawer('mem', 'MEMORY.md')
    expect(useSidebarDetailStore.getState().open).toEqual({ kind: 'mem', id: 'MEMORY.md' })
  })
})
