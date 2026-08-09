// @vitest-environment jsdom
/**
 * The two contracts this picker carries. First, a locked relaunch renders no
 * activate control at all — absent, not disabled, matching the plugins step —
 * because switching profiles is a write against `~/.hermes/active_profile`.
 * Second, the live profile is marked in the *accessible name*, not only in the
 * accent outline, and it is ordered first so it is reachable without hunting.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { buildProfileChoices } from '../lib/profile-choices'
import { ProfilePicker } from './profile-picker'

const PAYLOAD = {
  activeProfile: 'default',
  profiles: [
    { name: 'default', model: 'auto' },
    {
      name: 'hermes-switch',
      description: 'Routes tasks across the Tier-2 archetypes.',
      agent_ui: { tier: 1, glyph: 'HS', role: 'Orchestrator' },
    },
    {
      name: 'neo',
      description: 'Implements features. Acts decisively.',
      model: 'auto',
      agent_ui: { tier: 2, glyph: 'NE', role: 'Builder' },
    },
  ],
}

const CHOICES = buildProfileChoices(PAYLOAD)

describe('ProfilePicker', () => {
  afterEach(cleanup)

  it('offers no activate control at all while read-only', () => {
    render(
      <ProfilePicker
        choices={CHOICES}
        activeName="default"
        onActivate={vi.fn()}
        activating={null}
        canWrite={false}
      />,
    )

    expect(screen.queryAllByRole('button')).toHaveLength(0)
    // Still a read, not a blank screen.
    expect(screen.getByText('Hermes Switch')).toBeTruthy()
    expect(screen.getByText(/Read-only for this run/)).toBeTruthy()
  })

  it('marks the active profile and orders it first', () => {
    render(
      <ProfilePicker
        choices={CHOICES}
        activeName="default"
        onActivate={vi.fn()}
        activating={null}
        canWrite
      />,
    )

    const cards = screen.getAllByRole('listitem')
    expect(cards[0].textContent).toContain('Default')
    expect(cards[0].className).toContain('is-active')
    // The state is text, not just an outline colour.
    expect(cards[0].textContent).toContain('Active')

    // And no Activate button on the card that is already live.
    expect(
      screen.queryByRole('button', { name: 'Activate Default' }),
    ).toBeNull()
  })

  it('names each activate control after the profile it switches to', () => {
    const onActivate = vi.fn()
    render(
      <ProfilePicker
        choices={CHOICES}
        activeName="default"
        onActivate={onActivate}
        activating={null}
        canWrite
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Activate Neo' }))
    // The directory name is the identity, not the display label.
    expect(onActivate).toHaveBeenCalledWith('neo')
  })

  it('shows tier, role and model, and disables only the busy card', () => {
    render(
      <ProfilePicker
        choices={CHOICES}
        activeName="default"
        onActivate={vi.fn()}
        activating="neo"
        canWrite
      />,
    )

    expect(screen.getByText('Tier 1')).toBeTruthy()
    expect(screen.getByText('Orchestrator')).toBeTruthy()
    expect(screen.getAllByText(/Model auto/).length).toBeGreaterThan(0)

    expect(screen.getByRole('button', { name: 'Activate Neo' })).toHaveProperty(
      'disabled',
      true,
    )
    expect(
      screen.getByRole('button', { name: 'Activate Hermes Switch' }),
    ).toHaveProperty('disabled', false)
  })

  it("lets the caller's activeName win over a stale row flag", () => {
    // Between an activation and the refetch landing, the cached rows still
    // say the old profile is active. Two marked cards would be a lie.
    render(
      <ProfilePicker
        choices={CHOICES}
        activeName="neo"
        onActivate={vi.fn()}
        activating={null}
        canWrite
      />,
    )
    const marked = screen
      .getAllByRole('listitem')
      .filter((card) => card.className.includes('is-active'))
    expect(marked).toHaveLength(1)
    expect(marked[0].textContent).toContain('Neo')
  })
})
