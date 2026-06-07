import * as React from 'react'
import {
  ArrowUp,
  Bot,
  Brain,
  Check,
  ChevronDown,
  Image as ImageIcon,
  ListPlus,
  Paperclip,
  Reply,
  X,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/shadcn/ui/button'
import { Textarea } from '@/components/shadcn/ui/textarea'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/shadcn/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/shadcn/ui/command'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/shadcn/ui/tooltip'

import {
  MOCK_CONTEXT,
  MOCK_MODELS,
  MOCK_REPLY_TARGET,
  MOCK_SESSION,
  type MockModel,
} from './mock-data'
import { useAutocomplete } from './use-autocomplete'

const QUEUE_STORAGE_KEY = 'composer-shadcn:queue'

// ─── Sent-message log (sandbox-only; replaces real send) ───────────────────
type SentEntry = { id: string; text: string; attachmentCount: number }

type Attachment = {
  id: string
  preview: string // base64 data URL
  fileName: string
  fileType: string
}

type QueueItem = {
  id: string
  text: string
  status: 'pending' | 'sent'
}

let attachmentCounter = 0

function fmtTokens(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`
  }
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}k`
  }
  return String(n)
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function groupModelsByProvider(models: MockModel[]): Record<string, MockModel[]> {
  const groups: Record<string, MockModel[]> = {}
  for (const m of models) {
    const key = m.provider || 'other'
    ;(groups[key] ??= []).push(m)
  }
  return groups
}

export function ComposerShadcn() {
  const [value, setValue] = React.useState('')
  const [attachments, setAttachments] = React.useState<Attachment[]>([])
  const [replyTo, setReplyTo] = React.useState<typeof MOCK_REPLY_TARGET | null>(
    null,
  )
  const [queue, setQueue] = React.useState<QueueItem[]>([])
  const [queueRunning, setQueueRunning] = React.useState(false)
  const [activeModelId, setActiveModelId] = React.useState(MOCK_MODELS[0].id)
  const [modelMenuOpen, setModelMenuOpen] = React.useState(false)
  const [sent, setSent] = React.useState<SentEntry[]>([])

  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const autocomplete = useAutocomplete()

  const activeModel =
    MOCK_MODELS.find((m) => m.id === activeModelId) ?? MOCK_MODELS[0]
  const modelGroups = groupModelsByProvider(MOCK_MODELS)

  // ─── Feature 1: auto-grow textarea ───────────────────────────────────────
  React.useLayoutEffect(() => {
    const ta = textareaRef.current
    if (!ta) {
      return
    }
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 240)}px`
  }, [value])

  // ─── Feature 5: queue persistence (localStorage) ─────────────────────────
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(QUEUE_STORAGE_KEY)
      if (raw) {
        setQueue(JSON.parse(raw) as QueueItem[])
      }
    } catch {
      // ignore malformed storage
    }
  }, [])
  React.useEffect(() => {
    try {
      localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue))
    } catch {
      // ignore quota errors
    }
  }, [queue])

  const canSend = value.trim().length > 0 || attachments.length > 0

  // ─── Feature 6: live context counter ─────────────────────────────────────
  const ctxRatio =
    MOCK_CONTEXT.total > 0
      ? Math.min(MOCK_CONTEXT.used / MOCK_CONTEXT.total, 1)
      : 0
  const ctxColor =
    ctxRatio >= 0.85
      ? 'text-destructive'
      : ctxRatio >= 0.6
        ? 'text-secondary-foreground'
        : 'text-muted-foreground'

  // ─── Feature 3: image paste / attach ─────────────────────────────────────
  const addFiles = React.useCallback(async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/'))
    if (images.length === 0) {
      return
    }
    const next: Attachment[] = []
    for (const file of images) {
      const preview = await readFileAsDataUrl(file)
      next.push({
        id: `att-${++attachmentCounter}`,
        preview,
        fileName: file.name,
        fileType: file.type,
      })
    }
    setAttachments((prev) => [...prev, ...next])
  }, [])

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) {
      return
    }
    const files: File[] = []
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const f = items[i].getAsFile()
        if (f) {
          files.push(f)
        }
      }
    }
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

  // ─── Feature 4: reply-to quoting ─────────────────────────────────────────
  const clearReply = () => setReplyTo(null)

  const buildOutgoing = () => {
    const replyPrefix = replyTo
      ? `> [Re: #${replyTo.seq}] ${replyTo.preview}\n\n`
      : ''
    return replyPrefix + value
  }

  const handleSend = () => {
    if (!canSend) {
      return
    }
    setSent((prev) => [
      {
        id: `sent-${prev.length + 1}`,
        text: buildOutgoing(),
        attachmentCount: attachments.length,
      },
      ...prev,
    ])
    setValue('')
    setAttachments([])
    setReplyTo(null)
    autocomplete.dismiss()
  }

  // ─── Feature 5: message queue controls ───────────────────────────────────
  const addToQueue = () => {
    if (!value.trim()) {
      return
    }
    setQueue((prev) => [
      ...prev,
      { id: `q-${Date.now()}`, text: value.trim(), status: 'pending' },
    ])
    setValue('')
  }
  const startQueue = () => setQueueRunning(true)
  const stopQueue = () => setQueueRunning(false)
  const clearQueue = () => {
    setQueue([])
    setQueueRunning(false)
  }
  const removeQueueItem = (id: string) =>
    setQueue((prev) => prev.filter((q) => q.id !== id))

  const updateValue = React.useCallback((next: string, cursor?: number) => {
    setValue(next)
    const pos = cursor ?? next.length
    requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (ta) {
        ta.focus()
        ta.setSelectionRange(pos, pos)
      }
    })
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value
    setValue(next)
    autocomplete.sync(next, e.target.selectionStart ?? next.length)
  }

  // ─── Feature 2: slash / @ autocomplete selection ─────────────────────────
  const applyAutocomplete = (index: number) => {
    const result = autocomplete.applySelection(index, value)
    if (result) {
      updateValue(result.value, result.cursor)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Autocomplete intercepts arrows / enter / esc / tab while open.
    if (autocomplete.handleKeyDown(e)) {
      if (
        (e.key === 'Enter' || e.key === 'Tab') &&
        autocomplete.filteredItems.length > 0
      ) {
        applyAutocomplete(autocomplete.selectedIndex)
      }
      return
    }
    // Feature 1: Enter to send, Shift+Enter for newline.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
        {/* ─── Feature 7: inline model + session badges row ───────────────── */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-card-foreground">
            <span aria-hidden>{MOCK_SESSION.agentEmoji}</span>
            <span className="font-medium">{MOCK_SESSION.agentName}</span>
          </span>
          <span className="inline-flex items-center rounded-md border border-border bg-muted px-2 py-1 text-muted-foreground">
            {MOCK_SESSION.agentRole}
          </span>
          <span className="inline-flex items-center rounded-md border border-border bg-muted px-2 py-1 text-muted-foreground">
            {MOCK_SESSION.kind} · {MOCK_SESSION.channel}
          </span>
          <span className="inline-flex items-center rounded-md border border-border bg-muted px-2 py-1 text-muted-foreground">
            {MOCK_SESSION.project}
          </span>

          {/* Model selector badge (provider-grouped) */}
          <Popover open={modelMenuOpen} onOpenChange={setModelMenuOpen}>
            <PopoverAnchor asChild>
              <button
                type="button"
                onClick={() => setModelMenuOpen((o) => !o)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-card-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <Bot className="size-3.5" />
                <span className="font-medium">{activeModel.name}</span>
                {activeModel.reasoning ? (
                  <Brain className="size-3 text-secondary-foreground" />
                ) : null}
                <ChevronDown className="size-3 opacity-60" />
              </button>
            </PopoverAnchor>
            <PopoverContent
              align="start"
              className="w-72 p-0"
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <div className="max-h-80 overflow-y-auto">
                {Object.entries(modelGroups).map(([provider, models]) => (
                  <div key={provider}>
                    <div className="sticky top-0 border-b border-border bg-popover px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      {provider}
                    </div>
                    {models.map((m) => {
                      const selected = m.id === activeModelId
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            setActiveModelId(m.id)
                            setModelMenuOpen(false)
                          }}
                          className={cn(
                            'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground',
                            selected && 'bg-accent/50',
                          )}
                        >
                          <span className="flex-1 truncate">{m.name}</span>
                          {m.reasoning ? (
                            <Brain className="size-3 text-secondary-foreground" />
                          ) : null}
                          {m.vision ? (
                            <ImageIcon className="size-3 text-muted-foreground" />
                          ) : null}
                          {selected ? <Check className="size-3.5" /> : null}
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>

      {/* ─── Feature 5: queue panel ──────────────────────────────────────── */}
      {queue.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border bg-muted px-3 py-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">
              Queue ({queue.length})
              {queueRunning ? (
                <span className="ml-2 text-primary">running…</span>
              ) : null}
            </span>
            <div className="flex items-center gap-1">
              {queueRunning ? (
                <button
                  type="button"
                  onClick={stopQueue}
                  className="rounded-md bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive transition-colors hover:bg-destructive/20"
                >
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  onClick={startQueue}
                  className="rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary transition-colors hover:bg-primary/20"
                >
                  Start
                </button>
              )}
              <button
                type="button"
                onClick={clearQueue}
                className="rounded-md px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Clear
              </button>
            </div>
          </div>
          <div className="max-h-32 overflow-y-auto">
            {queue.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 px-3 py-1.5 text-xs text-foreground"
              >
                <span className="flex-1 truncate">{item.text}</span>
                <button
                  type="button"
                  onClick={() => removeQueueItem(item.id)}
                  className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label="Remove from queue"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Composer card ───────────────────────────────────────────────── */}
      <Popover open={autocomplete.isOpen}>
        <PopoverAnchor asChild>
          <div className="rounded-2xl border border-border bg-card text-card-foreground shadow-sm ring-1 ring-border focus-within:ring-2 focus-within:ring-ring">
            {/* Feature 4: reply-to chip */}
            {replyTo && (
              <div className="flex items-center gap-2 px-4 pt-3">
                <div className="flex min-w-0 max-w-full items-center gap-2 rounded-lg border border-border bg-muted px-3 py-1.5 text-xs text-muted-foreground">
                  <Reply className="size-3 shrink-0 text-primary" />
                  <span className="shrink-0 font-medium text-primary">
                    #{replyTo.seq}
                  </span>
                  <span className="truncate">{replyTo.preview}</span>
                  <button
                    type="button"
                    onClick={clearReply}
                    className="ml-1 shrink-0 transition-colors hover:text-foreground"
                    aria-label="Dismiss reply"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              </div>
            )}

            {/* Feature 3: attachment thumbnails */}
            {attachments.length > 0 && (
              <div className="flex items-center gap-2 overflow-x-auto px-4 pt-3">
                {attachments.map((att) => (
                  <div key={att.id} className="group/att relative shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={att.preview}
                      alt={att.fileName}
                      className="size-12 rounded-lg border border-border object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeAttachment(att.id)}
                      className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border border-border bg-background opacity-0 shadow-sm transition-opacity hover:border-destructive hover:bg-destructive hover:text-destructive-foreground group-hover/att:opacity-100"
                      aria-label="Remove attachment"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Feature 1: textarea */}
            <div className="px-2 pt-2" onPaste={handlePaste}>
              <Textarea
                ref={textareaRef}
                value={value}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                rows={1}
                placeholder="Message the agent…  (try / or @, paste an image)"
                className="max-h-60 min-h-[56px] resize-none border-0 bg-transparent px-2 py-2 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
              />
            </div>

            {/* Footer toolbar */}
            <div className="flex items-center gap-1 px-3 pb-2 pt-1">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={handleFilePick}
              />
              {/* Feature 3: file-picker (Feature 7: tooltip) */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="Attach image"
                  >
                    <Paperclip className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Attach image</TooltipContent>
              </Tooltip>

              {/* Feature 4: reply demo trigger (sandbox affordance) */}
              {!replyTo && (
                <button
                  type="button"
                  onClick={() => setReplyTo(MOCK_REPLY_TARGET)}
                  className="flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <Reply className="size-3.5" />
                  <span className="hidden sm:inline">Reply</span>
                </button>
              )}

              <div className="flex-1" />

              {/* Feature 6: live context counter (color-coded by fill ratio) */}
              <span
                className={cn(
                  'mr-1 select-none font-mono text-[11px] tabular-nums',
                  ctxColor,
                )}
                title={`Context: ${(ctxRatio * 100).toFixed(0)}% used`}
              >
                {fmtTokens(MOCK_CONTEXT.used)} / {fmtTokens(MOCK_CONTEXT.total)}
              </span>

              {/* Feature 7: compact model badge */}
              <span className="mr-1 hidden items-center gap-1 rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline-flex">
                <Bot className="size-3" />
                {activeModel.name}
              </span>

              {/* Feature 5: add-to-queue */}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={addToQueue}
                disabled={!value.trim()}
                aria-label="Add to queue"
              >
                <ListPlus className="size-4" />
              </Button>

              {/* Feature 1: send */}
              <Button
                type="button"
                size="icon-sm"
                onClick={handleSend}
                disabled={!canSend}
                aria-label="Send message"
                className="rounded-full"
              >
                <ArrowUp className="size-4" />
              </Button>
            </div>
          </div>
        </PopoverAnchor>

        {/* Feature 2: autocomplete popover anchored to the composer */}
        <PopoverContent
          align="start"
          sideOffset={6}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="w-80 p-0"
        >
          <Command shouldFilter={false}>
            <CommandList>
              <CommandEmpty>No matches.</CommandEmpty>
              <CommandGroup
                heading={autocomplete.triggerMode === '/' ? 'Commands' : 'Mentions'}
              >
                {autocomplete.filteredItems.map((item, index) => (
                  <CommandItem
                    key={item.id}
                    value={item.label}
                    onSelect={() => applyAutocomplete(index)}
                    className={cn(
                      index === autocomplete.selectedIndex &&
                        'bg-accent text-accent-foreground',
                    )}
                  >
                    <span className="font-mono text-sm">{item.label}</span>
                    {item.description ? (
                      <span className="ml-auto truncate text-xs text-muted-foreground">
                        {item.description}
                      </span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {sent.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-3 text-card-foreground">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Sent (mock)
          </div>
          <div className="flex flex-col gap-1.5">
            {sent.map((entry) => (
              <div key={entry.id} className="text-xs text-foreground">
                <span className="whitespace-pre-wrap">{entry.text}</span>
                {entry.attachmentCount > 0 ? (
                  <span className="ml-2 text-muted-foreground">
                    (+{entry.attachmentCount} image
                    {entry.attachmentCount > 1 ? 's' : ''})
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )}
      </div>
    </TooltipProvider>
  )
}
