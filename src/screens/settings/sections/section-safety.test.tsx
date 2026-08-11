// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import {
  cleanup,
  fireEvent,
  render as rtlRender,
  screen,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SectionSafety from './section-safety'
import type { ReactElement } from 'react'
import { resetSettingsStore, useSettingsStore } from '@/stores/settings-store'

function loadDraft(patch: Record<string, unknown>) {
  useSettingsStore.getState().seed(patch)
}

/**
 * The approval-mode picker binds its options to `GET /api/config/schema` via
 * `useSchemaOptions`, so the section needs a QueryClientProvider. The schema
 * request fails in jsdom, which is deliberately exercised here: the picker must
 * fall back to its hardcoded modes rather than render empty.
 */
function render(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return rtlRender(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  resetSettingsStore()
})

describe('SectionSafety', () => {
  it('renders a critical combined-posture headline for manual mode + destructive allowlist entries', () => {
    loadDraft({
      'config.approvals.mode': 'manual',
      'config.command_allowlist': [
        'recursive delete',
        'git force push (rewrites remote history)',
      ],
      'config.security.tirith_enabled': true,
      'config.security.tirith_fail_open': true,
    })

    render(<SectionSafety />)

    expect(screen.getByText(/Manual approval, but 2 commands bypass it entirely/)).toBeTruthy()
    expect(screen.getByText('Critical')).toBeTruthy()
  })

  it('lists each allowlist entry with its description and a revoke button', () => {
    loadDraft({
      'config.approvals.mode': 'manual',
      'config.command_allowlist': ['recursive delete'],
    })

    render(<SectionSafety />)

    expect(screen.getByText('recursive delete')).toBeTruthy()
    expect(screen.getByText(/rm -rf and equivalents/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeTruthy()
  })

  it('revoking an entry removes it from the draft allowlist', () => {
    loadDraft({
      'config.approvals.mode': 'manual',
      'config.command_allowlist': ['recursive delete', 'git clean with force (deletes untracked files)'],
    })

    render(<SectionSafety />)

    const revokeButtons = screen.getAllByRole('button', { name: 'Revoke' })
    fireEvent.click(revokeButtons[0])

    expect(useSettingsStore.getState().draft['config.command_allowlist']).toEqual([
      'git clean with force (deletes untracked files)',
    ])
  })

  it('shows the clean empty state when the allowlist is empty', () => {
    loadDraft({
      'config.approvals.mode': 'manual',
      'config.command_allowlist': [],
      'config.security.tirith_enabled': true,
      'config.security.tirith_fail_open': false,
    })

    render(<SectionSafety />)

    expect(screen.getByText(/No commands are permanently pre-approved/)).toBeTruthy()
    expect(screen.getByText('OK')).toBeTruthy()
  })
})
