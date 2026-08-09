// @vitest-environment jsdom
/**
 * Two rendering contracts the strip has to keep: a fresh install must not grow
 * an empty "Currently configured" box, and the active state must survive being
 * read aloud — the green dot is drawn in CSS, so colour is the only visual
 * carrier of it.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { CurrentSetupStrip } from './current-setup-strip'
import type { SetupFact } from '../lib/current-setup'

const FACTS: Array<SetupFact> = [
  {
    id: 'provider',
    label: 'Active provider',
    value: 'Nous Portal',
    state: 'active',
  },
  { id: 'model', label: 'Active model', value: 'auto', state: 'set' },
  { id: 'others', label: 'Also configured', value: '—', state: 'unset' },
]

describe('CurrentSetupStrip', () => {
  afterEach(cleanup)

  it('renders nothing at all for an empty fact list', () => {
    const { container } = render(<CurrentSetupStrip facts={[]} />)
    expect(container.innerHTML).toBe('')
  })

  it('leads with a heading and one row per fact', () => {
    render(<CurrentSetupStrip facts={FACTS} />)
    expect(screen.getByText('Currently configured')).toBeTruthy()
    expect(screen.getByText('Active provider')).toBeTruthy()
    expect(screen.getByText('auto')).toBeTruthy()
  })

  it('states the active flag in text, not only in colour', () => {
    const { container } = render(<CurrentSetupStrip facts={FACTS} />)
    const active = container.querySelector('.ob-current-value.is-active')
    expect(active?.textContent).toContain('Nous Portal')
    expect(active?.textContent).toContain('active')
  })

  it('takes an override heading', () => {
    render(<CurrentSetupStrip facts={FACTS} heading="Replacing" />)
    expect(screen.getByText('Replacing')).toBeTruthy()
  })
})
