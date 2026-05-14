import { useEffect, useMemo, useRef, useState } from 'react'
import { Matrix3DCanvas } from './components/matrix3d-canvas'
import { useMatrix3DOfficeData } from './use-matrix3d-office-data'
import type { OfficeAgent } from '@/features/retro-office/core/types'
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

function toCardAgent(agent: OfficeAgent, index: number): Matrix3DAgentCardModel {
  return {
    id: agent.id,
    name: compactName(agent.name, index),
    role: agent.subtitle?.split(/[•·]/)[0]?.trim() || agent.item || 'agent',
    status: agent.status,
    color: agent.color || ['#00ff41', '#a78bfa', '#5fcfff', '#d6ff5f'][index % 4],
    dark: darkenColor(agent.color || '#00ff41'),
    bubble: agent.subtitle || `${agent.status} · ${agent.item || 'office'}`,
    tier: index === 0 ? 1 : 2,
  }
}

function buildConsoleEntries(
  agents: Array<Matrix3DAgentCardModel>,
  gatewayStatus: string,
): Array<Matrix3DConsoleEntry> {
  const now = new Date()
  const at = (offsetSeconds: number) => {
    const d = new Date(now.getTime() - offsetSeconds * 1000)
    return d.toLocaleTimeString('en-US', { hour12: false })
  }

  const entries: Array<Matrix3DConsoleEntry> = [
    {
      id: 'route',
      time: at(45),
      agent: 'HERMES',
      color: '#00ff41',
      type: 'route',
      message: `/matrix3d mounted · gateway ${gatewayStatus}`,
      duration: 'live',
    },
    {
      id: 'sync',
      time: at(32),
      agent: 'SYS',
      color: 'rgba(216,255,227,.34)',
      type: 'sys',
      message: `${agents.length} Hermes agents mapped into Matrix3D Office`,
      duration: '30s',
    },
    {
      id: 'renderer',
      time: at(20),
      agent: 'OFFICE',
      color: '#d6ff5f',
      type: 'tool',
      message: 'RetroOffice3D renderer active inside top viewport',
      duration: 'r184',
    },
  ]

  agents.slice(0, 8).forEach((agent, index) => {
    entries.push({
      id: `agent-${agent.id}`,
      time: at(Math.max(0, 12 - index * 2)),
      agent: agent.name,
      color: agent.color,
      type: agent.status === 'error' ? 'err' : agent.status === 'working' ? 'trace' : 'review',
      message:
        agent.status === 'working'
          ? `${agent.role} activity stream linked to office avatar`
          : agent.status === 'error'
            ? `${agent.role} requires attention`
            : `${agent.role} standing by`,
      duration: agent.status,
    })
  })

  return entries
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
      canvas.width = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
      drops = Array.from(
        { length: Math.max(1, Math.floor(canvas.width / 13)) },
        () => Math.random() * (canvas.height / 13),
      )
    }

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
      <div className="matrix3d-agent-status">
        <div className="matrix3d-agent-status-dot" style={{ background: dot, boxShadow: agent.status !== 'idle' ? `0 0 6px ${dot}` : '' }} />
        <div className="matrix3d-agent-status-label" style={{ color: dot }}>
          {agent.status}
        </div>
      </div>
    </div>
  )
}

function Matrix3DConsole({ entries }: { entries: Array<Matrix3DConsoleEntry> }) {
  const [tab, setTab] = useState('ALL')
  const tabs = useMemo(() => ['ALL', ...entries.map((entry) => entry.agent).filter((agent) => agent !== 'SYS').slice(0, 4)], [entries])
  const filtered = tab === 'ALL' ? entries : entries.filter((entry) => entry.agent === tab || entry.agent === 'SYS')

  return (
    <div className="matrix3d-console">
      <MatrixRain />
      <div className="matrix3d-console-head">
        <span className="matrix3d-console-label">Console</span>
        {tabs.map((item) => (
          <button key={item} className={`matrix3d-console-tab${tab === item ? ' is-on' : ''}`} type="button" onClick={() => setTab(item)}>
            {item}
          </button>
        ))}
        <div className="matrix3d-live">
          <div className="matrix3d-live-dot" />
          <span>Live</span>
        </div>
      </div>
      <div className="matrix3d-console-body">
        {filtered.map((entry) => (
          <div key={entry.id} className="matrix3d-console-row">
            <span className="matrix3d-console-time">{entry.time}</span>
            <span className="matrix3d-console-agent" style={{ color: entry.color }}>
              {entry.agent}
            </span>
            <span className={`matrix3d-console-type matrix3d-type-${entry.type}`}>{TYPE_LABELS[entry.type]}</span>
            <span className="matrix3d-console-message">{entry.message}</span>
            <span className="matrix3d-console-duration">{entry.duration}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function Matrix3DScreen() {
  const officeData = useMatrix3DOfficeData()
  const cardAgents = useMemo(() => officeData.agents.map(toCardAgent), [officeData.agents])
  const entries = useMemo(() => buildConsoleEntries(cardAgents, officeData.gatewayStatus), [cardAgents, officeData.gatewayStatus])
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
              <span className="matrix3d-roster-label">Agents</span>
              <span className="matrix3d-roster-summary">
                {cardAgents.length} online · {working} working · {errors} error
              </span>
            </div>
            <div className="matrix3d-roster-rail">
              {cardAgents.map((agent) => (
                <Matrix3DAgentCard key={agent.id} agent={agent} />
              ))}
            </div>
          </div>
          <Matrix3DConsole entries={entries} />
        </section>
      </div>
    </div>
  )
}
