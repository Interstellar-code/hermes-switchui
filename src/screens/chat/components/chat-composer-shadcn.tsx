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
// ─── TOOLBAR (icons + send only) ────────────────────────────────────────────
// The model / profile / workspace / thinking-level SELECTORS have been
// relocated out of this toolbar into the top meta bar (see
// `./v2/session-selectors-v2.tsx`). This composer's bottom toolbar now owns
// only icon controls + the context ring + send/stop:
//  - Attach / voice / fast-mode / web-search / system-messages / new-chat icons
//  - Live ContextBar (context ring)
//  - Send / Stop
//
// The composer still receives `thinkingLevel` (READ-ONLY) so the fast-mode gate
// `effectiveFastMode = fastMode && thinkingLevel === 'off'` keeps working; it no
// longer owns the thinking-level setter (`onThinkingLevelChange` lives on the
// meta-bar selectors now).
//
// ─── REMAINING PARITY-GAP TODOs (out of scope for this pass) ────────────────
//  - Mobile docking / portal behavior — the live composer docks fixed to the
//    viewport bottom on mobile; this drop-in stays inline (honors `embedded`
//    only insofar as it never docks).

import * as React from 'react'
import {
  ArrowUp,
  Check,
  Clock,
  Eye,
  EyeOff,
  Globe,
  ListPlus,
  Mic,
  Paperclip,
  Reply,
  Square,
  SquarePen,
  Trash2,
  X,
  Zap,
} from 'lucide-react'

import { useShallow } from 'zustand/react/shallow'
import { ContextBar } from './context-bar'
import {
  MAX_ATTACHMENT_FILE_SIZE,
  compressImageToDataUrl,
  formatFileSize,
  isCanvasSupported,
} from './chat-composer'
import type {
  ChatComposerAttachment,
  ChatComposerHandle,
  ChatComposerHelpers,
  ModelSwitchNotice,
  ThinkingLevel,
} from './chat-composer'
import type { Ref } from 'react'
import type {MessageQueueActivity, QueuedChatMessage} from '@/stores/chat-store';
import type {SlashCommandDefinition, SlashCommandMenuHandle} from '@/components/slash-command-menu';
import { cn } from '@/lib/utils'
import { Button } from '@/components/shadcn/ui/button'
import { Textarea } from '@/components/shadcn/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/shadcn/ui/tooltip'
import {
  
  SlashCommandMenu
  
} from '@/components/slash-command-menu'
import {
  
  
  normalizeMessageQueueSessionKey,
  useChatStore
} from '@/stores/chat-store'
import { useVoiceInput } from '@/hooks/use-voice-input'
import { useVoiceRecorder } from '@/hooks/use-voice-recorder'


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
  /** Read-only — used only to gate fast mode. The thinking-level selector
   *  lives in the meta bar now (see `./v2/session-selectors-v2.tsx`). */
  thinkingLevel?: ThinkingLevel
  onAbort?: () => void
  embedded?: boolean
  replyTo?: { seq: number; role: string; preview: string } | null
  onClearReply?: () => void
  systemMessagesHidden?: boolean
  onToggleSystemMessages?: () => void
}

const MAX_TEXTAREA_HEIGHT = 240
const REPLY_MARKER_SNIPPET_LIMIT = 140
const REPLY_PREVIEW_SNIPPET_LIMIT = 80
const QUEUE_ACTIVITY_VISIBLE_MS = 12_000
const EMPTY_MESSAGE_QUEUE: Array<QueuedChatMessage> = []

function normalizeReplySnippet(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function truncateReplySnippet(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength).trimEnd()}…`
}

function formatReplyMarker(replyTo: {
  seq: number
  role: string
  preview: string
}): string {
  const snippet = truncateReplySnippet(
    normalizeReplySnippet(replyTo.preview),
    REPLY_MARKER_SNIPPET_LIMIT,
  )
  return `> [Re: #${replyTo.seq}] ${snippet}\n\n`
}

// ─── Attachment helpers (parity-correct ChatComposerAttachment shape) ──────
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
  onOversize?: (message: string) => void,
): Promise<ChatComposerAttachment | null> {
  // Reject files that exceed the input cap before any processing.
  if (file.size > MAX_ATTACHMENT_FILE_SIZE) {
    onOversize?.(
      `"${file.name || 'file'}" is ${formatFileSize(file.size)}. Max upload input size is ${formatFileSize(MAX_ATTACHMENT_FILE_SIZE)}.`,
    )
    return null
  }

  const isImage = file.type.startsWith('image/')

  let dataUrl: string | null
  if (isImage && isCanvasSupported()) {
    // Compress: resize to 1920px longest side, iteratively lower JPEG quality
    // until under MAX_TRANSPORT_IMAGE_SIZE (1 MB). Fall back to raw read on
    // compression failure (e.g. unsupported format like SVG/AVIF/HEIC).
    const compressed = await compressImageToDataUrl(file).catch(() => null)
    dataUrl = compressed ?? (await readFileAsDataUrl(file))
  } else {
    dataUrl = await readFileAsDataUrl(file)
  }

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

function getQueuedMessagePreview(item: QueuedChatMessage): string {
  const text = item.text.trim()
  if (text.length > 0) return text
  const attachmentCount = item.attachments.length
  if (attachmentCount === 1) return '1 attachment'
  return `${attachmentCount} attachments`
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
  onNewSession,
  onToggleWebSearch,
  webSearchEnabled,
  embedded: _embedded,
  replyTo,
  onClearReply,
  systemMessagesHidden,
  onToggleSystemMessages,
}: ChatComposerShadcnProps) {
  const [value, setValue] = React.useState('')
  const [attachments, setAttachments] = React.useState<
    Array<ChatComposerAttachment>
  >([])
  const [isSlashMenuDismissed, setIsSlashMenuDismissed] = React.useState(false)
  const [modelNotice, setModelNotice] =
    React.useState<ModelSwitchNotice | null>(null)
  const [fastMode, setFastMode] = React.useState(false)
  const [isWebSearchMode, setIsWebSearchMode] = React.useState(false)

  // Thinking level is read-only here — owned by chat-screen / meta-bar
  // selectors. The composer only needs it to gate fast mode.
  const thinkingLevel = externalThinkingLevel ?? 'low'
  const isWebSearchActive = webSearchEnabled ?? isWebSearchMode

  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const slashMenuRef = React.useRef<SlashCommandMenuHandle | null>(null)
  const submittingRef = React.useRef(false)
  const queueSessionKey = sessionKey
    ? normalizeMessageQueueSessionKey(sessionKey)
    : null
  const queuedMessages = useChatStore((s) =>
    queueSessionKey
      ? (s.messageQueue[queueSessionKey] ?? EMPTY_MESSAGE_QUEUE)
      : EMPTY_MESSAGE_QUEUE,
  )
  const queueActivity = useChatStore((s) =>
    queueSessionKey ? (s.messageQueueActivity[queueSessionKey] ?? null) : null,
  )
  const { enqueue, removeQueued, clearQueue } = useChatStore(
    useShallow((s) => ({
      enqueue: s.enqueue,
      removeQueued: s.removeQueued,
      clearQueue: s.clearQueue,
    })),
  )
  const [visibleQueueActivity, setVisibleQueueActivity] =
    React.useState<MessageQueueActivity | null>(null)

  React.useEffect(() => {
    if (!queueActivity) {
      setVisibleQueueActivity(null)
      return
    }

    setVisibleQueueActivity(queueActivity)
    const timeout = window.setTimeout(() => {
      setVisibleQueueActivity((current) =>
        current?.occurredAt === queueActivity.occurredAt ? null : current,
      )
    }, QUEUE_ACTIVITY_VISIBLE_MS)

    return () => window.clearTimeout(timeout)
  }, [queueActivity])

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
      const onOversize = (message: string) =>
        setModelNotice({ tone: 'error', message })
      const built = await Promise.all(
        files.map((f) => buildAttachment(f, onOversize)),
      )
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
    !disabled &&
    !isLoading &&
    (value.trim().length > 0 || attachments.length > 0)
  const canQueue =
    !disabled &&
    isLoading &&
    queueSessionKey !== null &&
    (value.trim().length > 0 || attachments.length > 0)
  const showQueuePanel =
    queueSessionKey !== null &&
    (queuedMessages.length > 0 || visibleQueueActivity !== null)

  const handleSubmit = React.useCallback(() => {
    if (disabled || isLoading || submittingRef.current) return
    const rawBody = value.trim()
    if (rawBody.length === 0 && attachments.length === 0) return
    submittingRef.current = true
    const attachmentPayload = attachments.map((a) => ({ ...a }))
    const body = replyTo ? `${formatReplyMarker(replyTo)}${rawBody}` : rawBody
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
    onClearReply?.()
    focusPrompt()
  }, [
    disabled,
    isLoading,
    value,
    attachments,
    replyTo,
    onClearReply,
    onSubmit,
    helpers,
    focusPrompt,
    fastMode,
    thinkingLevel,
  ])

  const handleQueueSubmit = React.useCallback(() => {
    if (!queueSessionKey || disabled || submittingRef.current) return
    const rawBody = value.trim()
    if (rawBody.length === 0 && attachments.length === 0) return

    const replySnippet = replyTo
      ? replyTo.preview.replace(/\s+/g, ' ').trim()
      : ''
    const body = replyTo
      ? `> [Re: #${replyTo.seq}] ${replySnippet.length > 140 ? `${replySnippet.slice(0, 140)}…` : replySnippet}\n\n${rawBody}`
      : rawBody

    submittingRef.current = true
    enqueue(queueSessionKey, {
      id: crypto.randomUUID(),
      text: body,
      attachments: attachments.map((a) => ({ ...a })),
    })
    window.setTimeout(() => {
      submittingRef.current = false
    }, 300)
    setValue('')
    setAttachments([])
    setIsSlashMenuDismissed(false)
    onClearReply?.()
    focusPrompt()
  }, [
    attachments,
    disabled,
    enqueue,
    focusPrompt,
    onClearReply,
    queueSessionKey,
    replyTo,
    value,
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
      if (isLoading) {
        handleQueueSubmit()
        return
      }
      handleSubmit()
    }
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div
        ref={wrapperRef}
        className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-3 pt-2 pb-6 sm:px-5 md:pb-8"
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

        {/* reply-to chip — shows when a message is being replied to */}
        {replyTo && (
          <div className="flex items-start gap-2 rounded-lg border border-border/70 border-l-2 border-l-primary bg-muted px-3 py-2 text-xs text-muted-foreground">
            <Reply
              className="mt-0.5 size-3.5 shrink-0 text-primary"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <span className="font-medium text-foreground">
                Reply to #{replyTo.seq}
              </span>
              <span className="mx-1 text-muted-foreground">·</span>
              <span className="align-bottom">
                {truncateReplySnippet(
                  normalizeReplySnippet(replyTo.preview),
                  REPLY_PREVIEW_SNIPPET_LIMIT,
                ) || `${replyTo.role} message`}
              </span>
            </div>
            <button
              type="button"
              onClick={() => onClearReply?.()}
              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Clear reply"
            >
              <X className="size-3.5" />
            </button>
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

        {/* per-session forward-send queue */}
        {showQueuePanel && queueSessionKey ? (
          <div
            className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm"
            aria-live="polite"
          >
            <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <ListPlus className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate text-xs font-medium">
                  Message queue
                </span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  {queuedMessages.length > 0
                    ? queuedMessages.length
                    : visibleQueueActivity?.phase === 'sending'
                      ? isLoading
                        ? 'sending'
                        : 'sent'
                      : 'queued'}
                </span>
                {isLoading ? (
                  <span className="hidden items-center gap-1 text-[11px] text-muted-foreground sm:inline-flex">
                    <Clock className="size-3" />
                    Waiting for stream to finish
                  </span>
                ) : null}
              </div>
              {queuedMessages.length > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => clearQueue(queueSessionKey)}
                  className="h-6 px-2 text-xs"
                >
                  <Trash2 className="size-3" />
                  Clear all
                </Button>
              ) : null}
            </div>
            <div className="max-h-40 overflow-y-auto">
              {visibleQueueActivity ? (
                <div
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 text-sm',
                    queuedMessages.length > 0 && 'border-b border-border/60',
                  )}
                >
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    {visibleQueueActivity.phase === 'sending' ? (
                      <ArrowUp className="size-3" />
                    ) : (
                      <Check className="size-3" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-muted-foreground">
                      {visibleQueueActivity.phase === 'sending'
                        ? isLoading
                          ? 'Sending queued message now'
                          : 'Last queued message was sent'
                        : 'Message added to queue'}
                    </div>
                    <div className="truncate">
                      {getQueuedMessagePreview(visibleQueueActivity.item)}
                    </div>
                  </div>
                </div>
              ) : null}
              {queuedMessages.map((item, index) => {
                const attachmentCount = item.attachments.length
                const label = getQueuedMessagePreview(item)
                return (
                  <div
                    key={item.id}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 text-sm',
                      index < queuedMessages.length - 1 &&
                        'border-b border-border/60',
                    )}
                  >
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{label}</div>
                      {attachmentCount > 0 ? (
                        <div className="truncate text-xs text-muted-foreground">
                          {attachmentCount}{' '}
                          {attachmentCount === 1 ? 'attachment' : 'attachments'}
                        </div>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => removeQueued(queueSessionKey, item.id)}
                      aria-label="Remove queued message"
                    >
                      <X className="size-3" />
                    </Button>
                  </div>
                )
              })}
            </div>
          </div>
        ) : null}

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

                {/* system-messages toggle — Eye/EyeOff based on systemMessagesHidden */}
                {onToggleSystemMessages && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={onToggleSystemMessages}
                        aria-label={
                          systemMessagesHidden
                            ? 'Show system messages'
                            : 'Hide system messages'
                        }
                        aria-pressed={!systemMessagesHidden}
                        className={cn(!systemMessagesHidden && 'text-primary')}
                      >
                        {systemMessagesHidden ? (
                          <EyeOff className="size-4" />
                        ) : (
                          <Eye className="size-4" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {systemMessagesHidden
                        ? 'Show system messages'
                        : 'Hide system messages'}
                    </TooltipContent>
                  </Tooltip>
                )}

                {/* new-chat button */}
                {onNewSession && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={onNewSession}
                        aria-label="New chat"
                      >
                        <SquarePen className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>New chat</TooltipContent>
                  </Tooltip>
                )}

                <div className="flex-1" />

                {/* live context counter (real ContextBar) */}
                <ContextBar compact sessionId={sessionKey} />

                {/* send / stop */}
                {isLoading ? (
                  <>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={handleQueueSubmit}
                          disabled={!canQueue}
                          aria-label="Add to queue"
                          className="rounded-full"
                        >
                          <ListPlus className="size-4" />
                          <span className="hidden sm:inline">
                            Add to queue
                          </span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Add to queue</TooltipContent>
                    </Tooltip>
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
                  </>
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
