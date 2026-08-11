// @vitest-environment jsdom
/**
 * Guards the Hermes-plugin settings mirror.
 *
 * Needs jsdom: the mirror deliberately no-ops when `window` is undefined, so
 * it never runs during SSR. Under the repo's default node environment that
 * guard would make every assertion below vacuously pass.
 *
 * The mirror previously lived in the Settings screen's saver, where it fired
 * only on an explicit gateway-config save and mapped five keys that no code
 * read. Deleting those dead controls in Wave 1 left it unable to fire at all,
 * which silently stopped the plugin's "reported settings" panel updating.
 *
 * These tests pin the two properties that made it worth re-homing rather than
 * deleting: it reacts to a preference changing anywhere, and it never lets a
 * failed mirror surface as an error, because an unreachable plugin must not
 * break the app.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  buildPluginSettingsPayload,
  startPluginSettingsMirror,
} from './plugin-settings-mirror'
import { defaultStudioSettings, useStudioSettingsStore } from '@/hooks/use-settings'

beforeAll(() => {
  // jsdom ships no matchMedia, and resolveTheme() needs it to turn a "system"
  // preference into the concrete theme the user is actually looking at.
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })
  }
})

describe('buildPluginSettingsPayload', () => {
  it('resolves a "system" theme to what the user actually sees', () => {
    // The plugin renders the value verbatim, so "system" would tell it nothing.
    const payload = buildPluginSettingsPayload({
      ...defaultStudioSettings,
      theme: 'system',
    })
    expect(payload.theme === 'light' || payload.theme === 'dark').toBe(true)
  })

  it('passes an explicit theme through unchanged', () => {
    expect(
      buildPluginSettingsPayload({ ...defaultStudioSettings, theme: 'light' })
        .theme,
    ).toBe('light')
  })

  it('emits only keys the server allowlist accepts', () => {
    const payload = buildPluginSettingsPayload(defaultStudioSettings)
    const allowed = [
      'theme',
      'locale',
      'showTimestamps',
      'showTokenCounts',
      'showCostEstimates',
      'enableSoundNotifications',
      'enableDesktopNotifications',
      'compactMode',
      'codeHighlighting',
      'fontSize',
      'customPort',
      'frontendPort',
    ]
    for (const key of Object.keys(payload)) {
      expect(allowed.includes(key)).toBe(true)
    }
  })
})

/**
 * Each case owns its own mirror lifecycle rather than sharing one through
 * beforeEach. The mirror keeps module-level debounce state, and threading that
 * through shared fake-timer setup made a passing test fail purely because of
 * what ran before it — which is exactly the kind of order-dependence that
 * makes a suite untrustworthy.
 */
function withMirror(
  body: (fetchMock: ReturnType<typeof vi.fn>) => void,
  fetchImpl?: ReturnType<typeof vi.fn>,
): void {
  vi.useFakeTimers()
  const fetchMock = fetchImpl ?? vi.fn().mockResolvedValue({ ok: true })
  vi.stubGlobal('fetch', fetchMock)
  useStudioSettingsStore.setState({ settings: { ...defaultStudioSettings } })
  const stop = startPluginSettingsMirror()
  try {
    body(fetchMock)
  } finally {
    stop()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  }
}

describe('startPluginSettingsMirror', () => {
  it('does not fire on start — only on an actual change', () => {
    withMirror((fetchMock) => {
      vi.advanceTimersByTime(5_000)
      expect(fetchMock.mock.calls.length).toBe(0)
    })
  })

  it('mirrors a preference change, debounced into a single request', () => {
    withMirror((fetchMock) => {
      useStudioSettingsStore.getState().updateSettings({ theme: 'dark' })
      useStudioSettingsStore.getState().updateSettings({ editorFontSize: 16 })
      useStudioSettingsStore.getState().updateSettings({ editorFontSize: 18 })

      expect(fetchMock.mock.calls.length).toBe(0) // still debouncing
      vi.advanceTimersByTime(2_000)

      expect(fetchMock.mock.calls.length).toBe(1)
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/hermes-plugin/settings')
      expect(init.method).toBe('POST')
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      expect(body.theme).toBe('dark')
      expect(body.fontSize).toBe(18) // the last value, not the first
    })
  })

  it('swallows a failed mirror rather than surfacing it', () => {
    const failing = vi.fn().mockRejectedValue(new Error('plugin unreachable'))
    withMirror((fetchMock) => {
      useStudioSettingsStore.getState().updateSettings({ theme: 'dark' })
      expect(() => vi.advanceTimersByTime(2_000)).not.toThrow()
      expect(fetchMock.mock.calls.length).toBe(1)
    }, failing)
  })

  it('stops mirroring once torn down', () => {
    withMirror((fetchMock) => {
      startPluginSettingsMirror()() // start then immediately stop
      useStudioSettingsStore.getState().updateSettings({ theme: 'dark' })
      vi.advanceTimersByTime(5_000)
      expect(fetchMock.mock.calls.length).toBe(0)
    })
  })
})
