// @vitest-environment jsdom
/**
 * The three contracts this picker carries. First, a locked relaunch renders no
 * select control at all — absent, not disabled, matching the plugins and
 * profile steps — because switching the provider rewrites config.yaml. Second,
 * every state a colour carries is also in the accessible name: the readiness
 * pill has a word, and the live provider says so in text. Third, a provider
 * that needs a key, a service or a CLI says so on its own card, before the
 * user picks it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { buildMemoryChoices } from '../lib/memory-choices'
import { MemoryPicker } from './memory-picker'

const GATEWAY_BODY = {
  providers: [
    { name: 'matrix-memory', status: 'ready' },
    { name: 'mem0', status: 'needs_config' },
  ],
}

const CHOICES = buildMemoryChoices({
  activeProvider: 'matrix-memory',
  gatewayMemory: GATEWAY_BODY,
})

describe('MemoryPicker', () => {
  afterEach(cleanup)

  it('offers no select control at all while read-only', () => {
    render(
      <MemoryPicker
        choices={CHOICES}
        activeId="matrix-memory"
        onSelect={vi.fn()}
        selecting={null}
        canWrite={false}
      />,
    )

    expect(screen.queryAllByRole('button')).toHaveLength(0)
    // Still a read, not a blank screen.
    expect(screen.getByText('Matrix Memory')).toBeTruthy()
    expect(screen.getByText(/Read-only for this run/)).toBeTruthy()
  })

  it('marks the active provider, orders it first, and says so in text', () => {
    render(
      <MemoryPicker
        choices={CHOICES}
        activeId="matrix-memory"
        onSelect={vi.fn()}
        selecting={null}
        canWrite
      />,
    )

    const cards = screen.getAllByRole('listitem')
    expect(cards[0].textContent).toContain('Matrix Memory')
    expect(cards[0].className).toContain('is-active')
    expect(cards[0].textContent).toContain('Active')
    expect(cards[0].textContent).toContain('Recommended')
    // The state is text, not just an outline colour.
    expect(cards[0].textContent).toContain(
      'Currently the active memory provider.',
    )
    expect(
      screen.queryByRole('button', { name: 'Use Matrix Memory' }),
    ).toBeNull()
  })

  it('renders readiness as a word, including the could-not-check case', () => {
    render(
      <MemoryPicker
        choices={CHOICES}
        activeId="matrix-memory"
        onSelect={vi.fn()}
        selecting={null}
        canWrite
      />,
    )

    expect(screen.getByText('Ready')).toBeTruthy()
    expect(screen.getByText('Needs setup')).toBeTruthy()
    // Providers the gateway did not list read as unchecked, never as broken.
    expect(screen.getAllByText("Couldn't check").length).toBeGreaterThan(0)
    expect(
      screen.getAllByText(/Readiness could not be checked/).length,
    ).toBeGreaterThan(0)
  })

  it('states what a credentialled provider needs before it is picked', () => {
    render(
      <MemoryPicker
        choices={CHOICES}
        activeId="matrix-memory"
        onSelect={vi.fn()}
        selecting={null}
        canWrite
      />,
    )

    expect(
      screen.getAllByText(/Needs an API key stored in ~\/.hermes\/.env/).length,
    ).toBeGreaterThan(0)
    expect(
      screen.getByText(/Needs its command-line tool installed/),
    ).toBeTruthy()
  })

  it('names each select control after the provider it switches to', () => {
    const onSelect = vi.fn()
    render(
      <MemoryPicker
        choices={CHOICES}
        activeId="matrix-memory"
        onSelect={onSelect}
        selecting={null}
        canWrite
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Use Mem0' }))
    expect(onSelect).toHaveBeenCalledWith('mem0')
  })

  it('shows the store evidence only for the recommended provider', () => {
    render(
      <MemoryPicker
        choices={CHOICES}
        activeId="matrix-memory"
        onSelect={vi.fn()}
        selecting={null}
        canWrite
        stats={{ exists: true, total: 67 }}
      />,
    )

    const cards = screen.getAllByRole('listitem')
    expect(cards[0].textContent).toContain(
      'Its store already exists here, holding 67 entries.',
    )
    expect(cards[1].textContent).not.toContain('Its store already exists')
  })

  it('says nothing about a store that does not exist yet', () => {
    render(
      <MemoryPicker
        choices={CHOICES}
        activeId="matrix-memory"
        onSelect={vi.fn()}
        selecting={null}
        canWrite
        stats={{ exists: false, total: 0 }}
      />,
    )
    expect(screen.queryByText(/Its store already exists/)).toBeNull()
  })

  it('disables only the busy card', () => {
    render(
      <MemoryPicker
        choices={CHOICES}
        activeId="matrix-memory"
        onSelect={vi.fn()}
        selecting="mem0"
        canWrite
      />,
    )
    expect(screen.getByRole('button', { name: 'Use Mem0' })).toHaveProperty(
      'disabled',
      true,
    )
    expect(
      screen.getByRole('button', { name: 'Use Holographic' }),
    ).toHaveProperty('disabled', false)
  })

  it("lets the caller's activeId win over a stale row flag", () => {
    // Between a write and the refetch landing, the cached rows still say the
    // old provider is active. Two marked cards would be a lie.
    render(
      <MemoryPicker
        choices={CHOICES}
        activeId="mem0"
        onSelect={vi.fn()}
        selecting={null}
        canWrite
      />,
    )
    const marked = screen
      .getAllByRole('listitem')
      .filter((card) => card.className.includes('is-active'))
    expect(marked).toHaveLength(1)
    expect(marked[0].textContent).toContain('Mem0')
  })
})
