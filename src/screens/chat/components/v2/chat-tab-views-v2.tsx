import type { ChatMessage } from '../../types'

type LifecycleEvent = {
  text: string
  emoji: string
  timestamp: number
  isError: boolean
}

type ToolTabViewProps = {
  messages: Array<ChatMessage>
}

type ActivityTabViewProps = {
  events: Array<LifecycleEvent>
}

const toolViewStyle: React.CSSProperties = {
  color: 'var(--m-muted, var(--theme-muted))',
}
const cardStyle: React.CSSProperties = {
  background: 'var(--m-surface-1, var(--theme-card))',
  borderColor: 'var(--m-border, var(--theme-border))',
}
const greenStyle: React.CSSProperties = { color: 'var(--m-green, #4ade80)' }

export function ToolTabView({ messages }: ToolTabViewProps) {
  const toolMessages = messages.filter((m) => {
    if (!Array.isArray(m.content)) return false
    return m.content.some(
      (c) => (c as { type: string }).type === 'toolCall' || (c as { type: string }).type === 'toolResult',
    )
  })

  if (toolMessages.length === 0) {
    return (
      <div
        className="flex-1 min-h-0 overflow-y-auto p-4 font-mono text-xs"
        style={toolViewStyle}
      >
        <p className="opacity-40 text-center mt-8">No tool invocations yet</p>
      </div>
    )
  }

  return (
    <div
      className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2 font-mono text-xs"
      style={toolViewStyle}
    >
      {toolMessages.map((m, i) => {
        const calls = Array.isArray(m.content)
          ? m.content.filter(
              (c) => (c as { type: string }).type === 'toolCall' || (c as { type: string }).type === 'toolResult',
            )
          : []
        return calls.map((c, j) => {
          const raw = c as Record<string, unknown>
          const isCall = raw['type'] === 'toolCall'
          const label = isCall
            ? String(raw['name'] ?? '')
            : String(raw['toolName'] ?? '')
          const callId = String(raw['id'] ?? raw['toolCallId'] ?? '')
          return (
            <div
              key={`${String(m.id ?? i)}-${j}`}
              className="rounded px-3 py-2 border"
              style={cardStyle}
            >
              <span style={greenStyle}>{isCall ? '▶' : '◀'} </span>
              {label}
              {callId ? (
                <span className="ml-2 opacity-50">{callId}</span>
              ) : null}
            </div>
          )
        })
      })}
    </div>
  )
}

export function ActivityTabView({ events }: ActivityTabViewProps) {
  if (events.length === 0) {
    return (
      <div
        className="flex-1 min-h-0 overflow-y-auto p-4 font-mono text-xs"
        style={toolViewStyle}
      >
        <p className="opacity-40 text-center mt-8">No activity events yet</p>
      </div>
    )
  }

  return (
    <div
      className="flex-1 min-h-0 overflow-y-auto p-4 space-y-1.5 font-mono text-xs"
      style={toolViewStyle}
    >
      {events.map((ev, i) => (
        <div key={i} className="flex items-start gap-2">
          <span style={greenStyle} aria-hidden="true">
            {ev.emoji || '·'}
          </span>
          <span
            className={
              ev.isError ? 'text-red-400 shrink-0' : 'opacity-80 shrink-0'
            }
          >
            {ev.text}
          </span>
          <span className="opacity-40 ml-auto shrink-0 tabular-nums">
            {new Date(ev.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </span>
        </div>
      ))}
    </div>
  )
}
