// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Input } from './input'

describe('Input', () => {
  it('renders outside a Base UI field provider', () => {
    render(<Input aria-label="Scenario title" defaultValue="Seed training" />)

    const input = screen.getByRole('textbox', { name: 'Scenario title' })

    expect((input as HTMLInputElement).value).toBe('Seed training')
  })
})
