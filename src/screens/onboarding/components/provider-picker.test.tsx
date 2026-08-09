// @vitest-environment jsdom
/**
 * The provider grid is 24 cards long, so "which one am I on" has to be
 * answerable without scrolling and without seeing colour: the active card is
 * hoisted to the top of its group and its state is part of the button's
 * accessible name.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { ProviderPicker } from './provider-picker'
import type { ProviderChoice } from '../lib/provider-choices'

function choice(
  id: string,
  overrides?: Partial<ProviderChoice>,
): ProviderChoice {
  return {
    id,
    name: id.toUpperCase(),
    description: `${id} description`,
    group: 'all',
    authKind: 'api-key',
    envKey: null,
    baseUrl: null,
    docsUrl: null,
    supportsOAuth: false,
    cliCommand: null,
    detail: null,
    hasLogo: false,
    ...overrides,
  }
}

const CHOICES = [choice('alpha'), choice('beta'), choice('gamma')]

function names(): Array<string> {
  return screen
    .getAllByRole('button')
    .map((node) => node.textContent.trim())
}

describe('ProviderPicker', () => {
  afterEach(cleanup)

  it('marks and hoists the active provider', () => {
    render(
      <ProviderPicker
        choices={CHOICES}
        selectedId={null}
        onSelect={vi.fn()}
        activeProviderId="gamma"
        configuredProviderIds={['gamma']}
      />,
    )

    // Hoisted out of its catalog position (alpha, beta, gamma) to the front.
    expect(names()[0]).toContain('GAMMA')
    // …and named, so the state is not carried by the pill's colour alone.
    expect(names()[0]).toContain('Active')
    expect(screen.getByRole('button', { name: /GAMMA.*Active/s })).toBeTruthy()
  })

  it('marks other configured providers without hoisting them above the active one', () => {
    render(
      <ProviderPicker
        choices={CHOICES}
        selectedId={null}
        onSelect={vi.fn()}
        activeProviderId="gamma"
        configuredProviderIds={['gamma', 'beta']}
      />,
    )

    const rendered = names()
    expect(rendered[0]).toContain('GAMMA')
    expect(rendered[1]).toContain('BETA')
    expect(rendered[1]).toContain('Configured')
    expect(rendered[2]).toContain('ALPHA')
    expect(rendered[2]).not.toContain('Configured')
  })

  it('leaves the catalog order alone when nothing is configured yet', () => {
    render(
      <ProviderPicker
        choices={CHOICES}
        selectedId={null}
        onSelect={vi.fn()}
        activeProviderId={null}
        configuredProviderIds={[]}
      />,
    )
    expect(names()).toEqual([
      'ALPHAalpha description',
      'BETAbeta description',
      'GAMMAgamma description',
    ])
  })
})
