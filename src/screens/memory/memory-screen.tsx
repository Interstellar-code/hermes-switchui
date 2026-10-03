/**
 * MemoryScreen — Matrix-themed Memory & Matrix Wiki shell (MEM-01).
 *
 * Tabs: Agent Memory | Browse | Wiki | Map. Settings is a gear-opened view;
 * Chat is a side drawer reachable from every tab. Browse/Map need
 * matrix-memory and show disabled (with the reason) when it is unavailable.
 * Active view persisted to localStorage via useMemoryScreenStore.
 */

import { Fragment, Suspense, lazy, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { UnifiedSearch } from './components/unified-search'
import type { MemoryTab } from '@/stores/memory-screen-store'
import type { MnemosyneHealth } from '@/server/mnemosyne-browser'
import { BUILTIN_AGENTS } from '@/lib/builtin-agents'
import { useFocusTrap } from '@/components/ui/use-focus-trap'
import {
  DEFAULT_MEMORY_PROFILE,
  useMemoryScreenStore,
} from '@/stores/memory-screen-store'
import '@/styles/matrix-memory.css'
import '@/styles/matrix-profiles.css'

// Matrix Memory (mnemosyne) backs the Map tab. `/api/memory/stats` reports
// whether the profile's mnemosyne DB exists — i.e. matrix-memory is
// configured and activated.
type MnemosyneAvailability = {
  db: { exists: boolean }
  counts: { total: number; triples: number }
  lastWriteAt?: string | null
  health?: MnemosyneHealth
}

async function fetchMnemosyneAvailability(
  profile: string,
): Promise<MnemosyneAvailability> {
  const res = await fetch(
    `/api/memory/stats?profile=${encodeURIComponent(profile)}`,
  )
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return res.json() as Promise<MnemosyneAvailability>
}

type MemoryProfiles = {
  profiles?: Array<{ name: string; hasMatrixMemory: boolean }>
}

async function fetchMemoryProfiles(): Promise<MemoryProfiles> {
  const res = await fetch('/api/memory/profiles')
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return res.json() as Promise<MemoryProfiles>
}

const AgentMemoryTab = lazy(async () => {
  const m = await import('./components/agent-memory-tab')
  return { default: m.AgentMemoryTab }
})

const BrowseTab = lazy(async () => {
  const m = await import('./components/browse-tab')
  return { default: m.BrowseTab }
})

const WikiTab = lazy(async () => {
  const m = await import('./components/wiki-tab')
  return { default: m.WikiTab }
})

const MemoryMap = lazy(async () => {
  const m = await import('./components/memory-map')
  return { default: m.MemoryMap }
})

const SettingsTab = lazy(async () => {
  const m = await import('./components/settings-tab')
  return { default: m.SettingsTab }
})

const ChatTab = lazy(async () => {
  const m = await import('./components/chat-tab')
  return { default: m.ChatTab }
})

// ── icons (inline svg paths — same pattern as mockup) ─────────────────────

function IconMem() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <rect x="2" y="4" width="12" height="8" rx="1.5" />
      <path
        d="M5 4V2M8 4V2M11 4V2M5 12v2M8 12v2M11 12v2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconBrowse() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <rect x="2.25" y="3" width="11.5" height="10" rx="1.5" />
      <path d="M5 6h6M5 8.5h4M5 11h3" strokeLinecap="round" />
    </svg>
  )
}

function IconBook() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path
        d="M3 2h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"
        strokeLinecap="round"
      />
      <path d="M6 2v12M9 5h1M9 8h1" strokeLinecap="round" />
    </svg>
  )
}

function IconMap() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="2" />
      <circle cx="3" cy="3" r="1.5" />
      <circle cx="13" cy="3" r="1.5" />
      <circle cx="3" cy="13" r="1.5" />
      <circle cx="13" cy="13" r="1.5" />
      <path
        d="M4.1 4.1l2.5 2.5M11.9 4.1l-2.5 2.5M4.1 11.9l2.5-2.5M11.9 11.9l-2.5-2.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconCog() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="2.5" />
      <path
        d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M3.6 12.4l1.4-1.4M11 5l1.4-1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconChat() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path
        d="M2 2h12v9H9l-3 3v-3H2V2z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ── tab definitions ───────────────────────────────────────────────────────

type TabId = 'memory' | 'browse' | 'wiki' | 'map'

type TabDef = {
  id: TabId
  label: string
  icon: React.ReactNode
}

const TABS: Array<TabDef> = [
  { id: 'memory', label: 'Agent Memory', icon: <IconMem /> },
  { id: 'browse', label: 'Browse', icon: <IconBrowse /> },
  { id: 'wiki', label: 'Wiki', icon: <IconBook /> },
  { id: 'map', label: 'Map', icon: <IconMap /> },
]

const GATED_REASON = 'Needs matrix-memory: no memories in the Mnemosyne DB yet'

/**
 * WAI-ARIA tabs keyboard model: Arrow keys wrap over enabled tabs, Home/End
 * jump to the ends. Returns null for keys it does not handle.
 */
export function nextTabId<T>(
  enabled: Array<T>,
  current: T,
  key: string,
): T | null {
  if (enabled.length === 0) return null
  const i = Math.max(0, enabled.indexOf(current))
  switch (key) {
    case 'ArrowRight':
      return enabled[(i + 1) % enabled.length]
    case 'ArrowLeft':
      return enabled[(i - 1 + enabled.length) % enabled.length]
    case 'Home':
      return enabled[0]
    case 'End':
      return enabled[enabled.length - 1]
    default:
      return null
  }
}

function formatRelative(iso: string): string {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`
  return `${Math.round(mins / (60 * 24))}d ago`
}

const fmt = (n: number) => new Intl.NumberFormat().format(n)

const STALE_CONSOLIDATION_MS = 3 * 24 * 60 * 60_000

/** Compact consolidation/embedding health items for the header stat line. */
export function healthItems(
  h: MnemosyneHealth | undefined,
  now = Date.now(),
): Array<{ key: string; text: string; title: string; warn: boolean }> {
  if (!h) return []
  const items = []
  const lc = h.lastConsolidation
  if (lc?.at) {
    const stale = now - Date.parse(lc.at) > STALE_CONSOLIDATION_MS
    items.push({
      key: 'consolidation',
      text: `consolidated ${formatRelative(lc.at)}${lc.method ? ` (${lc.method})` : ''}`,
      title: `Last sleep pass folded ${lc.items ?? '?'} working memories into summaries. llm = host-LLM summary; aaak = lossy fallback compression.${stale ? ' Over 3 days ago — auto-sleep may not be running.' : ''}`,
      warn: stale || lc.method === 'aaak',
    })
  }
  if (h.backlog) {
    const { rows, sessions, backoff } = h.backlog
    items.push({
      key: 'backlog',
      text: `backlog ${fmt(rows)} in ${fmt(sessions)} sessions`,
      title: `Unconsolidated, unpinned working memories old enough for the next sleep sweep.${backoff ? ` ${fmt(backoff)} more are in the 6h retry backoff after a failed summary.` : ''}`,
      warn: false,
    })
  }
  if (h.embeddings && h.embeddings.total > 0) {
    const pct = (h.embeddings.covered / h.embeddings.total) * 100
    items.push({
      key: 'embeddings',
      text: `embeddings ${Math.floor(pct)}%`,
      title: `${fmt(h.embeddings.covered)} of ${fmt(h.embeddings.total)} working memories have a vector embedding; the rest are keyword-only in recall.`,
      warn: pct < 95,
    })
  }
  return items
}

// ── MemoryScreen ──────────────────────────────────────────────────────────

export function MemoryScreen() {
  const { activeTab, setActiveTab, profile, setProfile } =
    useMemoryScreenStore()
  const [chatOpen, setChatOpen] = useState(false)
  // Mount the chat once opened and keep it (hidden) so the conversation
  // survives closing the drawer, e.g. after a source-link click.
  const [chatMounted, setChatMounted] = useState(false)
  const openChat = () => {
    setChatMounted(true)
    setChatOpen(true)
  }
  // Where the settings gear returns to.
  const lastTabRef = useRef<MemoryTab>('memory')
  if (activeTab !== 'settings' && activeTab !== 'chat')
    lastTabRef.current = activeTab
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({})

  const agentCount = BUILTIN_AGENTS.length

  // Matrix-memory is "configured + activated" when its mnemosyne DB exists AND
  // actually holds memories. The Map and Browse tabs both depend on it.
  const { data: mnemo } = useQuery({
    queryKey: ['memory', 'availability', profile],
    queryFn: () => fetchMnemosyneAvailability(profile),
    staleTime: 60_000,
  })
  const { data: profileData } = useQuery({
    queryKey: ['memory', 'profiles'],
    queryFn: fetchMemoryProfiles,
    staleTime: 60_000,
  })
  const profiles = profileData?.profiles ?? []
  // A persisted profile that no longer exists falls back to the default.
  useEffect(() => {
    if (profiles.length > 0 && !profiles.some((p) => p.name === profile))
      setProfile(
        profiles.some((p) => p.name === DEFAULT_MEMORY_PROFILE)
          ? DEFAULT_MEMORY_PROFILE
          : profiles[0].name,
      )
  }, [profiles, profile, setProfile])
  const matrixMemoryActive = mnemo?.db.exists === true && mnemo.counts.total > 0
  const isGatedTab = (t: MemoryTab) => t === 'map' || t === 'browse'
  const isDisabled = (t: MemoryTab) => isGatedTab(t) && !matrixMemoryActive
  const enabledTabs = TABS.map((t) => t.id).filter((t) => !isDisabled(t))

  // Chat used to be a tab; a persisted 'chat' opens the drawer instead.
  useEffect(() => {
    if (activeTab === 'chat') {
      setChatMounted(true)
      setChatOpen(true)
      setActiveTab('memory')
    }
  }, [activeTab, setActiveTab])

  // If a matrix-memory tab is persisted-active but it's unavailable, fall back.
  useEffect(() => {
    if (mnemo && isDisabled(activeTab)) setActiveTab('memory')
  }, [activeTab, mnemo, matrixMemoryActive, setActiveTab])

  const chatRef = useRef<HTMLElement>(null)
  useFocusTrap(chatOpen, chatRef, () => setChatOpen(false))

  function onTabKeyDown(e: React.KeyboardEvent, current: TabId) {
    const next = nextTabId(enabledTabs, current, e.key)
    if (!next) return
    e.preventDefault()
    setActiveTab(next)
    tabRefs.current[next]?.focus()
  }

  const showSettings = activeTab === 'settings'
  const selectedTab = TABS.some((t) => t.id === activeTab) ? activeTab : null
  const fallback = <div className="mem-loading">Loading…</div>

  return (
    <div data-screen="memory" className="mem-shell">
      {/* Header */}
      <div className="mem-header">
        <h1>Memory</h1>
        <div className="mem-header-stats">
          {matrixMemoryActive ? (
            <>
              <span>
                <b>{fmt(mnemo.counts.total)}</b> memories
              </span>
              <div className="sep" />
              <span>
                <b>{fmt(mnemo.counts.triples)}</b> triples
              </span>
              {mnemo.lastWriteAt && (
                <>
                  <div className="sep" />
                  <span>last write {formatRelative(mnemo.lastWriteAt)}</span>
                </>
              )}
              {healthItems(mnemo.health).map((item) => (
                <Fragment key={item.key}>
                  <div className="sep" />
                  <span
                    title={item.title}
                    className={item.warn ? 'mem-header-warn' : undefined}
                  >
                    {item.text}
                  </span>
                </Fragment>
              ))}
            </>
          ) : (
            <span>
              <b>{agentCount}</b> agents
            </span>
          )}
        </div>
        <div className="mem-header-spacer" />
        <UnifiedSearch />
        <div className="mem-header-actions">
          <select
            className="mem-btn"
            aria-label="Memory profile"
            title="Profile this page reads"
            value={profile}
            onChange={(e) => setProfile(e.target.value)}
          >
            {(profiles.some((p) => p.name === profile)
              ? profiles
              : [{ name: profile, hasMatrixMemory: true }, ...profiles]
            ).map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
                {p.hasMatrixMemory ? '' : ' (no matrix-memory)'}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="mem-btn"
            aria-expanded={chatOpen}
            aria-controls={chatOpen ? 'mem-chat-drawer' : undefined}
            onClick={openChat}
          >
            <IconChat />
            Chat
          </button>
          <button
            type="button"
            className={`mem-btn ${showSettings ? 'is-primary' : ''}`}
            aria-label="Memory settings"
            title="Memory settings"
            aria-pressed={showSettings}
            onClick={() =>
              setActiveTab(showSettings ? lastTabRef.current : 'settings')
            }
          >
            <IconCog />
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="mem-tabbar" role="tablist" aria-label="Memory views">
        {TABS.map((t) => {
          const disabled = isDisabled(t.id)
          const selected = selectedTab === t.id
          const focusable =
            selected || (!selectedTab && t.id === enabledTabs[0])
          return (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el
              }}
              id={`mem-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls="mem-panel"
              aria-disabled={disabled || undefined}
              tabIndex={focusable ? 0 : -1}
              title={disabled ? GATED_REASON : undefined}
              aria-describedby={disabled ? 'mem-gated-reason' : undefined}
              className={`mem-tab ${selected ? 'is-active' : ''} ${disabled ? 'is-disabled' : ''}`}
              onClick={() => {
                if (!disabled) setActiveTab(t.id)
              }}
              onKeyDown={(e) => onTabKeyDown(e, t.id)}
            >
              {t.icon}
              {t.label}
            </button>
          )
        })}
        <div className="mem-tabbar-spacer" />
        <span id="mem-gated-reason" className="sr-only">
          {GATED_REASON}
        </span>
      </div>

      {/* Body */}
      <div
        id="mem-panel"
        className="mem-body"
        role={selectedTab ? 'tabpanel' : 'region'}
        aria-labelledby={selectedTab ? `mem-tab-${selectedTab}` : undefined}
        aria-label={showSettings ? 'Memory settings' : undefined}
      >
        {activeTab === 'memory' && (
          <Suspense fallback={fallback}>
            <AgentMemoryTab />
          </Suspense>
        )}
        {activeTab === 'browse' && matrixMemoryActive && (
          <Suspense fallback={fallback}>
            <BrowseTab />
          </Suspense>
        )}
        {activeTab === 'wiki' && (
          <Suspense fallback={fallback}>
            <WikiTab />
          </Suspense>
        )}
        {activeTab === 'map' && matrixMemoryActive && (
          <Suspense fallback={fallback}>
            <MemoryMap />
          </Suspense>
        )}
        {showSettings && (
          <Suspense fallback={fallback}>
            <SettingsTab />
          </Suspense>
        )}
      </div>

      {/* Chat drawer — reachable from every tab */}
      {chatMounted && (
        <>
          {chatOpen && (
            <div
              className="pf-drawer-backdrop"
              onClick={() => setChatOpen(false)}
            />
          )}
          <aside
            hidden={!chatOpen}
            id="mem-chat-drawer"
            ref={chatRef}
            className="pf-drawer is-open mem-chat-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Chat with your memory"
          >
            <div className="pf-drawer-header">
              <div className="pf-drawer-name">Chat with memory</div>
              <button
                type="button"
                className="pf-drawer-close"
                onClick={() => setChatOpen(false)}
                aria-label="Close chat"
              >
                <svg
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <path d="M2 2l10 10M12 2L2 12" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <Suspense fallback={fallback}>
              <ChatTab onNavigate={() => setChatOpen(false)} />
            </Suspense>
          </aside>
        </>
      )}
    </div>
  )
}
