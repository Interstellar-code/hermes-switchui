import * as React from 'react'
import { ArrowUp } from 'lucide-react'

import { Button } from '@/components/shadcn/ui/button'
import { Textarea } from '@/components/shadcn/ui/textarea'

// ─── Sent-message log (sandbox-only; replaces real send) ───────────────────
type SentEntry = { id: string; text: string; attachmentCount: number }

export function ComposerShadcn() {
  const [value, setValue] = React.useState('')
  const [sent, setSent] = React.useState<SentEntry[]>([])

  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  // ─── Feature 1: auto-grow textarea ───────────────────────────────────────
  React.useLayoutEffect(() => {
    const ta = textareaRef.current
    if (!ta) {
      return
    }
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 240)}px`
  }, [value])

  const canSend = value.trim().length > 0

  const handleSend = () => {
    if (!canSend) {
      return
    }
    setSent((prev) => [
      { id: `sent-${prev.length + 1}`, text: value, attachmentCount: 0 },
      ...prev,
    ])
    setValue('')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Feature 1: Enter to send, Shift+Enter for newline.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
      {/* ─── Composer card ───────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-border bg-card text-card-foreground shadow-sm ring-1 ring-border focus-within:ring-2 focus-within:ring-ring">
        {/* Feature 1: textarea */}
        <div className="px-2 pt-2">
          <Textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder="Message the agent…"
            className="max-h-60 min-h-[56px] resize-none border-0 bg-transparent px-2 py-2 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
        </div>

        {/* Footer toolbar */}
        <div className="flex items-center gap-1 px-3 pb-2 pt-1">
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
