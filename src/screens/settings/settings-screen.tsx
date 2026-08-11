/**
 * settings-screen.tsx — Matrix-themed Settings shell.
 *
 * Layout: sidebar tree (left) + content panel (right).
 * Active section persisted to localStorage key `hermes.settings.section`.
 *
 * Sections, their groups and the keys they own all come from
 * `lib/section-registry.ts`; this file only wires the store to the shell.
 */

import { Suspense, useEffect, useRef, useState } from 'react'
import '@/styles/matrix-skills.css'
import '@/styles/matrix-settings.css'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { SidebarTree } from './components/sidebar-tree'
import { SaveBar } from './components/save-bar'
import { settingsSaver } from './lib/saver'
import { flattenConfig } from './lib/flatten-config'
import {
  SECTION_COMPONENTS,
  SECTION_SPECS,
  SECTION_SPEC_BY_ID,
  dirtySectionIds,
} from './lib/section-registry'
import type { SectionSpec } from './lib/section-registry'
import type { SidebarGroup } from './components/sidebar-tree'
import { useDirtyCount, useSettingsStore } from '@/stores/settings-store'
import { getConfig } from '@/lib/hermes-client'
import { toast } from '@/components/ui/toast'

const DEFAULT_SECTION = 'workspace'
const LS_KEY = 'hermes.settings.section'

// ── Sidebar groups ────────────────────────────────────────────────────────

/**
 * The dirty dot used to be `dirty.has(section.id)` — a Set of setting *keys*
 * tested against a section *id*, which can never be true. `dirtySectionIds`
 * maps keys to owning sections instead.
 */
export function buildSidebarGroups(dirty: Set<string>): Array<SidebarGroup> {
  const dirtyIds = dirtySectionIds(dirty)
  const groupMap = new Map<string, SidebarGroup>()
  for (const s of SECTION_SPECS) {
    if (!groupMap.has(s.group)) {
      groupMap.set(s.group, { label: s.group, items: [] })
    }
    groupMap.get(s.group)!.items.push({
      id: s.id,
      label: s.label,
      dirty: dirtyIds.has(s.id),
      ownership: s.ownership,
    })
  }
  return Array.from(groupMap.values())
}

// ── Stub section component ────────────────────────────────────────────────

function StubSection({ section }: { section: SectionSpec }) {
  return (
    <div>
      <div className="section-head">
        <div>
          <h2>{section.label}</h2>
          <div className="desc">This section has no body yet.</div>
        </div>
        <div className="meta">Section · <b>{section.id}</b></div>
      </div>
      <div className="card">
        <h3>{section.label}</h3>
        <div style={{ padding: '18px', font: '500 12px var(--m-font-mono)', color: 'var(--m-text-faint)' }}>
          Content for this section has not been implemented.
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
  const save = useSettingsStore((s) => s.save)
  const saveState = useSettingsStore((s) => s.saveState)
  const dirtyCount = useDirtyCount()

  /**
   * Holds the last server snapshot handed to `seed()`. The old code guarded on
   * the store's `loaded` flag, which seven sections' mount effects also set —
   * so a section could mark the store loaded before the fetch resolved and
   * permanently block the real seed.
   */
  const seededRef = useRef<unknown>(undefined)

  const [activeId, setActiveId] = useState<string>(() => {
    try {
      return localStorage.getItem(LS_KEY) ?? DEFAULT_SECTION
    } catch {
      return DEFAULT_SECTION
    }
  })

  // Fetch server config and seed store on mount
  const queryClient = useQueryClient()
  const { data: serverConfig, refetch: refetchConfig } = useQuery({
    queryKey: ['config'],
    queryFn: getConfig,
    staleTime: 60_000,
  })

  async function handleRefresh() {
    // Refresh promises a reload from disk, so it is the one hard reset. A
    // non-forced seed here would silently keep the drafts the user just chose
    // to throw away.
    if (
      useSettingsStore.getState().dirty.size > 0 &&
      !window.confirm('Discard unsaved changes and reload settings from disk?')
    ) {
      return
    }
    const result = await refetchConfig()
    await queryClient.invalidateQueries({ queryKey: ['config', 'raw'] })
    if (result.data) {
      const flat = flattenConfig(result.data)
      seededRef.current = result.data
      useSettingsStore.getState().seed(flat, { force: true })
      toast('Page settings refreshed', { type: 'success' })
    } else {
      toast('Failed to refresh settings', { type: 'error' })
    }
  }

  useEffect(() => {
    // Seeds on first data, and again on every new snapshot from the ['config']
    // query — a self-saving section can invalidate that key and the non-forced
    // seed will fold the new server truth in underneath any live drafts.
    if (!serverConfig || seededRef.current === serverConfig) return
    seededRef.current = serverConfig
    useSettingsStore.getState().seed(flattenConfig(serverConfig))
  }, [serverConfig])

  // Persist active section to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, activeId)
    } catch {
      // ignore
    }
  }, [activeId])

  // Unsaved-changes guard. Scoped to beforeunload only — the router's
  // useBlocker has no precedent in this app and interacts badly with the lazy
  // Suspense boundary below.
  useEffect(() => {
    if (dirtyCount === 0) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirtyCount])

  const activeSection =
    SECTION_SPEC_BY_ID.get(activeId) ?? SECTION_SPEC_BY_ID.get(DEFAULT_SECTION)!

  const sidebarGroups = buildSidebarGroups(dirty)

  function handleSave() {
    void save(settingsSaver).then((outcome) => {
      if (outcome.persisted.length === 0 && outcome.failed.length === 0) return
      if (outcome.failed.length === 0) {
        toast(
          `Saved ${outcome.persisted.length} setting${outcome.persisted.length === 1 ? '' : 's'}`,
          { type: 'success' },
        )
        return
      }
      const reason = outcome.failed[0].reason
      if (outcome.persisted.length > 0) {
        toast(
          `Saved ${outcome.persisted.length}, ${outcome.failed.length} failed: ${reason}`,
          { type: 'warning' },
        )
      } else {
        toast(`Save failed: ${reason}`, { type: 'error' })
      }
    })
  }

  function handleDiscardAll() {
    if (useSettingsStore.getState().dirty.size === 0) return
    useSettingsStore.getState().discardAll()
    toast('Unsaved changes discarded')
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

  function handleImport() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const text = String(reader.result ?? '')
          const parsed: unknown = JSON.parse(text)
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            throw new Error('Expected a JSON object')
          }
          // This used to call load({...committed, ...parsed}) first, which made
          // every imported key equal to committed — so the follow-up set() loop
          // took the else-branch and deleted it from dirty. Import could never
          // save anything.
          const changed = useSettingsStore
            .getState()
            .importValues(parsed as Record<string, unknown>)
          const total = Object.keys(parsed).length
          toast(
            changed === 0
              ? `Imported ${total} settings — none differ from the current values`
              : `Imported ${total} settings · ${changed} changed`,
            { type: changed === 0 ? 'info' : 'success' },
          )
        } catch (err) {
          toast(err instanceof Error ? err.message : 'Import failed', { type: 'error' })
        }
      }
      reader.readAsText(file)
    }
    input.click()
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
            <span><b>{SECTION_SPECS.length}</b> sections</span>
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
          activeOwnership={activeSection.ownership}
          saveState={saveState}
          onSave={handleSave}
          onRefresh={() => { void handleRefresh() }}
          onDiscardAll={handleDiscardAll}
          onExport={handleExport}
          onImport={handleImport}
        />
      </div>
    </div>
  )
}
