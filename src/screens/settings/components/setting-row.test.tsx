// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SettingRow } from './setting-row'
import { Toggle } from './controls'

afterEach(() => {
  cleanup()
})

describe('SettingRow', () => {
  it('associates its label with a plain input child via a real <label htmlFor>', () => {
    render(
      <SettingRow label="Command timeout" desc="max seconds a command may run">
        <input type="text" defaultValue="90" readOnly />
      </SettingRow>,
    )

    // getByLabelText resolves label[for] -> id association, exactly the
    // relationship `.lbl` never had before this stream: it was a bare
    // `<div>`, so this query returned nothing and every input/select/toggle
    // announced as unnamed "edit text" / "switch" to a screen reader. The
    // label's accessible name also includes the `desc` text (concatenated,
    // same element), hence the regex rather than an exact match.
    const control = screen.getByLabelText<HTMLInputElement>(/Command timeout/)
    expect(control).toBeTruthy()
    expect(control.tagName).toBe('INPUT')
    expect(control.value).toBe('90')
  })

  it('names a custom control component (Toggle) via the same association', () => {
    render(
      <SettingRow label="Network access" desc="Off runs with --network=none">
        <Toggle on={false} set={() => undefined} />
      </SettingRow>,
    )

    const control = screen.getByLabelText(/Network access/)
    expect(control).toBeTruthy()
    expect(control.getAttribute('role')).toBe('switch')
  })

  it('does not associate anything when there is no single control child (no regression)', () => {
    render(<SettingRow label="Agent working directory" />)

    // No control to name — the row still renders its label text, it just
    // isn't clickable-to-focus anything. This is the "0 or >1 children"
    // fallback path, and it must not throw or drop the label text.
    expect(screen.getByText('Agent working directory')).toBeTruthy()
    expect(screen.queryByLabelText(/Agent working directory/)).toBeNull()
  })

  it('respects an id the child already sets instead of overwriting it', () => {
    render(
      <SettingRow label="Docker image">
        <input type="text" id="explicit-id" defaultValue="alpine" readOnly />
      </SettingRow>,
    )

    const control = screen.getByLabelText<HTMLInputElement>(/Docker image/)
    expect(control.id).toBe('explicit-id')
  })

  /**
   * The auto-naming clone can only reach a *single* child element. Rows that
   * wrap their control in layout markup — an input beside Save/Cancel buttons,
   * as every API-keys row does — were left announcing as an unnamed textbox.
   * The render-prop form is how those rows name themselves.
   */
  it('hands its ids to a render-prop child so a wrapped control can be named', () => {
    render(
      <SettingRow label="Anthropic API key" desc="ANTHROPIC_API_KEY">
        {({ labelId, controlId }) => (
          <div style={{ display: 'flex' }}>
            <input
              type="password"
              id={controlId}
              aria-labelledby={labelId}
              defaultValue="secret"
              readOnly
            />
            <button type="button">Save</button>
          </div>
        )}
      </SettingRow>,
    )

    const control = screen.getByLabelText<HTMLInputElement>(/Anthropic API key/)
    expect(control.tagName).toBe('INPUT')
    expect(control.type).toBe('password')
  })

  it('leaves a render-prop row alone rather than cloning its wrapper', () => {
    render(
      <SettingRow label="Wrapped">
        {() => (
          <div data-testid="wrapper">
            <input type="text" defaultValue="a" readOnly />
          </div>
        )}
      </SettingRow>,
    )

    // The wrapper must not be handed an id/aria-labelledby — naming a <div>
    // would be meaningless and would shadow the real control.
    const wrapper = screen.getByTestId('wrapper')
    expect(wrapper.getAttribute('aria-labelledby')).toBe(null)
    expect(wrapper.id).toBe('')
  })
})
