// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { CommandOutputCard, CommandOutputList } from './command-output-card'
import { useCommandOutputStore } from '@/stores/command-output-store'

afterEach(() => {
  cleanup()
})

const BOX_ART = `+------------------------------+
|      Available Commands      |
+------------------------------+
  /new    - Start a new session`

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    command: '/status',
    output: 'Hermes TUI Status\nTokens: 0',
    createdAt: 1,
    ...overrides,
  } as never
}

describe('CommandOutputCard', () => {
  it('renders output inside a <pre>, never as markdown', () => {
    // §7.3: the agent hard-wraps to 120 columns and emits box art. A markdown
    // renderer would read the pipes as a table and reflow the wrapping.
    render(<CommandOutputCard entry={entry({ output: BOX_ART })} />)
    const card = screen.getByTestId('command-output-card')
    const pre = card.querySelector('pre')
    expect(pre).not.toBeNull()
    expect(pre?.textContent).toBe(BOX_ART)
    expect(card.querySelector('table')).toBeNull()
  })

  it('scrolls wide output inside itself rather than widening the page', () => {
    render(<CommandOutputCard entry={entry({ output: BOX_ART })} />)
    const pre = screen.getByTestId('command-output-card').querySelector('pre')
    expect(pre?.className).toContain('overflow-x-auto')
    expect(pre?.className).toContain('font-mono')
    expect(pre?.className).toContain('whitespace-pre')
  })

  it('shows short output expanded, with no expander', () => {
    render(<CommandOutputCard entry={entry()} />)
    expect(screen.queryByText('Expand')).toBeNull()
  })

  it('collapses long output but keeps every line reachable', () => {
    const long = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n')
    render(<CommandOutputCard entry={entry({ output: long })} />)

    expect(screen.getByText('Expand')).toBeTruthy()
    expect(screen.getByText('Show all 40 lines')).toBeTruthy()
    // Nothing is truncated away — the text is present, only the height is capped.
    const pre = screen.getByTestId('command-output-card').querySelector('pre')
    expect(pre?.textContent).toContain('line 39')

    fireEvent.click(screen.getByText('Expand'))
    expect(screen.getByText('Collapse')).toBeTruthy()
  })

  it('renders a mirror warning above the output', () => {
    render(<CommandOutputCard entry={entry({ warning: 'session busy' })} />)
    expect(screen.getByText('session busy')).toBeTruthy()
  })

  it('falls back to a placeholder for empty output', () => {
    render(<CommandOutputCard entry={entry({ output: '' })} />)
    expect(screen.getByText('(no output)')).toBeTruthy()
  })
})

describe('CommandOutputList', () => {
  beforeEach(() => {
    useCommandOutputStore.setState({ bySession: {} })
  })

  it('renders nothing when the session has no output', () => {
    render(<CommandOutputList sessionKey="s1" />)
    expect(screen.queryByTestId('command-output-list')).toBeNull()
  })

  it('lists a session\'s output and can dismiss one', () => {
    useCommandOutputStore
      .getState()
      .addOutput('s1', { command: '/status', output: 'A' })
    useCommandOutputStore
      .getState()
      .addOutput('s1', { command: '/history', output: 'B' })

    render(<CommandOutputList sessionKey="s1" />)
    expect(screen.getAllByTestId('command-output-card')).toHaveLength(2)

    fireEvent.click(screen.getByLabelText('Dismiss /status output'))
    expect(screen.getAllByTestId('command-output-card')).toHaveLength(1)
  })

  it('does not carry output across sessions', () => {
    useCommandOutputStore
      .getState()
      .addOutput('s1', { command: '/status', output: 'A' })
    render(<CommandOutputList sessionKey="s2" />)
    expect(screen.queryByTestId('command-output-list')).toBeNull()
  })
})

describe('command output store', () => {
  beforeEach(() => {
    useCommandOutputStore.setState({ bySession: {} })
  })

  it('caps the number of retained entries per session', () => {
    for (let i = 0; i < 25; i += 1) {
      useCommandOutputStore
        .getState()
        .addOutput('s1', { command: '/status', output: `out ${i}` })
    }
    const entries = useCommandOutputStore.getState().bySession.s1
    expect(entries).toHaveLength(20)
    expect(entries[entries.length - 1].output).toBe('out 24')
  })

  it('buckets a sessionless chat under a fallback key', () => {
    useCommandOutputStore
      .getState()
      .addOutput(undefined, { command: '/status', output: 'A' })
    expect(useCommandOutputStore.getState().bySession.__new__).toHaveLength(1)
  })

  it('clears a session', () => {
    useCommandOutputStore
      .getState()
      .addOutput('s1', { command: '/status', output: 'A' })
    useCommandOutputStore.getState().clearOutputs('s1')
    expect(useCommandOutputStore.getState().bySession.s1).toBeUndefined()
  })
})
