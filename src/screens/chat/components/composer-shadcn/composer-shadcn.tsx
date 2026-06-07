import * as React from 'react'
import { ArrowUp, Paperclip, Reply, X } from 'lucide-react'

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

import { MOCK_REPLY_TARGET } from './mock-data'
import { useAutocomplete } from './use-autocomplete'

// ─── Sent-message log (sandbox-only; replaces real send) ───────────────────
type SentEntry = { id: string; text: string; attachmentCount: number }

type Attachment = {
  id: string
  preview: string // base64 data URL
  fileName: string
  fileType: string
}

let attachmentCounter = 0

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function ComposerShadcn() {
  const [value, setValue] = React.useState('')
  const [attachments, setAttachments] = React.useState<Attachment[]>([])
  const [replyTo, setReplyTo] = React.useState<typeof MOCK_REPLY_TARGET | null>(
    null,
  )
  const [sent, setSent] = React.useState<SentEntry[]>([])

  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const autocomplete = useAutocomplete()

  // ─── Feature 1: auto-grow textarea ───────────────────────────────────────
  React.useLayoutEffect(() => {
    const ta = textareaRef.current
    if (!ta) {
      return
    }
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 240)}px`
  }, [value])

  const canSend = value.trim().length > 0 || attachments.length > 0

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
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
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
              {/* Feature 3: file-picker */}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Attach image"
              >
                <Paperclip className="size-4" />
              </Button>

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
  )
}
