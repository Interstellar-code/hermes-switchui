'use client'

/**
 * theme-picker.tsx — the full 10-theme grid. Selecting a theme applies it
 * immediately via `setTheme` so the wizard chrome re-skins live; that live
 * re-skin is the entire point of putting this step in onboarding rather
 * than leaving it buried in settings.
 */
import type { CSSProperties } from 'react'
import type { ThemeId } from '@/lib/theme'
import { THEMES, setTheme } from '@/lib/theme'

export type ThemePickerProps = {
  selected: ThemeId
  onSelect: (id: ThemeId) => void
}

/**
 * Representative swatch colours per theme, read off each theme's
 * `--theme-bg` / `--theme-panel` / `--theme-accent` tokens in
 * `src/styles.css`. This map is a preview approximation for the picker
 * only, not a source of truth — the values that actually get applied live
 * in each theme's own CSS block and are what `setTheme` switches to.
 */
const SWATCH_PREVIEW: Record<
  ThemeId,
  { bg: string; panel: string; accent: string }
> = {
  'claude-nous': { bg: '#041c1c', panel: '#06282a', accent: '#ffac02' },
  'claude-nous-light': { bg: '#f8faf8', panel: '#f4f7f5', accent: '#2557b7' },
  matrix: { bg: '#020804', panel: '#041008', accent: '#00ff41' },
  'matrix-light': { bg: '#f4fff6', panel: '#f0fff4', accent: '#008f2d' },
  'claude-official': { bg: '#0a0e1a', panel: '#0d1220', accent: '#6366f1' },
  'claude-official-light': {
    bg: '#f7f7f1',
    panel: '#f4f5ef',
    accent: '#2557b7',
  },
  'claude-classic': { bg: '#0d0f12', panel: '#13171c', accent: '#b98a44' },
  'claude-classic-light': {
    bg: '#f5f2ed',
    panel: '#f0ebe4',
    accent: '#b98a44',
  },
  'claude-slate': { bg: '#0d1117', panel: '#161b22', accent: '#7eb8f6' },
  'claude-slate-light': { bg: '#f6f8fa', panel: '#eef2f6', accent: '#3b82f6' },
}

function swatchStyle(id: ThemeId): CSSProperties {
  const preview = SWATCH_PREVIEW[id]
  return {
    '--ob-swatch-1': preview.bg,
    '--ob-swatch-2': preview.panel,
    '--ob-swatch-3': preview.accent,
  } as CSSProperties
}

export function ThemePicker({ selected, onSelect }: ThemePickerProps) {
  return (
    <div className="ob-themes">
      {THEMES.map((theme) => {
        const on = theme.id === selected
        return (
          <button
            key={theme.id}
            type="button"
            className={`ob-theme${on ? ' on' : ''}`}
            aria-pressed={on}
            onClick={() => {
              setTheme(theme.id)
              onSelect(theme.id)
            }}
          >
            <span className="ob-theme-swatch" style={swatchStyle(theme.id)} />
            <span className="ob-theme-name">{theme.label}</span>
            <span className="ob-theme-desc">{theme.description}</span>
          </button>
        )
      })}
    </div>
  )
}
