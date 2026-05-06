import { useState } from 'react'
import {
  buildResultTsMap,
  extractStreamToolCallsFromMessages,
  extractStreamingEntries,
  extractToolEntries,
  mergeToolEntries,
} from './chat-tab-views-v2'
import type { ChatMessage } from '../../types'

type LifecycleEvent = {
  text: string
  emoji: string
  timestamp: number
  isError: boolean
}

type StreamingToolCall = {
  id: string
  name: string
  phase: string
  args?: unknown
  preview?: string
  result?: string
  firstSeenAt?: number
}

type ChatSkillsTabV2Props = {
  messages: Array<ChatMessage>
  streamingToolCalls?: Array<StreamingToolCall>
  events?: Array<LifecycleEvent>
}

type SkillInvocation = {
  key: string
  timestamp?: number
  displayTs?: number
  args?: Record<string, unknown>
  result?: string
  isError?: boolean
}

type SkillGroup = {
  skillName: string
  invocations: Array<SkillInvocation>
  count: number
  lastInvokedTs?: number
  status: 'error' | 'done' | 'running'
}

const tabStyle: React.CSSProperties = {
  color: 'var(--m-muted, var(--theme-muted))',
}

const cardStyle: React.CSSProperties = {
  background: 'var(--m-surface-1, var(--theme-card))',
  borderColor: 'var(--m-border, var(--theme-border))',
}

const greenStyle: React.CSSProperties = { color: 'var(--m-green, #4ade80)' }

function fmtTs(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function truncate(s: string, max = 120): string {
  if (s.length <= max) return s
  return s.slice(0, max) + '…'
}

function statusColor(status: SkillGroup['status']): string {
  if (status === 'error') return 'var(--theme-danger, #ef4444)'
  if (status === 'done') return 'var(--theme-success, #22c55e)'
  return 'var(--theme-accent, #6366f1)'
}

function argsSummary(args?: Record<string, unknown>): string {
  if (!args || Object.keys(args).length === 0) return ''
  return truncate(JSON.stringify(args))
}

function SkillCard({ group }: { group: SkillGroup }) {
  const [open, setOpen] = useState(false)
  const color = statusColor(group.status)

  return (
    <div className="rounded border overflow-hidden" style={cardStyle}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-xs"
        style={{ cursor: 'pointer', background: 'transparent', border: 'none' }}
      >
        <span style={greenStyle}>{open ? '▼' : '▶'}</span>
        <span className="font-semibold" style={greenStyle}>{group.skillName}</span>
        <span
          className="text-[10px] px-1.5 py-0.5 rounded tabular-nums"
          style={{
            background: 'color-mix(in srgb, var(--m-green, #4ade80) 12%, transparent)',
            color: 'var(--m-green, #4ade80)',
          }}
        >
          ×{group.count}
        </span>
        <span className="flex-1" />
        {group.lastInvokedTs != null ? (
          <span className="shrink-0 opacity-40 text-[10px] tabular-nums">
            {fmtTs(group.lastInvokedTs)}
          </span>
        ) : null}
        <span
          className="shrink-0 text-[10px] px-1.5 py-0.5 rounded"
          style={{
            color,
            background: `color-mix(in srgb, ${color} 15%, transparent)`,
          }}
        >
          {group.status}
        </span>
        <span className="shrink-0 opacity-40 text-[10px]">{open ? '▾' : '▸'}</span>
      </button>

      {open ? (
        <div
          className="mx-3 mb-2 rounded border divide-y"
          style={{
            borderColor: 'var(--theme-border)',
            background: 'var(--code-bg, color-mix(in srgb, var(--theme-card) 70%, transparent))',
            // @ts-expect-error css var
            '--divide-color': 'var(--theme-border)',
          }}
        >
          {group.invocations.map((inv, i) => {
            const summary = argsSummary(inv.args)
            const resultSnip = inv.result ? truncate(inv.result) : null
            return (
              <div
                key={inv.key}
                className="px-3 py-1.5 font-mono text-[10px]"
                style={{ borderTop: i > 0 ? '1px solid var(--theme-border)' : undefined }}
              >
                <div className="flex items-center gap-2">
                  <span className="tabular-nums opacity-50">#{i + 1}</span>
                  {inv.displayTs != null ? (
                    <span className="tabular-nums opacity-40">{fmtTs(inv.displayTs)}</span>
                  ) : null}
                  {inv.isError ? (
                    <span style={{ color: 'var(--theme-danger, #ef4444)' }}>error</span>
                  ) : null}
                </div>
                {summary ? (
                  <div className="mt-0.5 opacity-60 break-all">{summary}</div>
                ) : null}
                {resultSnip ? (
                  <div
                    className="mt-0.5 break-all"
                    style={{ color: inv.isError ? 'var(--theme-danger, #ef4444)' : 'var(--code-foreground, var(--theme-text))' }}
                  >
                    {resultSnip}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

export function ChatSkillsTabV2({ messages, streamingToolCalls = [], events: _events = [] }: ChatSkillsTabV2Props) {
  const resultTsMap = buildResultTsMap(messages)
  const streamingEntries = extractStreamingEntries(streamingToolCalls)
  const completedEntries = extractStreamToolCallsFromMessages(messages, resultTsMap)
  const messageEntries = extractToolEntries(messages)
  const allEntries = mergeToolEntries(streamingEntries, completedEntries, messageEntries)

  // Filter to skill-shaped entries:
  //   - name === 'skill' → gateway-translated skill.loaded event; skill name in result
  //   - name matches skill/todo/task → tool invocations of skills (todo, task plugins)
  const isSkill = (e: { name: string }) => {
    const n = (e.name || '').toLowerCase()
    return n === 'skill' || /\b(skill|todo|task)\b/.test(n)
  }
  const skillEntries = allEntries.filter(isSkill)

  // Group by skill name. For 'skill' entries use entry.output (the loaded
  // SKILL name); for direct invocations (todo, task) use entry.name itself.
  const groupMap = new Map<string, SkillGroup>()
  for (const entry of skillEntries) {
    const fromResult = typeof entry.output === 'string' ? entry.output.trim() : ''
    const skillName =
      entry.name === 'skill'
        ? fromResult || 'unknown skill'
        : entry.name || 'unknown skill'
    let group = groupMap.get(skillName)
    if (!group) {
      group = { skillName, invocations: [], count: 0, lastInvokedTs: undefined, status: 'done' }
      groupMap.set(skillName, group)
    }
    const inv: SkillInvocation = {
      key: entry.key,
      timestamp: entry.timestamp,
      displayTs: entry.displayTs,
      args: entry.input,
      result: entry.output,
      isError: entry.isError,
    }
    group.invocations.push(inv)
    group.count++
    if (entry.timestamp != null) {
      if (group.lastInvokedTs == null || entry.timestamp > group.lastInvokedTs) {
        group.lastInvokedTs = entry.timestamp
      }
    }
  }

  // Compute status per group and sort invocations by timestamp
  for (const group of groupMap.values()) {
    group.invocations.sort((a, b) => (a.timestamp ?? Infinity) - (b.timestamp ?? Infinity))
    const hasError = group.invocations.some((i) => i.isError)
    const allSettled = group.invocations.every((i) => i.result !== undefined || i.isError)
    group.status = hasError ? 'error' : allSettled ? 'done' : 'running'
  }

  const groups = Array.from(groupMap.values())

  if (groups.length === 0) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto p-4 font-mono text-xs" style={tabStyle}>
        <p className="opacity-40 text-center mt-8">∅ No skills loaded in this session</p>
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2 font-mono text-xs" style={tabStyle}>
      {groups.map((group) => (
        <SkillCard key={group.skillName} group={group} />
      ))}
    </div>
  )
}
