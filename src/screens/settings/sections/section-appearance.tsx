/**
 * section-appearance.tsx — Appearance settings section (P2).
 */

import { useEffect, useRef } from 'react'
import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'
import { Segmented, Toggle } from '../components/controls'
import type { ThemeId } from '@/lib/theme'
import { THEMES, getTheme, setTheme } from '@/lib/theme'
import { useSettingsStore } from '@/stores/settings-store'

const LS_KEYS: Record<string, string> = {
  'hermes.density': 'comfortable',
  'hermes.monoFont': 'JetBrains Mono',
  'hermes.rainBg': 'false',
  'hermes.dimRain': 'false',
}

const DENSITY_OPTIONS = [
  { value: 'compact', label: 'Compact' },
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'spacious', label: 'Spacious' },
]

const MONO_FONTS = [
  { value: 'JetBrains Mono', label: 'JetBrains Mono' },
  { value: 'Fira Code', label: 'Fira Code' },
  { value: 'IBM Plex Mono', label: 'IBM Plex Mono' },
  { value: 'Menlo', label: 'Menlo' },
  { value: 'system-ui', label: 'System' },
]

// Show only base (non-light) themes for the picker
const THEME_OPTIONS = THEMES.filter((t) => !t.id.endsWith('-light')).map((t) => ({
  value: t.id,
  label: t.label,
}))

export default function SectionAppearance() {
  const { draft, set } = useSettingsStore()
  const seeded = useRef(false)

  useEffect(() => {
    if (seeded.current) return
    seeded.current = true

    const currentTheme = getTheme()
    const baseTheme = currentTheme.endsWith('-light')
      ? currentTheme.replace('-light', '') as ThemeId
      : currentTheme

    const patch: Record<string, unknown> = { 'hermes.theme': baseTheme }
    for (const [key, defaultVal] of Object.entries(LS_KEYS)) {
      patch[key] = localStorage.getItem(key) ?? defaultVal
    }
    useSettingsStore.getState().load({
      ...useSettingsStore.getState().committed,
      ...patch,
    })
  }, [])

  const theme = (draft['hermes.theme'] as string | undefined) ?? 'claude-nous'
  const density = (draft['hermes.density'] as string | undefined) ?? 'comfortable'
  const monoFont = (draft['hermes.monoFont'] as string | undefined) ?? 'JetBrains Mono'
  const rainBg = draft['hermes.rainBg'] === 'true' || draft['hermes.rainBg'] === true
  const dimRain = draft['hermes.dimRain'] === 'true' || draft['hermes.dimRain'] === true

  function handleThemeChange(v: string) {
    set('hermes.theme', v)
    // Apply immediately; setTheme also writes to localStorage (no-op on save)
    setTheme(v as ThemeId)
  }

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Appearance</h2>
          <div className="desc">Visual theme, layout density, and font preferences.</div>
        </div>
        <div className="meta">Section · <b>appearance</b></div>
      </div>

      <SettingCard title="Theme">
        <SettingRow label="Theme" pill={{ t: 'local-only' }}>
          <Segmented
            options={THEME_OPTIONS}
            value={theme}
            onChange={handleThemeChange}
          />
        </SettingRow>
        <SettingRow label="Density">
          <Segmented
            options={DENSITY_OPTIONS}
            value={density}
            onChange={(v) => set('hermes.density', v)}
          />
        </SettingRow>
      </SettingCard>

      <SettingCard title="Fonts">
        <SettingRow label="Mono font">
          <select
            className="select-input"
            value={monoFont}
            onChange={(e) => set('hermes.monoFont', e.target.value)}
          >
            {MONO_FONTS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </SettingRow>
      </SettingCard>

      <SettingCard title="Matrix Rain">
        <SettingRow label="Matrix rain background" rowEnd>
          <Toggle
            on={rainBg}
            set={(v) => set('hermes.rainBg', v ? 'true' : 'false')}
          />
        </SettingRow>
        <SettingRow
          label="Dim rain"
          pill={!rainBg ? { t: 'disabled' } : undefined}
          rowEnd
        >
          <Toggle
            on={dimRain}
            disabled={!rainBg}
            set={(v) => set('hermes.dimRain', v ? 'true' : 'false')}
          />
        </SettingRow>
      </SettingCard>
    </div>
  )
}
