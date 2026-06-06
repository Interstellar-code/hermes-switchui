// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Check } from 'lucide-react'

import { ShadcnSmoke } from '@/components/shadcn/shadcn-smoke'

describe('ShadcnSmoke', () => {
  it('renders the isolated shadcn button smoke surface', () => {
    render(<ShadcnSmoke />)

    expect(screen.getByTestId('shadcn-smoke')).toBeTruthy()
    expect(screen.getByRole('button', { name: /shadcn smoke/i })).toBeTruthy()
  })

  it('uses the real lucide Check icon instead of the placeholder shim', () => {
    const markup = renderToStaticMarkup(<Check />)

    expect(markup).toContain('<path')
    expect(markup).not.toContain('<circle')
  })
})
