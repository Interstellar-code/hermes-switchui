// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SettingRow } from './setting-row'
import { Toggle } from './controls'
import type { KeyMeta } from '../lib/key-meta-types'

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

  // ── meta prop (P3, board B) ───────────────────────────────────────────────

  const META: KeyMeta = {
    id: 'agent.max_turns',
    label: 'Max turns',
    group: 'agent-runtime',
    scope: 'hermes-config',
    applies: 'next-session',
    type: 'int',
    default: null,
    recommended: 40,
    range: { min: 1, max: 500, unlimited: null },
    effect: 'Caps tool-calling iterations per turn.',
    source: 'agent/config.py',
    verified: false,
  }

  it('renders the RowMeta strip under the label when meta is present', () => {
    render(
      <SettingRow label="Max turns" meta={META}>
        <input type="number" defaultValue="40" readOnly />
      </SettingRow>,
    )

    expect(screen.getByText('config.yaml')).toBeTruthy()
    expect(screen.getByText('Next session')).toBeTruthy()
    expect(
      screen.getByText('Default ∞ · Recommended 40 · Range 1–∞'),
    ).toBeTruthy()
    expect(screen.getByText('ⓘ')).toBeTruthy()
  })

  it('keeps the label → control association intact alongside meta', () => {
    render(
      <SettingRow label="Max turns" meta={META}>
        <input type="number" defaultValue="40" readOnly />
      </SettingRow>,
    )

    const control = screen.getByLabelText<HTMLInputElement>(/Max turns/)
    expect(control.tagName).toBe('INPUT')
    expect(control.value).toBe('40')
  })

  it('renders no wrapper and no meta markup when meta is omitted', () => {
    const { container } = render(
      <SettingRow label="Plain">
        <input type="text" defaultValue="a" readOnly />
      </SettingRow>,
    )

    // Exactly the pre-P3 DOM: .row > label.lbl + div.ctl, nothing between.
    const row = container.querySelector('.row')
    expect(row).toBeTruthy()
    expect(row?.children.length).toBe(2)
    expect(row?.children[0].tagName).toBe('LABEL')
    expect(row?.children[0].className).toBe('lbl')
    expect(row?.querySelector('.row-meta')).toBeNull()
    expect(row?.querySelector('.lbl-wrap')).toBeNull()
  })
})
