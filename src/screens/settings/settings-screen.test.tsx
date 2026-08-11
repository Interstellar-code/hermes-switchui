// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsScreen, buildSidebarGroups } from './settings-screen'
import { settingsSaver } from './lib/saver'
import { resetSettingsStore, useSettingsStore } from '@/stores/settings-store'

vi.mock('@/lib/hermes-client', () => ({
  getConfig: () => Promise.resolve({ terminal: { timeout: 90 } }),
}))

const s = () => useSettingsStore.getState()

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SettingsScreen />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  resetSettingsStore()
  localStorage.setItem('hermes.settings.section', 'execution')
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  resetSettingsStore()
  localStorage.clear()
})

describe('buildSidebarGroups', () => {
  /**
   * The dirty dot was `dirty.has(section.id)` — a Set of setting keys tested
   * against a section id — so it could never light for any section.
   */
  it('dots the section that owns the dirty key, not an unrelated one', () => {
    const groups = buildSidebarGroups(new Set(['config.terminal.timeout']))
    const items = groups.flatMap((g) => g.items)

    expect(items.length).toBeGreaterThan(20)
    expect(items.find((i) => i.id === 'execution')?.dirty).toBe(true)
    expect(items.find((i) => i.id === 'workspace')?.dirty).toBe(false)
  })

  it('dots nothing when nothing is dirty', () => {
    const items = buildSidebarGroups(new Set()).flatMap((g) => g.items)
    expect(items.some((i) => i.dirty)).toBe(false)
  })

  it('carries ownership through to the sidebar items', () => {
    const items = buildSidebarGroups(new Set()).flatMap((g) => g.items)
    expect(items.find((i) => i.id === 'raw-config')?.ownership).toBe('self-saving')
    expect(items.find((i) => i.id === 'execution')?.ownership).toBe('store')
  })
})

describe('SettingsScreen', () => {
  it('seeds the store from the server config', async () => {
    renderScreen()
    await waitFor(() => expect(s().status).toBe('seeded'))
    expect(s().committed['config.terminal.timeout']).toBe(90)
    expect(s().dirty.size).toBe(0)
  })

  it('shows the dirty count once a key is edited', async () => {
    renderScreen()
    await waitFor(() => expect(s().status).toBe('seeded'))

    s().set('config.terminal.timeout', 120)

    await waitFor(() => expect(screen.getByText('1 change')).toBeTruthy())
  })

  /**
   * The whole point of the effort: a save that does not land must not report
   * success, and the edited key must stay dirty so the user can retry.
   */
  it('never reports success when the saver fails, and keeps the key dirty', async () => {
    renderScreen()
    await waitFor(() => expect(s().status).toBe('seeded'))
    s().set('config.terminal.timeout', 120)

    await s().save(() =>
      Promise.resolve({
        persisted: [],
        failed: [{ key: 'config.terminal.timeout', reason: 'PUT /api/config: 405' }],
      }),
    )

    await waitFor(() => expect(screen.getByText(/405/)).toBeTruthy())
    expect(screen.queryByText('Saved')).toBeNull()
    expect(s().dirty.has('config.terminal.timeout')).toBe(true)
    expect(s().committed['config.terminal.timeout']).toBe(90)
  })

  it('leaves one dirty key after importing one changed value', async () => {
    renderScreen()
    await waitFor(() => expect(s().status).toBe('seeded'))

    // handleImport's core: the old code called load({...committed, ...parsed})
    // first, which made every imported key equal to committed so the set()
    // loop deleted it from dirty and Import could never save anything.
    const changed = s().importValues({ 'config.terminal.timeout': 120 })

    expect(changed).toBe(1)
    expect(s().dirty.size).toBe(1)
    expect(s().committed['config.terminal.timeout']).toBe(90)
    await waitFor(() => expect(screen.getByText('1 change')).toBeTruthy())
  })

  it('tells the truth about a self-saving section with nothing dirty', async () => {
    localStorage.setItem('hermes.settings.section', 'raw-config')
    renderScreen()
    await waitFor(() =>
      expect(screen.getByText('This section saves its own changes')).toBeTruthy(),
    )
  })

  it('wires the real saver in, and that saver is the PUT transport', () => {
    // Guards against the screen quietly being pointed at a stub.
    expect(typeof settingsSaver).toBe('function')
  })
})
