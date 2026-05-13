/**
 * settings-screen.tsx — Matrix-themed Settings shell (P1 scaffold).
 *
 * Layout: sidebar tree (left) + content panel (right).
 * Active section persisted to localStorage key `hermes.settings.section`.
 * All section bodies are stubs for P1; content filled in P2–P7.
 */

import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import '@/styles/matrix-skills.css'
import '@/styles/matrix-settings.css'
import { useQuery } from '@tanstack/react-query'
import { SidebarTree } from './components/sidebar-tree'
import { SaveBar } from './components/save-bar'
import { settingsSaver } from './lib/saver'
import { flattenConfig } from './lib/flatten-config'
import type { SidebarGroup } from './components/sidebar-tree'
import { useDirtyCount, useSettingsStore } from '@/stores/settings-store'
import { getConfig } from '@/lib/hermes-client'

// ── Lazy section components ───────────────────────────────────────────────
const SectionWorkspace = lazy(() => import('./sections/section-workspace'))
const SectionAccount = lazy(() => import('./sections/section-account'))
const SectionAppearance = lazy(() => import('./sections/section-appearance'))
const SectionNotifications = lazy(() => import('./sections/section-notifications'))
const SectionProvider = lazy(() => import('./sections/section-provider'))
const SectionModelRegistry = lazy(() => import('./sections/section-model-registry'))
const SectionAgentRuntime = lazy(() => import('./sections/section-agent-runtime'))
const SectionMemoryWiki = lazy(() => import('./sections/section-memory-wiki'))
const SectionSkills = lazy(() => import('./sections/section-skills'))
const SectionMcpServers = lazy(() => import('./sections/section-mcp-servers'))
const SectionMcpRegistered = lazy(() => import('./sections/section-mcp-registered'))
const SectionStorage = lazy(() => import('./sections/section-storage'))
const SectionPrivacy = lazy(() => import('./sections/section-privacy'))
const SectionTelemetry = lazy(() => import('./sections/section-telemetry'))
const SectionApiKeys = lazy(() => import('./sections/section-api-keys'))
const SectionNetwork = lazy(() => import('./sections/section-network'))
const SectionPerformance = lazy(() => import('./sections/section-performance'))
const SectionShortcuts = lazy(() => import('./sections/section-shortcuts'))
const SectionAdvanced = lazy(() => import('./sections/section-advanced'))
const SectionDanger = lazy(() => import('./sections/section-danger'))

const SECTION_COMPONENTS: Partial<Record<string, React.ComponentType>> = {
  workspace: SectionWorkspace,
  account: SectionAccount,
  appearance: SectionAppearance,
  notifications: SectionNotifications,
  provider: SectionProvider,
  'model-registry': SectionModelRegistry,
  'agent-runtime': SectionAgentRuntime,
  'memory-wiki': SectionMemoryWiki,
  skills: SectionSkills,
  'mcp-servers': SectionMcpServers,
  'mcp-registered': SectionMcpRegistered,
  storage: SectionStorage,
  privacy: SectionPrivacy,
  telemetry: SectionTelemetry,
  'api-keys': SectionApiKeys,
  network: SectionNetwork,
  performance: SectionPerformance,
  shortcuts: SectionShortcuts,
  advanced: SectionAdvanced,
  danger: SectionDanger,
}

// ── Section registry ──────────────────────────────────────────────────────

type SectionDef = {
  id: string
  label: string
  group: string
  p: number
}

const SECTIONS: Array<SectionDef> = [
  // General
  { id: 'workspace', label: 'Workspace', group: 'General', p: 2 },
  { id: 'account', label: 'Account', group: 'General', p: 2 },
  { id: 'appearance', label: 'Appearance', group: 'General', p: 2 },
  { id: 'notifications', label: 'Notifications', group: 'General', p: 3 },
  // Models
  { id: 'provider', label: 'Provider', group: 'Models', p: 2 },
  { id: 'model-registry', label: 'Model Registry', group: 'Models', p: 3 },
  // Agent
  { id: 'agent-runtime', label: 'Runtime', group: 'Agent', p: 3 },
  // Memory
  { id: 'memory-wiki', label: 'Memory & Wiki', group: 'Memory', p: 4 },
  // Skills
  { id: 'skills', label: 'Skills', group: 'Skills', p: 4 },
  // MCP
  { id: 'mcp-servers', label: 'Servers', group: 'MCP', p: 5 },
  { id: 'mcp-registered', label: 'Registered', group: 'MCP', p: 5 },
  // System
  { id: 'storage', label: 'Storage', group: 'System', p: 5 },
  { id: 'privacy', label: 'Privacy', group: 'System', p: 5 },
  { id: 'telemetry', label: 'Telemetry', group: 'System', p: 6 },
  { id: 'api-keys', label: 'API Keys', group: 'System', p: 2 },
  { id: 'network', label: 'Network', group: 'System', p: 6 },
  { id: 'performance', label: 'Performance', group: 'System', p: 6 },
  // Other
  { id: 'shortcuts', label: 'Shortcuts', group: 'Shortcuts', p: 6 },
  { id: 'advanced', label: 'Advanced', group: 'Advanced', p: 7 },
  { id: 'danger', label: 'Danger Zone', group: 'Danger', p: 7 },
]

const SECTION_MAP = new Map(SECTIONS.map((s) => [s.id, s]))

const DEFAULT_SECTION = 'workspace'
const LS_KEY = 'hermes.settings.section'

// ── Sidebar groups ────────────────────────────────────────────────────────

function buildSidebarGroups(dirty: Set<string>): Array<SidebarGroup> {
  const groupMap = new Map<string, SidebarGroup>()
  for (const s of SECTIONS) {
    if (!groupMap.has(s.group)) {
      groupMap.set(s.group, { label: s.group, items: [] })
    }
    groupMap.get(s.group)!.items.push({
      id: s.id,
      label: s.label,
      dirty: dirty.has(s.id),
    })
  }
  return Array.from(groupMap.values())
}

// ── Stub section component ────────────────────────────────────────────────

function StubSection({ section }: { section: SectionDef }) {
  return (
    <div>
      <div className="section-head">
        <div>
          <h2>{section.label}</h2>
          <div className="desc">Coming in P{section.p}</div>
        </div>
        <div className="meta">Section · <b>{section.id}</b></div>
      </div>
      <div className="card">
        <h3>{section.label}</h3>
        <div style={{ padding: '18px', font: '500 12px var(--m-font-mono)', color: 'var(--m-text-faint)' }}>
          Content for this section will be implemented in P{section.p}.
        </div>
      </div>
    </div>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────

function IconCog() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <circle cx="8" cy="8" r="2.5"/>
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M3.6 12.4l1.4-1.4M11 5l1.4-1.4" strokeLinecap="round"/>
    </svg>
  )
}

// ── SettingsScreen ────────────────────────────────────────────────────────

export function SettingsScreen() {
  const dirty = useSettingsStore((s) => s.dirty)
  const reset = useSettingsStore((s) => s.reset)
  const save = useSettingsStore((s) => s.save)
  const loaded = useSettingsStore((s) => s.loaded)
  const dirtyCount = useDirtyCount()
  const seedOnceRef = useRef(false)

  const [activeId, setActiveId] = useState<string>(() => {
    try {
      return localStorage.getItem(LS_KEY) ?? DEFAULT_SECTION
    } catch {
      return DEFAULT_SECTION
    }
  })

  // Fetch server config and seed store on mount
  const { data: serverConfig } = useQuery({
    queryKey: ['config'],
    queryFn: getConfig,
    staleTime: 60_000,
  })

  useEffect(() => {
    if (!serverConfig || seedOnceRef.current || loaded) return
    seedOnceRef.current = true
    const flat = flattenConfig(serverConfig as Record<string, unknown>)
    useSettingsStore.getState().load(flat)
  }, [serverConfig, loaded])

  // Persist active section to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, activeId)
    } catch {
      // ignore
    }
  }, [activeId])

  const activeSection = SECTION_MAP.get(activeId) ?? SECTION_MAP.get(DEFAULT_SECTION)!

  const sidebarGroups = buildSidebarGroups(dirty)

  function handleSave() {
    void save(settingsSaver)
  }

  function handleExport() {
    const committed = useSettingsStore.getState().committed
    const blob = new Blob([JSON.stringify(committed, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'hermes-settings.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="settings-shell" data-screen="settings">
      {/* Sidebar tree */}
      <SidebarTree
        groups={sidebarGroups}
        activeId={activeId}
        onSelect={setActiveId}
      />

      {/* Main panel */}
      <div className="main">
        {/* Topbar */}
        <div className="topbar">
          <h1>
            <IconCog />
            <span className="crumb">Hermes</span>
            <span className="sep">·</span>
            <span className="cur">Settings</span>
            <span className="sep">·</span>
            <span className="crumb">{activeSection.label}</span>
          </h1>
          <div className="stats">
            {dirtyCount > 0 ? (
              <span className="warn"><b>{dirtyCount}</b> unsaved</span>
            ) : (
              <span className="ok">Saved</span>
            )}
            <div className="sep" />
            <span><b>{SECTIONS.length}</b> sections</span>
          </div>
        </div>

        {/* Content */}
        <div className="body">
          {/* content scrollable area fills the 1fr row */}
          <div className="content">
            {(() => {
              const SectionComponent = SECTION_COMPONENTS[activeId]
              if (SectionComponent) {
                return (
                  <Suspense fallback={<div style={{ padding: '24px', color: 'var(--m-text-faint)' }}>Loading…</div>}>
                    <SectionComponent />
                  </Suspense>
                )
              }
              return <StubSection section={activeSection} />
            })()}
          </div>
        </div>

        {/* Save bar */}
        <SaveBar
          dirtyCount={dirtyCount}
          onSave={handleSave}
          onReset={reset}
          onExport={handleExport}
        />
      </div>
    </div>
  )
}
