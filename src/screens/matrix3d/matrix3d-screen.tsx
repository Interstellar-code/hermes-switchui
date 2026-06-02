import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { Matrix3DCanvas } from './components/matrix3d-canvas'
import { TYPE_LABELS, buildLogEntries } from './matrix3d-console-log'
import { useMatrix3DOfficeData } from './use-matrix3d-office-data'
import {
  a2aMessageKind,
  a2aMessageLabel,
  modeAccent,
  modeLabel,
  normalizeMode,
} from './a2a-modes'
import type { CSSProperties } from 'react'
import type { A2AMessageKind } from './a2a-modes'
import type { OfficeAgent } from '@/features/retro-office/core/types'
import type {
  A2AFleetConversationSummary,
  A2AFleetMessage,
} from '@/lib/hermes-client'
import type { Matrix3DConsoleEntry } from './matrix3d-console-log'
import type { Matrix3DAgentPresence } from './use-matrix3d-office-data'
import {
  getA2AFleetConversation,
  getA2AFleetConversations,
  getLogs,
} from '@/lib/hermes-client'
import './matrix3d-office.css'

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

type Matrix3DSelectedAgent = {
  card: Matrix3DAgentCardModel
  presence?: Matrix3DAgentPresence
}

type A2AConversationFilter = 'all' | A2AMessageKind
type Matrix3DBottomMode = 'agents' | 'a2a'

const FALLBACK_CARD_NAMES = ['HERMES', 'NEO', 'TRINITY', 'MORPHEUS']
const MATRIX3D_IDENTITY_COLORS = ['#00ff41', '#38bdf8', '#f59e0b', '#a78bfa']
const MATRIX3D_NAMED_COLORS: Record<string, string> = {
  'hermes-switch': '#00ff41',
  hermes: '#00ff41',
  neo: '#38bdf8',
  trinity: '#f59e0b',
  morpheus: '#a78bfa',
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
  return (first || clean)
    .replace(/[^a-z0-9-]/gi, '')
    .slice(0, 10)
    .toUpperCase()
}

function statusColor(status: OfficeAgent['status']): string {
  if (status === 'working') return '#00ff41'
  if (status === 'error') return '#ff5f6d'
  return '#facc15'
}

function agentIdentityColor(agent: OfficeAgent, index: number): string {
  const identity = `${agent.id} ${agent.name}`.toLowerCase()
  for (const [token, color] of Object.entries(MATRIX3D_NAMED_COLORS)) {
    if (identity.includes(token)) return color
  }
  return (
    agent.color ||
    MATRIX3D_IDENTITY_COLORS[index % MATRIX3D_IDENTITY_COLORS.length]
  )
}

function pluralize(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return `${count} ${count === 1 ? singular : plural}`
}

function normalizeLabel(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isGenericProfileRole(value: string | null | undefined): boolean {
  return normalizeLabel(value).toLowerCase() === 'profile'
}

function readableModel(value: string | null | undefined): string {
  const model = normalizeLabel(value)
  if (!model || model.toLowerCase() === 'unknown') return ''
  return model
}

function cardBubbleLabel(
  agent: OfficeAgent,
  presence: Matrix3DAgentPresence | undefined,
): string {
  const model = readableModel(presence?.model)
  if (model) return model
  const bubble = normalizeLabel(presence?.lastActivity || agent.subtitle)
  return bubble || 'Hermes'
}

function cardRoleLabel(
  agent: OfficeAgent,
  presence: Matrix3DAgentPresence | undefined,
): string {
  const explicitRole = normalizeLabel(presence?.role)
  if (explicitRole && !isGenericProfileRole(explicitRole)) return explicitRole
  const provider = normalizeLabel(presence?.provider)
  if (provider) return `${provider} profile`
  return agent.item || 'agent'
}

function cardMetaLabel(presence: Matrix3DAgentPresence | undefined): string {
  if (!presence) return 'profile ready'
  const details = [
    readableModel(presence.model),
    presence.assignedTaskCount > 0
      ? pluralize(presence.assignedTaskCount, 'task')
      : null,
    presence.activeSessionKey ? 'live session' : null,
    presence.sessionCount > 0
      ? pluralize(presence.sessionCount, 'session')
      : null,
  ].filter(Boolean)
  return details.length > 0 ? details.join(' • ') : 'profile ready'
}

function formatPanelValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'number')
    return Number.isFinite(value) ? String(value) : '—'
  const text = value.trim()
  return text || '—'
}

function parseTimestampMs(
  value: string | number | null | undefined,
): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value
  }

  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null

  const numeric = Number(trimmed)
  if (Number.isFinite(numeric)) {
    return numeric < 10_000_000_000 ? numeric * 1000 : numeric
  }

  const parsed = Date.parse(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function formatRelativeTimestamp(
  value: string | number | null | undefined,
): string {
  const timestamp = parseTimestampMs(value)
  if (!timestamp) return 'unknown'

  const seconds = Math.round((timestamp - Date.now()) / 1000)
  const abs = Math.abs(seconds)
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

  if (abs < 60) return formatter.format(seconds, 'second')
  const minutes = Math.round(seconds / 60)
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour')
  const days = Math.round(hours / 24)
  return formatter.format(days, 'day')
}

function formatAbsoluteTimestamp(
  value: string | number | null | undefined,
): string {
  const timestamp = parseTimestampMs(value)
  if (!timestamp) return '—'
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(timestamp)
}

function a2aConversationTitle(
  conversation: A2AFleetConversationSummary,
): string {
  return conversation.peer.trim() || conversation.contextId
}

function a2aConversationMatchesFilter(
  conversation: A2AFleetConversationSummary,
  query: string,
  filter: A2AConversationFilter,
): boolean {
  if (
    filter !== 'all' &&
    a2aMessageKind(conversation.last_dir || '') !== filter
  ) {
    return false
  }

  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return true

  return [
    conversation.peer,
    conversation.contextId,
    conversation.repo_path,
    conversation.last_dir,
    conversation.last_text,
  ]
    .filter((value): value is string => typeof value === 'string')
    .some((value) => value.toLowerCase().includes(normalizedQuery))
}

function a2aMessageMatchesFilter(
  message: A2AFleetMessage,
  query: string,
  filter: A2AConversationFilter,
): boolean {
  if (filter !== 'all' && a2aMessageKind(message.dir) !== filter) {
    return false
  }

  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return true

  return [message.from, message.to, message.dir, message.text]
    .filter((value): value is string => typeof value === 'string')
    .some((value) => value.toLowerCase().includes(normalizedQuery))
}

function repoBasename(path: string | null | undefined): string {
  if (!path) return ''
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] || path
}

function copyText(value: string | null | undefined): void {
  if (!value) return
  void navigator.clipboard.writeText(value).catch(() => undefined)
}

function NetworkGlyph({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M12 5v5m0 4v5M7 8.5l-2.5 2m12.5-2 2.5 2M7 15.5l-2.5-2m12.5 2 2.5-2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="4" r="2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="20" r="2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="3.5" cy="12" r="2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="20.5" cy="12" r="2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}

function toCardAgent(
  agent: OfficeAgent,
  presence: Matrix3DAgentPresence | undefined,
  index: number,
): Matrix3DAgentCardModel {
  const identityColor = agentIdentityColor(agent, index)
  return {
    id: agent.id,
    name: compactName(agent.name, index),
    role: cardRoleLabel(agent, presence),
    status: agent.status,
    color: identityColor,
    dark: darkenColor(identityColor),
    bubble: cardBubbleLabel(agent, presence),
    tier: index === 0 ? 1 : 2,
    meta: cardMetaLabel(presence),
  }
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
          drops[index] =
            y * 13 > canvas.height && Math.random() > 0.975 ? 0 : y + 0.35
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
    <div
      className={statusClass}
      style={{ width: 44, height: 52, display: 'flex', alignItems: 'flex-end' }}
    >
      <svg
        width="44"
        height="52"
        viewBox="0 0 44 52"
        fill="none"
        aria-hidden="true"
      >
        {hermes ? (
          <>
            <rect
              x="19"
              y="0"
              width="2"
              height="6"
              rx="1"
              fill={c}
              opacity=".85"
            />
            <circle
              cx="20"
              cy="0"
              r="2.5"
              fill={c}
              style={{ filter: `drop-shadow(0 0 4px ${c})` }}
            />
          </>
        ) : null}
        {neo ? (
          <rect
            x="10"
            y="15"
            width="24"
            height="3"
            rx="1.5"
            fill={dk}
            opacity=".85"
          />
        ) : null}
        {trinity ? (
          <rect
            x="30"
            y="9"
            width="5"
            height="14"
            rx="2.5"
            fill={dk}
            opacity=".7"
          />
        ) : null}
        <rect
          x={morpheus ? 8 : 10}
          y={hermes ? 6 : 4}
          width={morpheus ? 28 : 24}
          height={hermes ? 18 : 17}
          rx="3"
          fill={c}
        />
        <rect
          x={morpheus ? 8 : 10}
          y={hermes ? 6 : 4}
          width={morpheus ? 28 : 24}
          height="8"
          rx="3"
          fill="rgba(255,255,255,0.13)"
        />
        <rect
          x={morpheus ? 13 : 13}
          y={hermes ? 11 : 9}
          width="5"
          height="5"
          rx="1"
          fill="rgba(0,0,0,0.72)"
        />
        <rect
          x={morpheus ? 26 : 26}
          y={hermes ? 11 : 9}
          width="5"
          height="5"
          rx="1"
          fill="rgba(0,0,0,0.72)"
        />
        <rect
          x={morpheus ? 14 : 14}
          y={hermes ? 12 : 10}
          width="2"
          height="2"
          fill="rgba(255,255,255,0.5)"
        />
        <rect
          x={morpheus ? 27 : 27}
          y={hermes ? 12 : 10}
          width="2"
          height="2"
          fill="rgba(255,255,255,0.5)"
        />
        {morpheus ? (
          <rect
            x="12"
            y="12"
            width="20"
            height="2.5"
            rx="1.25"
            fill={dk}
            opacity=".7"
          />
        ) : null}
        <rect
          x="17"
          y={hermes ? 21 : 18}
          width="10"
          height="2"
          rx="1"
          fill="rgba(0,0,0,0.42)"
        />
        <rect
          x={morpheus ? 7 : 9}
          y={hermes ? 26 : 23}
          width={morpheus ? 30 : 26}
          height="18"
          rx="3"
          fill={c}
        />
        <rect
          x={morpheus ? 7 : 9}
          y={hermes ? 26 : 23}
          width={morpheus ? 30 : 26}
          height="5"
          rx="3"
          fill="rgba(255,255,255,0.09)"
        />
        <rect
          x="21"
          y={hermes ? 28 : 25}
          width="2"
          height="14"
          fill="rgba(0,0,0,0.18)"
        />
        <rect
          x="1"
          y={hermes ? 26 : 23}
          width="8"
          height="13"
          rx="2"
          fill={c}
        />
        <rect
          x="35"
          y={hermes ? 26 : 23}
          width="8"
          height="13"
          rx="2"
          fill={c}
        />
        <rect
          x={morpheus ? 9 : 10}
          y="43"
          width={morpheus ? 11 : 10}
          height="9"
          rx="2"
          fill={dk}
        />
        <rect
          x={morpheus ? 24 : 24}
          y="43"
          width={morpheus ? 11 : 10}
          height="9"
          rx="2"
          fill={dk}
        />
        <rect
          x={morpheus ? 9 : 10}
          y="43"
          width={morpheus ? 11 : 10}
          height="3"
          rx="2"
          fill={c}
          opacity=".45"
        />
        <rect
          x={morpheus ? 24 : 24}
          y="43"
          width={morpheus ? 11 : 10}
          height="3"
          rx="2"
          fill={c}
          opacity=".45"
        />
      </svg>
    </div>
  )
}

function Matrix3DAgentCard({
  agent,
  selected = false,
  onClick,
}: {
  agent: Matrix3DAgentCardModel
  selected?: boolean
  onClick?: () => void
}) {
  const dot = statusColor(agent.status)

  return (
    <button
      type="button"
      className={`matrix3d-agent-card${selected ? ' is-selected' : ''}`}
      style={{
        borderColor: selected ? agent.color : `${agent.color}66`,
        background: `linear-gradient(180deg, ${agent.color}1f, rgba(2, 15, 7, 0.94))`,
        boxShadow: selected
          ? `0 0 0 1px ${agent.color}55 inset, 0 0 18px ${agent.color}22`
          : `0 0 0 1px ${agent.color}14 inset`,
      }}
      onClick={onClick}
      aria-pressed={selected}
      aria-label={`${agent.name} — ${agent.role}`}
    >
      {agent.tier === 1 ? (
        <span
          className="matrix3d-agent-tier"
          style={{ color: agent.color, textShadow: `0 0 6px ${agent.color}88` }}
        >
          T1
        </span>
      ) : null}
      <div
        className="matrix3d-agent-bubble"
        style={{
          borderColor: `${agent.color}70`,
          color: agent.color,
          background: `${agent.dark}ee`,
          textShadow: `0 0 6px ${agent.color}66`,
        }}
      >
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
        <div
          className="matrix3d-agent-status-dot"
          style={{
            background: dot,
            boxShadow: agent.status !== 'idle' ? `0 0 6px ${dot}` : '',
          }}
        />
        <div className="matrix3d-agent-status-label" style={{ color: dot }}>
          {agent.status === 'idle' ? 'idle' : agent.status}
        </div>
      </div>
    </button>
  )
}

function Matrix3DConsole({
  entries,
  isLoading,
  isError,
  agentTabs,
}: {
  entries: Array<Matrix3DConsoleEntry>
  isLoading: boolean
  isError: boolean
  agentTabs: Array<{ id: string; label: string }>
}) {
  const [tab, setTab] = useState('ALL')
  const [showNoise, setShowNoise] = useState(false)
  const tabs = useMemo(
    () => ['ALL', 'AGENTS', 'GATEWAY', ...agentTabs.map((agent) => agent.id)],
    [agentTabs],
  )
  const visibleEntries = useMemo(
    () => (showNoise ? entries : entries.filter((entry) => !entry.noisy)),
    [entries, showNoise],
  )
  const hiddenNoiseCount = useMemo(
    () => entries.filter((entry) => entry.noisy).length,
    [entries],
  )
  const filtered = useMemo(() => {
    if (tab === 'ALL') return visibleEntries
    if (tab === 'AGENTS')
      return visibleEntries.filter(
        (entry) => entry.source === 'agent' || entry.agentKey,
      )
    if (tab === 'GATEWAY')
      return visibleEntries.filter((entry) => entry.source === 'gateway')
    return visibleEntries.filter((entry) => entry.agentKey === tab)
  }, [visibleEntries, tab])
  const tabLabel = (value: string) =>
    agentTabs.find((agent) => agent.id === value)?.label || value

  return (
    <div className="matrix3d-console">
      <MatrixRain />
      <div className="matrix3d-console-head">
        <span className="matrix3d-console-label">Runtime logs</span>
        {tabs.map((item) => (
          <button
            key={item}
            className={`matrix3d-console-tab${tab === item ? ' is-on' : ''}`}
            type="button"
            onClick={() => setTab(item)}
          >
            {tabLabel(item)}
          </button>
        ))}
        <button
          className={`matrix3d-console-tab matrix3d-console-toggle${showNoise ? ' is-on' : ''}`}
          type="button"
          onClick={() => setShowNoise((value) => !value)}
        >
          {showNoise
            ? hiddenNoiseCount > 0
              ? `NOISE ON · ${hiddenNoiseCount}`
              : 'NOISE ON'
            : hiddenNoiseCount > 0
              ? `NOISE OFF · ${hiddenNoiseCount}`
              : 'NOISE OFF'}
        </button>
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
              <span
                className="matrix3d-console-agent"
                style={{ color: entry.color }}
              >
                {entry.agent}
              </span>
              <span
                className={`matrix3d-console-type matrix3d-type-${entry.type}`}
              >
                {TYPE_LABELS[entry.type]}
              </span>
              <span className="matrix3d-console-message">{entry.message}</span>
              <span className="matrix3d-console-duration">
                {entry.duration}
              </span>
            </div>
          ))
        ) : (
          <div className="matrix3d-console-empty">
            {isError
              ? 'Could not load agent/gateway logs from Hermes.'
              : 'No runtime log lines returned yet.'}
          </div>
        )}
      </div>
    </div>
  )
}

function A2AFleetTab() {
  const [selectedContextId, setSelectedContextId] = useState<string | null>(
    null,
  )
  const [searchQuery, setSearchQuery] = useState('')
  const [conversationFilter, setConversationFilter] =
    useState<A2AConversationFilter>('all')
  const [modeFilter, setModeFilter] = useState<string>('all')
  const [threadSearchQuery, setThreadSearchQuery] = useState('')
  const [threadFilter, setThreadFilter] = useState<A2AConversationFilter>('all')
  const threadRef = useRef<HTMLDivElement | null>(null)
  const conversationsQuery = useQuery({
    queryKey: ['matrix3d', 'a2a-fleet', 'conversations'],
    queryFn: getA2AFleetConversations,
    staleTime: 1_000,
    refetchInterval: 2_000,
    retry: false,
  })
  const conversations = conversationsQuery.data?.conversations ?? []
  const availableModes = useMemo(() => {
    const seen = new Set<string>()
    for (const conversation of conversations) {
      const key = normalizeMode(conversation.mode)
      if (key) seen.add(key)
    }
    return Array.from(seen).sort()
  }, [conversations])
  const filteredConversations = useMemo(
    () =>
      conversations.filter(
        (conversation) =>
          (modeFilter === 'all' ||
            normalizeMode(conversation.mode) === modeFilter) &&
          a2aConversationMatchesFilter(
            conversation,
            searchQuery,
            conversationFilter,
          ),
      ),
    [conversationFilter, conversations, modeFilter, searchQuery],
  )
  const selectedConversation = useMemo(
    () =>
      selectedContextId
        ? conversations.find(
            (conversation) => conversation.contextId === selectedContextId,
          )
        : null,
    [conversations, selectedContextId],
  )

  useEffect(() => {
    if (conversations.length === 0 || filteredConversations.length === 0) {
      if (selectedContextId) setSelectedContextId(null)
      return
    }

    if (
      !selectedContextId ||
      !filteredConversations.some(
        (conversation) => conversation.contextId === selectedContextId,
      )
    ) {
      setSelectedContextId(filteredConversations[0]?.contextId ?? null)
    }
  }, [conversations.length, filteredConversations, selectedContextId])

  const threadQuery = useQuery({
    queryKey: ['matrix3d', 'a2a-fleet', 'conversation', selectedContextId],
    queryFn: () => getA2AFleetConversation(selectedContextId ?? ''),
    enabled: Boolean(selectedContextId),
    staleTime: 1_000,
    refetchInterval: 2_000,
    retry: false,
  })
  const messages = threadQuery.data?.messages ?? []
  const filteredMessages = useMemo(
    () =>
      messages.filter((message) =>
        a2aMessageMatchesFilter(message, threadSearchQuery, threadFilter),
      ),
    [messages, threadFilter, threadSearchQuery],
  )
  const lastMessageKey =
    messages.length > 0
      ? `${messages.length}:${messages[messages.length - 1]?.ts ?? ''}:${messages[messages.length - 1]?.text ?? ''}`
      : 'empty'
  const errorMessage =
    conversationsQuery.error instanceof Error
      ? conversationsQuery.error.message
      : threadQuery.error instanceof Error
        ? threadQuery.error.message
        : ''
  const isMissingRoute =
    errorMessage.includes('404') ||
    errorMessage.includes('endpoint-unavailable')

  useEffect(() => {
    const thread = threadRef.current
    if (!thread) return
    thread.scrollTop = thread.scrollHeight
  }, [lastMessageKey, selectedContextId, threadFilter, threadSearchQuery])

  return (
    <div className="matrix3d-a2a">
      <MatrixRain />
      <div className="matrix3d-a2a-body">
        <div className="matrix3d-a2a-list" aria-label="A2A conversations">
          <div className="matrix3d-a2a-search">
            <input
              aria-label="Search A2A conversations"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search peer, context, repo, text…"
            />
            <select
              aria-label="Filter A2A conversations"
              value={conversationFilter}
              onChange={(event) =>
                setConversationFilter(
                  event.target.value as A2AConversationFilter,
                )
              }
            >
              <option value="all">All</option>
              <option value="orchestrator">Hermes</option>
              <option value="executor">Executor</option>
              <option value="ack">Queued</option>
            </select>
            {availableModes.length > 0 ? (
              <select
                aria-label="Filter A2A conversations by protocol"
                value={
                  modeFilter !== 'all' && !availableModes.includes(modeFilter)
                    ? 'all'
                    : modeFilter
                }
                onChange={(event) => setModeFilter(event.target.value)}
              >
                <option value="all">All protocols</option>
                {availableModes.map((mode) => (
                  <option key={mode} value={mode}>
                    {modeLabel(mode)}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          {filteredConversations.length > 0 ? (
            filteredConversations.map((conversation) => (
              <button
                key={conversation.contextId}
                type="button"
                className={`matrix3d-a2a-conversation${
                  conversation.contextId === selectedContextId
                    ? ' is-selected'
                    : ''
                }`}
                onClick={() => setSelectedContextId(conversation.contextId)}
              >
                <div className="matrix3d-a2a-conversation-top">
                  <span className="matrix3d-a2a-peer-wrap">
                    {conversation.mode ? (
                      <span
                        className="matrix3d-a2a-mode-badge"
                        style={
                          {
                            '--a2a-mode-accent': modeAccent(conversation.mode),
                          } as CSSProperties
                        }
                      >
                        {modeLabel(conversation.mode)}
                      </span>
                    ) : null}
                    <span className="matrix3d-a2a-peer">
                      {a2aConversationTitle(conversation)}
                    </span>
                  </span>
                  <span className="matrix3d-a2a-count">
                    {conversation.message_count}
                  </span>
                </div>
                <div className="matrix3d-a2a-context">
                  {conversation.contextId}
                </div>
                <div className="matrix3d-a2a-preview">
                  {conversation.last_text || 'No message preview.'}
                </div>
                <div className="matrix3d-a2a-meta">
                  <span>{formatRelativeTimestamp(conversation.last_ts)}</span>
                  <span>{conversation.last_dir || '—'}</span>
                </div>
              </button>
            ))
          ) : (
            <div className="matrix3d-a2a-empty">
              {conversationsQuery.isError
                ? isMissingRoute
                  ? 'A2A backend not ready — restart the Hermes dashboard (the plugin API mounts only at dashboard startup).'
                  : 'Could not load A2A conversations from Hermes.'
                : conversations.length > 0
                  ? 'No A2A conversations match the current search/filter.'
                  : 'No A2A conversations yet — deploy an executor from Hermes.'}
            </div>
          )}
        </div>
        <div className="matrix3d-a2a-thread-wrap">
          <div className="matrix3d-a2a-thread-head">
            <div className="matrix3d-a2a-thread-id">
              <div className="matrix3d-a2a-thread-title">
                {selectedConversation?.mode ? (
                  <span
                    className="matrix3d-a2a-mode-badge"
                    style={
                      {
                        '--a2a-mode-accent': modeAccent(
                          selectedConversation.mode,
                        ),
                      } as CSSProperties
                    }
                  >
                    {modeLabel(selectedConversation.mode)}
                  </span>
                ) : null}
                {selectedConversation
                  ? a2aConversationTitle(selectedConversation)
                  : 'No conversation selected'}
              </div>
              <div className="matrix3d-a2a-thread-meta">
                <span>{pluralize(messages.length, 'message')}</span>
                {selectedConversation?.last_ts ? (
                  <span>
                    Updated{' '}
                    {formatRelativeTimestamp(selectedConversation.last_ts)}
                  </span>
                ) : null}
                {selectedConversation?.repo_path ? (
                  <span>{repoBasename(selectedConversation.repo_path)}</span>
                ) : null}
              </div>
            </div>
            <div className="matrix3d-a2a-thread-tools">
              <input
                aria-label="Search selected A2A thread"
                value={threadSearchQuery}
                onChange={(event) => setThreadSearchQuery(event.target.value)}
                placeholder="Search thread…"
              />
              <select
                aria-label="Filter selected A2A thread"
                value={threadFilter}
                onChange={(event) =>
                  setThreadFilter(event.target.value as A2AConversationFilter)
                }
              >
                <option value="all">All</option>
                <option value="orchestrator">Hermes</option>
                <option value="executor">Executor</option>
                <option value="ack">Queued</option>
              </select>
              <button
                type="button"
                disabled={!selectedConversation}
                onClick={() => copyText(selectedConversation?.contextId)}
              >
                Copy ID
              </button>
              <button
                type="button"
                disabled={!selectedConversation?.repo_path}
                onClick={() => copyText(selectedConversation?.repo_path)}
              >
                Copy Repo
              </button>
              {threadQuery.isFetching ? (
                <span className="matrix3d-a2a-thread-state">Sync</span>
              ) : null}
            </div>
          </div>
          <div
            ref={threadRef}
            className="matrix3d-a2a-thread"
            aria-live="polite"
          >
            {filteredMessages.length > 0 ? (
              filteredMessages.map((message, index) => {
                const kind = a2aMessageKind(message.dir)
                return (
                  <div
                    key={`${message.ts ?? index}-${message.dir}-${index}`}
                    className={`matrix3d-a2a-message is-${kind}`}
                    style={
                      kind === 'executor' && selectedConversation?.mode
                        ? ({
                            '--a2a-mode-accent': modeAccent(
                              selectedConversation.mode,
                            ),
                          } as CSSProperties)
                        : undefined
                    }
                  >
                    <div className="matrix3d-a2a-message-meta">
                      <span>
                        {a2aMessageLabel(message, selectedConversation?.mode)}
                      </span>
                      <span>{formatAbsoluteTimestamp(message.ts)}</span>
                    </div>
                    <div className="matrix3d-a2a-bubble">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkBreaks]}
                        components={{
                          a: ({ href, children }) => (
                            <a href={href} target="_blank" rel="noreferrer">
                              {children}
                            </a>
                          ),
                        }}
                      >
                        {message.text || ' '}
                      </ReactMarkdown>
                    </div>
                  </div>
                )
              })
            ) : (
              <div className="matrix3d-a2a-empty">
                {threadQuery.isError
                  ? 'Could not load the selected A2A thread.'
                  : messages.length > 0
                    ? 'No messages match the current thread search/filter.'
                    : selectedContextId
                      ? 'Waiting for messages…'
                      : 'Select a conversation to inspect its thread.'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function Matrix3DScreen() {
  const officeData = useMatrix3DOfficeData()
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [isSidePanelOpen, setIsSidePanelOpen] = useState(false)
  const [bottomMode, setBottomMode] = useState<Matrix3DBottomMode>('agents')
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
  useEffect(() => {
    if (
      selectedAgentId &&
      !cardAgents.some((agent) => agent.id === selectedAgentId)
    ) {
      setSelectedAgentId(null)
      setIsSidePanelOpen(false)
    }
  }, [cardAgents, selectedAgentId])
  const selectedAgent = useMemo<Matrix3DSelectedAgent | null>(() => {
    if (!selectedAgentId) return null
    const card = cardAgents.find((agent) => agent.id === selectedAgentId)
    if (!card) return null
    return {
      card,
      presence: officeData.presence.find(
        (presence) => presence.id === selectedAgentId,
      ),
    }
  }, [cardAgents, officeData.presence, selectedAgentId])
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
    () =>
      officeData.presence.map((presence) => ({
        id: presence.id,
        name: presence.name,
      })),
    [officeData.presence],
  )
  const entries = useMemo(
    () =>
      [
        ...buildLogEntries(agentLogsQuery.data, 'agent', agentMatchers, {
          includeNoise: true,
        }),
        ...buildLogEntries(gatewayLogsQuery.data, 'gateway', agentMatchers, {
          includeNoise: true,
        }),
      ].sort(
        (a, b) =>
          (a.timestampMs ?? Number.NEGATIVE_INFINITY) -
            (b.timestampMs ?? Number.NEGATIVE_INFINITY) ||
          a.time.localeCompare(b.time),
      ),
    [agentLogsQuery.data, agentMatchers, gatewayLogsQuery.data],
  )
  const consoleAgentTabs = useMemo(
    () =>
      officeData.presence
        .filter((presence) =>
          entries.some((entry) => entry.agentKey === presence.id),
        )
        .map((presence) => ({
          id: presence.id,
          label: compactName(presence.name, 0),
        })),
    [entries, officeData.presence],
  )
  const liveSessionCount = useMemo(
    () =>
      officeData.presence.filter((presence) =>
        Boolean(presence.activeSessionKey),
      ).length,
    [officeData.presence],
  )
  const working = cardAgents.filter(
    (agent) => agent.status === 'working',
  ).length
  const errors = cardAgents.filter((agent) => agent.status === 'error').length
  const idle = Math.max(0, cardAgents.length - working - errors)
  const rosterLabel =
    officeData.agentSource === 'live'
      ? 'Active agents'
      : officeData.agentSource === 'roster'
        ? 'Workspace roster'
        : 'Agent roster'
  const rosterSummary =
    officeData.agentSource === 'live'
      ? `${pluralize(cardAgents.length, 'live agent')} · ${working} working · ${errors} error`
      : officeData.agentSource === 'roster'
        ? `${pluralize(cardAgents.length, 'local profile')} · ${pluralize(liveSessionCount, 'live session')} · ${working} working`
        : '0 agents'
  const selectedEntries = useMemo(
    () =>
      selectedAgent
        ? entries
            .filter((entry) => entry.agentKey === selectedAgent.card.id)
            .slice(-5)
            .reverse()
        : [],
    [entries, selectedAgent],
  )

  return (
    <div className="matrix3d-office-page">
      <div className="matrix3d-main">
        <section
          className="matrix3d-canvas-zone"
          aria-label="Matrix3D Office viewport"
        >
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
            <span style={{ color: 'rgba(0,255,65,.6)' }}>
              {working} working
            </span>
            <span className="matrix3d-sep">·</span>
            <span>{idle} idle</span>
            <span className="matrix3d-sep">·</span>
            <span>{errors} error</span>
            <span style={{ marginLeft: 'auto', opacity: 0.4 }}>
              active · drag · scroll · space+drag · dbl-click
            </span>
          </div>
        </section>

        <section
          className={`matrix3d-bottom-zone${
            isSidePanelOpen && bottomMode === 'agents'
              ? ''
              : ' is-side-collapsed'
          }`}
          aria-label="Matrix3D Office agents and console"
        >
          <div className="matrix3d-bottom-main">
            <div className="matrix3d-roster">
              <div className="matrix3d-roster-bar">
                <div className="matrix3d-roster-pulse" />
                <span className="matrix3d-roster-label">{rosterLabel}</span>
                <span className="matrix3d-roster-summary">{rosterSummary}</span>
                <div className="matrix3d-roster-tabs" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={bottomMode === 'agents'}
                    className={`matrix3d-roster-tab${
                      bottomMode === 'agents' ? ' is-on' : ''
                    }`}
                    onClick={() => setBottomMode('agents')}
                  >
                    Active Agents
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={bottomMode === 'a2a'}
                    className={`matrix3d-roster-tab${
                      bottomMode === 'a2a' ? ' is-on' : ''
                    }`}
                    onClick={() => {
                      setBottomMode('a2a')
                      setSelectedAgentId(null)
                      setIsSidePanelOpen(false)
                    }}
                  >
                    <NetworkGlyph size={11} />
                    A2A Fleet
                  </button>
                </div>
              </div>
              {bottomMode === 'agents' && cardAgents.length > 0 ? (
                <div className="matrix3d-roster-rail">
                  {cardAgents.map((agent) => (
                    <Matrix3DAgentCard
                      key={agent.id}
                      agent={agent}
                      selected={agent.id === selectedAgent?.card.id}
                      onClick={() => {
                        setBottomMode('agents')
                        setSelectedAgentId(agent.id)
                        setIsSidePanelOpen(true)
                      }}
                    />
                  ))}
                </div>
              ) : bottomMode === 'agents' ? (
                <div className="matrix3d-roster-empty">
                  No Hermes profiles or live sessions returned by the workspace
                  yet.
                </div>
              ) : null}
            </div>
            {bottomMode === 'agents' ? (
              <Matrix3DConsole
                entries={entries}
                isLoading={
                  agentLogsQuery.isLoading || gatewayLogsQuery.isLoading
                }
                isError={Boolean(
                  agentLogsQuery.isError && gatewayLogsQuery.isError,
                )}
                agentTabs={consoleAgentTabs}
              />
            ) : (
              <A2AFleetTab />
            )}
          </div>
          <aside
            className="matrix3d-side-panel"
            aria-label="Selected agent details"
          >
            {selectedAgent ? (
              <>
                <div
                  className="matrix3d-side-accent"
                  style={{ background: selectedAgent.card.color }}
                />
                <div className="matrix3d-side-hdr">
                  <div
                    className="matrix3d-side-avatar"
                    style={{
                      borderColor: selectedAgent.card.color,
                      color: selectedAgent.card.color,
                    }}
                  >
                    <div className="matrix3d-side-avatar-glyph">
                      {selectedAgent.card.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div
                      className="matrix3d-side-avatar-pulse"
                      style={{
                        background: selectedAgent.card.color,
                        boxShadow: `0 0 6px ${selectedAgent.card.color}`,
                      }}
                    />
                  </div>
                  <div className="matrix3d-side-title">
                    <div className="matrix3d-side-name">
                      {selectedAgent.card.name}
                    </div>
                    <div
                      className="matrix3d-side-badge"
                      style={{
                        background: `${selectedAgent.card.color}15`,
                        color: selectedAgent.card.color,
                        borderColor: `${selectedAgent.card.color}35`,
                      }}
                    >
                      {selectedAgent.presence?.provider || 'Hermes'} ·{' '}
                      {selectedAgent.card.role}
                    </div>
                    <div className="matrix3d-side-model">
                      {formatPanelValue(selectedAgent.presence?.model)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="matrix3d-side-close"
                    aria-label="Close agent details"
                    onClick={() => {
                      setSelectedAgentId(null)
                      setIsSidePanelOpen(false)
                    }}
                  >
                    ×
                  </button>
                </div>
                <div className="matrix3d-side-body">
                  <div className="matrix3d-side-stats">
                    {[
                      ['Sessions', selectedAgent.presence?.sessionCount ?? 0],
                      ['Tasks', selectedAgent.presence?.assignedTaskCount ?? 0],
                      ['Tier', `T${selectedAgent.card.tier}`],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="matrix3d-side-stat">
                        <div
                          className="matrix3d-side-stat-v"
                          style={{ color: selectedAgent.card.color }}
                        >
                          {value}
                        </div>
                        <div className="matrix3d-side-stat-l">{label}</div>
                      </div>
                    ))}
                  </div>
                  <div className="matrix3d-side-sec">
                    <div className="matrix3d-side-sec-lbl">Current Task</div>
                    <div className="matrix3d-side-task">
                      {selectedAgent.presence?.lastActivity ||
                        selectedAgent.card.bubble}
                    </div>
                  </div>
                  <div className="matrix3d-side-sec">
                    <div className="matrix3d-side-sec-lbl">Recent Activity</div>
                    <div className="matrix3d-side-tl">
                      {selectedEntries.length > 0 ? (
                        selectedEntries.map((entry) => (
                          <div key={entry.id} className="matrix3d-side-tl-row">
                            <div
                              className="matrix3d-side-tl-dot"
                              style={{
                                background: entry.color,
                                boxShadow: `0 0 5px ${entry.color}70`,
                              }}
                            />
                            <div className="matrix3d-side-tl-msg">
                              {entry.message}
                            </div>
                            <div className="matrix3d-side-tl-ts">
                              {entry.time}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="matrix3d-side-empty">
                          No recent agent-specific activity.
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="matrix3d-side-sec">
                    <div className="matrix3d-side-sec-lbl">Profile Details</div>
                    <div className="matrix3d-side-details">
                      <div>
                        <span>Source</span>
                        <b>{selectedAgent.presence?.source || 'workspace'}</b>
                      </div>
                      <div>
                        <span>Status</span>
                        <b>
                          {selectedAgent.presence?.effectiveStatus ||
                            selectedAgent.card.status}
                        </b>
                      </div>
                      <div>
                        <span>Roster</span>
                        <b>
                          {selectedAgent.presence?.rosterStatus || 'unknown'}
                        </b>
                      </div>
                      <div>
                        <span>Active</span>
                        <b>
                          {selectedAgent.presence?.activeSessionKey
                            ? 'yes'
                            : 'no'}
                        </b>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : null}
          </aside>
        </section>
      </div>
    </div>
  )
}
