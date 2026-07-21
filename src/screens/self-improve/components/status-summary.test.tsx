// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { StatusSummary } from './status-summary'
import type { PluginHealth, ProfileStatus } from '@/lib/self-improve-types'
import type { NextStep } from '@/lib/self-improve-next-step'

afterEach(cleanup)

const healthyHealth: PluginHealth = {
  ok: true,
  plugin: 'karpathy-self-improve',
  version: '0.1.0',
  db_path: '/tmp/db',
  db_exists: true,
}

const unavailableHealth: PluginHealth = {
  ok: false,
  plugin: 'karpathy-self-improve',
  version: '0.1.0',
  db_path: null,
  db_exists: false,
}

const configuredStatus: ProfileStatus = {
  profile: 'default',
  paused: false,
  configured: true,
  target_relpath: 'SOUL.md',
  scenario_counts: { train: 4, holdout: 0 },
  experiment_counts: {
    proposed: 0,
    approved: 0,
    live: 0,
    verified: 0,
    reverted: 0,
    rejected: 0,
  },
  latest_baseline_score: null,
  last_collection_at: null,
  last_proposal_at: null,
  last_verification_at: null,
}

const nextStep: NextStep = {
  key: 'add-holdout',
  label: 'Add held-out scenarios',
  hint: 'Held-out scenarios verify the change generalizes.',
}

describe('StatusSummary', () => {
  it('renders healthy / configured / active pills', () => {
    render(
      <StatusSummary
        profile="default"
        health={healthyHealth}
        status={configuredStatus}
        nextStep={nextStep}
      />,
    )

    expect(screen.getByText('Plugin healthy (v0.1.0)')).toBeTruthy()
    expect(screen.getByText('Profile configured → SOUL.md')).toBeTruthy()
    expect(screen.getByText('Loop active')).toBeTruthy()
  })

  it('renders unavailable / not-configured / paused pills', () => {
    render(
      <StatusSummary
        profile="default"
        health={unavailableHealth}
        status={{ ...configuredStatus, configured: false, paused: true }}
        nextStep={undefined}
      />,
    )

    expect(screen.getByText('Plugin unavailable')).toBeTruthy()
    expect(screen.getByText('Not configured — bootstrap needed')).toBeTruthy()
    expect(screen.getByText('Loop paused')).toBeTruthy()
  })

  it('renders counts from status', () => {
    render(
      <StatusSummary
        profile="default"
        health={healthyHealth}
        status={configuredStatus}
        nextStep={undefined}
      />,
    )

    expect(screen.getByText(/Scenarios 4 train \/ 0 held-out/)).toBeTruthy()
    expect(screen.getByText(/Baseline none/)).toBeTruthy()
    expect(screen.getByText(/Experiments 0/)).toBeTruthy()
  })

  it('shows next-step label and hint when provided, hides when undefined', () => {
    const { rerender } = render(
      <StatusSummary
        profile="default"
        health={healthyHealth}
        status={configuredStatus}
        nextStep={nextStep}
      />,
    )
    expect(screen.getByText('Add held-out scenarios')).toBeTruthy()
    expect(
      screen.getByText(/Held-out scenarios verify the change generalizes\./),
    ).toBeTruthy()

    rerender(
      <StatusSummary
        profile="default"
        health={healthyHealth}
        status={configuredStatus}
        nextStep={undefined}
      />,
    )
    expect(screen.queryByText(/Next step:/)).toBeNull()
  })

  it('shows "never" for null freshness timestamps', () => {
    render(
      <StatusSummary
        profile="default"
        health={healthyHealth}
        status={configuredStatus}
        nextStep={undefined}
      />,
    )

    expect(
      screen.getByText(/collected never · proposed never · verified never/),
    ).toBeTruthy()
  })

  it('renders children as the controls slot', () => {
    render(
      <StatusSummary
        profile="default"
        health={healthyHealth}
        status={configuredStatus}
        nextStep={undefined}
      >
        <button type="button">Collect</button>
      </StatusSummary>,
    )

    expect(screen.getByRole('button', { name: 'Collect' })).toBeTruthy()
  })

  it('does not crash when status, health, and nextStep are all undefined', () => {
    render(
      <StatusSummary
        profile="default"
        health={undefined}
        status={undefined}
        nextStep={undefined}
      />,
    )

    expect(screen.getByText('Plugin unknown')).toBeTruthy()
    expect(screen.getByText('Config unknown')).toBeTruthy()
    expect(screen.getByText('Loop unknown')).toBeTruthy()
  })
})
