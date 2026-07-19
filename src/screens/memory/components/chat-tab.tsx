/**
 * ChatTab — Chat with your Memory (MEM-09).
 *
 * A dedicated, strictly memory-grounded chat. Answers come ONLY from the user's
 * memory — never general knowledge:
 *   - agent memory files (MEMORY.md / memory/*.md / memories/*.md) via
 *     /api/memory/search
 *   - matrix-memory (mnemosyne gists / facts / episodic) via
 *     /api/memory/mnemosyne-search
 *
 * Flow on send:
 *  1. Retrieve top memory matches from both sources (capped).
 *  2. If nothing relevant is found, reply "I don't have that in my memory."
 *     (no model call — deterministic gate).
 *  3. Otherwise stream an answer from /api/send-stream with a strict
 *     memory-only system prompt.
 */

import { useEffect, useRef, useState } from 'react'
import { toast as showToast } from '@/components/ui/toast'

// ── Types ─────────────────────────────────────────────────────────────────────

type Role = 'user' | 'assistant'

type Message = {
  id: string
  role: Role
  content: string
  sources?: Array<string>
}

type FileMatch = { path: string; line: number; text: string }
type MnemoMatch = { kind: 'gist' | 'fact' | 'episodic'; text: string; score: number }

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_CONTEXT_BYTES = 32 * 1024 // 32 kB total memory context
const TOP_K_FILES = 8
const TOP_K_MNEMO = 8
const NOT_IN_MEMORY = "I don't have that in my memory."

// ── ID helper ─────────────────────────────────────────────────────────────────

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

// ── Memory context builder ──────────────────────────────────────────────────────

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { credentials: 'same-origin' })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

async function buildMemoryContext(
  query: string,
): Promise<{ context: string; sources: Array<string> }> {
  const [files, mnemo] = await Promise.all([
    fetchJson<{ results: Array<FileMatch> }>(
      `/api/memory/search?q=${encodeURIComponent(query)}`,
    ),
    fetchJson<{ results: Array<MnemoMatch> }>(
      `/api/memory/mnemosyne-search?q=${encodeURIComponent(query)}&limit=${TOP_K_MNEMO}`,
    ),
  ])

  const chunks: Array<string> = []
  const sources: Array<string> = []
  let totalBytes = 0
  const enc = new TextEncoder()
  const add = (chunk: string, source: string) => {
    if (totalBytes >= MAX_CONTEXT_BYTES) return
    const bytes = enc.encode(chunk).length
    if (totalBytes + bytes > MAX_CONTEXT_BYTES) return
    chunks.push(chunk)
    if (!sources.includes(source)) sources.push(source)
    totalBytes += bytes
  }

  // memory files (grouped one line per match)
  for (const f of (files?.results ?? []).slice(0, TOP_K_FILES)) {
    add(`[memory file: ${f.path}:${f.line}]\n${f.text}`, f.path)
  }
  // matrix-memory (mnemosyne)
  for (const m of mnemo?.results ?? []) {
    add(`[matrix-memory ${m.kind}]\n${m.text}`, `matrix-memory:${m.kind}`)
  }

  return { context: chunks.join('\n\n'), sources }
}

// ── Stream chat via /api/send-stream ─────────────────────────────────────────

async function streamChat(
  messages: Array<{ role: Role; content: string }>,
  memoryContext: string,
  onToken: (token: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const systemPrompt = `You are the user's personal memory assistant. Answer the question using ONLY the memory context provided below (the user's memory files and matrix-memory). If the answer is not contained in this memory, reply exactly: "${NOT_IN_MEMORY}" — do not use outside or general knowledge, and do not guess.

--- MEMORY CONTEXT ---
${memoryContext}
--- END MEMORY CONTEXT ---`

  const lastMsg = messages[messages.length - 1]
  const priorTurns = messages.slice(0, -1)
  const history: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemPrompt },
    ...priorTurns,
  ]

  const res = await fetch('/api/send-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionKey: 'new', // portable mode — no gateway session required
      message: lastMsg.content,
      history,
      stream: true,
    }),
    signal,
  })

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(err.error ?? `Request failed (${res.status})`)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buf = ''
  let currentEvent = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim()
        continue
      }
      if (!line.startsWith('data: ')) continue
      const raw = line.slice(6).trim()
      if (raw === '[DONE]') return
      let parsed: { text?: string; error?: string }
      try {
        parsed = JSON.parse(raw)
      } catch {
        continue // non-JSON (comments / keepalive)
      }
      if (currentEvent === 'error') {
        throw new Error(parsed.error ?? 'Stream error')
      }
      // /api/send-stream emits `event: chunk` with `{ text }`.
      if (typeof parsed.text === 'string' && parsed.text) onToken(parsed.text)
    }
  }
}

// ── Sources panel ──────────────────────────────────────────────────────────────

function Sources({ sources }: { sources: Array<string> }) {
  if (sources.length === 0) return null
  return (
    <div className="chat-cited">
      <div className="chat-cited-title">From memory</div>
      {sources.map((s) => (
        <div key={s} className="chat-cited-item">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M3 2h6l4 4v9H3V2z" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M9 2v4h4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {s}
        </div>
      ))}
    </div>
  )
}

// ── ChatBubble ────────────────────────────────────────────────────────────────

function ChatBubble({ msg }: { msg: Message }) {
  return (
    <div className={`chat-bubble chat-bubble--${msg.role}`}>
      <div className="chat-bubble-role">{msg.role === 'user' ? 'You' : 'Memory'}</div>
      <div className="chat-bubble-content">
        {msg.content || <span className="chat-typing">▍</span>}
      </div>
      {msg.role === 'assistant' && msg.sources && msg.sources.length > 0 && (
        <Sources sources={msg.sources} />
      )}
    </div>
  )
}

// ── ChatTab ───────────────────────────────────────────────────────────────────

export function ChatTab() {
  const [messages, setMessages] = useState<Array<Message>>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSend() {
    const text = input.trim()
    if (!text || sending) return

    setInput('')
    setSending(true)

    const userMsg: Message = { id: uid(), role: 'user', content: text }
    setMessages((prev) => [...prev, userMsg])

    const assistantId = uid()
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: 'assistant', content: '', sources: [] },
    ])

    try {
      const { context, sources } = await buildMemoryContext(text)

      // Deterministic gate: nothing relevant in memory → don't call the model.
      if (!context) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: NOT_IN_MEMORY } : m,
          ),
        )
        return
      }

      const history = messages
        .concat(userMsg)
        .map((m) => ({ role: m.role, content: m.content }))

      abortRef.current = new AbortController()

      await streamChat(
        history,
        context,
        (token) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + token } : m,
            ),
          )
        },
        abortRef.current.signal,
      )

      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, sources } : m)),
      )
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // user cancelled — leave partial content
      } else {
        const errMsg = err instanceof Error ? err.message : 'Chat failed'
        showToast(errMsg)
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: `Error: ${errMsg}` } : m,
          ),
        )
      }
    } finally {
      setSending(false)
      abortRef.current = null
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  function handleStop() {
    abortRef.current?.abort()
  }

  return (
    <div className="chat-shell">
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="28" height="28" aria-hidden="true">
              <path d="M2 2h12v9H9l-3 3v-3H2V2z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>Ask about your memory</span>
            <span className="chat-empty-sub">
              Answers come only from your memory files + matrix-memory
            </span>
          </div>
        )}
        {messages.map((m) => (
          <ChatBubble key={m.id} msg={m} />
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="chat-inputbar">
        <textarea
          className="chat-input"
          placeholder="Ask about your memory… (Enter to send, Shift+Enter for newline)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={sending}
          rows={2}
        />
        <div className="chat-inputbar-actions">
          {sending ? (
            <button type="button" className="mem-btn is-danger" onClick={handleStop}>
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="mem-btn is-primary"
              onClick={() => void handleSend()}
              disabled={!input.trim()}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M2 14L14 8 2 2v4l8 2-8 2v4z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
