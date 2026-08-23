// @vitest-environment jsdom
/**
 * theme.test.ts — the one distinction the onboarding checklist depends on:
 * "this browser picked a theme" vs "this browser is sitting on the default".
 *
 * `readStoredTheme` is the reader, and it can only stay truthful if nothing
 * writes `claude-theme` on the user's behalf. Boot-time appearance setup used
 * to do exactly that (`setTheme(getTheme())`), which silently retired the
 * "Pick a theme" step for every user on their first page load — so the split
 * between `applyStoredTheme` (paint only) and `setTheme` (paint and record) is
 * a contract, not an implementation detail, and is pinned here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
  applyStoredTheme,
  getTheme,
  readStoredTheme,
  setTheme,
} from './theme'

afterEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.classList.remove('light', 'dark', 'system')
})

describe('applyStoredTheme', () => {
  it('paints the default without recording it as a choice', () => {
    applyStoredTheme()

    expect(document.documentElement.getAttribute('data-theme')).toBe('matrix')
    // The whole point: painting is not choosing.
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
    expect(readStoredTheme()).toBeNull()
  })

  it('repaints an existing choice without disturbing it', () => {
    setTheme('claude-slate-light')
    applyStoredTheme()

    expect(readStoredTheme()).toBe('claude-slate-light')
    expect(document.documentElement.getAttribute('data-theme')).toBe(
      'claude-slate-light',
    )
    expect(document.documentElement.classList.contains('light')).toBe(true)
  })

  it('leaves getTheme reporting the default while readStoredTheme says null', () => {
    applyStoredTheme()

    expect(getTheme()).toBe('matrix')
    expect(readStoredTheme()).toBeNull()
  })
})

describe('setTheme', () => {
  it('records the choice and paints it', () => {
    setTheme('claude-official')

    expect(readStoredTheme()).toBe('claude-official')
    expect(document.documentElement.getAttribute('data-theme')).toBe(
      'claude-official',
    )
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('announces the change to its own tab', () => {
    // `storage` events never reach the writing tab, and the theme control
    // lives in a dialog that opens over the dashboard's setup card without
    // unmounting it — so without this event that card goes stale until reload.
    const listener = vi.fn()
    window.addEventListener(THEME_CHANGE_EVENT, listener)

    setTheme('matrix-light')

    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener(THEME_CHANGE_EVENT, listener)
  })

  it('has already written storage by the time the event fires', () => {
    let seen: string | null = 'unset'
    const listener = () => {
      seen = localStorage.getItem(THEME_STORAGE_KEY)
    }
    window.addEventListener(THEME_CHANGE_EVENT, listener)

    setTheme('claude-classic')

    expect(seen).toBe('claude-classic')
    window.removeEventListener(THEME_CHANGE_EVENT, listener)
  })
})
