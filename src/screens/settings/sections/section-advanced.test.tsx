// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SectionAdvanced from './section-advanced'
import { resetSettingsStore, useSettingsStore } from '@/stores/settings-store'

vi.mock('@/lib/hermes-client', () => ({
  getLogs: vi.fn(),
}))

vi.mock('@/components/ui/toast', () => ({
  toast: vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  resetSettingsStore()
})

describe('SectionAdvanced', () => {
  it('renders the log level row with its key-meta badges (config.yaml · Needs restart)', () => {
    useSettingsStore.getState().seed({ 'config.logging.level': 'INFO' })

    render(<SectionAdvanced />)

    const row = screen.getByText('Log level').closest('.row') as HTMLElement
    expect(within(row).getByText('config.yaml')).toBeTruthy()
    expect(within(row).getByText('Needs restart')).toBeTruthy()
  })

  it('writes the picked level straight to the draft store', () => {
    useSettingsStore.getState().seed({ 'config.logging.level': 'INFO' })

    render(<SectionAdvanced />)

    fireEvent.change(screen.getByDisplayValue('INFO'), {
      target: { value: 'DEBUG' },
    })

    expect(useSettingsStore.getState().draft['config.logging.level']).toBe(
      'DEBUG',
    )
    expect(useSettingsStore.getState().dirty.has('config.logging.level')).toBe(
      true,
    )
  })

  it('keeps a saved value outside the offered list visible instead of snapping blank', () => {
    useSettingsStore.getState().seed({ 'config.logging.level': 'ERROR' })

    render(<SectionAdvanced />)

    expect(screen.getByDisplayValue('ERROR (not offered here)')).toBeTruthy()
  })

  it('gives the diagnostics row no meta — it is a button, not a config key', () => {
    render(<SectionAdvanced />)

    const row = screen
      .getByText('View recent logs')
      .closest('.row') as HTMLElement
    expect(within(row).queryByText('config.yaml')).toBeNull()
  })
})
