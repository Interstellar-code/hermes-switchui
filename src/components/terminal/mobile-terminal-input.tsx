/**
 * Kept outside TerminalWorkspace so terminal stream rerenders cannot block
 * mobile input.
 */
import { useCallback, useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowUp02Icon, Copy01Icon } from '@hugeicons/core-free-icons'
import { useTerminalPanelStore } from '@/stores/terminal-panel-store'

async function sendToActiveTab(data: string): Promise<boolean> {
  const { tabs, activeTabId } = useTerminalPanelStore.getState()
  const tab = tabs.find((item) => item.id === activeTabId) ?? tabs[0]
  if (!tab.sessionId) return false

  try {
    const response = await fetch('/api/terminal-input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: tab.sessionId, data }),
    })
    return response.ok
  } catch {
    return false
  }
}

export function MobileTerminalInput() {
  const inputRef = useRef<HTMLInputElement>(null)
  const requestChainRef = useRef(Promise.resolve())
  const [failed, setFailed] = useState(false)
  const activeTab = useTerminalPanelStore(
    (state) =>
      state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0],
  )
  const attached = Boolean(activeTab.sessionId)

  const enqueue = useCallback((data: string) => {
    const request = requestChainRef.current.then(async () => {
      const ok = await sendToActiveTab(data)
      if (!ok) setFailed(true)
      return ok
    })
    requestChainRef.current = request.then(() => undefined)
    return request
  }, [])

  const send = useCallback(() => {
    const value = inputRef.current?.value
    if (!value || !attached) return
    void enqueue(`${value}\r`).then((ok) => {
      if (ok && inputRef.current?.value === value) inputRef.current.value = ''
      if (ok) setFailed(false)
    })
  }, [attached, enqueue])

  const paste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text && inputRef.current) inputRef.current.value += text
    } finally {
      inputRef.current?.focus()
    }
  }, [])

  const sendControl = useCallback(
    (data: string) => {
      if (attached) void enqueue(data)
    },
    [attached, enqueue],
  )

  return (
    <div
      className="flex items-center gap-1 px-2 py-1.5 shrink-0"
      style={{ background: '#1a1a1a', borderTop: '1px solid #333' }}
    >
      {failed && (
        <span role="alert" className="sr-only">
          Failed to send terminal input
        </span>
      )}
      <button
        type="button"
        onClick={() => void paste()}
        className="flex items-center justify-center size-8 rounded-lg shrink-0 active:opacity-60"
        style={{ background: '#2a2a2a', color: '#aaa' }}
        aria-label="Paste"
      >
        <HugeiconsIcon icon={Copy01Icon} size={16} strokeWidth={1.6} />
      </button>
      <input
        ref={inputRef}
        type="text"
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            send()
          }
          if (event.key === 'Tab' || event.key === 'Escape') {
            event.preventDefault()
            sendControl(event.key === 'Tab' ? '\t' : '\x1b')
          }
        }}
        placeholder={attached ? 'Type command…' : 'Attach terminal…'}
        aria-label="Terminal command"
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        className="flex-1 min-w-0 text-sm outline-none px-2 py-1 rounded-lg"
        style={{
          background: '#2a2a2a',
          color: '#e6e6e6',
          border: '1px solid #444',
          fontFamily: 'JetBrains Mono, Menlo, monospace',
        }}
      />
      <button
        type="button"
        onClick={() => sendControl('\x03')}
        disabled={!attached}
        className="flex items-center justify-center px-2 h-8 rounded-lg shrink-0 text-xs active:opacity-60"
        style={{ background: '#3a1a1a', color: '#f87171' }}
        aria-label="Ctrl+C"
      >
        ^C
      </button>
      <button
        type="button"
        onClick={() => sendControl('\x1b')}
        disabled={!attached}
        className="flex items-center justify-center px-2 h-8 rounded-lg shrink-0 text-xs active:opacity-60"
        style={{ background: '#2a2a2a', color: '#aaa' }}
        aria-label="Escape"
      >
        Esc
      </button>
      <button
        type="button"
        onClick={send}
        disabled={!attached}
        className="flex items-center justify-center size-8 rounded-lg shrink-0 active:opacity-60"
        style={{ background: '#ea580c', color: '#fff' }}
        aria-label="Send"
      >
        <HugeiconsIcon icon={ArrowUp02Icon} size={16} strokeWidth={1.8} />
      </button>
    </div>
  )
}
