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
})
