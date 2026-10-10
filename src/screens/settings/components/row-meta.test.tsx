// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { RowMeta } from './row-meta'
import type { KeyMeta } from '../lib/key-meta-types'

afterEach(() => {
  cleanup()
})

/** Minimal valid KeyMeta with the fields under test overridden. */
function meta(overrides: Partial<KeyMeta>): KeyMeta {
  return {
    id: 'test.key',
    label: 'Test key',
    group: 'test-group',
    scope: 'hermes-config',
    applies: 'live',
    type: 'int',
    effect: 'Caps how long the agent may run.',
    source: 'agent/config.py',
    verified: true,
    ...overrides,
  }
}

/** Hovers the ⓘ trigger and waits for the portaled tooltip body to appear. */
async function openTooltip() {
  fireEvent.mouseEnter(screen.getByText('ⓘ'))
  await waitFor(() => expect(screen.getByText(/Source:/)).toBeTruthy())
}

describe('RowMeta badges', () => {
  it('renders a scope badge per KeyScope with its user-facing file name', () => {
    const { rerender } = render(
      <RowMeta meta={meta({ scope: 'hermes-config' })} />,
    )
    expect(screen.getByText('config.yaml')).toBeTruthy()

    rerender(<RowMeta meta={meta({ scope: 'env' })} />)
    expect(screen.getByText('.env')).toBeTruthy()

    rerender(<RowMeta meta={meta({ scope: 'switchui-local' })} />)
    expect(screen.getByText('this browser')).toBeTruthy()
  })

  it('renders an applies badge per KeyApplies', () => {
    const { rerender } = render(<RowMeta meta={meta({ applies: 'live' })} />)
    expect(screen.getByText('Live')).toBeTruthy()

    rerender(<RowMeta meta={meta({ applies: 'next-session' })} />)
    expect(screen.getByText('Next session')).toBeTruthy()

    rerender(<RowMeta meta={meta({ applies: 'restart' })} />)
    expect(screen.getByText('Needs restart')).toBeTruthy()
  })
})

describe('RowMeta default/recommended/range line', () => {
  it('joins all three parts with a middle dot when they all exist', () => {
    render(
      <RowMeta
        meta={meta({ default: 3, recommended: 5, range: { min: 0, max: 10 } })}
      />,
    )
    expect(
      screen.getByText('Default 3 · Recommended 5 · Range 0–10'),
    ).toBeTruthy()
  })

  it('renders only the parts the meta carries', () => {
    const { rerender } = render(<RowMeta meta={meta({ recommended: 5 })} />)
    expect(screen.getByText('Recommended 5')).toBeTruthy()
    expect(screen.queryByText(/Default/)).toBeNull()
    expect(screen.queryByText(/Range/)).toBeNull()

    rerender(<RowMeta meta={meta({ default: 1800 })} />)
    expect(screen.getByText('Default 1800')).toBeTruthy()

    rerender(<RowMeta meta={meta({ range: { min: 60, max: 7200 } })} />)
    expect(screen.getByText('Range 60–7200')).toBeTruthy()

    rerender(<RowMeta meta={meta({})} />)
    expect(screen.queryByText(/Default|Recommended|Range/)).toBeNull()
  })

  it('renders ∞ for the unlimited sentinel in default, recommended and range max', () => {
    render(
      <RowMeta
        meta={meta({
          default: null,
          recommended: null,
          range: { min: 1, max: 500, unlimited: null },
        })}
      />,
    )
    expect(
      screen.getByText('Default ∞ · Recommended ∞ · Range 1–∞'),
    ).toBeTruthy()
  })

  it('formats object values as JSON rather than "[object Object]"', () => {
    render(<RowMeta meta={meta({ default: { a: 1 } })} />)
    expect(screen.getByText(/Default \{"a":1\}/)).toBeTruthy()
  })
})

describe('RowMeta tooltip', () => {
  it('shows effect, tradeoff and source on hover', async () => {
    render(
      <RowMeta
        meta={meta({
          effect: 'Caps tool-calling iterations per turn.',
          tradeoff: 'Higher = more room but more tokens.',
          source: 'agent/config.py:120',
        })}
      />,
    )
    await openTooltip()

    expect(
      screen.getByText('Caps tool-calling iterations per turn.'),
    ).toBeTruthy()
    expect(
      screen.getByText('Tradeoff: Higher = more room but more tokens.'),
    ).toBeTruthy()
    expect(screen.getByText('Source: agent/config.py:120')).toBeTruthy()
  })

  it('omits the tradeoff line when the meta has none', async () => {
    render(<RowMeta meta={meta({ tradeoff: undefined })} />)
    await openTooltip()
    expect(screen.queryByText(/Tradeoff:/)).toBeNull()
  })

  it('states "Verified" for a verified key', async () => {
    render(<RowMeta meta={meta({ verified: true })} />)
    await openTooltip()
    expect(screen.getByText('Verified')).toBeTruthy()
    expect(screen.queryByText('not traced in code')).toBeNull()
  })

  it('states "not traced in code" for an unverified key', async () => {
    render(<RowMeta meta={meta({ verified: false })} />)
    await openTooltip()
    expect(screen.getByText('not traced in code')).toBeTruthy()
    expect(screen.queryByText('Verified')).toBeNull()
  })

  it('states the lock — value and reason — for a required key, even a verified one', async () => {
    render(
      <RowMeta
        meta={meta({
          verified: true,
          required: { value: 'claude', reason: 'UI only supports claude' },
        })}
      />,
    )
    await openTooltip()
    expect(
      screen.getByText('Locked: claude — UI only supports claude'),
    ).toBeTruthy()
    expect(screen.queryByText('Verified')).toBeNull()
  })

  it('opens on keyboard focus, not only on hover', async () => {
    render(<RowMeta meta={meta({})} />)
    fireEvent.focusIn(screen.getByText('ⓘ'))
    await waitFor(() => expect(screen.getByText(/Caps how long/)).toBeTruthy())
  })
})
