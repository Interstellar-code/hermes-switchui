import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/components/ui/toast'
import type { AgentRow } from '../profiles-screen'
import type {
  ProfileDetail,
  AgentUIMetadata,
  McpServerConfig,
  SkillsConfig,
  AgentRuntime,
  MemoryConfig,
  MemoryProvider,
  ProfileConfig,
} from '@/server/profiles-browser'
import { DrawerTabOverview } from './drawer-tab-overview'
import { DrawerTabPersona } from './drawer-tab-persona'
import { DrawerTabSkills } from './drawer-tab-skills'
import { DrawerTabMcp } from './drawer-tab-mcp'
import { DrawerTabMemory } from './drawer-tab-memory'
import { DrawerTabRaw } from './drawer-tab-raw'

type Tab = 'overview' | 'persona' | 'skills' | 'mcp' | 'memory' | 'raw'
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'persona', label: 'Persona' },
  { id: 'skills', label: 'Skills' },
  { id: 'mcp', label: 'MCP' },
  { id: 'memory', label: 'Memory' },
  { id: 'raw', label: 'Raw' },
]

type Props = {
  agent: AgentRow | null
  open: boolean
  onClose: () => void
  onRename?: (agent: AgentRow) => void
  onDelete?: (profileName: string) => void
  onActivate?: (profileName: string) => void
}

async function fetchDetail(name: string): Promise<ProfileDetail> {
  const r = await fetch(`/api/profiles/read?name=${encodeURIComponent(name)}`)
  if (!r.ok) {
    const d = (await r.json().catch(() => ({}))) as { error?: string }
    throw new Error(d.error ?? `Failed to load profile (${r.status})`)
  }
  const d = (await r.json()) as { profile: ProfileDetail }
  return d.profile
}

async function patchProfile(
  name: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const r = await fetch('/api/profiles/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, ...patch }),
  })
  const d = (await r.json().catch(() => ({}))) as { error?: string }
  if (!r.ok || d.error) throw new Error(d.error ?? `Update failed (${r.status})`)
}

function isLegacyProfile(config: ProfileConfig): boolean {
  return !config.agent_ui
}

export function AgentDetailDrawer({
  agent,
  open,
  onClose,
  onRename,
  onDelete,
  onActivate,
}: Props) {
  const [tab, setTab] = useState<Tab>('overview')
  const queryClient = useQueryClient()

  // Reset tab when agent changes
  useEffect(() => {
    if (agent) setTab('overview')
  }, [agent?.id])

  const detailQuery = useQuery({
    queryKey: ['profiles', 'detail', agent?.profileName],
    queryFn: () => fetchDetail(agent!.profileName!),
    enabled: open && !!agent?.profileName,
    staleTime: 15_000,
  })

  const detail = detailQuery.data
  const config = detail?.config ?? {}
  const profileName = agent?.profileName ?? ''

  // Built-in T1/T2 or default → read-only
  const readonly =
    !agent ||
    agent.builtin ||
    agent.profileName === 'default' ||
    agent.tier === 1 ||
    agent.tier === 2

  async function invalidate() {
    await queryClient.invalidateQueries({ queryKey: ['profiles'] })
  }

  async function handleSavePatch(patch: Record<string, unknown>) {
    if (!profileName) return
    try {
      await patchProfile(profileName, patch)
      toast('Agent updated', { type: 'success' })
      await queryClient.invalidateQueries({ queryKey: ['profiles', 'detail', profileName] })
      await invalidate()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Update failed', { type: 'error' })
      throw e
    }
  }

  async function handleUpgradeLegacy() {
    if (!agent) return
    const glyph = agent.name.slice(0, 2).toUpperCase()
    const role = config.description ?? ''
    const patch: Record<string, unknown> = {
      agent_ui: {
        tier: 3,
        glyph,
        role,
        status: 'idle',
        tags: [],
        persona_id: null,
        last_run: null,
      },
    }
    await handleSavePatch(patch)
  }

  // Derived values from config with legacy fallbacks
  const agentUi: AgentUIMetadata = config.agent_ui ?? {}
  const personaId = agentUi.persona_id ?? null
  const systemPrompt = typeof config.system_prompt === 'string' ? config.system_prompt : ''
  const skillDirs: string[] = config.skills?.external_dirs ?? []
  const mcpServers: Record<string, McpServerConfig> = config.mcp_servers ?? {}
  const memoryEnabled: boolean = config.memory?.memory_enabled ?? false
  const memoryProvider: MemoryProvider = config.memory?.provider ?? 'hindsight'
  const maxTurns: number = config.agent?.max_turns ?? 200
  const reasoningEffort: 'low' | 'medium' | 'high' = config.agent?.reasoning_effort ?? 'medium'
  const configPath = detail ? `${detail.path}/config.yaml` : ''

  const legacy = detail ? isLegacyProfile(config) : false

  // Status colors
  const statusColor: Record<string, string> = { active: '#00ff41', idle: '#888', draft: '#f59e0b' }

  if (!open || !agent) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="pf-drawer-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        role="dialog"
        aria-label={`Agent details: ${agent.name}`}
        className="pf-drawer"
      >
        {/* Header */}
        <div className="pf-drawer-header">
          <div className="pf-drawer-glyph">{agent.glyph}</div>
          <div className="pf-drawer-name">{agent.name}</div>
          <div className="pf-drawer-badges">
            {/* Tier badge */}
            <span style={{
              padding: '2px 8px',
              borderRadius: 4,
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '.14em',
              textTransform: 'uppercase',
              fontFamily: 'monospace',
              background: agent.tier === 1 ? '#00ff41' : agent.tier === 2 ? 'rgba(92,138,255,.2)' : 'rgba(0,255,65,.1)',
              color: agent.tier === 1 ? '#000' : agent.tier === 2 ? '#5c8aff' : '#00ff41',
              border: `1px solid ${agent.tier === 1 ? '#00ff41' : agent.tier === 2 ? '#5c8aff' : 'rgba(0,255,65,.3)'}`,
            }}>
              T{agent.tier}
            </span>
            {/* Status dot */}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, fontFamily: 'monospace', color: 'var(--m-text-faint,var(--theme-muted))' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor[agent.status] ?? '#888', display: 'inline-block' }} />
              {agent.status}
            </span>
          </div>
          <button type="button" className="pf-drawer-close" onClick={onClose} aria-label="Close drawer">
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="2" y1="2" x2="12" y2="12"/><line x1="12" y1="2" x2="2" y2="12"/>
            </svg>
          </button>
        </div>

        {/* Tab bar */}
        <div className="pf-drawer-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`pf-drawer-tab${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="pf-drawer-body">
          {detailQuery.isLoading && (
            <div style={{ fontFamily: 'monospace', fontSize: 11, opacity: .5, textTransform: 'uppercase', letterSpacing: '.16em', textAlign: 'center', paddingTop: 40 }}>
              Loading…
            </div>
          )}
          {detailQuery.isError && (
            <div style={{ padding: 16, fontFamily: 'monospace', fontSize: 11, color: 'var(--m-red,#ff4444)' }}>
              Failed to load profile details.{' '}
              <button type="button" className="pf-drawer-action-btn" onClick={() => void detailQuery.refetch()}>
                Retry
              </button>
            </div>
          )}

          {!detailQuery.isLoading && !detailQuery.isError && (
            <>
              {tab === 'overview' && (
                <DrawerTabOverview
                  agent={agent}
                  readonly={readonly}
                  isLegacy={legacy}
                  onSave={(patch) => handleSavePatch(patch as Record<string, unknown>)}
                  onUpgradeLegacy={!readonly ? handleUpgradeLegacy : undefined}
                  onActivate={
                    !readonly && onActivate && !agent.active
                      ? () => { onActivate(profileName); onClose() }
                      : undefined
                  }
                  onRename={
                    !readonly && onRename
                      ? () => { onRename(agent); onClose() }
                      : undefined
                  }
                  onDelete={
                    !readonly && onDelete && agent.tier === 3 && profileName !== 'default'
                      ? () => { onDelete(profileName); onClose() }
                      : undefined
                  }
                />
              )}
              {tab === 'persona' && (
                <DrawerTabPersona
                  agent={agent}
                  personaId={personaId}
                  systemPrompt={systemPrompt}
                  readonly={readonly}
                  onSave={(patch) =>
                    handleSavePatch({
                      system_prompt: patch.system_prompt,
                      agent_ui: patch.agent_ui,
                    })
                  }
                />
              )}
              {tab === 'skills' && (
                <DrawerTabSkills
                  skillDirs={skillDirs}
                  maxTurns={maxTurns}
                  reasoningEffort={reasoningEffort}
                  readonly={readonly}
                  onSave={(patch) => handleSavePatch(patch as Record<string, unknown>)}
                />
              )}
              {tab === 'mcp' && (
                <DrawerTabMcp
                  mcpServers={mcpServers}
                  readonly={readonly}
                  onSave={(patch) => handleSavePatch(patch as Record<string, unknown>)}
                />
              )}
              {tab === 'memory' && (
                <DrawerTabMemory
                  memoryEnabled={memoryEnabled}
                  memoryProvider={memoryProvider}
                  readonly={readonly}
                  onSave={(patch) => handleSavePatch(patch as Record<string, unknown>)}
                />
              )}
              {tab === 'raw' && detail && (
                <DrawerTabRaw
                  config={config}
                  configPath={configPath}
                />
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}
