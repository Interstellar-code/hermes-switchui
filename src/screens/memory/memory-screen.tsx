/**
 * MemoryScreen — Matrix-themed Memory & Wiki shell (MEM-01).
 *
 * Tabs: Agent Memory (P3) | Wiki (P4) | Graph (P4) | Settings (P5) | Chat with Wiki (P5)
 * Active tab persisted to localStorage via useMemoryScreenStore.
 */

import { lazy, Suspense } from 'react'
import { BUILTIN_AGENTS } from '@/lib/builtin-agents'
import { useMemoryScreenStore } from '@/stores/memory-screen-store'
import type { MemoryTab } from '@/stores/memory-screen-store'
import '@/styles/matrix-memory.css'

const AgentMemoryTab = lazy(async () => {
  const m = await import('./components/agent-memory-tab')
  return { default: m.AgentMemoryTab }
})

const WikiTab = lazy(async () => {
  const m = await import('./components/wiki-tab')
  return { default: m.WikiTab }
})

const GraphTab = lazy(async () => {
  const m = await import('./components/graph-tab')
  return { default: m.GraphTab }
})

// ── icons (inline svg paths — same pattern as mockup) ─────────────────────

function IconMem() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="2" y="4" width="12" height="8" rx="1.5"/>
      <path d="M5 4V2M8 4V2M11 4V2M5 12v2M8 12v2M11 12v2" strokeLinecap="round"/>
    </svg>
  )
}

function IconBook() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M3 2h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" strokeLinecap="round"/>
      <path d="M6 2v12M9 5h1M9 8h1" strokeLinecap="round"/>
    </svg>
  )
}

function IconGraph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="8" cy="8" r="2"/>
      <circle cx="3" cy="3" r="1.5"/>
      <circle cx="13" cy="3" r="1.5"/>
      <circle cx="3" cy="13" r="1.5"/>
      <circle cx="13" cy="13" r="1.5"/>
      <path d="M4.1 4.1l2.5 2.5M11.9 4.1l-2.5 2.5M4.1 11.9l2.5-2.5M11.9 11.9l-2.5-2.5" strokeLinecap="round"/>
    </svg>
  )
}

function IconCog() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="8" cy="8" r="2.5"/>
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M3.6 12.4l1.4-1.4M11 5l1.4-1.4" strokeLinecap="round"/>
    </svg>
  )
}

function IconChat() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M2 2h12v9H9l-3 3v-3H2V2z" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

// ── stub placeholder for unimplemented tabs ───────────────────────────────

function StubTab({ label, phase }: { label: string; phase: string }) {
  return (
    <div className="mem-stub">
      <IconBook />
      <span>{label}</span>
      <span className="mem-stub-badge">Coming in {phase}</span>
    </div>
  )
}

// ── tab definitions ───────────────────────────────────────────────────────

type TabDef = {
  id: MemoryTab
  label: string
  icon: React.ReactNode
}

const TABS: Array<TabDef> = [
  { id: 'memory', label: 'Agent Memory', icon: <IconMem /> },
  { id: 'wiki', label: 'Wiki', icon: <IconBook /> },
  { id: 'graph', label: 'Graph', icon: <IconGraph /> },
  { id: 'settings', label: 'Settings', icon: <IconCog /> },
  { id: 'chat', label: 'Chat with Wiki', icon: <IconChat /> },
]

// ── MemoryScreen ──────────────────────────────────────────────────────────

export function MemoryScreen() {
  const { activeTab, setActiveTab } = useMemoryScreenStore()

  const agentCount = BUILTIN_AGENTS.length

  return (
    <div data-screen="memory" className="mem-shell">
      {/* Header */}
      <div className="mem-header">
        <h1>
          <span className="crumb">Hermes</span>
          <span className="sep">/</span>
          <span className="crumb">Knowledge</span>
          <span className="sep">/</span>
          <span className="cur">Memory &amp; Wiki</span>
        </h1>
        <div className="mem-header-stats">
          <span><b>{agentCount}</b> agents</span>
          <div className="sep" />
          <span>Agent Memory</span>
        </div>
        <div className="mem-header-spacer" />
      </div>

      {/* Tab bar */}
      <div className="mem-tabbar" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={activeTab === t.id}
            className={`mem-tab ${activeTab === t.id ? 'is-active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
        <div className="mem-tabbar-spacer" />
      </div>

      {/* Body */}
      <div className="mem-body" role="tabpanel">
        {activeTab === 'memory' && (
          <Suspense fallback={<div className="mem-loading">Loading…</div>}>
            <AgentMemoryTab />
          </Suspense>
        )}
        {activeTab === 'wiki' && (
          <Suspense fallback={<div className="mem-loading">Loading…</div>}>
            <WikiTab />
          </Suspense>
        )}
        {activeTab === 'graph' && (
          <Suspense fallback={<div className="mem-loading">Loading…</div>}>
            <GraphTab />
          </Suspense>
        )}
        {activeTab === 'settings' && <StubTab label="Settings" phase="P5" />}
        {activeTab === 'chat' && <StubTab label="Chat with Wiki" phase="P5" />}
      </div>

      {/* Footer */}
      <div className="mem-footer">
        <span><b>{agentCount}</b> agents</span>
        <span>·</span>
        <span>$HERMES_HOME/profiles/&lt;agent&gt;/memory/</span>
      </div>
    </div>
  )
}
