import { useEffect, useRef } from 'react'

export type ChatMessage = { role: 'assistant' | 'user'; msg: string }

export interface DescribeChatPaneProps {
  chatHistory: Array<ChatMessage>
  chatInput: string
  chatPending: boolean
  onChatInput: (v: string) => void
  onSend: () => void
}

export function DescribeChatPane({
  chatHistory,
  chatInput,
  chatPending,
  onChatInput,
  onSend,
}: DescribeChatPaneProps) {
  const msgsEndRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (typeof msgsEndRef.current?.scrollIntoView === 'function') {
      msgsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [chatHistory])

  return (
    <div className="plan-chat">
      <div className="chat-msgs">
        {chatHistory.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            <span className="chat-who">
              {m.role === 'assistant' ? 'Hermes' : 'You'}
            </span>
            <div className="chat-text">
              {m.msg.split('\n').map((line, j) => (
                <p key={j}>{line}</p>
              ))}
            </div>
          </div>
        ))}
        <div ref={msgsEndRef} />
      </div>
      {chatPending && (
        <p
          style={{
            fontSize: 10,
            color: 'var(--m-green-500, #00ff41)',
            margin: '0 0 6px',
            padding: '0 2px',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <span
            className="inline-block h-1.5 w-1.5 rounded-full bg-current animate-pulse"
            style={{
              display: 'inline-block',
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'currentColor',
              animation: 'pulse 1.2s cubic-bezier(0.4,0,0.6,1) infinite',
            }}
          />
          <span style={{ marginLeft: 4 }}>Hermes is thinking…</span>
        </p>
      )}
      <div className="chat-input-row">
        <input
          className="chat-inp"
          placeholder="Describe your workflow in plain language…"
          value={chatInput}
          disabled={chatPending}
          onChange={(e) => onChatInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSend()
          }}
        />
        <button
          className="btn-mini prim"
          onClick={onSend}
          disabled={chatPending}
        >
          {chatPending ? 'Thinking…' : 'Send'}
        </button>
      </div>
    </div>
  )
}
