import { useEffect } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { applyStoredTheme } from '@/lib/theme'

export type SettingsThemeMode = 'system' | 'light' | 'dark'
export type AccentColor = 'orange' | 'purple' | 'blue' | 'green'

export type StudioSettings = {
  claudeUrl: string
  claudeToken: string
  theme: SettingsThemeMode
  accentColor: AccentColor
  editorFontSize: number
  editorWordWrap: boolean
  editorMinimap: boolean
  notificationsEnabled: boolean
  usageThreshold: number
  smartSuggestionsEnabled: boolean
  preferredBudgetModel: string
  preferredPremiumModel: string
  onlySuggestCheaper: boolean
  /** Mobile chat nav mode: 'dock' = iMessage (no nav in chat), 'integrated' = chat input in nav pill, 'scroll-hide' = nav shows on scroll up */
  mobileChatNavMode: 'dock' | 'integrated' | 'scroll-hide'
}

type StudioSettingsState = {
  settings: StudioSettings
  updateSettings: (updates: Partial<StudioSettings>) => void
}

export const defaultStudioSettings: StudioSettings = {
  claudeUrl: '',
  claudeToken: '',
  theme: 'system',
  accentColor: 'blue',
  editorFontSize: 13,
  editorWordWrap: true,
  editorMinimap: false,
  notificationsEnabled: true,
  usageThreshold: 80,
  smartSuggestionsEnabled: false,
  preferredBudgetModel: '',
  preferredPremiumModel: '',
  onlySuggestCheaper: false,
  mobileChatNavMode: 'dock',
}

/**
 * Studio (browser-local) preferences — theme mode, editor prefs, chat nav
 * mode, etc. Persisted to localStorage under `claude-settings`.
 *
 * Named `useStudioSettingsStore`, not `useSettingsStore`, on purpose: the
 * *gateway* settings store at `@/stores/settings-store.ts` used to export a
 * hook with the exact same identifier — two unrelated zustand stores sharing
 * one name, which made every `grep useSettingsStore` a coin flip about which
 * store a call site actually touched. See
 * `use-settings-store-naming.contract.test.ts`.
 */
export const useStudioSettingsStore = create<StudioSettingsState>()(
  persist(
    function createSettingsStore(set) {
      return {
        settings: defaultStudioSettings,
        updateSettings: function updateSettings(updates) {
          set(function applyUpdates(state) {
            return {
              settings: {
                ...state.settings,
                ...updates,
              },
            }
          })
        },
      }
    },
    {
      name: 'claude-settings',
      skipHydration: true,
    },
  ),
)

export function useSettings() {
  useEffect(() => {
    void useStudioSettingsStore.persist.rehydrate()
  }, [])

  const settings = useStudioSettingsStore(function selectSettings(state) {
    return state.settings
  })
  const updateSettings = useStudioSettingsStore(
    function selectUpdateSettings(state) {
      return state.updateSettings
    },
  )

  return {
    settings,
    updateSettings,
  }
}

export function resolveTheme(theme: SettingsThemeMode): 'light' | 'dark' {
  if (theme === 'light') return 'light'
  if (theme === 'dark') return 'dark'

  if (typeof window === 'undefined') return 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

/**
 * Re-paint whatever theme is already in effect. Takes a mode argument only so
 * existing callers keep compiling — the concrete theme id is owned by
 * `claude-theme`, and the light/dark callers switch it via `setTheme` before
 * calling here.
 *
 * Paints without persisting (`applyStoredTheme`, not `setTheme(getTheme())`):
 * see that function's comment — writing the default on a browser that never
 * picked one silently completes the onboarding "Pick a theme" step.
 */
export function applyTheme(_theme?: SettingsThemeMode) {
  applyStoredTheme()
  document.documentElement.setAttribute('data-accent', 'orange')
}

export function initializeSettingsAppearance() {
  applyStoredTheme()
  document.documentElement.setAttribute('data-accent', 'orange')
}
