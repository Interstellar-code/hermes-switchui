// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Segmented } from './controls'
import { SelectField } from './select-field'
import { TextField } from './text-field'

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
    render(
      <Segmented options={OPTIONS} value="smart" onChange={() => undefined} />,
    )

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
    render(
      <Segmented options={OPTIONS} value="smart" onChange={() => undefined} />,
    )

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
      <Segmented
        options={OPTIONS}
        value="smart"
        onChange={(v) => seen.push(v)}
      />,
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
    render(
      <Segmented
        options={OPTIONS}
        value="manual"
        onChange={onChange}
        disabled
      />,
    )

    const group = screen.getByRole('radiogroup')
    expect(() => fireEvent.keyDown(group, { key: 'ArrowRight' })).not.toThrow()
  })
})

describe('SelectField', () => {
  const TIERS = [
    { value: 'auto', label: 'Auto' },
    { value: 'flex', label: 'Flex' },
    { value: 'priority', label: 'Priority' },
  ]

  it('renders one option per entry and reports the chosen value on change', () => {
    let value = 'auto'
    const { rerender } = render(
      <SelectField
        options={TIERS}
        value={value}
        onChange={(v) => {
          value = v
        }}
      />,
    )

    const select = screen.getByRole<HTMLSelectElement>('combobox')
    expect(select.querySelectorAll('option').length).toBe(3)
    expect(select.value).toBe('auto')

    fireEvent.change(select, { target: { value: 'flex' } })
    expect(value).toBe('flex')

    rerender(
      <SelectField
        options={TIERS}
        value={value}
        onChange={(v) => {
          value = v
        }}
      />,
    )
    expect(select.value).toBe('flex')
  })

  it('shows an unknown current value as "<value> (not offered here)" instead of snapping', () => {
    render(
      <SelectField
        options={TIERS}
        value="weird-backend"
        onChange={() => undefined}
      />,
    )

    const select = screen.getByRole<HTMLSelectElement>('combobox')
    // The unknown value stays selected rather than silently becoming the
    // first offered option, and says why it looks different from the rest.
    expect(select.value).toBe('weird-backend')
    expect(screen.getByText('weird-backend (not offered here)')).toBeTruthy()
    expect(select.querySelectorAll('option').length).toBe(4)
  })

  it('treats an empty value as unset, not as an unknown value to flag', () => {
    render(<SelectField options={TIERS} value="" onChange={() => undefined} />)

    expect(screen.queryByText(/not offered here/)).toBeNull()
    expect(screen.getByRole('combobox').querySelectorAll('option').length).toBe(
      3,
    )
  })

  it('accepts the id/aria-labelledby SettingRow clones onto it', () => {
    render(
      <SelectField
        options={TIERS}
        value="auto"
        onChange={() => undefined}
        id="ctl"
        aria-labelledby="lbl"
      />,
    )
    const select = screen.getByRole('combobox')
    expect(select.id).toBe('ctl')
    expect(select.getAttribute('aria-labelledby')).toBe('lbl')
  })
})

describe('TextField', () => {
  it('renders a controlled text input with the section input class', () => {
    const { rerender } = render(
      <TextField value="127.0.0.1" onChange={() => undefined} />,
    )
    const input = screen.getByRole<HTMLInputElement>('textbox')
    expect(input.tagName).toBe('INPUT')
    expect(input.type).toBe('text')
    expect(input.className).toBe('text-input')
    expect(input.value).toBe('127.0.0.1')

    rerender(<TextField value="0.0.0.0" onChange={() => undefined} />)
    expect(input.value).toBe('0.0.0.0')
  })

  it('reports edits through onChange and passes through placeholder/disabled', () => {
    let value = ''
    render(
      <TextField
        value={value}
        onChange={(v) => {
          value = v
        }}
        placeholder="8642"
      />,
    )
    const input = screen.getByPlaceholderText('8642')
    expect((input as HTMLInputElement).disabled).toBe(false)

    fireEvent.change(input, { target: { value: '9000' } })
    expect(value).toBe('9000')
  })

  it('accepts the id/aria-labelledby SettingRow clones onto it', () => {
    render(
      <TextField
        value="a"
        onChange={() => undefined}
        id="ctl"
        aria-labelledby="lbl"
      />,
    )
    const input = screen.getByRole('textbox')
    expect(input.id).toBe('ctl')
    expect(input.getAttribute('aria-labelledby')).toBe('lbl')
  })
})
