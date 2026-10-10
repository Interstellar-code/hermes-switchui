// @vitest-environment jsdom
/**
 * The danger zone used to ship two rows that could not do anything: "Clear
 * caches" and "Delete workspace" toasted that the gateway lacked the endpoint.
 * Both are deleted outright — this test pins their absence so they cannot be
 * resurrected as stubs — and the reset row is renamed to describe the only
 * thing it actually does: clear SwitchUI's own `hermes.*` localStorage.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SectionDanger from './section-danger'

vi.mock('@/lib/hermes-client', () => ({
  gatewayRestart: vi.fn(),
}))

vi.mock('@/components/ui/toast', () => ({
  toast: vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SectionDanger', () => {
  it('renders the reset row as "Reset local UI settings" with localStorage-only copy', () => {
    render(<SectionDanger />)

    expect(
      screen.getByRole('button', { name: /Reset local UI settings/ }),
    ).toBeTruthy()
    expect(
      screen.getByText(
        /Clears SwitchUI's hermes\.\* localStorage keys in this browser/,
      ),
    ).toBeTruthy()
    // It must not claim to touch the agent's config.yaml.
    expect(
      screen.getByText(/does not touch the agent's config\.yaml/),
    ).toBeTruthy()
  })

  it('renders no "Clear caches" or "Delete workspace" stubs', () => {
    render(<SectionDanger />)

    expect(screen.queryByText('Clear caches')).toBeNull()
    expect(screen.queryByText('Clear all caches')).toBeNull()
    expect(screen.queryByText('Delete workspace')).toBeNull()
    expect(screen.queryByLabelText(/Type DELETE to confirm/)).toBeNull()
  })

  it('keeps the gateway restart row, the one destructive action that works', () => {
    render(<SectionDanger />)

    expect(screen.getByText('Restart gateway')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Restart/ })).toBeTruthy()
  })
})
