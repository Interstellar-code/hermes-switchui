// ─── Drop-in shadcn composer (Phase 2 #12) ────────────────────────────────
//
// A flag-gated, drop-in replacement for the live `<ChatComposer>` built on
// shadcn/ui primitives (`@/components/shadcn/ui/*`) + lucide icons. It shares
// the EXACT same `ChatComposerProps` contract as the live composer so the only
// change at the mount site is a conditional element swap.
//
// This component owns NO send/streaming logic — submit/abort are delegated to
// the `onSubmit` / `onAbort` props passed in by chat-screen. It reuses the
// real switchui hooks + stores (voice, model selection, context bar, slash
// menu) so behavior matches the live composer where wired.
//
// CONSTRAINTS (HARD): primitives ONLY from `@/components/shadcn/ui/*` + lucide
// + `cn`. No `@/components/ui/*`. No hardcoded colors — theme via the shadcn
// token bridge classes which forward to `--theme-*`.
//
// ─── TOOLBAR PARITY (Phase 2 #13) ──────────────────────────────────────────
// This composer is now at toolbar parity with the live `<ChatComposer>` and is
// intended to REPLACE it. The following live controls are wired here, reusing
// the SAME queries / mutations / stores / endpoints (helpers are imported from
// `./chat-composer`, which exports them additively):
//  - Profile menu (`/api/profiles/list` + `/api/profiles/activate`)
//  - Workspace menu (`/api/workspace` GET/POST)
//  - Thinking-level menu (honors `thinkingLevel` prop + `onThinkingLevelChange`)
//  - Fast-mode toggle (flows into `onSubmit(..., fastMode, ...)`; `/fast` parity)
//  - Web-search toggle (`webSearchEnabled` prop + `onToggleWebSearch`)
//  - Live model switch (per-session persistence + gateway `switchModel()` with
//    the zero-fork block guard + `ModelSwitchNotice` surface)
//
// ─── REMAINING PARITY-GAP TODOs (out of scope for this pass) ────────────────
//  - Provider-switcher (cross-provider model browse) — only the curated
//    `/api/models` catalog is shown; no "other providers" expansion.
//  - Mobile docking / portal behavior — the live composer docks fixed to the
//    viewport bottom on mobile; this drop-in stays inline (honors `embedded`
//    only insofar as it never docks).
//  - Image compression + transport-size guards — attachments are read as data
//    URLs without the live composer's compression/limit pipeline.

import * as React from 'react'
import {
  ArrowUp,
  Bot,
  Brain,
  Briefcase,
  Check,
  ChevronDown,
  Globe,
  Mic,
  Paperclip,
  Square,
  UserRound,
  X,
  Zap,
} from 'lucide-react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '@/lib/utils'
import { Button } from '@/components/shadcn/ui/button'
import { Textarea } from '@/components/shadcn/ui/textarea'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/shadcn/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/shadcn/ui/tooltip'
import {
  SlashCommandMenu,
  type SlashCommandDefinition,
  type SlashCommandMenuHandle,
} from '@/components/slash-command-menu'
import { usePinnedModels } from '@/hooks/use-pinned-models'
import { useSessionModelStore } from '@/stores/session-model-store'
import { useGatewayRestartStore } from '@/stores/gateway-restart-store'
import { useVoiceInput } from '@/hooks/use-voice-input'
import { useVoiceRecorder } from '@/hooks/use-voice-recorder'
import { formatModelName } from '@/lib/format-model-name'

import { ContextBar } from './context-bar'
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
} from './chat-composer'
import {
  MODEL_SWITCH_BLOCKED_TOAST,
  getZeroForkModelInfoFlags,
  shouldBlockZeroForkModelSwitch,
} from './chat-composer-model-switch'
import type {
  ChatComposerAttachment,
  ChatComposerHandle,
  ChatComposerHelpers,
  ModelSwitchNotice,
  ThinkingLevel,
  WorkspaceDetectionResponse,
} from './chat-composer'
import type { Ref } from 'react'

// Mirror of the live composer's ChatComposerProps. Imported types keep the
// payload shapes identical; we re-declare the prop bag locally (the live one is
// not exported) so the swap stays additive without editing chat-composer.tsx.
type ChatComposerShadcnProps = {
  onSubmit: (
    value: string,
    attachments: Array<ChatComposerAttachment>,
    fastMode: boolean,
    helpers: ChatComposerHelpers,
  ) => void
  isLoading: boolean
  disabled: boolean
  sessionKey?: string
  wrapperRef?: Ref<HTMLDivElement>
  composerRef?: Ref<ChatComposerHandle>
  focusKey?: string
  onNewSession?: () => void
  onToggleWebSearch?: (enabled: boolean) => void
  webSearchEnabled?: boolean
  thinkingLevel?: ThinkingLevel
  onThinkingLevelChange?: (level: ThinkingLevel) => void
  onAbort?: () => void
  embedded?: boolean
  hideModelSelector?: boolean
}

const MAX_TEXTAREA_HEIGHT = 240

// ─── Model catalog (curated /api/models) ───────────────────────────────────
type NormalizedModel = {
  id: string
  name: string
  provider: string
}

function readModelText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
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

// ─── Attachment helpers (parity-correct ChatComposerAttachment shape) ──────
// NOTE: this intentionally omits the live composer's image compression +
// transport-size guards (see PARITY-GAP TODOs). It produces the same shape.
function readFileAsDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
}

async function buildAttachment(
  file: File,
): Promise<ChatComposerAttachment | null> {
  const isImage = file.type.startsWith('image/')
  const dataUrl = await readFileAsDataUrl(file)
  if (!dataUrl) return null
  return {
    id: crypto.randomUUID(),
    name: file.name || (isImage ? 'pasted-image' : 'pasted-file'),
    contentType: file.type || 'application/octet-stream',
    size: file.size,
    dataUrl,
    previewUrl: isImage ? dataUrl : undefined,
    kind: isImage ? 'image' : 'file',
  }
}

// ─── Slash-command query parsing (mirrors live `readSlashCommandQuery`) ────
function readSlashCommandQuery(value: string): string | null {
  if (!value.startsWith('/')) return null
  // Only an active slash command while there is no whitespace yet.
  if (/\s/.test(value)) return null
  return value.slice(1)
}

function ChatComposerShadcn({
  onSubmit,
  isLoading,
  disabled,
  sessionKey,
  wrapperRef,
  composerRef,
  focusKey,
  onAbort,
  thinkingLevel: externalThinkingLevel,
  onThinkingLevelChange,
  onNewSession: _onNewSession,
  onToggleWebSearch,
  webSearchEnabled,
  embedded: _embedded,
  hideModelSelector = false,
}: ChatComposerShadcnProps) {
  const queryClient = useQueryClient()
  const [value, setValue] = React.useState('')
  const [attachments, setAttachments] = React.useState<
    Array<ChatComposerAttachment>
  >([])
  const [modelMenuOpen, setModelMenuOpen] = React.useState(false)
  const [profileMenuOpen, setProfileMenuOpen] = React.useState(false)
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = React.useState(false)
  const [thinkingMenuOpen, setThinkingMenuOpen] = React.useState(false)
  const [isSlashMenuDismissed, setIsSlashMenuDismissed] = React.useState(false)
  const [modelNotice, setModelNotice] =
    React.useState<ModelSwitchNotice | null>(null)
  const [fastMode, setFastMode] = React.useState(false)
  const [internalThinkingLevel, setInternalThinkingLevel] =
    React.useState<ThinkingLevel>('low')
  const [isWebSearchMode, setIsWebSearchMode] = React.useState(false)

  const thinkingLevel = externalThinkingLevel ?? internalThinkingLevel
  const isWebSearchActive = webSearchEnabled ?? isWebSearchMode

  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const slashMenuRef = React.useRef<SlashCommandMenuHandle | null>(null)
  const submittingRef = React.useRef(false)

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
      if (data?.needsGatewayRestart) {
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
          error instanceof Error
            ? error.message
            : 'Failed to activate profile',
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
          error instanceof Error
            ? error.message
            : 'Failed to switch workspace',
      })
    },
  })

  const models = React.useMemo(
    () => modelsQuery.data ?? [],
    [modelsQuery.data],
  )
  const modelGroups = React.useMemo(
    () => groupModelsByProvider(models),
    [models],
  )
  const activeModel = React.useMemo(() => {
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
  const activeProfileName =
    profilesQuery.data?.activeProfile ||
    profilesQuery.data?.profiles?.find((profile) => profile.active)?.name ||
    'default'
  const activeProfile = profilesQuery.data?.profiles?.find(
    (profile) => profile.name === activeProfileName,
  )
  const workspaceEntries = workspaceContextQuery.data?.workspaces ?? []
  const detectedWorkspacePath = workspaceContextQuery.data?.path ?? ''
  const activeWorkspace = workspaceEntries.find(
    (workspace) => workspace.path === detectedWorkspacePath,
  )
  const workspaceButtonLabel =
    activeWorkspace?.name ||
    workspaceContextQuery.data?.folderName ||
    shortPathLabel(detectedWorkspacePath) ||
    'Workspace'

  const closeAllMenus = React.useCallback(() => {
    setModelMenuOpen(false)
    setProfileMenuOpen(false)
    setWorkspaceMenuOpen(false)
    setThinkingMenuOpen(false)
  }, [])

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
              error instanceof Error
                ? error.message
                : 'Failed to switch model',
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

  // ─── thinking level (honor external controller, else internal) ───────────
  const handleThinkingSelect = React.useCallback(
    (level: ThinkingLevel) => {
      if (onThinkingLevelChange) {
        onThinkingLevelChange(level)
      } else {
        setInternalThinkingLevel(level)
      }
      setThinkingMenuOpen(false)
    },
    [onThinkingLevelChange],
  )

  // ─── web-search toggle (honor external controller, else internal) ────────
  const toggleWebSearch = React.useCallback(() => {
    const next = !isWebSearchActive
    if (onToggleWebSearch) {
      onToggleWebSearch(next)
    } else {
      setIsWebSearchMode(next)
    }
  }, [isWebSearchActive, onToggleWebSearch])

  // ─── focus management ────────────────────────────────────────────────────
  const focusPrompt = React.useCallback(() => {
    if (typeof window === 'undefined') return
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
    })
  }, [])

  // Refocus when the session changes (mirrors live focusKey behavior).
  React.useEffect(() => {
    focusPrompt()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey])

  // ─── auto-grow textarea ──────────────────────────────────────────────────
  React.useLayoutEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`
  }, [value])

  // ─── slash menu state ────────────────────────────────────────────────────
  const slashCommandQuery = React.useMemo(
    () => readSlashCommandQuery(value),
    [value],
  )
  const isSlashMenuOpen =
    slashCommandQuery !== null && !disabled && !isSlashMenuDismissed

  const handleSelectSlashCommand = React.useCallback(
    (command: SlashCommandDefinition) => {
      // `/fast` toggles fast mode (live parity) instead of inserting text.
      if (command.command === '/fast') {
        setIsSlashMenuDismissed(false)
        setFastMode((previous) => !previous)
        setValue('')
        focusPrompt()
        return
      }
      // Insert the selected command + a trailing space, then dismiss.
      setValue(`${command.command} `)
      setIsSlashMenuDismissed(true)
      focusPrompt()
    },
    [focusPrompt],
  )

  // ─── imperative handle (ChatComposerHandle) ──────────────────────────────
  const setComposerValue = React.useCallback(
    (next: string) => {
      setIsSlashMenuDismissed(false)
      setValue(next)
      focusPrompt()
    },
    [focusPrompt],
  )
  const insertText = React.useCallback(
    (text: string) => {
      setIsSlashMenuDismissed(false)
      setValue((prev) => (prev.trim().length > 0 ? `${prev}\n${text}` : text))
      focusPrompt()
    },
    [focusPrompt],
  )
  React.useImperativeHandle(
    composerRef,
    () => ({ setValue: setComposerValue, insertText }),
    [setComposerValue, insertText],
  )

  // ─── helpers passed into onSubmit ────────────────────────────────────────
  const reset = React.useCallback(() => {
    setIsSlashMenuDismissed(false)
    setValue('')
    setAttachments([])
    focusPrompt()
  }, [focusPrompt])

  const helpers = React.useMemo<ChatComposerHelpers>(
    () => ({
      reset,
      setValue: setComposerValue,
      setAttachments: (next) => {
        setAttachments(next)
        focusPrompt()
      },
    }),
    [reset, setComposerValue, focusPrompt],
  )

  // ─── attachments: paste / drag-drop / file-pick ──────────────────────────
  const addFiles = React.useCallback(
    async (files: Array<File>) => {
      if (disabled || files.length === 0) return
      const built = await Promise.all(files.map(buildAttachment))
      const valid = built.filter(
        (a): a is ChatComposerAttachment => a !== null,
      )
      if (valid.length === 0) return
      setAttachments((prev) => [...prev, ...valid])
      focusPrompt()
    },
    [disabled, focusPrompt],
  )

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    const files: Array<File> = []
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') {
        const f = items[i].getAsFile()
        if (f) files.push(f)
      }
    }
    if (files.length > 0) {
      e.preventDefault()
      void addFiles(files)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    if (disabled) return
    const files = Array.from(e.dataTransfer?.files ?? [])
    if (files.length > 0) {
      e.preventDefault()
      void addFiles(files)
    }
  }

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      void addFiles(Array.from(e.target.files))
    }
    e.target.value = ''
  }

  const removeAttachment = (id: string) =>
    setAttachments((prev) => prev.filter((a) => a.id !== id))

  // ─── voice (parity with live composer) ───────────────────────────────────
  const voiceInput = useVoiceInput({
    onResult: React.useCallback((text: string) => {
      if (!text.trim()) return
      setValue((prev) => (prev.trim().length > 0 ? `${prev} ${text}` : text))
    }, []),
  })
  const voiceRecorder = useVoiceRecorder({
    onRecorded: React.useCallback(
      (blob: Blob, _durationMs: number) => {
        const ext = blob.type.includes('webm') ? 'webm' : 'mp4'
        const file = new File([blob], `voice-note-${Date.now()}.${ext}`, {
          type: blob.type || 'audio/webm',
        })
        void readFileAsDataUrl(file).then((dataUrl) => {
          if (!dataUrl) return
          setAttachments((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              name: file.name,
              contentType: file.type,
              size: file.size,
              dataUrl,
              kind: 'audio',
            },
          ])
        })
      },
      [],
    ),
  })
  const voiceSupported = voiceInput.isSupported || voiceRecorder.isSupported
  const toggleVoice = () => {
    if (voiceInput.isSupported) {
      voiceInput.toggle()
    } else if (voiceRecorder.isSupported) {
      if (voiceRecorder.isRecording) {
        voiceRecorder.stop()
      } else {
        voiceRecorder.start()
      }
    }
  }

  // ─── submit ──────────────────────────────────────────────────────────────
  const canSend =
    !disabled && (value.trim().length > 0 || attachments.length > 0)

  const handleSubmit = React.useCallback(() => {
    if (disabled || submittingRef.current) return
    const body = value.trim()
    if (body.length === 0 && attachments.length === 0) return
    submittingRef.current = true
    const attachmentPayload = attachments.map((a) => ({ ...a }))
    try {
      // Fast mode is incompatible with extended thinking — disable if thinking
      // is on (mirrors the live composer's effectiveFastMode rule).
      const effectiveFastMode =
        fastMode && thinkingLevel === 'off' ? true : false
      onSubmit(body, attachmentPayload, effectiveFastMode, helpers)
    } finally {
      window.setTimeout(() => {
        submittingRef.current = false
      }, 300)
    }
    setValue('')
    setAttachments([])
    setIsSlashMenuDismissed(false)
    focusPrompt()
  }, [
    disabled,
    value,
    attachments,
    onSubmit,
    helpers,
    focusPrompt,
    fastMode,
    thinkingLevel,
  ])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // While the slash menu is open, route arrows / enter to it.
    if (isSlashMenuOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        slashMenuRef.current?.moveSelection(1)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        slashMenuRef.current?.moveSelection(-1)
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        const applied = slashMenuRef.current?.selectActive() ?? false
        if (applied) {
          e.preventDefault()
          return
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setIsSlashMenuDismissed(true)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const showModelSelector = !hideModelSelector

  return (
    <TooltipProvider delayDuration={200}>
      <div
        ref={wrapperRef}
        className="mx-auto flex w-full max-w-3xl flex-col gap-2"
      >
        {/* attachment thumbnails / chips */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 px-1">
            {attachments.map((att) => (
              <div
                key={att.id}
                className="group/att relative flex items-center gap-2 rounded-lg border border-border bg-card px-2 py-1 text-xs text-card-foreground"
              >
                {att.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={att.previewUrl}
                    alt={att.name}
                    className="size-8 rounded object-cover"
                  />
                ) : (
                  <Paperclip className="size-3.5 text-muted-foreground" />
                )}
                <span className="max-w-40 truncate">{att.name}</span>
                <button
                  type="button"
                  onClick={() => removeAttachment(att.id)}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                  aria-label="Remove attachment"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* model-switch / profile / workspace notice (live ModelSwitchNotice
            surface — success or error feedback rendered inline). */}
        {modelNotice && (
          <div
            className={cn(
              'flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-xs',
              modelNotice.tone === 'error'
                ? 'border-destructive/50 bg-destructive/10 text-destructive'
                : 'border-border bg-accent text-accent-foreground',
            )}
          >
            <span className="truncate">{modelNotice.message}</span>
            <button
              type="button"
              onClick={() => setModelNotice(null)}
              className="shrink-0 opacity-70 transition-opacity hover:opacity-100"
              aria-label="Dismiss notice"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}

        {/* composer card; SlashCommandMenu positions itself absolutely
            relative to this wrapper (it renders its own container). */}
        <div className="relative">
            <div
              onDrop={handleDrop}
              onDragOver={(e) => {
                if (!disabled) e.preventDefault()
              }}
              className={cn(
                'rounded-2xl border border-border bg-card text-card-foreground shadow-sm ring-1 ring-border focus-within:ring-2 focus-within:ring-ring',
                disabled && 'opacity-60',
              )}
            >
              <div className="px-2 pt-2" onPaste={handlePaste}>
                <Textarea
                  ref={textareaRef}
                  value={value}
                  disabled={disabled}
                  onChange={(e) => {
                    setIsSlashMenuDismissed(false)
                    setValue(e.target.value)
                  }}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  placeholder="Message the agent…  (try /, paste a file)"
                  className="max-h-60 min-h-[56px] resize-none border-0 bg-transparent px-2 py-2 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
                />
              </div>

              {/* footer toolbar */}
              <div className="flex items-center gap-1 px-3 pb-2 pt-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  hidden
                  onChange={handleFilePick}
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={disabled}
                      onClick={() => fileInputRef.current?.click()}
                      aria-label="Attach file"
                    >
                      <Paperclip className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Attach file</TooltipContent>
                </Tooltip>

                {/* voice (mic) — preserves switchui voice parity */}
                {voiceSupported && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={disabled}
                        onClick={toggleVoice}
                        aria-label="Voice input"
                        className={cn(
                          (voiceInput.isListening ||
                            voiceRecorder.isRecording) &&
                            'text-destructive',
                        )}
                      >
                        <Mic className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {voiceRecorder.isRecording
                        ? `Recording… ${Math.round(voiceRecorder.durationMs / 1000)}s`
                        : voiceInput.isListening
                          ? 'Listening…'
                          : 'Voice input'}
                    </TooltipContent>
                  </Tooltip>
                )}

                {/* fast-mode toggle — submits fastMode into onSubmit; the
                    effective value is gated by thinkingLevel === 'off'. */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={disabled}
                      onClick={() => setFastMode((prev) => !prev)}
                      aria-label="Fast mode"
                      aria-pressed={fastMode}
                      className={cn(fastMode && 'text-primary')}
                    >
                      <Zap
                        className={cn('size-4', fastMode && 'fill-current')}
                      />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {fastMode
                      ? thinkingLevel === 'off'
                        ? 'Fast mode on'
                        : 'Fast mode (disabled while thinking is on)'
                      : 'Fast mode'}
                  </TooltipContent>
                </Tooltip>

                {/* web-search toggle — honors webSearchEnabled prop +
                    onToggleWebSearch, else falls back to local state. */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={disabled}
                      onClick={toggleWebSearch}
                      aria-label="Web search"
                      aria-pressed={isWebSearchActive}
                      className={cn(isWebSearchActive && 'text-primary')}
                    >
                      <Globe className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {isWebSearchActive ? 'Web search on' : 'Web search'}
                  </TooltipContent>
                </Tooltip>

                {/* model selector */}
                {showModelSelector && (
                  <Popover open={modelMenuOpen} onOpenChange={setModelMenuOpen}>
                    <PopoverAnchor asChild>
                      <button
                        type="button"
                        onClick={() => setModelMenuOpen((o) => !o)}
                        disabled={disabled}
                        className="ml-1 inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs text-card-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                      >
                        <Bot className="size-3.5" />
                        <span className="max-w-40 truncate font-medium">
                          {activeModel?.name ?? 'Model'}
                        </span>
                        <ChevronDown className="size-3 opacity-60" />
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
                                    <span className="flex-1 truncate">
                                      {m.name}
                                    </span>
                                    {isPinned(m.id) ? (
                                      <span className="text-[10px] text-muted-foreground">
                                        pinned
                                      </span>
                                    ) : null}
                                    {selected ? (
                                      <Check className="size-3.5" />
                                    ) : null}
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
                        disabled={
                          disabled || profileActivateMutation.isPending
                        }
                        title={
                          activeProfile
                            ? `${activeProfile.name}${profileMeta(activeProfile) ? ` · ${profileMeta(activeProfile)}` : ''}`
                            : activeProfileName
                        }
                        className="ml-1 inline-flex max-w-32 items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium uppercase tracking-wider text-card-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                      >
                        <UserRound className="size-3.5" />
                        <span className="truncate">{activeProfileName}</span>
                        <ChevronDown className="size-3 opacity-60" />
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
                      {(profilesQuery.data?.profiles ?? []).map((profile) => {
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
                              <span className="truncate font-medium">
                                {profile.name}
                              </span>
                              {selected ? (
                                <Check className="size-3.5" />
                              ) : null}
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
                        disabled={disabled}
                        title={detectedWorkspacePath || 'Workspace context'}
                        className="ml-1 hidden max-w-36 items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium uppercase tracking-wider text-card-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50 sm:inline-flex"
                      >
                        <Briefcase className="size-3.5" />
                        <span className="truncate">{workspaceButtonLabel}</span>
                        <ChevronDown className="size-3 opacity-60" />
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
                            const selected =
                              workspace.path === detectedWorkspacePath
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
                                    {workspace.name ||
                                      shortPathLabel(workspace.path)}
                                  </span>
                                  {selected ? (
                                    <Check className="size-3.5" />
                                  ) : null}
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
                            handleThinkingSelect(
                              nextThinkingLevel(thinkingLevel),
                            )
                            return
                          }
                          setThinkingMenuOpen((o) => !o)
                        }}
                        disabled={disabled}
                        title={`Reasoning effort: ${thinkingLabel(thinkingLevel)} (⇧-click to cycle)`}
                        className={cn(
                          'ml-1 hidden items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-card-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50 sm:inline-flex',
                          thinkingLevel === 'off' && 'opacity-70',
                        )}
                      >
                        <Brain className="size-3.5" />
                        <span className="truncate">
                          {thinkingLabel(thinkingLevel)}
                        </span>
                        <ChevronDown className="size-3 opacity-60" />
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

                <div className="flex-1" />

                {/* live context counter (real ContextBar) */}
                <ContextBar compact sessionId={sessionKey} />

                {/* send / stop */}
                {isLoading ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="destructive"
                        onClick={() => onAbort?.()}
                        aria-label="Stop generation"
                        className="rounded-full"
                      >
                        <Square className="size-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Stop generation</TooltipContent>
                  </Tooltip>
                ) : (
                  <Button
                    type="button"
                    size="icon-sm"
                    onClick={handleSubmit}
                    disabled={!canSend}
                    aria-label="Send message"
                    className="rounded-full"
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                )}
              </div>
            </div>

          {/* slash menu (real SlashCommandMenu — self-positions above the
              composer wrapper above). */}
          <SlashCommandMenu
            ref={slashMenuRef}
            open={isSlashMenuOpen}
            query={slashCommandQuery ?? ''}
            onSelect={handleSelectSlashCommand}
          />
        </div>
      </div>
    </TooltipProvider>
  )
}

const MemoizedChatComposerShadcn = React.memo(ChatComposerShadcn)

export { MemoizedChatComposerShadcn as ChatComposerShadcn }
export type { ChatComposerShadcnProps }
