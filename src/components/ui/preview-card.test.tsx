// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from './preview-card'

describe('PreviewCard', () => {
  it('renders without a Base UI provider', () => {
    render(
      <PreviewCard>
        <PreviewCardTrigger aria-label="Context usage">25%</PreviewCardTrigger>
        <PreviewCardPopup align="end">50K of 200K tokens</PreviewCardPopup>
      </PreviewCard>,
    )

    expect(screen.getByLabelText('Context usage')).toBeTruthy()
    expect(screen.getByRole('tooltip').textContent).toContain('50K of 200K')
  })
})
