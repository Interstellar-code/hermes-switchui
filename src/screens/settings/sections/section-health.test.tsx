// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { applyPreset } from '../lib/config-health'
import { getKeyMeta, getPresets, listKeyMeta } from '../lib/key-meta'
import SectionHealth from './section-health'
import { resetSettingsStore, useSettingsStore } from '@/stores/settings-store'

/**
 * The section is pure store + lib — no query, no network edge to mock. The
 * only network claim to check is the negative one: Fix / preset buttons never
 * fetch, they only write the draft.
 */

/** Draft keys for every board-C locked key, at its locked value. */
const REQUIRED_BASE: Record<string, unknown> = (() => {
  const base: Record<string, unknown> = {}
  for (const m of listKeyMeta()) {
    if (!m.required) continue
    base[draftKeyFor(m.id)] = JSON.parse(JSON.stringify(m.required.value))
  }
  return base
})()

/** Draft-key mapping that mirrors config-health's private `draftKey`. */
function draftKeyFor(id: string): string {
  const m = getKeyMeta(id)
  return m?.scope === 'hermes-config' || !m ? `config.${id}` : id
}

function loadDraft(patch: Record<string, unknown>) {
  useSettingsStore.getState().seed({ ...REQUIRED_BASE, ...patch })
}

afterEach(() => {
  cleanup()
  resetSettingsStore()
  vi.unstubAllGlobals()
})

describe('SectionHealth — findings', () => {
  it('renders a triggered rule and its Fix writes the draft dirty without saving', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    loadDraft({
      'config.approvals.mode': 'manual',
      'config.approvals.timeout': 60,
    })

    render(<SectionHealth />)

    const row = screen
      .getByText(/expires after 60 s/)
      .closest<HTMLElement>('.health-iss')!
    // Key chips and the current → fix diff line.
    expect(row.textContent).toContain('approvals.mode')
    expect(row.textContent).toContain('approvals.timeout')
    expect(row.textContent).toContain('manual')
    expect(row.textContent).toContain('smart')

    fireEvent.click(within(row).getByRole('button', { name: 'Fix' }))

    const s = useSettingsStore.getState()
    expect(s.draft['config.approvals.mode']).toBe('smart')
    expect(s.draft['config.approvals.timeout']).toBe(300)
    expect(s.dirty.has('config.approvals.mode')).toBe(true)
    expect(s.dirty.has('config.approvals.timeout')).toBe(true)
    // Draft only: committed is server truth and stays untouched, no fetch.
    expect(s.committed['config.approvals.mode']).toBe('manual')
    expect(s.committed['config.approvals.timeout']).toBe(60)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('Fix all applies every non-empty fix', () => {
    loadDraft({
      'config.approvals.mode': 'manual',
      'config.approvals.timeout': 60,
      'config.sessions.auto_prune': false,
      'config.model_catalog.enabled': false,
    })

    render(<SectionHealth />)

    const committedBefore = { ...useSettingsStore.getState().committed }
    fireEvent.click(screen.getByRole('button', { name: 'Fix all' }))

    const s = useSettingsStore.getState()
    const expected: Record<string, unknown> = {
      'config.approvals.mode': 'smart',
      'config.approvals.timeout': 300,
      'config.sessions.auto_prune': true,
      'config.model_catalog.enabled': true,
    }
    for (const [key, value] of Object.entries(expected)) {
      expect(s.draft[key], key).toBe(value)
      expect(s.dirty.has(key), key).toBe(true)
      expect(s.committed[key], key).toBe(committedBefore[key])
    }
  })

  it('shows the empty state and disables Fix all when there is nothing to fix', () => {
    loadDraft({})

    render(<SectionHealth />)

    expect(screen.getByText(/No findings/)).toBeTruthy()
    const fixAll = screen.getByRole('button', {
      name: 'Fix all',
    })
    expect(fixAll.hasAttribute('disabled')).toBe(true)
  })
})

describe('SectionHealth — presets', () => {
  it('applies only the preset keys, never a required key; count equals patch size', () => {
    loadDraft({})
    render(<SectionHealth />)

    const balanced = getPresets().find((p) => p.id === 'balanced')!
    const expectedPatch = applyPreset(
      useSettingsStore.getState().draft,
      balanced,
      listKeyMeta(),
    )
    expect(Object.keys(expectedPatch).length).toBeGreaterThan(0)

    const block = screen
      .getByText('Balanced')
      .closest<HTMLElement>('.health-pre')!
    fireEvent.click(
      within(block).getByRole('button', {
        name: `Apply ${Object.keys(expectedPatch).length} changes`,
      }),
    )

    const s = useSettingsStore.getState()
    for (const [key, value] of Object.entries(expectedPatch)) {
      expect(s.draft[key], key).toEqual(value)
      expect(s.dirty.has(key), key).toBe(true)
    }
    // Nothing outside the preset's patch went dirty.
    expect([...s.dirty].sort()).toEqual(Object.keys(expectedPatch).sort())
    // Every required key is unchanged.
    for (const m of listKeyMeta()) {
      if (!m.required) continue
      const key = draftKeyFor(m.id)
      expect(s.draft[key], key).toEqual(m.required.value)
    }
    expect(s.committed).toEqual(REQUIRED_BASE)
  })

  it('disables the apply button at 0 changes for an already-matching preset', () => {
    const safe = getPresets().find((p) => p.id === 'safe')!
    const draft: Record<string, unknown> = { ...REQUIRED_BASE }
    for (const [id, value] of Object.entries(safe.values)) {
      draft[draftKeyFor(id)] = value
    }
    useSettingsStore.getState().seed(draft)

    render(<SectionHealth />)

    expect(
      Object.keys(
        applyPreset(useSettingsStore.getState().draft, safe, listKeyMeta()),
      ),
    ).toHaveLength(0)
    const block = screen.getByText('Safe').closest<HTMLElement>('.health-pre')!
    const btn = within(block).getByRole('button', {
      name: 'Apply 0 changes',
    })
    expect(btn.hasAttribute('disabled')).toBe(true)
  })
})

describe('SectionHealth — required card', () => {
  it('lists every required key with ✓, or ✗ plus the reason when drifted', () => {
    loadDraft({ 'config.model.provider': 'openai' })

    const { container } = render(<SectionHealth />)

    const required = listKeyMeta().filter((m) => m.required)
    const rows = container.querySelectorAll('.health-lock')
    expect(rows.length).toBe(required.length)
    // Scope to the required card: a drifted key also renders as a finding.
    const card = screen
      .getByText('Required for SwitchUI')
      .closest<HTMLElement>('.card')!
    for (const m of required) {
      const chip = within(card).getByText(m.id)
      const row = chip.closest<HTMLElement>('.health-lock')
      expect(row, m.id).toBeTruthy()
      if (!row) continue
      if (m.id === 'model.provider') {
        expect(row.textContent).toContain('openai')
        expect(row.textContent).toContain('✗')
        expect(row.textContent).toContain('named manifest provider')
      } else {
        expect(row.textContent).toContain('✓')
      }
    }
    // Score strip agrees: 7 of 8 locked keys ok.
    expect(screen.getByText('7/8')).toBeTruthy()
    // Footer note: presets never change these keys.
    expect(screen.getByText(/Presets never change these keys/)).toBeTruthy()
  })
})
