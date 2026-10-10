/**
 * settings-screen.tsx — Matrix-themed Settings shell.
 *
 * Layout: sidebar tree (left) + content panel (right).
 *
 * The active section lives in the **URL** (`/settings?section=safety`). It used
 * to be `useState` seeded from the localStorage key `hermes.settings.section`,
 * which meant the page could not be linked to, the back button did nothing, and
 * anything wanting to send a user to a section had to write that localStorage
 * key first and hope (`inline-approval-card.tsx` really did that). See
 * `lib/settings-search.ts` for the URL contract and why it is `?section=` and
 * not a `/settings/$section` param route.
 *
 * Sections, their groups and the keys they own all come from
 * `lib/section-registry.ts`; this file only wires the store to the shell.
 */

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import '@/styles/matrix-skills.css'
import '@/styles/matrix-settings.css'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { SidebarTree } from './components/sidebar-tree'
import { SaveBar } from './components/save-bar'
import { UnexposedKeys } from './components/unexposed-keys'
import { settingsSaver } from './lib/saver'
import { flattenConfig } from './lib/flatten-config'
import {
  GROUP_SPECS,
  SECTION_COMPONENTS,
  SECTION_SPECS,
  SECTION_SPEC_BY_ID,
  dirtySectionIds,
  sectionIdsForKey,
} from './lib/section-registry'
import { listKeyMeta } from './lib/key-meta'
import {
  useConfigSchema,
  useRegisterSchemaDefaults,
} from './lib/schema-binding'
import { buildSearchIndex, searchSections } from './lib/search-index'
import { DEFAULT_SECTION } from './lib/settings-search'
import type { SectionSpec } from './lib/section-registry'
import type { SidebarGroup } from './components/sidebar-tree'
import { useDirtyCount, useSettingsStore } from '@/stores/settings-store'
import { valuesEqual } from '@/stores/settings-equal'
import { getConfig } from '@/lib/hermes-client'
import { toast } from '@/components/ui/toast'

export { DEFAULT_SECTION }

// ── Sidebar groups ────────────────────────────────────────────────────────

export type BuildSidebarGroupsOptions = {
  /** Resolved draft. Supplied by the screen; omitting skips the meta flags. */
  draft?: Record<string, unknown>
  /** `SchemaIndex.fields.length` — prefixes the Advanced group's hint. */
  schemaKeyCount?: number
}

/**
 * The dirty dot used to be `dirty.has(section.id)` — a Set of setting *keys*
 * tested against a section *id*, which can never be true. `dirtySectionIds`
 * maps keys to owning sections instead.
 *
 * Board A adds two more per-section flags from the key-meta contract (C1):
 * ◆ off-recommended (draft ≠ `recommended`) and ▲ config issue (draft ≠
 * `required.value`), plus each group's mockup hint. Like the dirty dot, a key
 * flags every section that owns it — same mapping, same rule. An absent draft
 * value counts as differing: an unset key with a recommended value is exactly
 * the case the chip exists to surface.
 */
export function buildSidebarGroups(
  dirty: Set<string>,
  opts?: BuildSidebarGroupsOptions,
): Array<SidebarGroup> {
  const dirtyIds = dirtySectionIds(dirty)

  const offRecIds = new Set<string>()
  const issueIds = new Set<string>()
  if (opts?.draft) {
    for (const meta of listKeyMeta()) {
      const storeKey = `config.${meta.id}`
      const owners = sectionIdsForKey(storeKey)
      if (owners.length === 0) continue
      const value = opts.draft[storeKey]
      if (
        meta.recommended !== undefined &&
        !valuesEqual(value, meta.recommended)
      ) {
        for (const id of owners) offRecIds.add(id)
      }
      if (meta.required && !valuesEqual(value, meta.required.value)) {
        for (const id of owners) issueIds.add(id)
      }
    }
  }

  const groupSpecs = new Map(GROUP_SPECS.map((g) => [g.label, g]))
  const groupMap = new Map<string, SidebarGroup>()
  for (const s of SECTION_SPECS) {
    if (!groupMap.has(s.group)) {
      const spec = groupSpecs.get(s.group)
      const count = opts?.schemaKeyCount ?? 0
      const hint =
        spec?.hintKeyCount && count > 0
          ? `${count} keys · ${spec.hint ?? ''}`.trim()
          : spec?.hint
      groupMap.set(s.group, { label: s.group, hint, items: [] })
    }
    groupMap.get(s.group)!.items.push({
      id: s.id,
      label: s.label,
      dirty: dirtyIds.has(s.id),
      offRec: offRecIds.has(s.id),
      issues: issueIds.has(s.id),
      ownership: s.ownership,
    })
  }
  return Array.from(groupMap.values())
}

// ── Unexposed-keys prefixes ───────────────────────────────────────────────

/**
 * The longest dotted prefix every declared key of a section shares (bare
 * keys, no `config.`): `agent.` for agent-runtime, `logging.` for telemetry.
 * A section whose keys live in different namespaces (execution: terminal.* +
 * code_execution.*) has none and gets no unexposed-keys block.
 */
export function commonKeyPrefix(keys: Array<string>): string | undefined {
  const bare = keys.map((k) => k.replace(/^config\./, ''))
  if (bare.length === 0) return undefined
  const split = bare.map((k) => k.split('.'))
  const first = split[0]
  // A lone leaf key has no namespace to group under.
  if (first.length < 2) return undefined
  const common: Array<string> = []
  for (let i = 0; i < first.length - 1; i++) {
    if (split.every((parts) => parts[i] === first[i])) common.push(first[i])
    else break
  }
  return common.length > 0 ? `${common.join('.')}.` : undefined
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
        <div style={{ padding: '18px', font: '500 12px var(--m-font-mono)', color: 'var(--m-text-faint, var(--theme-muted))' }}>
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

export type SettingsScreenProps = {
  /**
   * The active section. Supplied by the route from `?section=`; when omitted
   * the screen keeps its own state, which is what lets it be rendered without
   * a router (tests, storybook-style harnesses).
   */
  section?: string
  /** Called when the user picks a section. The route writes it to the URL. */
  onSectionChange?: (id: string) => void
}

export function SettingsScreen({
  section,
  onSectionChange,
}: SettingsScreenProps = {}) {
  const dirty = useSettingsStore((s) => s.dirty)
  const draft = useSettingsStore((s) => s.draft)
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

  const [ownSection, setOwnSection] = useState<string>(DEFAULT_SECTION)
  const activeId = section ?? ownSection
  const selectSection = onSectionChange ?? setOwnSection

  // Page-wide search. Deliberately *not* in the URL: it changes on every
  // keystroke, and a query param that only sometimes reflects the box is worse
  // than one that never claims to.
  const [query, setQuery] = useState('')

  // Fetch server config and seed store on mount
  const queryClient = useQueryClient()
  const { data: serverConfig, refetch: refetchConfig } = useQuery({
    queryKey: ['config'],
    queryFn: getConfig,
    staleTime: 60_000,
  })

  // Schema-derived defaults replace the sections' inline `?? 90` guesses. Both
  // this and the schema itself degrade to nothing on failure — neither may
  // block the page.
  useRegisterSchemaDefaults()
  const { index: schemaIndex } = useConfigSchema()

  const searchIndex = useMemo(() => buildSearchIndex(schemaIndex), [schemaIndex])
  const searchResults = useMemo(
    () => (query.trim() ? searchSections(searchIndex, query) : []),
    [searchIndex, query],
  )

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

  const sidebarGroups = buildSidebarGroups(dirty, {
    draft,
    schemaKeyCount: schemaIndex.fields.length,
  })

  // Sections whose declared keys share one dotted namespace get board A's
  // "More <prefix>* keys" block for the schema rows no curated control covers.
  const unexposedPrefix = commonKeyPrefix(activeSection.keys ?? [])

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
        onSelect={selectSection}
        query={query}
        onQueryChange={setQuery}
        searchResults={searchResults}
        onSelectSetting={(sectionId) => selectSection(sectionId)}
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
                    <Suspense fallback={<div style={{ padding: '24px', color: 'var(--m-text-faint, var(--theme-muted))' }}>Loading…</div>}>
                      <SectionComponent query={query} />
                    </Suspense>
                  )
                }
                return <StubSection section={activeSection} />
              })()}
              {unexposedPrefix && (
                <UnexposedKeys
                  prefix={unexposedPrefix}
                  onEditKey={(key) => {
                    // Same path the sidebar's search hits use: jump to
                    // All-settings with the page-wide query pinned to the key.
                    setQuery(key)
                    selectSection('all-settings')
                  }}
                />
              )}
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
