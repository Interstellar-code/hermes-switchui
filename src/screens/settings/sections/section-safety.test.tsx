// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import SectionSafety from './section-safety'
import { resetSettingsStore, useSettingsStore } from '@/stores/settings-store'

function loadDraft(patch: Record<string, unknown>) {
  useSettingsStore.getState().seed(patch)
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
