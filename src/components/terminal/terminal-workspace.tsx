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
import type { FitAddon } from 'xterm-addon-fit'
import type * as FitAddonModule from 'xterm-addon-fit'
import type { Terminal } from 'xterm'
import type * as XtermModule from 'xterm'
import type * as WebLinksAddonModule from 'xterm-addon-web-links'
import type { DebugAnalysis } from '@/components/terminal/debug-panel'
import type { TerminalTab } from '@/stores/terminal-panel-store'
import { DebugPanel } from '@/components/terminal/debug-panel'
import { MatrixRainCanvas } from '@/components/terminal/matrix-rain-canvas'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useTerminalPanelStore } from '@/stores/terminal-panel-store'
import '@/styles/matrix-terminal.css'

// Dynamic imports to avoid SSR crash (xterm uses `self` which doesn't exist on server)
let xtermLoaded = false
let TerminalCtor: typeof XtermModule.Terminal
let FitAddonCtor: typeof FitAddonModule.FitAddon
let WebLinksAddonCtor: typeof WebLinksAddonModule.WebLinksAddon

async function ensureXterm() {
  if (xtermLoaded) return
  const [xtermMod, fitMod, linksMod] = await Promise.all([
    import('xterm'),
    import('xterm-addon-fit'),
    import('xterm-addon-web-links'),
  ])
  // Load CSS on client only
  await import('xterm/css/xterm.css')
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

function toDebugAnalysis(value: unknown): DebugAnalysis | null {
  if (!value || typeof value !== 'object') return null
  const entry = value as Record<string, unknown>
  const summary = typeof entry.summary === 'string' ? entry.summary.trim() : ''
  const rootCause =
    typeof entry.rootCause === 'string' ? entry.rootCause.trim() : ''
  const rawCommands = Array.isArray(entry.suggestedCommands)
    ? entry.suggestedCommands
    : []

  if (!summary || !rootCause) return null

  const suggestedCommands = rawCommands
    .map(function mapCommand(commandEntry) {
      if (!commandEntry || typeof commandEntry !== 'object') return null
      const command = commandEntry as Record<string, unknown>
      const commandText =
        typeof command.command === 'string' ? command.command.trim() : ''
      const descriptionText =
        typeof command.description === 'string'
          ? command.description.trim()
          : ''
      if (!commandText || !descriptionText) return null
      return { command: commandText, description: descriptionText }
    })
    .filter(function removeNulls(command): command is {
      command: string
      description: string
    } {
      return Boolean(command)
    })

  const docsLink =
    typeof entry.docsLink === 'string' && entry.docsLink.trim()
      ? entry.docsLink.trim()
      : undefined

  return {
    summary,
    rootCause,
    suggestedCommands,
    ...(docsLink ? { docsLink } : {}),
  }
}

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
  const [debugAnalysis, setDebugAnalysis] = useState<DebugAnalysis | null>(null)
  const [debugLoading, setDebugLoading] = useState(false)
  const [showDebugPanel, setShowDebugPanel] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sessionFilter, setSessionFilter] = useState('')
  const [splitMode, setSplitMode] = useState<SplitMode>('single')
  const [copiedOutput, setCopiedOutput] = useState(false)

  const containerMapRef = useRef(new Map<string, HTMLDivElement>())
  const terminalMapRef = useRef(new Map<string, Terminal>())
  const fitMapRef = useRef(new Map<string, FitAddon>())
  const readerMapRef = useRef(
    new Map<string, ReadableStreamDefaultReader<Uint8Array>>(),
  )
  const connectedRef = useRef(new Set<string>())

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
  const visibleTerminalTabs = useMemo(() => {
    if (splitMode === 'single') return [activeTab]
    const secondary = tabs.find((tab) => tab.id !== activeTab.id) ?? activeTab
    return secondary.id === activeTab.id ? [activeTab] : [activeTab, secondary]
  }, [activeTab, splitMode, tabs])

  const sendInput = useCallback(function sendInput(
    tabId: string,
    data: string,
  ) {
    // Look up session ID from store at call time (not stale closure)
    const currentTab = useTerminalPanelStore
      .getState()
      .tabs.find((t) => t.id === tabId)
    if (!currentTab?.sessionId) return
    // Fire-and-forget — never await, never block input
    fetch('/api/terminal-input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: currentTab.sessionId, data }),
    }).catch(function ignore() {
      return undefined
    })
  }, [])

  const resizeSession = useCallback(async function resizeSession(
    tabId: string,
    terminal: Terminal,
  ) {
    const currentTab = useTerminalPanelStore
      .getState()
      .tabs.find((t) => t.id === tabId)
    if (!currentTab?.sessionId) return
    await fetch('/api/terminal-resize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: currentTab.sessionId,
        cols: terminal.cols,
        rows: terminal.rows,
      }),
    }).catch(function ignore() {
      return undefined
    })
  }, [])

  const captureRecentTerminalOutput = useCallback(
    function captureRecentTerminalOutput(tabId: string): string {
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

  const handleAnalyzeDebug = useCallback(
    async function handleAnalyzeDebug() {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime safety
      if (!activeTab) return

      setShowDebugPanel(true)
      setDebugLoading(true)
      setDebugAnalysis(null)

      try {
        const terminalOutput = captureRecentTerminalOutput(activeTab.id)
        const response = await fetch('/api/debug-analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ terminalOutput }),
        })

        const payload = (await response.json().catch(function fallback() {
          return null
        })) as unknown

        const analysis = toDebugAnalysis(payload)
        if (!analysis) {
          throw new Error('Invalid analysis response payload')
        }

        setDebugAnalysis(analysis)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setDebugAnalysis({
          summary: 'Debug analysis failed.',
          rootCause: message,
          suggestedCommands: [],
        })
      } finally {
        setDebugLoading(false)
      }
    },
    [activeTab, captureRecentTerminalOutput],
  )

  const handleRunDebugCommand = useCallback(
    function handleRunDebugCommand(command: string) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime safety
      if (!activeTab) return
      void sendInput(activeTab.id, `${command}\r`)
    },
    [activeTab, sendInput],
  )

  const handleCopyOutput = useCallback(
    async function handleCopyOutput() {
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
    function handleClearActiveTerminal() {
      terminalMapRef.current.get(activeTab.id)?.clear()
    },
    [activeTab.id],
  )

  const handleCloseDebugPanel = useCallback(function handleCloseDebugPanel() {
    setShowDebugPanel(false)
  }, [])

  const focusActiveTerminal = useCallback(
    function focusActiveTerminal() {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime safety
      if (!activeTab) return
      const terminal = terminalMapRef.current.get(activeTab.id)
      terminal?.focus()
    },
    [activeTab],
  )

  const closeTabResources = useCallback(async function closeTabResources(
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

    if (sessionId) {
      await fetch('/api/terminal-close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      }).catch(function ignore() {
        return undefined
      })
    }
  }, [])

  const handleCloseTab = useCallback(
    function handleCloseTab(tab: TerminalTab) {
      void closeTabResources(tab.id, tab.sessionId)
      closeTab(tab.id)
    },
    [closeTab, closeTabResources],
  )

  const handleClosePanel = useCallback(
    function handleClosePanel() {
      const currentTabs = useTerminalPanelStore.getState().tabs
      for (const tab of currentTabs) {
        void closeTabResources(tab.id, tab.sessionId)
      }
      closeAllTabs()
      setShowDebugPanel(false)
      if (onClosePanel) onClosePanel()
    },
    [closeAllTabs, closeTabResources, onClosePanel],
  )

  const connectTab = useCallback(
    async function connectTab(tab: TerminalTab) {
      if (connectedRef.current.has(tab.id)) return
      const terminal = terminalMapRef.current.get(tab.id)
      if (!terminal) return

      connectedRef.current.add(tab.id)
      setTabStatus(tab.id, 'active')

      const response = await fetch('/api/terminal-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cwd: DEFAULT_TERMINAL_CWD,
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
        terminal.writeln('\r\n[terminal] failed to connect\r\n')
        connectedRef.current.delete(tab.id)
        setTabStatus(tab.id, 'idle')
        return
      }

      const reader = response.body.getReader()
      readerMapRef.current.set(tab.id, reader)
      const decoder = new TextDecoder()
      let buffer = ''

      // Throttled terminal writes — yields to input events between flushes
      let writeBuf = ''
      let flushTimer: ReturnType<typeof setTimeout> | undefined
      const FLUSH_MS = 80 // ~12fps — generous gaps for input
      const MAX_BUF = 8192 // drop old data if buffer overflows (screen redraws)
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
        // If buffer is huge (TUI redraw flood), keep only the tail
        if (writeBuf.length > MAX_BUF) {
          writeBuf = writeBuf.slice(-MAX_BUF)
        }
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
          const lines = block.split('\n')
          let eventName = ''
          let eventData = ''
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventName = line.slice(7).trim()
              continue
            }
            if (line.startsWith('data: ')) {
              eventData += line.slice(6)
              continue
            }
            if (line.startsWith('data:')) {
              eventData += line.slice(5)
            }
          }
          if (!eventName || eventName === 'ping') continue

          if (eventName === 'session' && eventData) {
            const payload = JSON.parse(eventData) as TerminalSessionResponse
            if (payload.sessionId) {
              setTabSessionId(tab.id, payload.sessionId)
              const nextTitle = tab.cwd === '~' ? tab.title : tab.cwd
              renameTab(tab.id, nextTitle)
            }
            continue
          }

          if (eventName === 'data' && eventData) {
            const payload = JSON.parse(eventData) as { data?: string }
            if (typeof payload.data === 'string') {
              queueWrite(payload.data)
            }
            continue
          }

          if (eventName === 'exit' && eventData) {
            const payload = JSON.parse(eventData) as {
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
      setTabStatus(tab.id, 'idle')

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
        if (stillSameTab) {
          terminal.writeln('\r\n\x1b[2m[reconnecting...]\x1b[0m')
          // Schedule a reconnect on the next tick to break out of this
          // closure cleanly. connectTab guards against double-connecting.
          setTimeout(() => {
            const refreshed = useTerminalPanelStore
              .getState()
              .tabs.find((item) => item.id === tab.id)
            if (refreshed && refreshed.sessionId === previousSessionId) {
              void connectTab(refreshed)
            }
          }, 600)
          return
        }
      }

      setTabSessionId(tab.id, null)
    },
    [renameTab, setTabSessionId, setTabStatus],
  )

  const ensureTerminalForTab = useCallback(
    function ensureTerminalForTab(tab: TerminalTab) {
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
      void resizeSession(tab.id, terminal)
      void connectTab(tab)
    },
    [connectTab, resizeSession, sendInput],
  )

  const handleCreateTab = useCallback(
    function handleCreateTab() {
      const newTabId = createTab(DEFAULT_TERMINAL_CWD)
      window.setTimeout(function focusNewTab() {
        const tab = useTerminalPanelStore
          .getState()
          .tabs.find((item) => item.id === newTabId)
        if (!tab) return
        ensureTerminalForTab(tab)
        focusActiveTerminal()
      }, 0)
    },
    [createTab, ensureTerminalForTab, focusActiveTerminal],
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
      for (const tab of tabs) {
        ensureTerminalForTab(tab)
      }
    },
    [ensureTerminalForTab, tabs],
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
            aria-label={sidebarCollapsed ? 'Expand sessions' : 'Collapse sessions'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
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
                  key={tab.id}
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
          <div className="term-tabs-scroll">
            {tabs.map(function renderTab(tab) {
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime safety
              const isActive = tab.id === activeTab?.id
              return (
                <button
                  key={tab.id}
                  type="button"
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
                  {tabs.length > 1 ? (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={function onClose(event) {
                        event.stopPropagation()
                        handleCloseTab(tab)
                      }}
                      onKeyDown={function onCloseByKeyboard(event) {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          handleCloseTab(tab)
                        }
                      }}
                      className="x"
                    >
                      <HugeiconsIcon
                        icon={Cancel01Icon}
                        size={20}
                        strokeWidth={1.5}
                      />
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
          <button
            type="button"
            className="add"
            onClick={handleCreateTab}
            title="New tab"
          >
            <HugeiconsIcon icon={Add01Icon} size={16} strokeWidth={1.7} />
          </button>

          <div className="right-cluster">
            <button
              type="button"
              className={cn(
                'term-ico-btn',
                splitMode === 'single' ? 'active' : '',
              )}
              onClick={() => setSplitMode('single')}
              title="Single pane"
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
            >
              ⊟
            </button>
            <span className="term-toolbar-sep" />
            <button
              type="button"
              className="term-ico-btn"
              onClick={() => void handleCopyOutput()}
              title="Copy recent output"
            >
              {copiedOutput ? (
                '✓'
              ) : (
                <HugeiconsIcon icon={Copy01Icon} size={16} strokeWidth={1.6} />
              )}
            </button>
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
                className={cn(
                  'term-pane',
                  isActive ? 'focused' : '',
                  isVisible ? '' : 'hidden',
                )}
              >
                <MatrixRainCanvas className="matrix-rain-canvas" />
                <div className="term-hud">
                  <span className="d" />
                  <span>
                    <b>{tab.status}</b>
                  </span>
                  <span>{tab.cwd || DEFAULT_TERMINAL_CWD}</span>
                  <span>{tab.sessionId ? 'attached' : 'starting'}</span>
                </div>
                <div
                  ref={function assignContainer(node) {
                    if (node) {
                      containerMapRef.current.set(tab.id, node)
                      ensureTerminalForTab(tab)
                      return
                    }
                    containerMapRef.current.delete(tab.id)
                  }}
                  onClick={function tapToFocus() {
                    terminalMapRef.current.get(tab.id)?.focus()
                  }}
                  className="term-xterm"
                />
              </div>
            )
          })}
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
          <span className="ok">terminal ready</span>
        </footer>
      </main>

      {/* Mobile input bar moved to WorkspaceShell as a sibling to prevent re-render freeze */}

      {showDebugPanel ? (
        <DebugPanel
          analysis={debugAnalysis}
          isLoading={debugLoading}
          onRunCommand={handleRunDebugCommand}
          onClose={handleCloseDebugPanel}
        />
      ) : null}

      {contextMenu ? (
        <div
          className="term-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={function stop(event) {
            event.stopPropagation()
          }}
        >
          <button
            type="button"
            className="term-context-item"
            onClick={function renameTabFromMenu() {
              const menuTab = tabs.find((tab) => tab.id === contextMenu.tabId)
              setContextMenu(null)
              if (!menuTab) return
              const nextName = window.prompt(
                'Rename terminal tab',
                menuTab.title,
              )
              if (!nextName) return
              renameTab(menuTab.id, nextName)
            }}
          >
            Rename
          </button>
          <button
            type="button"
            className="term-context-item"
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
    </div>
  )
}
