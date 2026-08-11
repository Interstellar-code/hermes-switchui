// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Segmented } from './controls'

afterEach(() => {
  cleanup()
})

const OPTIONS = [
  { value: 'manual', label: 'Manual' },
  { value: 'smart', label: 'Smart' },
  { value: 'off', label: 'Off' },
]

describe('Segmented', () => {
  it('renders an ARIA radiogroup with one radio per option, the selected one checked', () => {
    render(<Segmented options={OPTIONS} value="smart" onChange={() => undefined} />)

    const group = screen.getByRole('radiogroup')
    expect(group).toBeTruthy()

    const radios = screen.getAllByRole('radio')
    expect(radios.length).toBe(3)
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
    ])
  })

  it('only the selected option is in the tab order (roving tabindex)', () => {
    render(<Segmented options={OPTIONS} value="smart" onChange={() => undefined} />)

    const radios = screen.getAllByRole('radio')
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1])
  })

  it('ArrowRight moves the selection to the next option and focus follows it', () => {
    let value = 'manual'
    const onChange = (v: string) => {
      value = v
    }
    const { rerender } = render(
      <Segmented options={OPTIONS} value={value} onChange={onChange} />,
    )

    const group = screen.getByRole('radiogroup')
    fireEvent.keyDown(group, { key: 'ArrowRight' })
    expect(value).toBe('smart')

    // Re-render with the new value, the way a controlled consumer would
    // after `onChange` updates its own state.
    rerender(<Segmented options={OPTIONS} value={value} onChange={onChange} />)
    const smartRadio = screen.getAllByRole('radio')[1]
    expect(document.activeElement).toBe(smartRadio)
  })

  it('ArrowLeft wraps from the first option to the last', () => {
    let value = 'manual'
    const onChange = (v: string) => {
      value = v
    }
    render(<Segmented options={OPTIONS} value={value} onChange={onChange} />)

    const group = screen.getByRole('radiogroup')
    fireEvent.keyDown(group, { key: 'ArrowLeft' })
    expect(value).toBe('off')
  })

  it('Home and End jump to the first and last option', () => {
    const seen: Array<string> = []
    render(
      <Segmented options={OPTIONS} value="smart" onChange={(v) => seen.push(v)} />,
    )

    const group = screen.getByRole('radiogroup')
    fireEvent.keyDown(group, { key: 'End' })
    fireEvent.keyDown(group, { key: 'Home' })
    expect(seen).toEqual(['off', 'manual'])
  })

  it('ignores arrow keys when disabled', () => {
    const onChange = () => {
      throw new Error('should not be called while disabled')
    }
    render(<Segmented options={OPTIONS} value="manual" onChange={onChange} disabled />)

    const group = screen.getByRole('radiogroup')
    expect(() => fireEvent.keyDown(group, { key: 'ArrowRight' })).not.toThrow()
  })
})
