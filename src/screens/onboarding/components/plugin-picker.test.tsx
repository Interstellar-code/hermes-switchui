// @vitest-environment jsdom
/**
 * Two contracts on the plugin picker: the copy control has to survive an
 * insecure origin (LAN/HTTP access is a supported deployment), and it must not
 * leave a timer running past unmount. Plus the read-only rendering a locked
 * relaunch depends on.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'

import { PluginPicker } from './plugin-picker'
import type { CorePluginRow } from '../lib/core-plugins'

const CLI_ROW: CorePluginRow = {
  name: 'hermes-extra',
  label: 'Hermes Extra',
  purpose: 'Adds an extra screen.',
  unlocks: null,
  state: 'absent',
  action: 'cli',
  cliCommand: 'hermes plugins enable hermes-extra',
}

const TOGGLE_ROW: CorePluginRow = {
  name: 'hermes-kanban',
  label: 'Kanban',
  purpose: 'Task board.',
  unlocks: null,
  state: 'disabled',
  action: 'enable',
  cliCommand: null,
}

describe('PluginPicker', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('copies through the clipboard helper, so an insecure origin still works', async () => {
    // jsdom leaves `navigator.clipboard` undefined, which is exactly what an
    // insecure origin looks like. The raw `navigator.clipboard.writeText`
    // call this used to make throws a TypeError straight out of the click
    // handler; `writeTextToClipboard` falls back to execCommand.
    expect(navigator.clipboard).toBeUndefined()
    const execCommand = vi.fn(() => true)
    Object.defineProperty(document, 'execCommand', {
      value: execCommand,
      configurable: true,
      writable: true,
    })

    render(<PluginPicker rows={[CLI_ROW]} onToggle={vi.fn()} busyName={null} />)
    fireEvent.click(screen.getByRole('button', { name: /Copy/ }))

    await screen.findByText('Copied')
    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  it('clears the "Copied" timer on unmount', async () => {
    Object.defineProperty(document, 'execCommand', {
      value: vi.fn(() => true),
      configurable: true,
      writable: true,
    })
    const clearSpy = vi.spyOn(window, 'clearTimeout')

    const view = render(
      <PluginPicker rows={[CLI_ROW]} onToggle={vi.fn()} busyName={null} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Copy/ }))
    await screen.findByText('Copied')

    clearSpy.mockClear()
    view.unmount()

    // Unmounting inside the 1.5s window used to leave the reset scheduled
    // against a component that no longer exists.
    expect(clearSpy).toHaveBeenCalled()
  })

  it('offers no toggle at all while read-only', () => {
    render(
      <PluginPicker
        rows={[TOGGLE_ROW]}
        onToggle={vi.fn()}
        busyName={null}
        readOnly
      />,
    )
    expect(screen.queryByRole('button', { name: 'Enable' })).toBeNull()
    // The state is still reported — this is a read, not a blank screen.
    expect(screen.getByText('Kanban')).toBeTruthy()
  })

  it('offers the toggle when not read-only', async () => {
    const onToggle = vi.fn()
    render(
      <PluginPicker rows={[TOGGLE_ROW]} onToggle={onToggle} busyName={null} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Enable' }))
    await waitFor(() =>
      expect(onToggle).toHaveBeenCalledWith('hermes-kanban', 'enable'),
    )
  })
})
