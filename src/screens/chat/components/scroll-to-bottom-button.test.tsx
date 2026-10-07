// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ScrollToBottomButton } from './scroll-to-bottom-button'

describe('ScrollToBottomButton', () => {
  it('renders pill with label and accent styling when visible', () => {
    const onClick = vi.fn()
    render(
      <ScrollToBottomButton
        isVisible={true}
        unreadCount={0}
        onClick={onClick}
      />,
    )

    const pill = screen.getByTestId('scroll-to-bottom-pill')
    expect(pill).toBeDefined()
    expect(screen.getByText('Latest')).toBeDefined()

    fireEvent.click(pill)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('renders unread badge when unreadCount > 0', () => {
    render(
      <ScrollToBottomButton
        isVisible={true}
        unreadCount={3}
        onClick={vi.fn()}
      />,
    )

    expect(screen.getByText('3 new')).toBeDefined()
  })

  it('renders nothing when isVisible is false', () => {
    const { container } = render(
      <ScrollToBottomButton
        isVisible={false}
        unreadCount={0}
        onClick={vi.fn()}
      />,
    )
    expect(container.firstChild).toBeNull()
  })
})
