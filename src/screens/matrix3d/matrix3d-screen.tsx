import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Matrix3DCanvas } from './components/matrix3d-canvas'
import { useMatrix3DOfficeData } from './use-matrix3d-office-data'
import type { OfficeAgent } from '@/features/retro-office/core/types'
import type { Matrix3DAgentPresence } from './use-matrix3d-office-data'
import { getLogs } from '@/lib/hermes-client'
import './matrix3d-office.css'

type Matrix3DConsoleType =
  | 'sys'
  | 'route'
  | 'tool'
  | 'trace'
  | 'review'
  | 'dispatch'
  | 'err'

type Matrix3DConsoleEntry = {
  id: string
  time: string
  agent: string
  agentKey: string | null
  source: 'agent' | 'gateway'
  color: string
  type: Matrix3DConsoleType
  message: string
  duration: string
}

type Matrix3DAgentCardModel = {
  id: string
  name: string
  role: string
  status: OfficeAgent['status']
  color: string
  dark: string
  bubble: string
  tier: 1 | 2
  meta: string
}

const FALLBACK_CARD_NAMES = ['HERMES', 'NEO', 'TRINITY', 'MORPHEUS']
const TYPE_LABELS: Record<Matrix3DConsoleType, string> = {
  sys: 'SYS',
  route: 'ROUTE',
  tool: 'TOOL',
  trace: 'TRACE',
  review: 'REVIEW',
  dispatch: 'DISP',
  err: 'ERR',
}

function darkenColor(color: string): string {
  if (!color.startsWith('#') || color.length !== 7) return '#04250f'

  const value = Number.parseInt(color.slice(1), 16)
  const r = Math.max(0, Math.round(((value >> 16) & 255) * 0.38))
  const g = Math.max(0, Math.round(((value >> 8) & 255) * 0.38))
  const b = Math.max(0, Math.round((value & 255) * 0.38))

  return `#${[r, g, b]
    .map((part) => part.toString(16).padStart(2, '0'))
    .join('')}`
}

function compactName(name: string, index: number): string {
  const clean = name.trim()
  if (!clean) return FALLBACK_CARD_NAMES[index % FALLBACK_CARD_NAMES.length]

  const [first] = clean.split(/\s+/)
  return (first || clean).replace(/[^a-z0-9-]/gi, '').slice(0, 10).toUpperCase()
}

function statusColor(status: OfficeAgent['status']): string {
  if (status === 'working') return '#00ff41'
  if (status === 'error') return '#ff5f6d'
  return 'rgba(216,255,227,.28)'
}

function toCardAgent(
  agent: OfficeAgent,
  presence: Matrix3DAgentPresence | undefined,
  index: number,
): Matrix3DAgentCardModel {
  return {
    id: agent.id,
    name: compactName(agent.name, index),
    role: presence?.role || agent.subtitle?.split(/[•·]/)[0]?.trim() || agent.item || 'agent',
    status: agent.status,
    color: agent.color || ['#00ff41', '#a78bfa', '#5fcfff', '#d6ff5f'][index % 4],
    dark: darkenColor(agent.color || '#00ff41'),
    bubble: presence?.lastActivity || agent.subtitle || `${agent.status} · ${agent.item || 'office'}`,
    tier: index === 0 ? 1 : 2,
    meta: presence
      ? `${presence.provider} • ${presence.rosterStatus}${presence.assignedTaskCount > 0 ? ` • ${presence.assignedTaskCount} task` : ''}`
      : 'office',
  }
}

function readLogLevel(line: string): Matrix3DConsoleType {
  const lower = line.toLowerCase()
  if (/\b(error|exception|traceback|failed|fatal)\b/.test(lower)) return 'err'
  if (/\b(warn|warning|deprecated)\b/.test(lower)) return 'review'
  if (/\b(tool|exec|command|shell)\b/.test(lower)) return 'tool'
  if (/\b(route|request|http|api)\b/.test(lower)) return 'route'
  if (/\b(trace|debug|stream)\b/.test(lower)) return 'trace'
  return 'sys'
}

function colorForType(type: Matrix3DConsoleType): string {
  if (type === 'err') return '#ff5f6d'
  if (type === 'review') return '#a78bfa'
  if (type === 'tool') return '#d6ff5f'
  if (type === 'route') return '#00ff41'
  if (type === 'trace') return '#5fcfff'
  return 'rgba(216,255,227,.58)'
}

function extractLogLines(raw: unknown): Array<string> {
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => {
        if (typeof entry === 'string') return entry
        if (entry && typeof entry === 'object') {
          const record = entry as Record<string, unknown>
          return typeof record.message === 'string'
            ? record.message
            : typeof record.line === 'string'
              ? record.line
              : JSON.stringify(record)
        }
        return ''
      })
      .filter(Boolean)
  }

  if (!raw || typeof raw !== 'object') return []
  const record = raw as Record<string, unknown>
  return Array.isArray(record.lines)
    ? record.lines.filter((line): line is string => typeof line === 'string')
    : []
}

function parseLogLine(
  line: string,
  index: number,
  source: 'agent' | 'gateway',
  agentMatchers: Array<{ id: string; name: string }>,
): Matrix3DConsoleEntry {
  const type = readLogLevel(line)
  const timestamp =
    line.match(/\b\d{2}:\d{2}:\d{2}(?:\.\d+)?\b/)?.[0]?.slice(0, 8) ||
    line.match(/T(\d{2}:\d{2}:\d{2})/)?.[1] ||
    '—'
  const bracket = line.match(/\[([^\]\s]{2,24})\]/)?.[1]
  const agent = (bracket || (type === 'route' ? 'API' : type === 'tool' ? 'TOOL' : 'GATEWAY')).toUpperCase()
  const message = line
    .replace(/^\s*\d{4}-\d{2}-\d{2}T?/, '')
    .replace(/^\s*\d{2}:\d{2}:\d{2}(?:\.\d+)?\s*/, '')
    .trim()

  const normalizedMessage = message || line
  return {
    id: `log-${source}-${index}-${line.slice(0, 24)}`,
    time: timestamp,
    agent,
    agentKey: inferAgentKey(agent, normalizedMessage, agentMatchers),
    source,
    color: colorForType(type),
    type,
    message: normalizedMessage,
    duration: '',
  }
}


function inferAgentKey(
  agentLabel: string,
  message: string,
  agentMatchers: Array<{ id: string; name: string }>,
): string | null {
  const haystack = `${agentLabel} ${message}`.toLowerCase()
  for (const matcher of agentMatchers) {
    const id = matcher.id.toLowerCase()
    const name = matcher.name.toLowerCase()
    if (haystack.includes(id) || haystack.includes(name)) return matcher.id
  }
  return null
}

function buildLogEntries(
  raw: unknown,
  source: 'agent' | 'gateway',
  agentMatchers: Array<{ id: string; name: string }>,
): Array<Matrix3DConsoleEntry> {
  return extractLogLines(raw)
    .slice(-80)
    .map((line, index) => parseLogLine(line, index, source, agentMatchers))
}


function MatrixRain() {
  const ref = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    let animation = 0
    let frame = 0
    let drops: Array<number> = []
    const chars = '01アイウエカキサシスタチナニハヒ<>{}[]|∑∆∇∂'

    const resize = () => {
      const width = canvas.parentElement?.clientWidth ?? canvas.offsetWidth
      const height = canvas.parentElement?.clientHeight ?? canvas.offsetHeight
      if (width <= 0 || height <= 0) return
      canvas.width = width
      canvas.height = height
      drops = Array.from(
        { length: Math.max(1, Math.floor(canvas.width / 13)) },
        () => Math.random() * (canvas.height / 13),
      )
    }

    const observer = new ResizeObserver(() => resize())
    if (canvas.parentElement) observer.observe(canvas.parentElement)

    const draw = () => {
      frame += 1
      if (frame % 3 === 0) {
        context.fillStyle = 'rgba(2,8,4,0.15)'
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.font = '11px JetBrains Mono, monospace'
        drops.forEach((y, index) => {
          const ch = chars[Math.floor(Math.random() * chars.length)] ?? '0'
          context.fillStyle = `rgba(0,255,65,${0.04 + Math.random() * 0.07})`
          context.fillText(ch, index * 13, y * 13)
          drops[index] = y * 13 > canvas.height && Math.random() > 0.975 ? 0 : y + 0.35
        })
      }
      animation = requestAnimationFrame(draw)
    }

    resize()
    animation = requestAnimationFrame(draw)
    window.addEventListener('resize', resize)

    return () => {
      cancelAnimationFrame(animation)
      observer.disconnect()
      window.removeEventListener('resize', resize)
    }
  }, [])

  return <canvas ref={ref} className="matrix3d-rain" />
}

function Matrix3DSprite({ agent }: { agent: Matrix3DAgentCardModel }) {
  const c = agent.color
  const dk = agent.dark
  const statusClass = `matrix3d-sprite-${agent.status}`
  const variant = agent.name.toLowerCase()
  const hermes = variant.includes('hermes') || agent.tier === 1
  const neo = variant.includes('neo')
  const trinity = variant.includes('trinity')
  const morpheus = variant.includes('morpheus')

  return (
    <div className={statusClass} style={{ width: 44, height: 52, display: 'flex', alignItems: 'flex-end' }}>
      <svg width="44" height="52" viewBox="0 0 44 52" fill="none" aria-hidden="true">
        {hermes ? (
          <>
            <rect x="19" y="0" width="2" height="6" rx="1" fill={c} opacity=".85" />
            <circle cx="20" cy="0" r="2.5" fill={c} style={{ filter: `drop-shadow(0 0 4px ${c})` }} />
          </>
        ) : null}
        {neo ? <rect x="10" y="15" width="24" height="3" rx="1.5" fill={dk} opacity=".85" /> : null}
        {trinity ? <rect x="30" y="9" width="5" height="14" rx="2.5" fill={dk} opacity=".7" /> : null}
        <rect x={morpheus ? 8 : 10} y={hermes ? 6 : 4} width={morpheus ? 28 : 24} height={hermes ? 18 : 17} rx="3" fill={c} />
        <rect x={morpheus ? 8 : 10} y={hermes ? 6 : 4} width={morpheus ? 28 : 24} height="8" rx="3" fill="rgba(255,255,255,0.13)" />
        <rect x={morpheus ? 13 : 13} y={hermes ? 11 : 9} width="5" height="5" rx="1" fill="rgba(0,0,0,0.72)" />
        <rect x={morpheus ? 26 : 26} y={hermes ? 11 : 9} width="5" height="5" rx="1" fill="rgba(0,0,0,0.72)" />
        <rect x={morpheus ? 14 : 14} y={hermes ? 12 : 10} width="2" height="2" fill="rgba(255,255,255,0.5)" />
        <rect x={morpheus ? 27 : 27} y={hermes ? 12 : 10} width="2" height="2" fill="rgba(255,255,255,0.5)" />
        {morpheus ? <rect x="12" y="12" width="20" height="2.5" rx="1.25" fill={dk} opacity=".7" /> : null}
        <rect x="17" y={hermes ? 21 : 18} width="10" height="2" rx="1" fill="rgba(0,0,0,0.42)" />
        <rect x={morpheus ? 7 : 9} y={hermes ? 26 : 23} width={morpheus ? 30 : 26} height="18" rx="3" fill={c} />
        <rect x={morpheus ? 7 : 9} y={hermes ? 26 : 23} width={morpheus ? 30 : 26} height="5" rx="3" fill="rgba(255,255,255,0.09)" />
        <rect x="21" y={hermes ? 28 : 25} width="2" height="14" fill="rgba(0,0,0,0.18)" />
        <rect x="1" y={hermes ? 26 : 23} width="8" height="13" rx="2" fill={c} />
        <rect x="35" y={hermes ? 26 : 23} width="8" height="13" rx="2" fill={c} />
        <rect x={morpheus ? 9 : 10} y="43" width={morpheus ? 11 : 10} height="9" rx="2" fill={dk} />
        <rect x={morpheus ? 24 : 24} y="43" width={morpheus ? 11 : 10} height="9" rx="2" fill={dk} />
        <rect x={morpheus ? 9 : 10} y="43" width={morpheus ? 11 : 10} height="3" rx="2" fill={c} opacity=".45" />
        <rect x={morpheus ? 24 : 24} y="43" width={morpheus ? 11 : 10} height="3" rx="2" fill={c} opacity=".45" />
      </svg>
    </div>
  )
}

function Matrix3DAgentCard({ agent }: { agent: Matrix3DAgentCardModel }) {
  const dot = statusColor(agent.status)

  return (
    <div className="matrix3d-agent-card" style={{ borderColor: `${agent.color}40` }}>
      {agent.tier === 1 ? (
        <span className="matrix3d-agent-tier" style={{ color: agent.color, textShadow: `0 0 6px ${agent.color}88` }}>
          T1
        </span>
      ) : null}
      <div className="matrix3d-agent-bubble" style={{ borderColor: `${agent.color}35`, color: agent.color, textShadow: `0 0 6px ${agent.color}44` }}>
        {agent.bubble}
      </div>
      <div className="matrix3d-agent-sprite">
        <Matrix3DSprite agent={agent} />
      </div>
      <div className="matrix3d-agent-name" style={{ color: agent.color }}>
        {agent.name}
      </div>
      <div className="matrix3d-agent-role">{agent.role}</div>
      <div className="matrix3d-agent-meta">{agent.meta}</div>
      <div className="matrix3d-agent-status">
        <div className="matrix3d-agent-status-dot" style={{ background: dot, boxShadow: agent.status !== 'idle' ? `0 0 6px ${dot}` : '' }} />
        <div className="matrix3d-agent-status-label" style={{ color: dot }}>
          {agent.status}
        </div>
      </div>
    </div>
  )
}

function Matrix3DConsole({ entries, isLoading, isError, agentTabs }: { entries: Array<Matrix3DConsoleEntry>; isLoading: boolean; isError: boolean; agentTabs: Array<{ id: string; label: string }> }) {
  const [tab, setTab] = useState('ALL')
  const tabs = useMemo(() => ['ALL', 'AGENTS', 'GATEWAY', ...agentTabs.map((agent) => agent.id)], [agentTabs])
  const filtered = useMemo(() => {
    if (tab === 'ALL') return entries
    if (tab === 'AGENTS') return entries.filter((entry) => entry.source === 'agent' || entry.agentKey)
    if (tab === 'GATEWAY') return entries.filter((entry) => entry.source === 'gateway')
    return entries.filter((entry) => entry.agentKey === tab)
  }, [entries, tab])
  const tabLabel = (value: string) => agentTabs.find((agent) => agent.id === value)?.label || value

  return (
    <div className="matrix3d-console">
      <MatrixRain />
      <div className="matrix3d-console-head">
        <span className="matrix3d-console-label">Runtime logs</span>
        {tabs.map((item) => (
          <button key={item} className={`matrix3d-console-tab${tab === item ? ' is-on' : ''}`} type="button" onClick={() => setTab(item)}>
            {tabLabel(item)}
          </button>
        ))}
        <div className="matrix3d-live">
          <div className="matrix3d-live-dot" />
          <span>{isLoading ? 'Sync' : isError ? 'Offline' : 'Live'}</span>
        </div>
      </div>
      <div className="matrix3d-console-body">
        {filtered.length > 0 ? (
          filtered.map((entry) => (
            <div key={entry.id} className="matrix3d-console-row">
              <span className="matrix3d-console-time">{entry.time}</span>
              <span className="matrix3d-console-agent" style={{ color: entry.color }}>
                {entry.agent}
              </span>
              <span className={`matrix3d-console-type matrix3d-type-${entry.type}`}>{TYPE_LABELS[entry.type]}</span>
              <span className="matrix3d-console-message">{entry.message}</span>
              <span className="matrix3d-console-duration">{entry.duration}</span>
            </div>
          ))
        ) : (
          <div className="matrix3d-console-empty">
            {isError ? 'Could not load agent/gateway logs from Hermes.' : 'No runtime log lines returned yet.'}
          </div>
        )}
      </div>
    </div>
  )
}

export function Matrix3DScreen() {
  const officeData = useMatrix3DOfficeData()
  const cardAgents = useMemo(
    () =>
      officeData.agents.map((agent, index) =>
        toCardAgent(
          agent,
          officeData.presence.find((presence) => presence.id === agent.id),
          index,
        ),
      ),
    [officeData.agents, officeData.presence],
  )
  const agentLogsQuery = useQuery({
    queryKey: ['matrix3d', 'agent-logs-console'],
    queryFn: () => getLogs({ lines: 120, file: 'agent' }),
    staleTime: 5_000,
    refetchInterval: 5_000,
    retry: false,
  })
  const gatewayLogsQuery = useQuery({
    queryKey: ['matrix3d', 'gateway-logs-console'],
    queryFn: () => getLogs({ lines: 120, file: 'gateway' }),
    staleTime: 5_000,
    refetchInterval: 5_000,
    retry: false,
  })
  const agentMatchers = useMemo(
    () => officeData.presence.map((presence) => ({ id: presence.id, name: presence.name })),
    [officeData.presence],
  )
  const entries = useMemo(
    () => [
      ...buildLogEntries(agentLogsQuery.data, 'agent', agentMatchers),
      ...buildLogEntries(gatewayLogsQuery.data, 'gateway', agentMatchers),
    ].sort((a, b) => a.time.localeCompare(b.time)),
    [agentLogsQuery.data, agentMatchers, gatewayLogsQuery.data],
  )
  const consoleAgentTabs = useMemo(
    () =>
      officeData.presence
        .filter((presence) => entries.some((entry) => entry.agentKey === presence.id))
        .map((presence) => ({ id: presence.id, label: compactName(presence.name, 0) })),
    [entries, officeData.presence],
  )
  const isLiveRoster = officeData.agentSource === 'live'
  const working = cardAgents.filter((agent) => agent.status === 'working').length
  const errors = cardAgents.filter((agent) => agent.status === 'error').length
  const idle = Math.max(0, cardAgents.length - working - errors)

  return (
    <div className="matrix3d-office-page">
      <div className="matrix3d-main">
        <section className="matrix3d-canvas-zone" aria-label="Matrix3D Office viewport">
          <div className="matrix3d-canvas-grid" />
          <div className="matrix3d-canvas-glow" />
          <Matrix3DCanvas officeData={officeData} />
          <div className="matrix3d-canvas-title-bar">
            <div className="matrix3d-canvas-title-line" />
            <span className="matrix3d-canvas-title">Matrix3D Office</span>
            <div className="matrix3d-canvas-title-line right" />
          </div>
          <div className="matrix3d-canvas-bottom-bar">
            <div className="matrix3d-dot" />
            <span style={{ color: 'rgba(0,255,65,.6)' }}>{working} working</span>
            <span className="matrix3d-sep">·</span>
            <span>{idle} idle</span>
            <span className="matrix3d-sep">·</span>
            <span>{errors} error</span>
            <span style={{ marginLeft: 'auto', opacity: 0.4 }}>active · drag · scroll · space+drag · dbl-click</span>
          </div>
        </section>

        <section className="matrix3d-bottom-zone" aria-label="Matrix3D Office agents and console">
          <div className="matrix3d-roster">
            <div className="matrix3d-roster-bar">
              <div className="matrix3d-roster-pulse" />
              <span className="matrix3d-roster-label">Active agents</span>
              <span className="matrix3d-roster-summary">
                {cardAgents.length} {isLiveRoster ? 'live' : 'roster'} · {working} working · {errors} error
              </span>
            </div>
            {cardAgents.length > 0 ? (
              <div className="matrix3d-roster-rail">
                {cardAgents.map((agent) => (
                  <Matrix3DAgentCard key={agent.id} agent={agent} />
                ))}
              </div>
            ) : (
              <div className="matrix3d-roster-empty">
                No Hermes agents returned by the workspace or gateway yet.
              </div>
            )}
          </div>
          <Matrix3DConsole entries={entries} isLoading={agentLogsQuery.isLoading || gatewayLogsQuery.isLoading} isError={Boolean(agentLogsQuery.isError && gatewayLogsQuery.isError)} agentTabs={consoleAgentTabs} />
        </section>
      </div>
    </div>
  )
}
