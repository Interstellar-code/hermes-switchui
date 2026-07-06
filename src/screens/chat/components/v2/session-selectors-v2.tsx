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
  UserRound,
  X,
} from 'lucide-react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useShallow } from 'zustand/react/shallow'

import {
  MODEL_SWITCH_BLOCKED_TOAST,
  getZeroForkModelInfoFlags,
  shouldBlockZeroForkModelSwitch,
} from '../chat-composer-model-switch'
import {
  activateProfile,
  fetchGatewayMode,
  fetchModelInfo,
  fetchProfiles,
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
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/shadcn/ui/popover'
import { formatModelName } from '@/lib/format-model-name'
import { usePinnedModels } from '@/hooks/use-pinned-models'
import { cn } from '@/lib/utils'
import { useGatewayRestartStore } from '@/stores/gateway-restart-store'
import { useSessionModelStore } from '@/stores/session-model-store'

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

async function fetchModelCatalog(): Promise<Array<NormalizedModel>> {
  const response = await fetch('/api/models')
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
  thinkingLevel?: ThinkingLevel
  onThinkingLevelChange?: (level: ThinkingLevel) => void
  hideModelSelector?: boolean
}

function SessionSelectorsV2Component({
  sessionKey,
  thinkingLevel: externalThinkingLevel,
  onThinkingLevelChange,
  hideModelSelector = false,
}: SessionSelectorsV2Props) {
  const queryClient = useQueryClient()
  const [modelMenuOpen, setModelMenuOpen] = React.useState(false)
  const [profileMenuOpen, setProfileMenuOpen] = React.useState(false)
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = React.useState(false)
  const [thinkingMenuOpen, setThinkingMenuOpen] = React.useState(false)
  const [modelNotice, setModelNotice] =
    React.useState<ModelSwitchNotice | null>(null)

  const thinkingLevel = externalThinkingLevel ?? 'low'

  // ─── real model data sources ─────────────────────────────────────────────
  const { pinned, isPinned } = usePinnedModels()
  const modelsQuery = useQuery({
    queryKey: ['claude', 'models'],
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
  const zeroForkModelInfoFlags = React.useMemo(
    () => getZeroForkModelInfoFlags(modelInfoQuery.data),
    [modelInfoQuery.data],
  )

  const profileActivateMutation = useMutation({
    mutationFn: activateProfile,
    onSuccess: async (data, profileName) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['profiles'] }),
        queryClient.invalidateQueries({ queryKey: ['workspace'] }),
        queryClient.invalidateQueries({ queryKey: ['claude', 'models'] }),
        queryClient.invalidateQueries({
          queryKey: ['claude', 'session-status-model'],
        }),
        queryClient.invalidateQueries({
          queryKey: ['dashboard', 'model-info'],
        }),
        queryClient.invalidateQueries({
          queryKey: ['gateway-status', 'mode'],
        }),
      ])
      setProfileMenuOpen(false)
      if (data.needsGatewayRestart) {
        useGatewayRestartStore.getState().markNeedsRestart(profileName)
      }
      setModelNotice({
        tone: 'success',
        message: `Activated profile ${profileName} — restart gateway to apply`,
      })
    },
    onError: (error) => {
      setModelNotice({
        tone: 'error',
        message:
          error instanceof Error ? error.message : 'Failed to activate profile',
      })
    },
  })
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

      {/* profile menu — /api/profiles/list + /api/profiles/activate */}
      {showModelSelector && (
        <Popover
          open={profileMenuOpen}
          onOpenChange={(open) => {
            setProfileMenuOpen(open)
            if (open) {
              setModelMenuOpen(false)
              setWorkspaceMenuOpen(false)
              setThinkingMenuOpen(false)
            }
          }}
        >
          <PopoverAnchor asChild>
            <button
              type="button"
              onClick={() => setProfileMenuOpen((o) => !o)}
              disabled={profileActivateMutation.isPending}
              title={
                activeProfile
                  ? `${activeProfile.name}${profileMeta(activeProfile) ? ` · ${profileMeta(activeProfile)}` : ''}`
                  : activeProfileName
              }
              className="inline-flex max-w-28 items-center gap-1 rounded-md border border-[var(--theme-accent-border)] bg-[var(--theme-accent-subtle)] px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-card-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
            >
              <UserRound className="size-3" />
              <span className="truncate">{activeProfileName}</span>
              <ChevronDown className="size-2.5 opacity-60" />
            </button>
          </PopoverAnchor>
          <PopoverContent
            align="start"
            className="w-60 p-1"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Agent profile
            </div>
            {profiles.map((profile) => {
              const selected = profile.name === activeProfileName
              return (
                <button
                  key={profile.name}
                  type="button"
                  onClick={() => {
                    if (selected) {
                      setProfileMenuOpen(false)
                      return
                    }
                    profileActivateMutation.mutate(profile.name)
                  }}
                  className={cn(
                    'flex w-full flex-col rounded-sm px-2 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground',
                    selected && 'bg-accent/50',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium">{profile.name}</span>
                    {selected ? <Check className="size-3.5" /> : null}
                  </span>
                  {profileMeta(profile) ? (
                    <span className="mt-0.5 max-w-[12rem] truncate text-[11px] text-muted-foreground">
                      {profileMeta(profile)}
                    </span>
                  ) : null}
                </button>
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
