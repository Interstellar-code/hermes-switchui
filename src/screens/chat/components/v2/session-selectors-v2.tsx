// ─── Session selectors (meta-bar) ──────────────────────────────────────────
//
// The model / profile / workspace / thinking-level selectors, relocated out of
// the chat composer toolbar into the top meta bar. This component owns ALL the
// queries, mutations, stores, and the live model-switch logic the selectors
// need, so the composer no longer references any of it.
//
// CONSTRAINTS (HARD): primitives ONLY from `@/components/shadcn/ui/*` + lucide
// + `cn`. No `@/components/ui/*`. No hardcoded colors — theme via the shadcn
// token bridge classes which forward to `--theme-*`.
//
// Shared profile/workspace/model helpers live outside the composer UI so
// selectors and composer implementations do not depend on a dead component.

import * as React from 'react'
import {
  Bot,
  Brain,
  Briefcase,
  Check,
  ChevronDown,
  FolderKanban,
  UserRound,
  X,
} from 'lucide-react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useShallow } from 'zustand/react/shallow'

import {
  MODEL_SWITCH_BLOCKED_TOAST,
  getZeroForkModelInfoFlags,
  shouldBlockZeroForkModelSwitch,
} from '../chat-composer-model-switch'
import {
  fetchGatewayMode,
  fetchModelInfo,
  fetchProfiles,
  fetchScopeStatus,
  fetchWorkspaceContext,
  getResolvedModelKey,
  nextThinkingLevel,
  profileMeta,
  shortPathLabel,
  switchModel,
  thinkingLabel,
} from '../chat-composer-services'
import type {
  ModelSwitchNotice,
  ThinkingLevel,
  WorkspaceDetectionResponse,
} from '../chat-composer-types'
import type { Project } from '@/lib/projects-types'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/shadcn/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/shadcn/ui/command'
import { formatModelName } from '@/lib/format-model-name'
import { usePinnedModels } from '@/hooks/use-pinned-models'
import { cn } from '@/lib/utils'
import {
  useBindSessionProject,
  useProjects,
  useSessionProject,
  useUnbindSessionProject,
} from '@/lib/projects-api'
import { useSessionModelStore } from '@/stores/session-model-store'
import { activeScopeSegments, getSessionProfile } from '@/lib/session-scope'

// ─── Model catalog (curated /api/models) ───────────────────────────────────
type NormalizedModel = {
  id: string
  name: string
  provider: string
}

type SelectableProfile = {
  name: string
  active?: boolean
  model?: string
  provider?: string
  skillCount?: number
}

type SelectableWorkspace = {
  name: string
  path: string
}

function readModelText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeProfiles(value: unknown): Array<SelectableProfile> {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const record = entry as Record<string, unknown>
    const name = readModelText(record.name)
    if (!name) return []
    return [
      {
        name,
        active: record.active === true,
        model: readModelText(record.model) || undefined,
        provider: readModelText(record.provider) || undefined,
        skillCount:
          typeof record.skillCount === 'number' ? record.skillCount : undefined,
      },
    ]
  })
}

function normalizeWorkspaces(value: unknown): Array<SelectableWorkspace> {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const record = entry as Record<string, unknown>
    const path = readModelText(record.path)
    if (!path) return []
    return [
      {
        path,
        name: readModelText(record.name),
      },
    ]
  })
}

/** Exported for the row-34 scoping test — importing the component tree just to
 *  reach it is heavier than exposing the function. */
export async function fetchModelCatalog(): Promise<Array<NormalizedModel>> {
  // Profiles are separate data homes with their own config.yaml, so a scoped
  // chat must offer that profile's providers/models, not the gateway-active
  // profile's. `/api/models?profile=` reads the foreign config off disk.
  // Omitted when unscoped, so the single-profile request is byte-identical.
  const profile = getSessionProfile()
  const response = await fetch(
    profile
      ? `/api/models?profile=${encodeURIComponent(profile)}`
      : '/api/models',
  )
  if (!response.ok) {
    throw new Error(`Models request failed (${response.status})`)
  }
  const payload = (await response.json()) as
    | Array<unknown>
    | {
        data?: Array<Record<string, unknown>>
        models?: Array<Record<string, unknown>>
      }
  const rawModels = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.data)
      ? payload.data
      : Array.isArray(payload.models)
        ? payload.models
        : []

  const seen = new Set<string>()
  const models: Array<NormalizedModel> = []
  for (const entry of rawModels) {
    let id = ''
    let providerRaw = ''
    let nameRaw = ''
    if (typeof entry === 'string') {
      id = entry.trim()
    } else if (entry && typeof entry === 'object') {
      const record = entry as Record<string, unknown>
      id =
        readModelText(record.id) ||
        readModelText(record.name) ||
        readModelText(record.model)
      providerRaw =
        readModelText(record.provider) || readModelText(record.owned_by)
      nameRaw =
        readModelText(record.name) ||
        readModelText(record.display_name) ||
        readModelText(record.label)
    }
    if (!id || seen.has(id)) continue
    seen.add(id)
    const provider =
      providerRaw || (id.includes('/') ? id.split('/')[0] : 'hermes-agent')
    models.push({
      id,
      provider,
      name: nameRaw || formatModelName(id),
    })
  }
  return models
}

function groupModelsByProvider(
  models: Array<NormalizedModel>,
): Array<[string, Array<NormalizedModel>]> {
  const groups = new Map<string, Array<NormalizedModel>>()
  for (const m of models) {
    const key = m.provider || 'other'
    const list = groups.get(key) ?? []
    list.push(m)
    groups.set(key, list)
  }
  return Array.from(groups.entries())
}

type SessionSelectorsV2Props = {
  sessionKey?: string
  /** Profile selection is only valid before the first session is created. */
  profileMutable?: boolean
  thinkingLevel?: ThinkingLevel
  onThinkingLevelChange?: (level: ThinkingLevel) => void
  hideModelSelector?: boolean
}

function SessionSelectorsV2Component({
  sessionKey,
  profileMutable = false,
  thinkingLevel: externalThinkingLevel,
  onThinkingLevelChange,
  hideModelSelector = false,
}: SessionSelectorsV2Props) {
  const queryClient = useQueryClient()
  const [modelMenuOpen, setModelMenuOpen] = React.useState(false)
  const [profileMenuOpen, setProfileMenuOpen] = React.useState(false)
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = React.useState(false)
  const [projectMenuOpen, setProjectMenuOpen] = React.useState(false)
  const [thinkingMenuOpen, setThinkingMenuOpen] = React.useState(false)
  const [modelNotice, setModelNotice] =
    React.useState<ModelSwitchNotice | null>(null)

  const thinkingLevel = externalThinkingLevel ?? 'low'

  // ─── real model data sources ─────────────────────────────────────────────
  const { pinned, isPinned } = usePinnedModels()
  const modelsQuery = useQuery({
    queryKey: ['claude', 'models', ...activeScopeSegments()],
    queryFn: fetchModelCatalog,
    refetchInterval: 60_000,
    retry: false,
  })
  const { persistedSessionModel, setPersistedSessionModel } =
    useSessionModelStore(
      useShallow((s) => ({
        persistedSessionModel: sessionKey ? s.models[sessionKey] : undefined,
        setPersistedSessionModel: s.setModel,
      })),
    )

  // ─── profile / workspace / model-info data sources (live parity) ──────────
  const profilesQuery = useQuery({
    queryKey: ['profiles', 'composer'],
    queryFn: fetchProfiles,
    retry: false,
    staleTime: 15_000,
  })
  const workspaceContextQuery = useQuery({
    queryKey: ['workspace', 'composer-context'],
    queryFn: fetchWorkspaceContext,
    retry: false,
    staleTime: 30_000,
  })
  const projectsQuery = useProjects(false)
  const sessionProjectQuery = useSessionProject(sessionKey)
  const bindSessionProjectMutation = useBindSessionProject()
  const unbindSessionProjectMutation = useUnbindSessionProject()
  const gatewayModeQuery = useQuery({
    queryKey: ['gateway-status', 'mode'],
    queryFn: fetchGatewayMode,
    staleTime: 30_000,
    retry: false,
  })
  const modelInfoQuery = useQuery({
    queryKey: ['dashboard', 'model-info'],
    queryFn: fetchModelInfo,
    staleTime: 30_000,
    retry: false,
  })
  // Multiplex topology (profile-scope.ts's GatewayMode) — distinct from
  // `gatewayModeQuery` above, which is the unrelated vanilla/enhanced-agent
  // mode. Powers the picker's served badge + per-row session count.
  const scopeStatusQuery = useQuery({
    queryKey: ['profiles', 'scope-status'],
    queryFn: fetchScopeStatus,
    staleTime: 5_000,
    retry: false,
  })
  const scopeMode = scopeStatusQuery.data?.mode ?? 'single'
  const servedProfiles = scopeStatusQuery.data?.servedProfiles ?? null
  const sessionCounts = scopeStatusQuery.data?.sessionCounts ?? {}

  // The profile this chat TAB is scoped to via `?profile=` — set only by
  // navigating (below), read here so a browser back/forward also updates the
  // picker. `strict: false` because this component renders under whichever
  // route matched; only `/chat/$sessionKey` declares the `profile` search key.
  const navigate = useNavigate()
  const routeSearch = useSearch({ strict: false })
  const scopedProfileName = routeSearch.profile?.trim() || null

  /** The `?profile=` write/clear trigger — the only place this composer sets
   * scope. Routes through the existing `validateSearch` contract on
   * `/chat/$sessionKey` rather than inventing a parallel mechanism. */
  const setScopedProfile = React.useCallback(
    (name: string | null) => {
      // `navigate()` here is generic (no `to`) since this component renders
      // under whichever route matched, and only `/chat/$sessionKey` declares
      // `profile` — the reducer can't be typed against a specific route's
      // search schema, so it's cast at the call boundary.

      ;(navigate as (opts: any) => void)({
        // Clearing sets `profile: undefined` instead of dropping the key.
        // `/chat/$sessionKey` retains `profile` across navigations, and that
        // middleware only fills the key back in when the navigation never
        // mentioned it — omitting it here would read as "unspecified" and the
        // scope could never be cleared. `undefined` is stripped from the URL.
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          profile: name || undefined,
        }),
      })
      setProfileMenuOpen(false)
    },
    [navigate],
  )
  const zeroForkModelInfoFlags = React.useMemo(
    () => getZeroForkModelInfoFlags(modelInfoQuery.data),
    [modelInfoQuery.data],
  )

  const workspaceSelectMutation = useMutation({
    mutationFn: async (workspace: { path: string; name?: string }) => {
      const response = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(workspace),
      })
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(text || `Workspace switch failed (${response.status})`)
      }
      return (await response.json()) as WorkspaceDetectionResponse
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['workspace', 'composer-context'],
      })
      setWorkspaceMenuOpen(false)
    },
    onError: (error) => {
      setModelNotice({
        tone: 'error',
        message:
          error instanceof Error ? error.message : 'Failed to switch workspace',
      })
    },
  })

  const models = React.useMemo(() => modelsQuery.data ?? [], [modelsQuery.data])
  const modelGroups = React.useMemo(
    () => groupModelsByProvider(models),
    [models],
  )
  const activeModel = React.useMemo<NormalizedModel | null>(() => {
    if (persistedSessionModel) {
      const match = models.find((m) => m.id === persistedSessionModel)
      if (match) return match
      return {
        id: persistedSessionModel,
        name: formatModelName(persistedSessionModel),
        provider: persistedSessionModel.includes('/')
          ? persistedSessionModel.split('/')[0]
          : 'hermes-agent',
      }
    }
    return models[0] ?? null
  }, [models, persistedSessionModel])

  // ─── derived labels (live parity) ────────────────────────────────────────
  const profiles = React.useMemo(
    () => normalizeProfiles(profilesQuery.data?.profiles),
    [profilesQuery.data?.profiles],
  )
  const activeProfileName =
    readModelText(profilesQuery.data?.activeProfile) ||
    profiles.find((profile) => profile.active)?.name ||
    'default'
  const displayedProfileName =
    scopedProfileName ?? (scopeMode === 'multiplex' ? 'default' : activeProfileName)
  const activeProfile = profiles.find(
    (profile) => profile.name === activeProfileName,
  )
  const workspaceEntries = React.useMemo(
    () => normalizeWorkspaces(workspaceContextQuery.data?.workspaces),
    [workspaceContextQuery.data?.workspaces],
  )
  const detectedWorkspacePath = workspaceContextQuery.data?.path ?? ''
  const activeWorkspace = workspaceEntries.find(
    (workspace) => workspace.path === detectedWorkspacePath,
  )
  const workspaceButtonLabel =
    activeWorkspace?.name ||
    workspaceContextQuery.data?.folderName ||
    shortPathLabel(detectedWorkspacePath) ||
    'Workspace'
  const projects = projectsQuery.data?.projects ?? []
  // The backend may report a profile-level fallback. The chat control only
  // represents an explicit assignment, so a new chat starts unassigned.
  const sessionProject =
    sessionProjectQuery.data?.source === 'binding'
      ? sessionProjectQuery.data.project
      : null
  const selectedProject = sessionProject
    ? (projects.find((project) => project.id === sessionProject.id) ??
      projects.find((project) => project.slug === sessionProject.slug) ??
      sessionProject)
    : null
  const selectedProjectDetails =
    selectedProject && 'icon' in selectedProject ? selectedProject : null
  const projectButtonLabel = selectedProject?.name || 'No project'
  const projectSelectionIsBinding =
    sessionProjectQuery.data?.source === 'binding'
  const projectSelectorDisabled =
    !sessionKey ||
    bindSessionProjectMutation.isPending ||
    unbindSessionProjectMutation.isPending

  const selectProject = React.useCallback(
    (project: Project) => {
      if (!sessionKey) return
      if (projectSelectionIsBinding && project.id === selectedProject?.id) {
        setProjectMenuOpen(false)
        return
      }
      bindSessionProjectMutation.mutate(
        { sessionKey, projectSlug: project.slug },
        {
          onSuccess: () => {
            setProjectMenuOpen(false)
          },
          onError: (error) => {
            setModelNotice({
              tone: 'error',
              message:
                error instanceof Error
                  ? error.message
                  : 'Failed to link project to chat',
            })
          },
        },
      )
    },
    [
      bindSessionProjectMutation,
      projectSelectionIsBinding,
      selectedProject?.id,
      sessionKey,
    ],
  )

  const clearSessionProject = React.useCallback(() => {
    if (!sessionKey) return
    unbindSessionProjectMutation.mutate(sessionKey, {
      onSuccess: () => setProjectMenuOpen(false),
      onError: (error) => {
        setModelNotice({
          tone: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'Failed to clear project from chat',
        })
      },
    })
  }, [sessionKey, unbindSessionProjectMutation])

  const selectModel = React.useCallback(
    (modelId: string, provider?: string) => {
      const model = modelId.trim()
      if (!model) return
      // Mirror the live composer's zero-fork guard: block the switch when the
      // running gateway is a vanilla/zero-fork agent that can't switch at
      // runtime, and surface the same blocked notice.
      if (
        shouldBlockZeroForkModelSwitch(
          gatewayModeQuery.data,
          zeroForkModelInfoFlags,
        )
      ) {
        setModelNotice({ tone: 'error', message: MODEL_SWITCH_BLOCKED_TOAST })
        setModelMenuOpen(false)
        return
      }
      setModelNotice(null)
      const resolved = getResolvedModelKey(model, provider)
      // Per-session, browser-local persistence (applied on next send).
      if (sessionKey) {
        setPersistedSessionModel(sessionKey, resolved)
      }
      setModelMenuOpen(false)
      setProjectMenuOpen(false)
      // Also switch the gateway's live model (config write / local override) so
      // the running agent reflects the pick, surfacing success/error inline.
      void switchModel(model, provider, sessionKey)
        .then((result) => {
          setModelNotice({
            tone: 'success',
            message: `Switched to ${formatModelName(result.resolved?.model ?? model)}`,
          })
        })
        .catch((error: unknown) => {
          setModelNotice({
            tone: 'error',
            message:
              error instanceof Error ? error.message : 'Failed to switch model',
            retryModel: model,
            retryProvider: provider,
          })
        })
    },
    [
      gatewayModeQuery.data,
      sessionKey,
      setPersistedSessionModel,
      zeroForkModelInfoFlags,
    ],
  )

  // ─── thinking level (controlled by chat-screen via onThinkingLevelChange) ─
  const handleThinkingSelect = React.useCallback(
    (level: ThinkingLevel) => {
      onThinkingLevelChange?.(level)
      setThinkingMenuOpen(false)
    },
    [onThinkingLevelChange],
  )

  const showModelSelector = !hideModelSelector

  return (
    <div className="flex items-center gap-1.5">
      {/* model-switch / profile / workspace notice (live ModelSwitchNotice
          surface — success or error feedback rendered inline). */}
      {modelNotice && (
        <div
          className={cn(
            'flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px]',
            modelNotice.tone === 'error'
              ? 'border-destructive/50 bg-destructive/10 text-destructive'
              : 'border-border bg-accent text-accent-foreground',
          )}
        >
          <span className="max-w-48 truncate">{modelNotice.message}</span>
          <button
            type="button"
            onClick={() => setModelNotice(null)}
            className="shrink-0 opacity-70 transition-opacity hover:opacity-100"
            aria-label="Dismiss notice"
          >
            <X className="size-3" />
          </button>
        </div>
      )}

      {/* model selector */}
      {showModelSelector && (
        <Popover open={modelMenuOpen} onOpenChange={setModelMenuOpen}>
          <PopoverAnchor asChild>
            <button
              type="button"
              onClick={() => setModelMenuOpen((o) => !o)}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--theme-accent-border)] bg-[var(--theme-accent-subtle)] px-2 py-0.5 text-[11px] text-card-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <Bot className="size-3" />
              <span className="max-w-32 truncate font-medium">
                {activeModel?.name ?? 'Model'}
              </span>
              <ChevronDown className="size-2.5 opacity-60" />
            </button>
          </PopoverAnchor>
          <PopoverContent
            align="start"
            className="w-72 p-0"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <div className="max-h-80 overflow-y-auto">
              {pinned.length > 0 && (
                <div>
                  <div className="sticky top-0 border-b border-border bg-popover px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Pinned
                  </div>
                  {pinned.map((id) => (
                    <button
                      key={`pinned-${id}`}
                      type="button"
                      onClick={() => selectModel(id)}
                      className={cn(
                        'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground',
                        activeModel?.id === id && 'bg-accent/50',
                      )}
                    >
                      <span className="flex-1 truncate">
                        {formatModelName(id)}
                      </span>
                      {activeModel?.id === id ? (
                        <Check className="size-3.5" />
                      ) : null}
                    </button>
                  ))}
                </div>
              )}
              {models.length === 0 ? (
                <div className="px-3 py-3 text-xs text-muted-foreground">
                  {modelsQuery.isLoading
                    ? 'Loading models…'
                    : 'No models available.'}
                </div>
              ) : (
                modelGroups.map(([provider, providerModels]) => (
                  <div key={provider}>
                    <div className="sticky top-0 border-b border-border bg-popover px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      {provider}
                    </div>
                    {providerModels.map((m) => {
                      const selected = m.id === activeModel?.id
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => selectModel(m.id)}
                          className={cn(
                            'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground',
                            selected && 'bg-accent/50',
                          )}
                        >
                          <span className="flex-1 truncate">{m.name}</span>
                          {isPinned(m.id) ? (
                            <span className="text-[10px] text-muted-foreground">
                              pinned
                            </span>
                          ) : null}
                          {selected ? <Check className="size-3.5" /> : null}
                        </button>
                      )
                    })}
                  </div>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>
      )}

      {/* Session profile: selectable before creation, immutable afterward. */}
      {showModelSelector && (
        <Popover
          open={profileMutable && profileMenuOpen}
          onOpenChange={(open) => {
            setProfileMenuOpen(open)
            if (open) {
              setModelMenuOpen(false)
              setProjectMenuOpen(false)
              setWorkspaceMenuOpen(false)
              setThinkingMenuOpen(false)
            }
          }}
        >
          <PopoverAnchor asChild>
            <button
              type="button"
              onClick={() => setProfileMenuOpen((o) => !o)}
              disabled={!profileMutable}
              aria-label={
                profileMutable
                  ? 'Select agent profile for new session'
                  : `Agent profile ${displayedProfileName}, bound to this session`
              }
              title={
                !profileMutable
                  ? `Bound to ${displayedProfileName}. Start a new chat to use another profile.`
                  : scopedProfileName
                  ? `Scoped to ${scopedProfileName}${
                      scopeMode === 'multiplex'
                        ? servedProfiles?.includes(scopedProfileName)
                          ? ' — sending enabled'
                          : ' — not served by this gateway, view only'
                        : ' — gateway not multiplexing, view only'
                    }`
                  : activeProfile
                    ? `${activeProfile.name}${profileMeta(activeProfile) ? ` · ${profileMeta(activeProfile)}` : ''}`
                    : activeProfileName
              }
              className={cn(
                'inline-flex max-w-28 items-center gap-1 rounded-md border border-[var(--theme-accent-border)] bg-[var(--theme-accent-subtle)] px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-card-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50',
                scopedProfileName && 'ring-1 ring-[var(--theme-accent)]',
              )}
              data-testid="profile-selector"
            >
              <UserRound className="size-3" />
              <span className="truncate">{displayedProfileName}</span>
              {profileMutable ? (
                <ChevronDown className="size-2.5 opacity-60" />
              ) : null}
            </button>
          </PopoverAnchor>
          <PopoverContent
            align="start"
            className="w-64 p-1"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Agent profile
              {scopeMode === 'single' ? ' — scoping is view-only' : ''}
            </div>
            {profiles.map((profile) => {
              const selected = profile.name === activeProfileName
              const isScoped = profile.name === scopedProfileName
              const served =
                scopeMode === 'multiplex'
                  ? (servedProfiles?.includes(profile.name) ?? false)
                  : null
              const count = sessionCounts[profile.name]
              return (
                <div key={profile.name} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setScopedProfile(profile.name)}
                    data-testid={`profile-option-${profile.name}`}
                    title={
                      scopeMode === 'multiplex'
                        ? served
                          ? `Scope this tab to ${profile.name} — sending enabled, no restart`
                          : `Scope this tab to ${profile.name} — not served, view only`
                        : `Scope this tab to ${profile.name} — view only (gateway not multiplexing)`
                    }
                    className={cn(
                      'flex w-full flex-col rounded-sm px-2 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground',
                      selected && 'bg-accent/50',
                      isScoped &&
                        'ring-1 ring-inset ring-[var(--theme-accent)]',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">
                        {profile.name}
                      </span>
                      {selected ? <Check className="size-3.5" /> : null}
                      {isScoped ? (
                        <span className="rounded-sm bg-[var(--theme-accent-subtle)] px-1 text-[9px] uppercase tracking-wide text-card-foreground">
                          Scoped
                        </span>
                      ) : null}
                      {served !== null ? (
                        <span
                          className={cn(
                            'ml-auto shrink-0 rounded-sm px-1 text-[9px] uppercase tracking-wide',
                            served
                              ? 'bg-[var(--theme-accent-subtle)] text-card-foreground'
                              : 'text-muted-foreground',
                          )}
                        >
                          {served ? 'Served' : 'Not served'}
                        </span>
                      ) : null}
                    </span>
                    {profileMeta(profile) || typeof count === 'number' ? (
                      <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        {profileMeta(profile) ? (
                          <span className="max-w-[8rem] truncate">
                            {profileMeta(profile)}
                          </span>
                        ) : null}
                        {typeof count === 'number' ? (
                          <span className="ml-auto shrink-0">
                            {count} session{count === 1 ? '' : 's'}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </button>
                </div>
              )
            })}
            {profilesQuery.isError ? (
              <div className="px-2 py-2 text-xs text-destructive">
                Failed to load profiles
              </div>
            ) : null}
          </PopoverContent>
        </Popover>
      )}

      {/* workspace menu — /api/workspace GET/POST */}
      {showModelSelector && (
        <Popover
          open={workspaceMenuOpen}
          onOpenChange={(open) => {
            setWorkspaceMenuOpen(open)
            if (open) {
              setModelMenuOpen(false)
              setProfileMenuOpen(false)
              setProjectMenuOpen(false)
              setThinkingMenuOpen(false)
            }
          }}
        >
          <PopoverAnchor asChild>
            <button
              type="button"
              onClick={() => setWorkspaceMenuOpen((o) => !o)}
              title={detectedWorkspacePath || 'Workspace context'}
              className="hidden max-w-32 items-center gap-1 rounded-md border border-[var(--theme-accent-border)] bg-[var(--theme-accent-subtle)] px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-card-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50 sm:inline-flex"
            >
              <Briefcase className="size-3" />
              <span className="truncate">{workspaceButtonLabel}</span>
              <ChevronDown className="size-2.5 opacity-60" />
            </button>
          </PopoverAnchor>
          <PopoverContent
            align="start"
            className="w-72 p-1"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Workspace context
            </div>
            <div className="max-h-56 overflow-y-auto">
              {workspaceEntries.length > 0 ? (
                workspaceEntries.map((workspace) => {
                  const selected = workspace.path === detectedWorkspacePath
                  return (
                    <button
                      key={workspace.path}
                      type="button"
                      onClick={() => {
                        if (selected) {
                          setWorkspaceMenuOpen(false)
                          return
                        }
                        workspaceSelectMutation.mutate(workspace)
                      }}
                      className={cn(
                        'flex w-full flex-col rounded-sm px-2 py-2 text-left transition-colors hover:bg-accent hover:text-accent-foreground',
                        selected && 'bg-accent/50',
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {workspace.name || shortPathLabel(workspace.path)}
                        </span>
                        {selected ? <Check className="size-3.5" /> : null}
                      </span>
                      <span className="mt-0.5 max-w-[16rem] truncate text-[10px] text-muted-foreground">
                        {workspace.path}
                      </span>
                    </button>
                  )
                })
              ) : (
                <div className="px-2 py-2 text-xs text-muted-foreground">
                  No valid workspaces detected
                </div>
              )}
            </div>
            {workspaceContextQuery.isError ? (
              <div className="px-2 py-2 text-xs text-destructive">
                Failed to load workspaces
              </div>
            ) : null}
          </PopoverContent>
        </Popover>
      )}

      {/* A project link is scoped to this chat; it never changes the profile default. */}
      {showModelSelector && (
        <Popover
          open={projectMenuOpen}
          onOpenChange={(open) => {
            setProjectMenuOpen(open)
            if (open) {
              setModelMenuOpen(false)
              setProfileMenuOpen(false)
              setWorkspaceMenuOpen(false)
              setThinkingMenuOpen(false)
            }
          }}
        >
          <PopoverAnchor asChild>
            <button
              type="button"
              onClick={() => setProjectMenuOpen((open) => !open)}
              disabled={projectSelectorDisabled}
              title={
                !sessionKey
                  ? 'Send a message first to link this chat to a project.'
                  : selectedProject
                    ? `${selectedProject.name}${'primary_path' in selectedProject && selectedProject.primary_path ? ` · ${selectedProject.primary_path}` : ''}`
                    : 'Link this chat to a project'
              }
              className="hidden max-w-32 items-center gap-1 rounded-md border border-[var(--theme-accent-border)] bg-[var(--theme-accent-subtle)] px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-card-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50 sm:inline-flex"
              data-testid="project-selector"
            >
              {selectedProjectDetails?.icon ? (
                <span aria-hidden="true" className="text-xs leading-none">
                  {selectedProjectDetails.icon.slice(0, 2)}
                </span>
              ) : (
                <FolderKanban
                  className="size-3"
                  style={
                    selectedProjectDetails?.color
                      ? { color: selectedProjectDetails.color }
                      : undefined
                  }
                />
              )}
              <span className="truncate">{projectButtonLabel}</span>
              <ChevronDown className="size-2.5 opacity-60" />
            </button>
          </PopoverAnchor>
          <PopoverContent
            align="start"
            className="w-80 overflow-hidden p-0"
            onOpenAutoFocus={(event) => event.preventDefault()}
          >
            <Command>
              <CommandInput placeholder="Search projects…" />
              <CommandList className="max-h-64 p-1">
                <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Project for this chat
                </div>
                {projectSelectionIsBinding ? (
                  <CommandItem
                    value="clear project from chat"
                    onSelect={clearSessionProject}
                    disabled={unbindSessionProjectMutation.isPending}
                    className="mb-1 flex rounded-sm px-2 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                    data-testid="project-use-profile-default"
                  >
                    Clear project
                  </CommandItem>
                ) : null}
                {projects.length > 0 ? (
                  projects.map((project) => {
                    const selected = project.id === selectedProject?.id
                    return (
                      <CommandItem
                        key={project.id}
                        value={`${project.name} ${project.slug} ${project.primary_path ?? ''} ${project.bound_board?.name ?? project.board_slug ?? ''}`}
                        onSelect={() => selectProject(project)}
                        disabled={bindSessionProjectMutation.isPending}
                        data-testid={`project-option-${project.id}`}
                        className={cn(
                          'flex w-full flex-col rounded-sm px-2 py-2 text-left transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50',
                          selected && 'bg-accent/50',
                        )}
                      >
                        <span className="flex w-full items-center gap-2">
                          {project.icon ? (
                            <span
                              aria-hidden="true"
                              className="text-sm leading-none"
                            >
                              {project.icon.slice(0, 2)}
                            </span>
                          ) : (
                            <FolderKanban
                              className="size-3.5 shrink-0"
                              style={
                                project.color
                                  ? { color: project.color }
                                  : undefined
                              }
                            />
                          )}
                          <span className="flex-1 truncate text-sm font-medium">
                            {project.name}
                          </span>
                          {selected ? <Check className="size-3.5" /> : null}
                        </span>
                        {project.primary_path ? (
                          <span className="mt-0.5 max-w-[16rem] truncate text-[10px] text-muted-foreground">
                            {project.primary_path}
                          </span>
                        ) : null}
                        {project.bound_board?.name || project.board_slug ? (
                          <span className="mt-0.5 max-w-[16rem] truncate text-[10px] text-muted-foreground">
                            Board ·{' '}
                            {project.bound_board?.name ?? project.board_slug}
                          </span>
                        ) : null}
                      </CommandItem>
                    )
                  })
                ) : (
                  <div className="px-2 py-2 text-xs text-muted-foreground">
                    {projectsQuery.isLoading
                      ? 'Loading projects…'
                      : 'No active projects available'}
                  </div>
                )}
                <CommandEmpty>No projects match your search.</CommandEmpty>
                {projectsQuery.isError ? (
                  <div className="px-2 py-2 text-xs text-destructive">
                    Failed to load projects
                  </div>
                ) : null}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}

      {/* thinking-level menu — honors thinkingLevel + onThinkingLevelChange */}
      {showModelSelector && (
        <Popover
          open={thinkingMenuOpen}
          onOpenChange={(open) => {
            setThinkingMenuOpen(open)
            if (open) {
              setModelMenuOpen(false)
              setProfileMenuOpen(false)
              setWorkspaceMenuOpen(false)
              setProjectMenuOpen(false)
            }
          }}
        >
          <PopoverAnchor asChild>
            <button
              type="button"
              onClick={(e) => {
                // Shift+click quick-cycles to the next level (live
                // nextThinkingLevel order); plain click opens menu.
                if (e.shiftKey) {
                  handleThinkingSelect(nextThinkingLevel(thinkingLevel))
                  return
                }
                setThinkingMenuOpen((o) => !o)
              }}
              title={`Reasoning effort: ${thinkingLabel(thinkingLevel)} (⇧-click to cycle)`}
              className={cn(
                'hidden items-center gap-1 rounded-md border border-[var(--theme-accent-border)] bg-[var(--theme-accent-subtle)] px-2 py-0.5 text-[11px] font-medium text-card-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50 sm:inline-flex',
                thinkingLevel === 'off' && 'opacity-70',
              )}
            >
              <Brain className="size-3" />
              <span className="truncate">{thinkingLabel(thinkingLevel)}</span>
              <ChevronDown className="size-2.5 opacity-60" />
            </button>
          </PopoverAnchor>
          <PopoverContent
            align="start"
            className="w-40 p-1"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            {(
              [
                ['off', 'None'],
                ['low', 'Low'],
                ['medium', 'Medium'],
                ['high', 'High'],
                ['adaptive', 'Adaptive'],
              ] as Array<[ThinkingLevel, string]>
            ).map(([level, label]) => {
              const selected = thinkingLevel === level
              return (
                <button
                  key={level}
                  type="button"
                  onClick={() => handleThinkingSelect(level)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-sm px-2 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground',
                    selected && 'bg-accent/50',
                  )}
                >
                  <span>{label}</span>
                  {selected ? <Check className="size-3.5" /> : null}
                </button>
              )
            })}
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}

export const SessionSelectorsV2 = React.memo(SessionSelectorsV2Component)
export type { SessionSelectorsV2Props }
