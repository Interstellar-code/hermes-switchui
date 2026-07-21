// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ScenarioWizard } from './scenario-wizard'

afterEach(cleanup)

function renderWizard(
  overrides: Partial<React.ComponentProps<typeof ScenarioWizard>> = {},
) {
  const props: React.ComponentProps<typeof ScenarioWizard> = {
    open: true,
    profile: 'hermes-switch',
    pending: false,
    onOpenChange: vi.fn(),
    onCreate: vi.fn(),
    ...overrides,
  }
  render(<ScenarioWizard {...props} />)
  return props
}

describe('ScenarioWizard', () => {
  it('builds a structured payload without leaking the UI template', () => {
    const onCreate = vi.fn()
    renderWizard({ onCreate })

    expect(screen.getByText('hermes-switch')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Scenario type'), {
      target: { value: 'concise' },
    })
    fireEvent.change(screen.getByLabelText('Evaluation split'), {
      target: { value: 'holdout' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    fireEvent.change(screen.getByLabelText('Input'), {
      target: { value: 'Give me a one-line gateway status.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create scenario' }))

    expect(onCreate).toHaveBeenCalledWith({
      profile: 'hermes-switch',
      name: 'concise-response',
      input: 'Give me a one-line gateway status.',
      checks: [{ type: 'max_tokens', value: 120 }],
      holdout: true,
    })
    expect(onCreate.mock.calls[0][0]).not.toHaveProperty('template')
  })

  it('validates each step and preserves data while moving backward', () => {
    renderWizard()

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText('Name is required.')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'direct-status' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText('Input is required.')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Input'), {
      target: { value: 'Is the gateway running?' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect(screen.getByLabelText<HTMLTextAreaElement>('Input').value).toBe(
      'Is the gateway running?',
    )
  })

  it('supports typed checks and shows external submission errors', () => {
    const onCreate = vi.fn()
    renderWizard({ onCreate, error: 'Plugin rejected the scenario.' })

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'uses-status-tool' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.change(screen.getByLabelText('Input'), {
      target: { value: 'Is the gateway running?' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    fireEvent.change(screen.getByLabelText('Check 1 type'), {
      target: { value: 'tool_used' },
    })
    fireEvent.change(screen.getByLabelText('Check 1 value'), {
      target: { value: 'gateway_status' },
    })
    fireEvent.click(screen.getByRole('button', { name: '+ Add check' }))
    fireEvent.change(screen.getByLabelText('Check 2 type'), {
      target: { value: 'judge' },
    })
    fireEvent.change(screen.getByLabelText('Check 2 value'), {
      target: { value: 'Answers yes or no first.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create scenario' }))

    expect(screen.getByRole('alert').textContent).toContain(
      'Plugin rejected the scenario.',
    )
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        checks: [
          { type: 'tool_used', value: 'gateway_status' },
          { type: 'judge', rubric: 'Answers yes or no first.' },
        ],
      }),
    )
  })
})
