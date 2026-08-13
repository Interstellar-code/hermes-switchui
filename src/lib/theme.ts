export type ThemeId =
  | 'claude-nous'
  | 'claude-nous-light'
  | 'matrix'
  | 'matrix-light'
  | 'claude-official'
  | 'claude-official-light'
  | 'claude-classic'
  | 'claude-classic-light'
  | 'claude-slate'
  | 'claude-slate-light'

export const THEMES: Array<{
  id: ThemeId
  label: string
  description: string
  icon: string
}> = [
  {
    id: 'claude-nous',
    label: 'Nous',
    description:
      'Deep teal background, cream accent — matches Nous Research chrome',
    icon: '◱',
  },
  {
    id: 'claude-nous-light',
    label: 'Nous Light',
    description: 'Cold paper white with restrained cobalt framing',
    icon: '◲',
  },
  {
    id: 'matrix',
    label: 'Matrix',
    description: 'Black glass terminal field with phosphor green signal glow',
    icon: '▣',
  },
  {
    id: 'matrix-light',
    label: 'Matrix Light',
    description: 'White terminal paper with green signal accents',
    icon: '▣',
  },
  {
    id: 'claude-official',
    label: 'Hermes',
    description: 'Navy and indigo flagship theme',
    icon: '⚕',
  },
  {
    id: 'claude-official-light',
    label: 'Hermes Light',
    description: 'Editorial paper white with muted cobalt accents',
    icon: '⚕',
  },
  {
    id: 'claude-classic',
    label: 'Bronze',
    description: 'Bronze accents on dark charcoal',
    icon: '🔶',
  },
  {
    id: 'claude-classic-light',
    label: 'Bronze Light',
    description: 'Warm parchment with bronze accents',
    icon: '🔶',
  },
  {
    id: 'claude-slate',
    label: 'Slate',
    description: 'Cool blue developer theme',
    icon: '🔷',
  },
  {
    id: 'claude-slate-light',
    label: 'Slate Light',
    description: 'GitHub-light palette with blue accents',
    icon: '🔷',
  },
]

const STORAGE_KEY = 'claude-theme'
const DEFAULT_THEME: ThemeId = 'matrix'
const THEME_SET = new Set<ThemeId>(THEMES.map((theme) => theme.id))
const LIGHT_THEME_MAP: Record<
  Exclude<ThemeId, `${string}-light`>,
  Extract<ThemeId, `${string}-light`>
> = {
  'claude-nous': 'claude-nous-light',
  matrix: 'matrix-light',
  'claude-official': 'claude-official-light',
  'claude-classic': 'claude-classic-light',
  'claude-slate': 'claude-slate-light',
}
const DARK_THEME_MAP: Record<
  Extract<ThemeId, `${string}-light`>,
  Exclude<ThemeId, `${string}-light`>
> = {
  'claude-nous-light': 'claude-nous',
  'matrix-light': 'matrix',
  'claude-official-light': 'claude-official',
  'claude-classic-light': 'claude-classic',
  'claude-slate-light': 'claude-slate',
}

const LIGHT_THEMES = new Set<ThemeId>([
  'claude-nous-light',
  'matrix-light',
  'claude-official-light',
  'claude-classic-light',
  'claude-slate-light',
])

export function isValidTheme(
  value: string | null | undefined,
): value is ThemeId {
  return typeof value === 'string' && THEME_SET.has(value as ThemeId)
}

export function isDarkTheme(theme: ThemeId): boolean {
  return !LIGHT_THEMES.has(theme)
}

export function getThemeVariant(
  theme: ThemeId,
  mode: 'light' | 'dark',
): ThemeId {
  if (mode === 'light') {
    return isDarkTheme(theme)
      ? LIGHT_THEME_MAP[theme as keyof typeof LIGHT_THEME_MAP]
      : theme
  }

  return isDarkTheme(theme)
    ? theme
    : DARK_THEME_MAP[theme as keyof typeof DARK_THEME_MAP]
}

/**
 * Exported so a listener can tell a `storage` event for the theme apart from
 * the noise of every other feature sharing this origin, without a second copy
 * of the literal drifting out of sync with `setTheme`.
 */
export const THEME_STORAGE_KEY = STORAGE_KEY

/**
 * The theme this browser has explicitly stored, or `null` when none has ever
 * been picked.
 *
 * `getTheme()` cannot answer that question: it substitutes `DEFAULT_THEME` for
 * an absent or unrecognised value, which makes "sitting on Matrix because I
 * chose it" and "never opened the theme picker" indistinguishable. The
 * onboarding checklist needs the difference — see
 * `use-onboarding-checklist.ts`.
 *
 * Never throws: `localStorage` access itself can raise in private-browsing
 * modes, and a checklist has no business taking a render down over a theme.
 */
export function readStoredTheme(): ThemeId | null {
  if (typeof window === 'undefined') return null
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isValidTheme(stored) ? stored : null
  } catch {
    return null
  }
}

export function getTheme(): ThemeId {
  return readStoredTheme() ?? DEFAULT_THEME
}

export function setTheme(theme: ThemeId): void {
  const root = document.documentElement
  root.setAttribute('data-theme', theme)
  root.classList.remove('light', 'dark', 'system')
  const nextMode = isDarkTheme(theme) ? 'dark' : 'light'
  root.classList.add(nextMode)
  root.style.setProperty('color-scheme', nextMode)
  localStorage.setItem(STORAGE_KEY, theme)
}
