// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  ScrollAreaRoot,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from './scroll-area'

describe('ScrollArea', () => {
  it('renders a native scroll container without Base UI context', () => {
    render(
      <ScrollAreaRoot>
        <ScrollAreaViewport aria-label="Workspace files">
          <span>SOUL.md</span>
        </ScrollAreaViewport>
        <ScrollAreaScrollbar orientation="vertical">
          <ScrollAreaThumb />
        </ScrollAreaScrollbar>
      </ScrollAreaRoot>,
    )

    expect(screen.getByLabelText('Workspace files').className).toContain(
      'overflow-auto',
    )
    expect(screen.getByText('SOUL.md')).toBeTruthy()
  })
})
