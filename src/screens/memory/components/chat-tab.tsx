/**
 * ChatTab — Chat with Wiki tab (MEM-09).
 *
 * RAG-style chat grounded in the wiki corpus.
 *
 * Strategy (plan R6 — context blow-out guard):
 * - On send, fetch top-K matching wiki pages via /api/knowledge/search?q=<query>&limit=5
 * - Inline page bodies capped at 4 kB each, total context capped at 32 kB
 * - Send to /api/send-stream (SSE) with a system prompt that includes the capped wiki context
 * - Render streamed tokens into the latest assistant bubble
 *
 * If /api/send-stream is unavailable (gateway offline), the send button shows a
 * clear "Backend offline" error — no silent failure.
 */

import { useEffect, useRef, useState } from 'react'
import { toast as showToast } from '@/components/ui/toast'

// ── Types ─────────────────────────────────────────────────────────────────────

type Role = 'user' | 'assistant'

type Message = {
  id: string
  role: Role
  content: string
  citedPages?: Array<string>
}

type WikiSearchResult = {
  path: string
  title: string
  snippet: string
  score: number
}

type SearchResponse = {
  results: Array<WikiSearchResult>
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_BODY_BYTES = 4 * 1024       // 4 kB per page
const MAX_CONTEXT_BYTES = 32 * 1024   // 32 kB total wiki context
const TOP_K = 5

// ── ID helper ─────────────────────────────────────────────────────────────────

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

// ── Wiki context builder ──────────────────────────────────────────────────────

async function buildWikiContext(query: string): Promise<{ context: string; pages: Array<string> }> {
  // 1. Search for relevant pages
  let results: Array<WikiSearchResult> = []
  try {
    const res = await fetch(`/api/knowledge/search?q=${encodeURIComponent(query)}&limit=${TOP_K}`)
    if (res.ok) {
      const data = (await res.json()) as SearchResponse
      results = data.results
    }
  } catch {
    // search unavailable — proceed without context
    return { context: '', pages: [] }
  }

  if (results.length === 0) return { context: '', pages: [] }

  // 2. Fetch page bodies, cap, accumulate
  const chunks: Array<string> = []
  const pages: Array<string> = []
  let totalBytes = 0

  for (const r of results) {
    if (totalBytes >= MAX_CONTEXT_BYTES) break
    try {
      const res = await fetch(`/api/knowledge/read?path=${encodeURIComponent(r.path)}`)
      if (!res.ok) continue
      const data = (await res.json()) as { content: string }
      let body = data.content
      // Cap per-page
      if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) {
        body = body.slice(0, MAX_BODY_BYTES) + '\n…[truncated]'
      }
      const chunk = `### ${r.title} (${r.path})\n\n${body}`
      const chunkBytes = new TextEncoder().encode(chunk).length
      if (totalBytes + chunkBytes > MAX_CONTEXT_BYTES) {
        // Partial include
        const remaining = MAX_CONTEXT_BYTES - totalBytes
        chunks.push(chunk.slice(0, remaining) + '\n…[truncated]')
        pages.push(r.path)
        totalBytes = MAX_CONTEXT_BYTES
        break
      }
      chunks.push(chunk)
      pages.push(r.path)
      totalBytes += chunkBytes
    } catch {
      // skip this page
    }
  }

  return {
    context: chunks.join('\n\n---\n\n'),
    pages,
  }
}

// ── Stream chat via /api/send-stream ─────────────────────────────────────────

async function streamChat(
  messages: Array<{ role: Role; content: string }>,
  wikiContext: string,
  onToken: (token: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const systemPrompt = wikiContext
    ? `You are a helpful assistant answering questions grounded in the user's wiki knowledge base.\n\nRelevant wiki content:\n\n${wikiContext}\n\nAnswer based on the wiki content above. If the answer isn't in the wiki, say so clearly.`
    : 'You are a helpful assistant.'

  const payload = {
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    stream: true,
  }

  const res = await fetch('/api/send-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
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

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') return
      try {
        const parsed = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>
          content?: string
        }
        const token =
          parsed.choices?.[0]?.delta?.content ??
          (typeof parsed.content === 'string' ? parsed.content : '')
        if (token) onToken(token)
      } catch {
        // non-JSON line, skip
      }
    }
  }
}

// ── CitedPages panel ──────────────────────────────────────────────────────────

function CitedPages({ pages }: { pages: Array<string> }) {
  if (pages.length === 0) return null
  return (
    <div className="chat-cited">
      <div className="chat-cited-title">Sources</div>
      {pages.map((p) => (
        <div key={p} className="chat-cited-item">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M3 2h6l4 4v9H3V2z" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M9 2v4h4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          {p}
        </div>
      ))}
    </div>
  )
}

// ── ChatBubble ────────────────────────────────────────────────────────────────

function ChatBubble({ msg }: { msg: Message }) {
  return (
    <div className={`chat-bubble chat-bubble--${msg.role}`}>
      <div className="chat-bubble-role">{msg.role === 'user' ? 'You' : 'Hermes'}</div>
      <div className="chat-bubble-content">{msg.content || <span className="chat-typing">▍</span>}</div>
      {msg.role === 'assistant' && msg.citedPages && msg.citedPages.length > 0 && (
        <CitedPages pages={msg.citedPages} />
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

  // Auto-scroll on new tokens
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSend() {
    const text = input.trim()
    if (!text || sending) return

    setInput('')
    setSending(true)

    // Add user message
    const userMsg: Message = { id: uid(), role: 'user', content: text }
    setMessages((prev) => [...prev, userMsg])

    // Placeholder assistant bubble
    const assistantId = uid()
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: 'assistant', content: '', citedPages: [] },
    ])

    try {
      // Build wiki context
      const { context, pages } = await buildWikiContext(text)

      // Build history (exclude the empty placeholder)
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

      // Attach cited pages to the completed assistant message
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, citedPages: pages } : m,
        ),
      )
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // user cancelled — leave partial content
      } else {
        const errMsg = err instanceof Error ? err.message : 'Chat failed'
        showToast(errMsg)
        // Replace placeholder with error message
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: `Error: ${errMsg}` }
              : m,
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
      {/* Message list */}
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="28" height="28" aria-hidden="true">
              <path d="M2 2h12v9H9l-3 3v-3H2V2z" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span>Ask anything about your wiki</span>
            <span className="chat-empty-sub">Answers are grounded in your wiki pages</span>
          </div>
        )}
        {messages.map((m) => (
          <ChatBubble key={m.id} msg={m} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="chat-inputbar">
        <textarea
          className="chat-input"
          placeholder="Ask a question about your wiki… (Enter to send, Shift+Enter for newline)"
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
                <path d="M2 14L14 8 2 2v4l8 2-8 2v4z" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
