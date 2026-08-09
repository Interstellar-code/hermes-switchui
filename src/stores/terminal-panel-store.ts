import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const DEFAULT_PANEL_HEIGHT = 280
const MIN_PANEL_HEIGHT = 100

/**
 * Single source of truth for the terminal's default working directory.
 *
 * Previously this store defaulted brand-new tabs to `'~'` while
 * `terminal-workspace.tsx` declared its own separate `DEFAULT_TERMINAL_CWD =
 * '~/.hermes'` constant for the "+ new terminal" action, the cwd-picker's
 * primary "Hermes state dir" option, and every fallback render of a tab's
 * cwd. Two independent literals for the same concept meant the very first
 * tab a fresh install ever sees (created here, at store-init time, before
 * terminal-workspace.tsx's own default ever applies) silently disagreed with
 * every other "default" the terminal UI presents.
 *
 * `'~/.hermes'` wins: it is the value terminal-workspace.tsx already treats
 * as canonical everywhere a user-visible default matters (button, picker,
 * fallback label), and it is the directory this workspace actually manages
 * (agent state, profiles, config) — a plain terminal opened against it lands
 * somewhere relevant instead of the user's unrelated home directory.
 */
export const DEFAULT_TERMINAL_CWD = '~/.hermes'

export type TerminalTabStatus =
  | 'active'
  | 'idle'
  | 'connecting'
  | 'reconnecting'
  | 'exited'
  | 'error'

export type TerminalTab = {
  id: string
  title: string
  cwd: string
  sessionId: string | null
  status: TerminalTabStatus
}

type TerminalPanelState = {
  isPanelOpen: boolean
  panelHeight: number
  tabs: Array<TerminalTab>
  activeTabId: string
  terminalCounter: number
  setPanelOpen: (isOpen: boolean) => void
  togglePanel: () => void
  setPanelHeight: (height: number) => void
  createTab: (cwd?: string) => string
  closeTab: (tabId: string) => void
  closeAllTabs: () => void
  setActiveTab: (tabId: string) => void
  renameTab: (tabId: string, title: string) => void
  setTabSessionId: (tabId: string, sessionId: string | null) => void
  setTabStatus: (tabId: string, status: TerminalTabStatus) => void
}

function createDefaultTab(counter: number, cwd = DEFAULT_TERMINAL_CWD): TerminalTab {
  return {
    id: crypto.randomUUID(),
    title: `Terminal ${counter}`,
    cwd,
    sessionId: null,
    status: 'idle',
  }
}

export const useTerminalPanelStore = create<TerminalPanelState>()(
  persist(
    (set, get) => ({
      isPanelOpen: false,
      panelHeight: DEFAULT_PANEL_HEIGHT,
      tabs: [createDefaultTab(1)],
      activeTabId: '',
      terminalCounter: 1,
      setPanelOpen: function setPanelOpen(isOpen: boolean) {
        set({ isPanelOpen: isOpen })
      },
      togglePanel: function togglePanel() {
        set((state) => ({ isPanelOpen: !state.isPanelOpen }))
      },
      setPanelHeight: function setPanelHeight(height: number) {
        const clamped = Math.max(MIN_PANEL_HEIGHT, Math.round(height))
        set({ panelHeight: clamped })
      },
      createTab: function createTab(cwd = '~') {
        const { terminalCounter } = get()
        const nextCounter = terminalCounter + 1
        const tab = createDefaultTab(nextCounter, cwd)
        set((state) => ({
          tabs: [...state.tabs, tab],
          activeTabId: tab.id,
          terminalCounter: nextCounter,
          isPanelOpen: true,
        }))
        return tab.id
      },
      closeTab: function closeTab(tabId: string) {
        set((state) => {
          const nextTabs = state.tabs.filter((tab) => tab.id !== tabId)
          if (nextTabs.length === 0) {
            const fallbackTab = createDefaultTab(state.terminalCounter + 1)
            return {
              tabs: [fallbackTab],
              activeTabId: fallbackTab.id,
              terminalCounter: state.terminalCounter + 1,
              isPanelOpen: false,
            }
          }
          const activeTabId =
            state.activeTabId === tabId ? nextTabs[0].id : state.activeTabId
          return {
            tabs: nextTabs,
            activeTabId,
          }
        })
      },
      closeAllTabs: function closeAllTabs() {
        set((state) => {
          const fallbackTab = createDefaultTab(state.terminalCounter + 1)
          return {
            tabs: [fallbackTab],
            activeTabId: fallbackTab.id,
            terminalCounter: state.terminalCounter + 1,
            isPanelOpen: false,
          }
        })
      },
      setActiveTab: function setActiveTab(tabId: string) {
        set({ activeTabId: tabId })
      },
      renameTab: function renameTab(tabId: string, title: string) {
        const trimmed = title.trim()
        if (!trimmed) return
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.id === tabId ? { ...tab, title: trimmed } : tab,
          ),
        }))
      },
      setTabSessionId: function setTabSessionId(
        tabId: string,
        sessionId: string | null,
      ) {
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.id === tabId ? { ...tab, sessionId } : tab,
          ),
        }))
      },
      setTabStatus: function setTabStatus(
        tabId: string,
        status: TerminalTabStatus,
      ) {
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.id === tabId ? { ...tab, status } : tab,
          ),
        }))
      },
    }),
    {
      name: 'terminal-panel-state',
      partialize: function partialize(state) {
        return {
          isPanelOpen: state.isPanelOpen,
          panelHeight: state.panelHeight,
          tabs: state.tabs.map((tab) => ({ ...tab, status: 'idle' as const })),
          activeTabId: state.activeTabId,
          terminalCounter: state.terminalCounter,
        }
      },
      onRehydrateStorage: function onRehydrateStorage() {
        return function onHydrated(state, error) {
          if (error || !state) return
          if (state.tabs.length === 0) {
            const fallback = createDefaultTab(state.terminalCounter + 1)
            useTerminalPanelStore.setState({
              tabs: [fallback],
              activeTabId: fallback.id,
              terminalCounter: state.terminalCounter + 1,
            })
            return
          }
          // Persist tab descriptors (including session IDs for intentional
          // PTY reattach), but never resurrect transient connection status.
          const tabs = state.tabs.map((tab) => ({
            ...tab,
            status: 'idle' as const,
          }))
          const activeExists = tabs.some((tab) => tab.id === state.activeTabId)
          useTerminalPanelStore.setState({
            tabs,
            ...(activeExists ? {} : { activeTabId: tabs[0].id }),
          })
        }
      },
    },
  ),
)

export { DEFAULT_PANEL_HEIGHT, MIN_PANEL_HEIGHT }
