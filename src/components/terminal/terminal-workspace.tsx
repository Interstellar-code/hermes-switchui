import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Add01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  ComputerTerminal01Icon,
  Copy01Icon,
  SidebarLeft01Icon,
} from '@hugeicons/core-free-icons'
import type { FitAddon } from '@xterm/addon-fit'
import type * as FitAddonModule from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'
import type * as XtermModule from '@xterm/xterm'
import type * as WebLinksAddonModule from '@xterm/addon-web-links'
import type { TerminalTab } from '@/stores/terminal-panel-store'
import { MatrixRainCanvas } from '@/components/terminal/matrix-rain-canvas'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { clampContextMenuPosition } from '@/lib/context-menu'
import { useTerminalPanelStore } from '@/stores/terminal-panel-store'
import { useProjects } from '@/lib/projects-api'
import {
  closeTerminalSession,
  createTerminalInputQueue,
  parseTerminalEventBlock,
  postTerminalInput,
  postTerminalResize,
} from '@/components/terminal/terminal-stream'
import '@/styles/matrix-terminal.css'

// Dynamic imports to avoid SSR crash (xterm uses `self` which doesn't exist on server)
let xtermLoaded = false
let TerminalCtor: typeof XtermModule.Terminal
let FitAddonCtor: typeof FitAddonModule.FitAddon
let WebLinksAddonCtor: typeof WebLinksAddonModule.WebLinksAddon

async function ensureXterm() {
  if (xtermLoaded) return
  const [xtermMod, fitMod, linksMod] = await Promise.all([
    import('@xterm/xterm'),
    import('@xterm/addon-fit'),
    import('@xterm/addon-web-links'),
  ])
  // Load CSS on client only
  await import('@xterm/xterm/css/xterm.css')
  TerminalCtor = xtermMod.Terminal
  FitAddonCtor = fitMod.FitAddon
  WebLinksAddonCtor = linksMod.WebLinksAddon
  xtermLoaded = true
}

type ContextMenuState = {
  tabId: string
  x: number
  y: number
}

type TerminalWorkspaceProps = {
  mode: 'panel' | 'fullscreen'
  panelVisible?: boolean
  onMinimizePanel?: () => void
  onMaximizePanel?: () => void
  onClosePanel?: () => void
  onBack?: () => void
}

type TerminalSessionResponse = {
  sessionId?: string
}

type SplitMode = 'single' | 'horizontal' | 'vertical'

const DEFAULT_TERMINAL_CWD = '~/.hermes'
const MAX_RECONNECT_ATTEMPTS = 4

export function TerminalWorkspace({
  mode,
  panelVisible = true,
  onMinimizePanel,
  onMaximizePanel,
  onClosePanel,
  onBack,
}: TerminalWorkspaceProps) {
  const tabs = useTerminalPanelStore((state) => state.tabs)
  const activeTabId = useTerminalPanelStore((state) => state.activeTabId)
  const createTab = useTerminalPanelStore((state) => state.createTab)
  const closeTab = useTerminalPanelStore((state) => state.closeTab)
  const closeAllTabs = useTerminalPanelStore((state) => state.closeAllTabs)
  const setActiveTab = useTerminalPanelStore((state) => state.setActiveTab)
  const renameTab = useTerminalPanelStore((state) => state.renameTab)
  const setTabSessionId = useTerminalPanelStore(
    (state) => state.setTabSessionId,
  )
  const setTabStatus = useTerminalPanelStore((state) => state.setTabStatus)

  const [termHeight, setTermHeight] = useState<number | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true)
  const [sessionFilter, setSessionFilter] = useState('')
  const [splitMode, setSplitMode] = useState<SplitMode>('single')
  const [copiedOutput, setCopiedOutput] = useState(false)
  const [renameTabId, setRenameTabId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [secondaryTabId, setSecondaryTabId] = useState<string | null>(null)
  const [splitRatio, setSplitRatio] = useState(50)
  const [newSessionCwd, setNewSessionCwd] = useState(DEFAULT_TERMINAL_CWD)
  const projectsQuery = useProjects(false, panelVisible)

  const containerMapRef = useRef(new Map<string, HTMLDivElement>())
  const terminalMapRef = useRef(new Map<string, Terminal>())
  const fitMapRef = useRef(new Map<string, FitAddon>())
  const readerMapRef = useRef(
    new Map<string, ReadableStreamDefaultReader<Uint8Array>>(),
  )
  const connectedRef = useRef(new Set<string>())
  const inputQueueMapRef = useRef(
    new Map<string, ReturnType<typeof createTerminalInputQueue>>(),
  )
  const reconnectAttemptsRef = useRef(new Map<string, number>())
  const reconnectTimersRef = useRef(new Map<string, number>())

  const activeTab = useMemo(
    function activeTabMemo() {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime safety
      return tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null
    },
    [activeTabId, tabs],
  )
  const filteredTabs = useMemo(() => {
    const query = sessionFilter.trim().toLowerCase()
    if (!query) return tabs
    return tabs.filter((tab) =>
      `${tab.title} ${tab.cwd} ${tab.status}`.toLowerCase().includes(query),
    )
  }, [sessionFilter, tabs])
  const cwdOptions = useMemo(
    () => [
      { id: 'hermes', value: DEFAULT_TERMINAL_CWD, label: 'Hermes home' },
      { id: 'home', value: '~', label: 'User home' },
      ...(projectsQuery.data?.projects ?? [])
        .filter((project) => project.primary_path)
        .map((project) => ({
          id: project.id,
          value: project.primary_path ?? '~',
          label: project.name,
        })),
    ],
    [projectsQuery.data?.projects],
  )
  const visibleTerminalTabs = useMemo(() => {
    if (splitMode === 'single') return [activeTab]
    const secondary =
      tabs.find(
        (tab) => tab.id === secondaryTabId && tab.id !== activeTab.id,
      ) ??
      tabs.find((tab) => tab.id !== activeTab.id) ??
      activeTab
    return secondary.id === activeTab.id ? [activeTab] : [activeTab, secondary]
  }, [activeTab, secondaryTabId, splitMode, tabs])
  const contextMenuPosition = contextMenu
    ? clampContextMenuPosition(
        contextMenu,
        { width: 150, height: 80 },
        {
          width: typeof window === 'undefined' ? 0 : window.innerWidth,
          height: typeof window === 'undefined' ? 0 : window.innerHeight,
        },
      )
    : null

  const sendInputRequest = useCallback(async function sendQueuedInput(
    tabId: string,
    data: string,
  ): Promise<boolean> {
    // Look up session ID from store at call time (not stale closure)
    const currentTab = useTerminalPanelStore
      .getState()
      .tabs.find((t) => t.id === tabId)
    if (!currentTab?.sessionId) return false
    return postTerminalInput(currentTab.sessionId, data)
  }, [])

  const sendInput = useCallback(
    function handleSendInput(tabId: string, data: string) {
      let queue = inputQueueMapRef.current.get(tabId)
      if (!queue) {
        queue = createTerminalInputQueue((chunk) =>
          sendInputRequest(tabId, chunk),
        )
        inputQueueMapRef.current.set(tabId, queue)
      }
      queue.push(data)
    },
    [sendInputRequest],
  )

  const resizeSession = useCallback(async function handleResizeSession(
    tabId: string,
    terminal: Terminal,
  ) {
    const currentTab = useTerminalPanelStore
      .getState()
      .tabs.find((t) => t.id === tabId)
    if (!currentTab?.sessionId) return
    await postTerminalResize(currentTab.sessionId, terminal.cols, terminal.rows)
  }, [])

  const captureRecentTerminalOutput = useCallback(
    function readRecentTerminalOutput(tabId: string): string {
      const terminal = terminalMapRef.current.get(tabId)
      if (!terminal) return ''

      const buffer = terminal.buffer.active
      const startLine = Math.max(0, buffer.length - 100)
      const recentLines: Array<string> = []

      for (let index = startLine; index < buffer.length; index += 1) {
        const line = buffer.getLine(index)
        if (!line) continue
        recentLines.push(line.translateToString(true))
      }

      return recentLines.join('\n').trim()
    },
    [],
  )

  const handleCopyOutput = useCallback(
    async function copyOutput() {
      const output = captureRecentTerminalOutput(activeTab.id)
      if (!output) return
      await navigator.clipboard.writeText(output).catch(function fallback() {
        return undefined
      })
      setCopiedOutput(true)
      window.setTimeout(function resetCopied() {
        setCopiedOutput(false)
      }, 1400)
    },
    [activeTab.id, captureRecentTerminalOutput],
  )

  const handleClearActiveTerminal = useCallback(
    function clearActiveTerminal() {
      terminalMapRef.current.get(activeTab.id)?.clear()
    },
    [activeTab.id],
  )

  const focusActiveTerminal = useCallback(
    function focusTerminal() {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime safety
      if (!activeTab) return
      const terminal = terminalMapRef.current.get(activeTab.id)
      terminal?.focus()
    },
    [activeTab],
  )

  const closeTabResources = useCallback(async function releaseTabResources(
    tabId: string,
    sessionId: string | null,
  ) {
    const reader = readerMapRef.current.get(tabId)
    readerMapRef.current.delete(tabId)
    if (reader) {
      await reader.cancel().catch(function ignore() {
        return undefined
      })
    }
    const terminal = terminalMapRef.current.get(tabId)
    terminal?.dispose()
    terminalMapRef.current.delete(tabId)
    fitMapRef.current.delete(tabId)
    containerMapRef.current.delete(tabId)
    connectedRef.current.delete(tabId)
    inputQueueMapRef.current.get(tabId)?.flush()
    inputQueueMapRef.current.get(tabId)?.clear()
    inputQueueMapRef.current.delete(tabId)

    if (sessionId) {
      await closeTerminalSession(sessionId)
    }
  }, [])

  const handleCloseTab = useCallback(
    function closeWorkspaceTab(tab: TerminalTab) {
      void closeTabResources(tab.id, tab.sessionId)
      closeTab(tab.id)
    },
    [closeTab, closeTabResources],
  )

  const handleClosePanel = useCallback(
    function closeWorkspacePanel() {
      const currentTabs = useTerminalPanelStore.getState().tabs
      for (const tab of currentTabs) {
        void closeTabResources(tab.id, tab.sessionId)
      }
      closeAllTabs()
      if (onClosePanel) onClosePanel()
    },
    [closeAllTabs, closeTabResources, onClosePanel],
  )

  const connectTab = useCallback(
    async function connectWorkspaceTab(tab: TerminalTab) {
      if (connectedRef.current.has(tab.id)) return
      const terminal = terminalMapRef.current.get(tab.id)
      if (!terminal) return

      connectedRef.current.add(tab.id)
      reconnectTimersRef.current.delete(tab.id)
      setTabStatus(tab.id, 'connecting')

      const response = await fetch('/api/terminal-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cwd: tab.cwd || DEFAULT_TERMINAL_CWD,
          // Let the server pick the shell from $SHELL
          cols: terminal.cols,
          rows: terminal.rows,
          // If this tab already has a sessionId, ask the server to reattach
          // to that PTY rather than spawning a fresh one. Lets us survive
          // transient SSE disconnects (network blip, browser suspension,
          // HMR reload) without dropping the user's shell. See #298.
          sessionId: tab.sessionId || undefined,
        }),
      }).catch(function handleError() {
        return null
      })

      if (!response || !response.ok || !response.body) {
        if (response?.status === 404) setTabSessionId(tab.id, null)
        terminal.writeln('\r\n[terminal] failed to connect\r\n')
        connectedRef.current.delete(tab.id)
        setTabStatus(tab.id, 'error')
        return
      }

      const reader = response.body.getReader()
      readerMapRef.current.set(tab.id, reader)
      const decoder = new TextDecoder()
      let buffer = ''
      let processExited = false

      // Throttled terminal writes — yields to input events between flushes
      let writeBuf = ''
      let flushTimer: ReturnType<typeof setTimeout> | undefined
      const FLUSH_MS = 80 // ~12fps — generous gaps for input
      function flushWrites() {
        flushTimer = undefined
        if (writeBuf && terminal) {
          const chunk = writeBuf
          writeBuf = ''
          terminal.write(chunk)
        }
      }
      function queueWrite(data: string) {
        writeBuf += data
        if (!flushTimer) flushTimer = setTimeout(flushWrites, FLUSH_MS)
      }

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime safety
      while (true) {
        const readState = await reader.read().catch(function onReadError() {
          return { done: true, value: undefined }
        })
        const value = readState.value
        if (readState.done) break
        if (!value) continue

        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() ?? ''

        for (let _bi = 0; _bi < blocks.length; _bi++) {
          // Yield every 10 blocks to let input events through
          if (_bi > 0 && _bi % 10 === 0)
            await new Promise((r) => setTimeout(r, 0))
          const block = blocks[_bi]
          if (!block.trim()) continue
          const parsed = parseTerminalEventBlock(block)
          if (!parsed) continue
          const eventName = parsed.event
          const eventData = parsed.data

          if (eventName === 'session' && eventData) {
            const payload = eventData as TerminalSessionResponse
            if (payload.sessionId) {
              setTabSessionId(tab.id, payload.sessionId)
              setTabStatus(tab.id, 'active')
              const nextTitle = tab.cwd === '~' ? tab.title : tab.cwd
              renameTab(tab.id, nextTitle)
              // Resize only now that the session exists server-side. Firing at
              // terminal creation raced ahead of this sessionId assignment and
              // 404'd against a not-yet-live session — noisy on first mount and
              // after a server/gateway restart re-issues sessionIds.
              const liveTerminal = terminalMapRef.current.get(tab.id)
              if (liveTerminal) void resizeSession(tab.id, liveTerminal)
            }
            continue
          }

          if (eventName === 'data' && eventData) {
            const payload = eventData as { data?: string }
            if (typeof payload.data === 'string') {
              queueWrite(payload.data)
            }
            continue
          }

          if (eventName === 'exit' && eventData) {
            processExited = true
            const payload = eventData as {
              exitCode?: number
              signal?: number
            }
            terminal.writeln(
              `\r\n[process exited${payload.exitCode != null ? ` code=${payload.exitCode}` : ''}]\r\n`,
            )
            continue
          }

          if (eventName === 'error' && eventData) {
            terminal.writeln('\r\n[terminal] connection error\r\n')
          }
        }
      }

      // Flush any remaining buffered writes
      clearTimeout(flushTimer)
      flushWrites()

      const latestTab = useTerminalPanelStore
        .getState()
        .tabs.find((item) => item.id === tab.id)

      // SSE stream ended. Two reasons it could end:
      // 1) The shell process exited (PTY closed) — server emits 'close'
      //    and we should fully tear down on the client too.
      // 2) The SSE stream itself dropped (network blip, browser tab
      //    suspension, HMR reload) but the PTY is still alive on the
      //    server (we changed terminal-stream to keep PTYs alive across
      //    SSE disconnects — see #298). In that case, try to reattach.
      //
      // We don't reliably know which reason from inside the read loop, so
      // attempt a single quick reattach with the existing sessionId. If the
      // server says the session is gone, we fall through to a clean idle.
      const previousSessionId = latestTab?.sessionId ?? null
      connectedRef.current.delete(tab.id)
      if (processExited) {
        reconnectAttemptsRef.current.delete(tab.id)
        setTabSessionId(tab.id, null)
        setTabStatus(tab.id, 'exited')
        return
      }
      setTabStatus(tab.id, 'reconnecting')

      if (previousSessionId) {
        // Don't call /api/terminal-close — we *want* the PTY to live so
        // we can reattach to it. The server will reap the session via
        // its own DETACH_TTL_MS if no client comes back.

        // Wait a beat for the server to register the markDetached, then
        // try to reconnect. The connectTab path will send sessionId in
        // the body, so the server reattaches to the same PTY.
        const stillSameTab =
          useTerminalPanelStore
            .getState()
            .tabs.find((item) => item.id === tab.id)?.sessionId ===
          previousSessionId
        const attempt = reconnectAttemptsRef.current.get(tab.id) ?? 0
        if (stillSameTab && attempt < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttemptsRef.current.set(tab.id, attempt + 1)
          terminal.writeln('\r\n\x1b[2m[reconnecting...]\x1b[0m')
          // Schedule a reconnect on the next tick to break out of this
          // closure cleanly. connectTab guards against double-connecting.
          const timer = window.setTimeout(
            () => {
              const refreshed = useTerminalPanelStore
                .getState()
                .tabs.find((item) => item.id === tab.id)
              if (refreshed && refreshed.sessionId === previousSessionId) {
                void connectTab(refreshed)
              }
            },
            Math.min(8000, 600 * 2 ** attempt),
          )
          reconnectTimersRef.current.set(tab.id, timer)
          return
        }
      }

      setTabSessionId(tab.id, null)
      setTabStatus(tab.id, 'error')
    },
    [renameTab, resizeSession, setTabSessionId, setTabStatus],
  )

  const ensureTerminalForTab = useCallback(
    function ensureTerminalTab(tab: TerminalTab) {
      if (terminalMapRef.current.has(tab.id)) return
      const container = containerMapRef.current.get(tab.id)
      if (!container) return

      // Guard: xterm must be loaded first
      if (!xtermLoaded) {
        void ensureXterm().then(() => {
          // Re-trigger after load
          if (
            !terminalMapRef.current.has(tab.id) &&
            containerMapRef.current.has(tab.id)
          ) {
            ensureTerminalForTab(tab)
          }
        })
        return
      }

      const isMobile = window.matchMedia('(max-width: 767px)').matches
      const terminal = new TerminalCtor({
        cursorBlink: true,
        fontSize: isMobile ? 11 : 13,
        fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
        theme: {
          background: '#020603',
          foreground: '#c5ffd0',
          cursor: '#00ff41',
          cursorAccent: '#001b08',
          selectionBackground: '#064718',
          black: '#001006',
          red: '#ff5fa2',
          green: '#00ff41',
          yellow: '#ffb347',
          blue: '#5fcfff',
          magenta: '#ff8ae2',
          cyan: '#5fcfff',
          white: '#d6f8de',
          brightBlack: '#31573a',
          brightRed: '#ff7aa8',
          brightGreen: '#9effb2',
          brightYellow: '#f5d07a',
          brightBlue: '#7be8ff',
          brightMagenta: '#ff9ee7',
          brightCyan: '#9eefff',
          brightWhite: '#f0fff3',
        },
      })
      const fitAddon = new FitAddonCtor()
      const webLinks = new WebLinksAddonCtor()
      terminal.loadAddon(fitAddon)
      terminal.loadAddon(webLinks)
      terminal.open(container)
      fitAddon.fit()

      terminal.onData(function onData(data) {
        void sendInput(tab.id, data)
      })

      terminalMapRef.current.set(tab.id, terminal)
      fitMapRef.current.set(tab.id, fitAddon)
      // Resize is deferred to connectTab, which fires it once the server has
      // assigned a live sessionId — resizing here raced the session and 404'd.
      void connectTab(tab)
    },
    [connectTab, sendInput],
  )

  const handleCreateTab = useCallback(
    function createTerminalTab() {
      const newTabId = createTab(newSessionCwd)
      window.setTimeout(function focusNewTab() {
        const tab = useTerminalPanelStore
          .getState()
          .tabs.find((item) => item.id === newTabId)
        if (!tab) return
        ensureTerminalForTab(tab)
        focusActiveTerminal()
      }, 0)
    },
    [createTab, ensureTerminalForTab, focusActiveTerminal, newSessionCwd],
  )

  const handleSecondaryCwdChange = useCallback(
    function changeSecondaryCwd(cwd: string) {
      const primaryTabId = activeTab.id
      const existingTab = tabs.find(
        (tab) => tab.id !== primaryTabId && tab.cwd === cwd,
      )
      const secondaryId = existingTab?.id ?? createTab(cwd)

      setSecondaryTabId(secondaryId)
      setActiveTab(primaryTabId)

      if (!existingTab) {
        window.setTimeout(function initializeSecondaryTab() {
          const secondaryTab = useTerminalPanelStore
            .getState()
            .tabs.find((tab) => tab.id === secondaryId)
          if (secondaryTab) ensureTerminalForTab(secondaryTab)
        }, 0)
      }
    },
    [activeTab.id, createTab, ensureTerminalForTab, setActiveTab, tabs],
  )

  const handleSplitResizeStart = useCallback(
    function resizeSplit(event: React.PointerEvent<HTMLDivElement>) {
      if (splitMode === 'single') return
      event.preventDefault()
      const area = event.currentTarget.parentElement
      if (!area) return
      const splitArea = area
      function onMove(moveEvent: PointerEvent) {
        const rect = splitArea.getBoundingClientRect()
        const raw =
          splitMode === 'horizontal'
            ? ((moveEvent.clientX - rect.left) / rect.width) * 100
            : ((moveEvent.clientY - rect.top) / rect.height) * 100
        setSplitRatio(Math.max(20, Math.min(80, raw)))
      }
      function onUp() {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [splitMode],
  )

  useEffect(
    function closeContextMenuOnClick() {
      if (!contextMenu) return
      function handlePointerDown() {
        setContextMenu(null)
      }
      function handleEscape(event: KeyboardEvent) {
        if (event.key === 'Escape') {
          setContextMenu(null)
        }
      }
      window.addEventListener('pointerdown', handlePointerDown)
      window.addEventListener('keydown', handleEscape)
      return function cleanup() {
        window.removeEventListener('pointerdown', handlePointerDown)
        window.removeEventListener('keydown', handleEscape)
      }
    },
    [contextMenu],
  )

  useEffect(
    function ensureTabsInitialized() {
      if (tabs.length === 0) {
        createTab(DEFAULT_TERMINAL_CWD)
        return
      }
      if (!activeTabId) {
        setActiveTab(tabs[0].id)
      }
    },
    [activeTabId, createTab, setActiveTab, tabs],
  )

  useEffect(
    function initializeVisibleTabs() {
      if (!panelVisible) return
      for (const tab of visibleTerminalTabs) {
        ensureTerminalForTab(tab)
      }
    },
    [ensureTerminalForTab, panelVisible, visibleTerminalTabs],
  )

  useEffect(
    function focusAndFitOnVisible() {
      if (!panelVisible) return
      // Refit all terminals when becoming visible (e.g. navigating back to terminal route)
      window.setTimeout(() => {
        for (const fitAddon of fitMapRef.current.values()) {
          try {
            fitAddon.fit()
          } catch {
            /* ignore */
          }
        }
        const snapshot = useTerminalPanelStore.getState().tabs
        for (const tab of snapshot) {
          const term = terminalMapRef.current.get(tab.id)
          if (term) void resizeSession(tab.id, term)
        }
        focusActiveTerminal()
      }, 100)
    },
    [focusActiveTerminal, panelVisible, resizeSession],
  )

  useEffect(
    function fitObservedContainers() {
      if (!panelVisible) return
      let frame = 0
      const lastSize = new Map<string, string>()
      const observer = new ResizeObserver((entries) => {
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(() => {
          for (const entry of entries) {
            const tabId = entry.target.getAttribute('data-terminal-tab')
            if (!tabId) continue
            const fit = fitMapRef.current.get(tabId)
            const terminal = terminalMapRef.current.get(tabId)
            if (!fit || !terminal) continue
            try {
              fit.fit()
              const size = `${terminal.cols}x${terminal.rows}`
              if (lastSize.get(tabId) !== size) {
                lastSize.set(tabId, size)
                void resizeSession(tabId, terminal)
              }
            } catch {
              // Container can briefly have zero size while changing routes.
            }
          }
        })
      })
      for (const container of containerMapRef.current.values()) {
        observer.observe(container)
      }
      return () => {
        cancelAnimationFrame(frame)
        observer.disconnect()
      }
    },
    [panelVisible, resizeSession, visibleTerminalTabs],
  )

  useEffect(
    function terminalKeyboardShortcuts() {
      if (!panelVisible) return
      function onKeyDown(event: KeyboardEvent) {
        if (!(event.ctrlKey || event.metaKey)) return
        if (event.key.toLowerCase() === 't') {
          event.preventDefault()
          handleCreateTab()
        } else if (event.key.toLowerCase() === 'w') {
          event.preventDefault()
          handleCloseTab(activeTab)
        } else if (event.key === 'PageDown' || event.key === 'PageUp') {
          event.preventDefault()
          const index = tabs.findIndex((tab) => tab.id === activeTab.id)
          const delta = event.key === 'PageDown' ? 1 : -1
          setActiveTab(tabs[(index + delta + tabs.length) % tabs.length].id)
        }
      }
      window.addEventListener('keydown', onKeyDown)
      return () => window.removeEventListener('keydown', onKeyDown)
    },
    [
      activeTab,
      handleCloseTab,
      handleCreateTab,
      panelVisible,
      setActiveTab,
      tabs,
    ],
  )

  useEffect(
    function fitOnResize() {
      function refitAll() {
        for (const fitAddon of fitMapRef.current.values()) {
          try {
            fitAddon.fit()
          } catch {
            /* */
          }
        }
        const snapshot = useTerminalPanelStore.getState().tabs
        for (const tab of snapshot) {
          const terminal = terminalMapRef.current.get(tab.id)
          if (!terminal) continue
          void resizeSession(tab.id, terminal)
        }
      }

      function handleResize() {
        // Update height from visualViewport (keyboard-aware on mobile)
        const vv = window.visualViewport
        if (vv) {
          setTermHeight(vv.height)
        }
        refitAll()
      }

      const timeout = window.setTimeout(handleResize, 50)
      window.addEventListener('resize', handleResize)
      window.visualViewport?.addEventListener('resize', handleResize)
      window.visualViewport?.addEventListener('scroll', handleResize)

      return function cleanup() {
        window.clearTimeout(timeout)
        window.removeEventListener('resize', handleResize)
        window.visualViewport?.removeEventListener('resize', handleResize)
        window.visualViewport?.removeEventListener('scroll', handleResize)
      }
    },
    [resizeSession],
  )

  useEffect(
    function refitAfterLayoutModeChange() {
      window.setTimeout(() => {
        for (const fitAddon of fitMapRef.current.values()) {
          try {
            fitAddon.fit()
          } catch {
            /* ignore */
          }
        }
      }, 80)
    },
    [sidebarCollapsed, splitMode],
  )

  useEffect(function disposeOnUnmount() {
    return function cleanup() {
      for (const reader of readerMapRef.current.values()) {
        void reader.cancel().catch(function ignore() {
          return undefined
        })
      }
      readerMapRef.current.clear()
      for (const terminal of terminalMapRef.current.values()) {
        terminal.dispose()
      }
      terminalMapRef.current.clear()
      fitMapRef.current.clear()
      containerMapRef.current.clear()
      connectedRef.current.clear()
      for (const timer of reconnectTimersRef.current.values()) {
        window.clearTimeout(timer)
      }
      reconnectTimersRef.current.clear()
      for (const queue of inputQueueMapRef.current.values()) queue.clear()
      inputQueueMapRef.current.clear()
    }
  }, [])

  return (
    <div
      data-screen="terminal"
      className={cn('term-shell', sidebarCollapsed ? 'sidebar-collapsed' : '')}
      style={
        termHeight
          ? { height: termHeight, maxHeight: termHeight }
          : { height: '100%' }
      }
    >
      <aside
        className={cn('term-sessions', sidebarCollapsed ? 'is-collapsed' : '')}
      >
        {/* header */}
        <div className="term-sessions-head">
          <h3>Sessions</h3>
          <span className="ct">{tabs.length}</span>
          <button
            type="button"
            className="term-ico-btn collapse-btn"
            onClick={() => setSidebarCollapsed((v) => !v)}
            title={sidebarCollapsed ? 'Expand sessions' : 'Collapse sessions'}
            aria-label={
              sidebarCollapsed ? 'Expand sessions' : 'Collapse sessions'
            }
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              width="14"
              height="14"
            >
              {sidebarCollapsed ? (
                <path d="M9 18l6-6-6-6" />
              ) : (
                <path d="M15 18l-6-6 6-6" />
              )}
            </svg>
          </button>
        </div>

        {/* search */}
        <div className="term-filter-search">
          <input
            type="text"
            value={sessionFilter}
            onChange={(event) => setSessionFilter(event.target.value)}
            placeholder="Filter sessions…"
            aria-label="Filter sessions"
          />
        </div>

        {/* body */}
        <div className="term-session-body">
          <div className="term-session-group">
            <div className="sec-label">Active</div>
            {filteredTabs.map(function renderSessionRow(tab) {
              const isActive = tab.id === activeTab.id
              return (
                <button
                  type="button"
                  className={cn(
                    'term-row',
                    tab.status === 'active' ? 'live' : '',
                    isActive ? 'on' : '',
                  )}
                  onClick={() => {
                    setActiveTab(tab.id)
                    window.setTimeout(function focusCurrent() {
                      terminalMapRef.current.get(tab.id)?.focus()
                    }, 0)
                  }}
                >
                  <span className="d" />
                  <span className="name">
                    {tab.title}
                    <span className="pwd">
                      {tab.cwd || DEFAULT_TERMINAL_CWD}
                    </span>
                  </span>
                  <span className="item-ct">{tab.status}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* foot */}
        <div className="term-sessions-foot">
          <select
            value={newSessionCwd}
            onChange={(event) => setNewSessionCwd(event.target.value)}
            aria-label="New terminal working directory"
          >
            {cwdOptions.map((option) => (
              <option key={option.id} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <Button
            className="term-new-session"
            size="sm"
            onClick={handleCreateTab}
          >
            <HugeiconsIcon icon={Add01Icon} size={14} strokeWidth={1.7} />
            New session
          </Button>
        </div>

        {/* collapsed rail */}
        <div className="term-rail">
          <span className="rail-label">Sessions</span>
          <span className="rail-badge">{tabs.length}</span>
        </div>
      </aside>

      <main className="term-main">
        <div className="term-tabs">
          <div
            className="term-tabs-scroll"
            role="tablist"
            aria-label="Terminal tabs"
          >
            {tabs.map(function renderTab(tab) {
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime safety
              const isActive = tab.id === activeTab?.id
              return (
                <div className="term-tab-wrap" key={tab.id}>
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    id={`terminal-tab-${tab.id}`}
                    aria-selected={isActive}
                    aria-controls={`terminal-pane-${tab.id}`}
                    tabIndex={isActive ? 0 : -1}
                    onClick={function onClick() {
                      setActiveTab(tab.id)
                      window.setTimeout(function focusCurrent() {
                        terminalMapRef.current.get(tab.id)?.focus()
                      }, 0)
                    }}
                    onContextMenu={function onContextMenu(event) {
                      event.preventDefault()
                      setContextMenu({
                        tabId: tab.id,
                        x: event.clientX,
                        y: event.clientY,
                      })
                    }}
                    onKeyDown={(event) => {
                      if (
                        event.key !== 'ArrowLeft' &&
                        event.key !== 'ArrowRight'
                      )
                        return
                      event.preventDefault()
                      const index = tabs.findIndex((item) => item.id === tab.id)
                      const delta = event.key === 'ArrowRight' ? 1 : -1
                      setActiveTab(
                        tabs[(index + delta + tabs.length) % tabs.length].id,
                      )
                    }}
                    className={cn(
                      'term-tab',
                      tab.status === 'active' ? 'live' : '',
                      isActive ? 'on' : '',
                    )}
                  >
                    <span className="d" />
                    <HugeiconsIcon
                      icon={ComputerTerminal01Icon}
                      size={20}
                      strokeWidth={1.5}
                      className="ic"
                    />
                    <span className="name">{tab.title}</span>
                    <span className="badge">{tab.status}</span>
                  </button>
                  {tabs.length > 1 ? (
                    <button
                      type="button"
                      aria-label={`Close ${tab.title}`}
                      onClick={function onClose(event) {
                        handleCloseTab(tab)
                      }}
                      className="x"
                    >
                      <HugeiconsIcon
                        icon={Cancel01Icon}
                        size={20}
                        strokeWidth={1.5}
                      />
                    </button>
                  ) : null}
                </div>
              )
            })}
          </div>
          <button
            type="button"
            className="add"
            onClick={handleCreateTab}
            title="New tab"
            aria-label="New terminal tab"
          >
            <HugeiconsIcon icon={Add01Icon} size={16} strokeWidth={1.7} />
          </button>

          <div className="right-cluster">
            {splitMode !== 'single' ? (
              <select
                className="term-pane-select"
                value={visibleTerminalTabs[1]?.cwd ?? ''}
                onChange={(event) =>
                  handleSecondaryCwdChange(event.target.value)
                }
                aria-label="Secondary pane working directory"
              >
                <option value="" disabled>
                  Choose working directory
                </option>
                {cwdOptions.map((option) => (
                  <option key={option.id} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : null}
            <button
              type="button"
              className={cn(
                'term-ico-btn',
                splitMode === 'single' ? 'active' : '',
              )}
              onClick={() => setSplitMode('single')}
              title="Single pane"
              aria-label="Single pane"
              aria-pressed={splitMode === 'single'}
            >
              ▣
            </button>
            <button
              type="button"
              className={cn(
                'term-ico-btn',
                splitMode === 'horizontal' ? 'active' : '',
              )}
              onClick={() => setSplitMode('horizontal')}
              title="Split right"
              aria-label="Split right"
              aria-pressed={splitMode === 'horizontal'}
            >
              ◫
            </button>
            <button
              type="button"
              className={cn(
                'term-ico-btn',
                splitMode === 'vertical' ? 'active' : '',
              )}
              onClick={() => setSplitMode('vertical')}
              title="Split down"
              aria-label="Split down"
              aria-pressed={splitMode === 'vertical'}
            >
              ⊟
            </button>
            <span className="term-toolbar-sep" />
            <button
              type="button"
              className="term-ico-btn"
              onClick={() => void handleCopyOutput()}
              title="Copy recent output"
              aria-label="Copy recent output"
            >
              {copiedOutput ? (
                '✓'
              ) : (
                <HugeiconsIcon icon={Copy01Icon} size={16} strokeWidth={1.6} />
              )}
            </button>
            <button
              type="button"
              className="term-ico-btn"
              onClick={handleClearActiveTerminal}
              title="Clear terminal"
              aria-label="Clear terminal"
            >
              ⌫
            </button>
            {activeTab.status === 'error' || activeTab.status === 'exited' ? (
              <button
                type="button"
                className="term-retry-btn"
                onClick={() => void connectTab(activeTab)}
              >
                {activeTab.status === 'exited' ? 'Restart' : 'Retry'}
              </button>
            ) : null}
            {mode === 'panel' ? (
              <>
                <button
                  type="button"
                  className="term-ico-btn"
                  onClick={onMinimizePanel}
                  aria-label="Minimize"
                >
                  <HugeiconsIcon
                    icon={SidebarLeft01Icon}
                    size={20}
                    strokeWidth={1.5}
                  />
                </button>
                <button
                  type="button"
                  className="term-ico-btn"
                  onClick={onMaximizePanel}
                  aria-label="Maximize"
                >
                  <HugeiconsIcon
                    icon={ArrowRight01Icon}
                    size={20}
                    strokeWidth={1.5}
                  />
                </button>
                <button
                  type="button"
                  className="term-ico-btn"
                  onClick={handleClosePanel}
                  aria-label="Close"
                >
                  <HugeiconsIcon
                    icon={Cancel01Icon}
                    size={20}
                    strokeWidth={1.5}
                  />
                </button>
              </>
            ) : null}
          </div>
        </div>

        <div
          className={cn(
            'term-area',
            splitMode === 'horizontal' ? 'split-h' : '',
            splitMode === 'vertical' ? 'split-v' : '',
          )}
          style={
            splitMode === 'horizontal'
              ? { gridTemplateColumns: `${splitRatio}% minmax(0, 1fr)` }
              : splitMode === 'vertical'
                ? { gridTemplateRows: `${splitRatio}% minmax(0, 1fr)` }
                : undefined
          }
        >
          {tabs.map(function renderTerminal(tab) {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime safety
            const isActive = tab.id === activeTab?.id
            const isVisible = visibleTerminalTabs.some(
              (visibleTab) => visibleTab.id === tab.id,
            )
            return (
              <div
                key={tab.id}
                id={`terminal-pane-${tab.id}`}
                role="tabpanel"
                aria-labelledby={`terminal-tab-${tab.id}`}
                className={cn(
                  'term-pane',
                  isActive ? 'focused' : '',
                  isVisible ? '' : 'hidden',
                )}
              >
                <MatrixRainCanvas
                  active={panelVisible && isVisible}
                  className="matrix-rain-canvas"
                />
                <div className="term-hud">
                  <span className="d" />
                  <span>
                    <b>{tab.status}</b>
                  </span>
                  <span>{tab.cwd || DEFAULT_TERMINAL_CWD}</span>
                  <span>{tab.sessionId ? 'attached' : 'starting'}</span>
                </div>
                <div
                  data-terminal-tab={tab.id}
                  ref={function assignContainer(node) {
                    if (node) {
                      containerMapRef.current.set(tab.id, node)
                      if (panelVisible && isVisible) ensureTerminalForTab(tab)
                      return
                    }
                    containerMapRef.current.delete(tab.id)
                  }}
                  onClick={function tapToFocus() {
                    setActiveTab(tab.id)
                    terminalMapRef.current.get(tab.id)?.focus()
                  }}
                  className="term-xterm"
                />
              </div>
            )
          })}
          {visibleTerminalTabs.length > 1 ? (
            <div
              className={cn(
                'term-split-divider',
                splitMode === 'vertical' ? 'vertical' : '',
              )}
              role="separator"
              aria-orientation={
                splitMode === 'vertical' ? 'horizontal' : 'vertical'
              }
              aria-valuenow={Math.round(splitRatio)}
              onPointerDown={handleSplitResizeStart}
              style={
                splitMode === 'vertical'
                  ? { top: `calc(${splitRatio}% - 2px)` }
                  : { left: `calc(${splitRatio}% - 2px)` }
              }
            />
          ) : null}
        </div>

        <footer className="term-foot">
          <span>
            <b>{tabs.length}</b> tabs open
          </span>
          <span className="sep" />
          <span>
            active <b>{activeTab.title}</b>
          </span>
          <span className="sep" />
          <span>
            workspace <b>{DEFAULT_TERMINAL_CWD}</b>
          </span>
          <span
            className={cn('ok', activeTab.status === 'error' ? 'error' : '')}
          >
            {activeTab.status === 'active'
              ? 'terminal ready'
              : activeTab.status}
          </span>
        </footer>
      </main>

      {/* Mobile input bar moved to WorkspaceShell as a sibling to prevent re-render freeze */}

      {contextMenu && contextMenuPosition ? (
        <div
          className="term-context-menu"
          role="menu"
          style={{ top: contextMenuPosition.y, left: contextMenuPosition.x }}
          onClick={function stop(event) {
            event.stopPropagation()
          }}
        >
          <button
            type="button"
            className="term-context-item"
            role="menuitem"
            autoFocus
            onClick={function renameTabFromMenu() {
              const menuTab = tabs.find((tab) => tab.id === contextMenu.tabId)
              setContextMenu(null)
              if (!menuTab) return
              setRenameTabId(menuTab.id)
              setRenameValue(menuTab.title)
            }}
          >
            Rename
          </button>
          <button
            type="button"
            className="term-context-item"
            role="menuitem"
            onClick={function closeTabFromMenu() {
              const menuTab = tabs.find((tab) => tab.id === contextMenu.tabId)
              setContextMenu(null)
              if (!menuTab) return
              handleCloseTab(menuTab)
            }}
          >
            Close
          </button>
        </div>
      ) : null}
      {renameTabId ? (
        <div className="term-rename-scrim" role="presentation">
          <form
            className="term-rename-dialog"
            onSubmit={(event) => {
              event.preventDefault()
              renameTab(renameTabId, renameValue)
              setRenameTabId(null)
            }}
          >
            <label htmlFor="terminal-tab-name">Rename terminal</label>
            <input
              id="terminal-tab-name"
              autoFocus
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
            />
            <div>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setRenameTabId(null)}
              >
                Cancel
              </Button>
              <Button type="submit">Rename</Button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  )
}
