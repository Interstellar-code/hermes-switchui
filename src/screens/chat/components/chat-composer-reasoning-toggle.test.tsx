// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ReasoningToggle } from './chat-composer-shadcn'
import { TooltipProvider } from '@/components/shadcn/ui/tooltip'
import { useSessionReasoningStore } from '@/stores/session-reasoning-store'
import { useChatSettingsStore } from '@/hooks/use-chat-settings'

/**
 * The composer's per-session reasoning toggle, exercised through the real
 * extracted component the toolbar renders (`ReasoningToggle`) with the real
 * stores and real localStorage — nothing mocked.
 */

function setGlobalShowReasoningBlocks(value: boolean) {
  useChatSettingsStore.setState({
    settings: {
      ...useChatSettingsStore.getState().settings,
      showReasoningBlocks: value,
    },
  })
}

function renderToggle(sessionKey?: string) {
  return render(
    <TooltipProvider>
      <ReasoningToggle sessionKey={sessionKey} />
    </TooltipProvider>,
  )
}

beforeEach(() => {
  window.localStorage.clear()
  useSessionReasoningStore.setState({ overrides: {} })
  setGlobalShowReasoningBlocks(false)
})

afterEach(cleanup)

describe('ReasoningToggle', () => {
  it('renders nothing on a new unsaved chat (no session key)', () => {
    const { container } = renderToggle(undefined)
    expect(container.firstChild).toBeNull()
  })

  it('reflects the global default while no override is set', () => {
    setGlobalShowReasoningBlocks(true)
    renderToggle('chat:t1')
    const button = screen.getByRole('button', {
      name: 'Hide reasoning (this chat)',
    })
    expect(button.getAttribute('aria-pressed')).toBe('true')
  })

  it('clicking flips aria-pressed and writes the override for that session', () => {
    renderToggle('chat:t1')
    const button = screen.getByRole('button', {
      name: 'Show reasoning (this chat)',
    })
    expect(button.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(button)
    expect(useSessionReasoningStore.getState().overrides['chat:t1']).toBe(true)

    const pressed = screen.getByRole('button', {
      name: 'Hide reasoning (this chat)',
    })
    expect(pressed.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(pressed)
    expect(useSessionReasoningStore.getState().overrides['chat:t1']).toBe(false)
    expect(
      screen
        .getByRole('button', { name: 'Show reasoning (this chat)' })
        .getAttribute('aria-pressed'),
    ).toBe('false')
  })

  it('writes the override only for the rendered session key', () => {
    renderToggle('chat:t1')
    fireEvent.click(
      screen.getByRole('button', { name: 'Show reasoning (this chat)' }),
    )

    expect(useSessionReasoningStore.getState().overrides).toEqual({
      'chat:t1': true,
    })
  })
})
