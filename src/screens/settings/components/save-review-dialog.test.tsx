// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { settingsSaver } from '../lib/saver'
import { SaveBar } from './save-bar'
import { BACKUP_NOTE, SaveReviewDialog, buildDiff } from './save-review-dialog'
import { resetSettingsStore, useSettingsStore } from '@/stores/settings-store'

const { putConfig, gatewayRestart } = vi.hoisted(() => ({
  putConfig: vi.fn(),
  gatewayRestart: vi.fn(),
}))
vi.mock('@/lib/hermes-client', () => ({ putConfig, gatewayRestart }))

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

beforeEach(() => {
  putConfig.mockReset().mockResolvedValue({ ok: true })
  gatewayRestart.mockReset().mockResolvedValue({})
  s().seed({
    'config.agent.max_turns': 90,
    'config.agent.gateway_timeout': 1800,
  })
})
afterEach(() => {
  cleanup()
  resetSettingsStore()
})

function openReview() {
  render(<Bar />)
  fireEvent.click(screen.getByRole('button', { name: /save changes/i }))
  return screen.getByRole('dialog')
}

describe('SaveReviewDialog', () => {
  it('groups changes by applies, unknown keys under Other', () => {
    s().set('config.agent.max_turns', 50)
    s().set('config.agent.gateway_timeout', 900)
    s().set('config.zzz.unknown', 1)
    const dialog = openReview()
    const group = (name: string) =>
      within(within(dialog).getByRole('region', { name }))
    expect(group('Applies immediately').getByText('Max turns')).toBeTruthy()
    expect(group('Needs a gateway restart')).toBeTruthy()
    expect(group('Other').getByText('zzz.unknown')).toBeTruthy()
  })

  it('shows old and new values as a YAML diff', () => {
    s().set('config.agent.max_turns', 50)
    openReview()
    const diff = screen.getByLabelText('YAML diff')
    expect(diff.textContent).toContain('- agent:')
    expect(diff.textContent).toContain('-   max_turns: 90')
    expect(diff.textContent).toContain('+   max_turns: 50')
  })

  it('masks secret-looking values in the diff', () => {
    const lines = buildDiff(
      ['config.x.api_key'],
      { 'config.x.api_key': 'old-secret' },
      { 'config.x.api_key': 'new-secret' },
    )
    expect(JSON.stringify(lines)).not.toContain('secret')
  })

  it('shows the verified backup note', () => {
    s().set('config.agent.max_turns', 50)
    openReview()
    expect(screen.getByText(BACKUP_NOTE)).toBeTruthy()
    expect(BACKUP_NOTE).toMatch(/does not back up/)
  })

  it('ticks restart by default only when a restart-applies key changed', () => {
    s().set('config.agent.max_turns', 50)
    openReview()
    expect(
      screen.getByLabelText<HTMLInputElement>('Restart gateway after save')
        .checked,
    ).toBe(false)
    cleanup()
    s().set('config.agent.gateway_timeout', 900)
    openReview()
    expect(
      screen.getByLabelText<HTMLInputElement>('Restart gateway after save')
        .checked,
    ).toBe(true)
  })

  it('Cancel saves nothing and restarts nothing', () => {
    s().set('config.agent.gateway_timeout', 900)
    openReview()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(putConfig).not.toHaveBeenCalled()
    expect(gatewayRestart).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Esc cancels', () => {
    s().set('config.agent.max_turns', 50)
    openReview()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(putConfig).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('restarts after a fully successful save when ticked', async () => {
    s().set('config.agent.gateway_timeout', 900)
    openReview()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(gatewayRestart).toHaveBeenCalledTimes(1))
    expect(putConfig).toHaveBeenCalledTimes(1)
  })

  it('does not restart when the box is unticked', async () => {
    s().set('config.agent.gateway_timeout', 900)
    openReview()
    fireEvent.click(screen.getByLabelText('Restart gateway after save'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(s().saveState.phase).toBe('success'))
    expect(gatewayRestart).not.toHaveBeenCalled()
  })

  it('never restarts after a failed save', async () => {
    putConfig.mockRejectedValue(new Error('boom'))
    s().set('config.agent.gateway_timeout', 900)
    openReview()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(s().saveState.phase).toBe('error'))
    expect(gatewayRestart).not.toHaveBeenCalled()
  })

  it('never restarts after a partial save', async () => {
    s().set('config.agent.gateway_timeout', 900)
    s().set('local.only', 1) // unroutable → reported failed, config key persists
    openReview()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(s().saveState.phase).toBe('error'))
    expect(s().committed['config.agent.gateway_timeout']).toBe(900)
    expect(gatewayRestart).not.toHaveBeenCalled()
  })
})

describe('SaveReviewDialog standalone', () => {
  it('passes the restart flag to onConfirm', () => {
    s().set('config.agent.gateway_timeout', 900)
    const onConfirm = vi.fn()
    render(<SaveReviewDialog open onCancel={() => {}} onConfirm={onConfirm} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onConfirm).toHaveBeenCalledWith(true)
  })
})
