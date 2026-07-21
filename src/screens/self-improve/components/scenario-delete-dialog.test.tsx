// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ScenarioDeleteDialog } from './scenario-delete-dialog'

afterEach(cleanup)

describe('ScenarioDeleteDialog', () => {
  it('identifies the scenario and preserves confirm and cancel actions', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()

    render(
      <ScenarioDeleteDialog
        open
        scenarioName="direct-factual"
        scenarioId={11}
        pending={false}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )

    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('direct-factual')).toBeTruthy()
    expect(screen.getByText(/#11/)).toBeTruthy()

    fireEvent.click(
      screen.getByRole('button', { name: 'Delete direct-factual' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('locks and labels actions while deletion is pending', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()

    render(
      <ScenarioDeleteDialog
        open
        scenarioName="direct-factual"
        scenarioId={11}
        pending
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )

    const deleteButton = screen.getByRole('button', {
      name: 'Deleting direct-factual',
    })
    expect(deleteButton.hasAttribute('disabled')).toBe(true)
    expect(deleteButton.getAttribute('aria-busy')).toBe('true')
    expect(
      screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled'),
    ).toBe(true)
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
  })
})
