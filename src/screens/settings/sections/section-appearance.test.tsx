// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import SectionAppearance from './section-appearance'

afterEach(() => {
  cleanup()
  localStorage.removeItem('claude-theme')
})

describe('SectionAppearance', () => {
  it('shows the theme row its key-meta badges (this browser · Live)', () => {
    render(<SectionAppearance />)

    const row = screen.getByRole('radiogroup').closest('.row') as HTMLElement
    expect(within(row).getByText('this browser')).toBeTruthy()
    expect(within(row).getByText('Live')).toBeTruthy()
  })
})
