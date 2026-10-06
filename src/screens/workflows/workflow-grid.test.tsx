// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { WorkflowGrid } from './workflow-grid'

afterEach(() => {
  cleanup()
})

describe('WorkflowGrid', () => {
  it('renders loadError alert and calls onRetry when clicked', () => {
    const onRetry = vi.fn()
    const onSelect = vi.fn()

    render(
      <WorkflowGrid
        workflows={[]}
        onSelect={onSelect}
        loadError="Workflow engine unavailable"
        onRetry={onRetry}
      />,
    )

    const alert = screen.getByRole('alert')
    expect(alert).toBeTruthy()
    expect(alert.textContent).toContain('Workflow engine unavailable')
    expect(screen.queryByText(/no workflows match/i)).toBeNull()

    const retryButton = screen.getByRole('button', { name: 'Retry' })
    fireEvent.click(retryButton)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('renders empty message when no loadError and workflows list is empty', () => {
    render(<WorkflowGrid workflows={[]} onSelect={vi.fn()} />)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText(/no workflows match/i)).toBeTruthy()
  })
})
