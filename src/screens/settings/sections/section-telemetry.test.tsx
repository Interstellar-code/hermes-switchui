// @vitest-environment jsdom
/**
 * `logging.level` used to be edited here AND in Advanced — two controls for
 * one key, drifting apart. This file pins the resolution: the control lives
 * in Advanced only; Telemetry shows a pointer and keeps the rotation rows.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import SectionTelemetry from './section-telemetry'
import { resetSettingsStore } from '@/stores/settings-store'

afterEach(() => {
  cleanup()
  resetSettingsStore()
})

describe('SectionTelemetry', () => {
  it('no longer renders a logging.level control — one line points at Advanced', () => {
    render(<SectionTelemetry />)

    expect(screen.getByText('Log level is under Advanced.')).toBeTruthy()
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
    expect(screen.queryAllByRole('combobox')).toHaveLength(0)
  })

  it('shows key-meta badges on the rotation rows (config.yaml · Needs restart)', () => {
    render(<SectionTelemetry />)

    const sizeRow = screen
      .getByText('Max file size (MB)')
      .closest('.row') as HTMLElement
    expect(within(sizeRow).getByText('config.yaml')).toBeTruthy()
    expect(within(sizeRow).getByText('Needs restart')).toBeTruthy()

    const backupRow = screen
      .getByText('Backup files to keep')
      .closest('.row') as HTMLElement
    expect(within(backupRow).getByText('config.yaml')).toBeTruthy()
  })
})
