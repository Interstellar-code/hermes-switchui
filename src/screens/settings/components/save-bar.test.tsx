// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { settingsSaver } from '../lib/saver'
import { SaveBar } from './save-bar'
import { resetSettingsStore, useSettingsStore } from '@/stores/settings-store'

const { putConfig, gatewayRestart, toast } = vi.hoisted(() => ({
  putConfig: vi.fn(),
  gatewayRestart: vi.fn(),
  toast: vi.fn(),
}))
vi.mock('@/lib/hermes-client', () => ({ putConfig, gatewayRestart }))
vi.mock('@/components/ui/toast', () => ({ toast }))

const s = () => useSettingsStore.getState()

function Bar() {
  const dirty = useSettingsStore((st) => st.dirty)
  const saveState = useSettingsStore((st) => st.saveState)
  return (
    <SaveBar
      dirtyCount={dirty.size}
      saveState={saveState}
      onRefresh={() => {}}
      onSave={() => void s().save(settingsSaver)}
    />
  )
}

/** Open the review dialog and click Save with the restart box ticked. */
function saveWithRestart() {
  render(<Bar />)
  fireEvent.click(screen.getByRole('button', { name: /save changes/i }))
  const box = screen.getByLabelText<HTMLInputElement>(
    'Restart gateway after save',
  )
  if (!box.checked) fireEvent.click(box)
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
}

beforeEach(() => {
  putConfig.mockReset().mockResolvedValue({ ok: true })
  gatewayRestart.mockReset().mockResolvedValue({})
  toast.mockReset()
  s().seed({
    'config.agent.gateway_timeout': 1800, // restart-applies → box ticked
  })
})
afterEach(() => {
  cleanup()
  resetSettingsStore()
})

describe('SaveBar gateway-restart feedback', () => {
  it('toasts success when the post-save restart starts', async () => {
    s().set('config.agent.gateway_timeout', 900)
    saveWithRestart()

    await waitFor(() => expect(gatewayRestart).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith('Gateway restarting', {
        type: 'success',
      }),
    )
  })

  it('toasts the error message when the restart fails', async () => {
    gatewayRestart.mockRejectedValue(new Error('gateway unreachable'))
    s().set('config.agent.gateway_timeout', 900)
    saveWithRestart()

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        'Gateway restart failed: gateway unreachable',
        { type: 'error' },
      ),
    )
  })

  it('toasts skipped and never restarts when the save ends with failures', async () => {
    s().set('config.agent.gateway_timeout', 900)
    s().set('local.only', 1) // unroutable → the save reports failures
    saveWithRestart()

    await waitFor(() => expect(s().saveState.phase).toBe('error'))
    expect(gatewayRestart).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        'Gateway restart skipped — the save did not finish cleanly',
        { type: 'warning' },
      ),
    )
  })

  it('stays silent when no restart was requested', async () => {
    s().set('config.agent.max_turns', 50) // live key → box unticked
    render(<Bar />)
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(s().saveState.phase).toBe('success'))
    expect(gatewayRestart).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
  })
})
