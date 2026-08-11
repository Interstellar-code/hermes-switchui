/**
 * section-appearance.tsx — Appearance settings section.
 *
 * Previously also held density, mono-font, and two Matrix-rain toggles as
 * localStorage-backed hermes.* draft keys. None of the four ever reached
 * anything that reads them — the Matrix-rain canvas mounts unconditionally
 * regardless of the toggle, there is no density implementation, and the
 * mono font selection was never applied anywhere. Deleted outright (plan
 * immutable-noodling-koala, Stream 1B).
 *
 * The theme control is the one real setting in this section: setTheme()
 * genuinely writes the app-wide `claude-theme` localStorage key (see
 * src/lib/theme.ts) and applies immediately. It is intentionally NOT wired
 * to the settings draft store — it saves itself the instant you click it,
 * same as before this rewrite, so it never shows dirty and never needs the
 * page-level Save button.
 */

import { useState } from 'react'
import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'
import { Segmented } from '../components/controls'
import type { ThemeId } from '@/lib/theme'
import { THEMES, getTheme, setTheme } from '@/lib/theme'

// Show only base (non-light) themes for the picker
const THEME_OPTIONS = THEMES.filter((t) => !t.id.endsWith('-light')).map((t) => ({
  value: t.id,
  label: t.label,
}))

function baseThemeId(id: string): ThemeId {
  return (id.endsWith('-light') ? id.replace('-light', '') : id) as ThemeId
}

export default function SectionAppearance() {
  const [theme, setThemeState] = useState<string>(() => baseThemeId(getTheme()))

  function handleThemeChange(v: string) {
    setThemeState(v)
    // Applies immediately and persists to the real `claude-theme` key.
    setTheme(v as ThemeId)
  }

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Appearance</h2>
          <div className="desc">Visual theme for this browser.</div>
        </div>
        <div className="meta">Section · <b>appearance</b></div>
      </div>

      {/*
        This control writes immediately via setTheme() and never touches the
        settings draft store, so it is marked self-saving: the save bar must
        not claim to speak for it.
      */}
      <SettingCard title="Theme" saves="self">
        <SettingRow label="Theme" pill={{ t: 'local-only' }}>
          <Segmented
            options={THEME_OPTIONS}
            value={theme}
            onChange={handleThemeChange}
          />
        </SettingRow>
      </SettingCard>
    </div>
  )
}
