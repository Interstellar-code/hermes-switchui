// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { FileText, Mic, Sparkles } from 'lucide-react'
import { ComposerMobileActionsMenu } from './composer-mobile-actions'

afterEach(() => {
  cleanup()
})

describe('ComposerMobileActionsMenu', () => {
  it('renders trigger button and opens popover on click', () => {
    const actions = [
      { id: 'attach', label: 'Attach file', icon: FileText, onClick: vi.fn() },
      { id: 'voice', label: 'Voice input', icon: Mic, onClick: vi.fn() },
    ]

    render(<ComposerMobileActionsMenu actions={actions} />)
    const trigger = screen.getByTestId('composer-mobile-actions-trigger')
    expect(trigger).toBeDefined()

    // Popover content should not be present before click
    expect(screen.queryByTestId('composer-mobile-actions-content')).toBeNull()

    // Open popover
    fireEvent.click(trigger)
    expect(screen.getByTestId('composer-mobile-actions-content')).toBeDefined()
    expect(screen.getByText('Attach file')).toBeDefined()
    expect(screen.getByText('Voice input')).toBeDefined()
  })

  it('triggers action onClick and closes popover', () => {
    const onAttach = vi.fn()
    const actions = [
      { id: 'attach', label: 'Attach file', icon: FileText, onClick: onAttach },
    ]

    render(<ComposerMobileActionsMenu actions={actions} />)
    fireEvent.click(screen.getByTestId('composer-mobile-actions-trigger'))

    const actionBtn = screen.getByTestId('mobile-action-attach')
    fireEvent.click(actionBtn)

    expect(onAttach).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('composer-mobile-actions-content')).toBeNull()
  })

  it('renders nothing when actions list is empty', () => {
    const { container } = render(<ComposerMobileActionsMenu actions={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('disables trigger when disabled prop is true', () => {
    const actions = [
      { id: 'sparkles', label: 'Reasoning', icon: Sparkles, onClick: vi.fn() },
    ]
    render(<ComposerMobileActionsMenu actions={actions} disabled />)
    const trigger = screen.getByTestId('composer-mobile-actions-trigger') as HTMLButtonElement
    expect(trigger.disabled).toBe(true)
  })
})
