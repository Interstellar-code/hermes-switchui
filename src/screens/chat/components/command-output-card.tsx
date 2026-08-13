import { useState } from 'react'

import {
  selectCommandOutputs,
  useCommandOutputStore,
} from '../../../stores/command-output-store'
import type { CommandOutputEntry } from '../../../stores/command-output-store'
import { cn } from '@/lib/utils'

/**
 * The output of an agent slash command, rendered next to the conversation but
 * never part of it.
 *
 * **Why `<pre>` and not markdown** (§7.3 of the plan): the slash worker builds
 * its output with `Console(file=buf, force_terminal=True, width=120)`
 * (`tui_gateway/slash_worker.py:103`) and strips ANSI on the way out. What
 * arrives is escape-free but *hard-wrapped to 120 columns* and full of
 * box-drawing characters — `+---+`, `|`, `──`. A markdown renderer would eat
 * the pipes as table syntax and reflow the wrapping into nonsense. Monospace,
 * preserved whitespace, and its own horizontal scroller are the only rendering
 * that keeps it readable, and the page body must never scroll sideways because
 * a `/tools` listing is 8kB of box art.
 *
 * **Why it is collapsible**: `/help` is 18kB and `/tools` 8kB, measured against
 * the live agent. Long output starts collapsed to a fixed-height window with an
 * explicit expander; nothing is ever truncated away.
 */

/** Output longer than this opens collapsed. */
const COLLAPSE_AFTER_LINES = 14

function lineCount(text: string): number {
  let count = 1
  for (const char of text) {
    if (char === '\n') count += 1
  }
  return count
}

export function CommandOutputCard({
  entry,
  onDismiss,
}: {
  entry: CommandOutputEntry
  onDismiss?: () => void
}) {
  const long = lineCount(entry.output) > COLLAPSE_AFTER_LINES
  const [expanded, setExpanded] = useState(!long)

  return (
    <div
      data-testid="command-output-card"
      data-command={entry.command}
      className="mx-auto w-full max-w-3xl rounded-lg border px-3 py-2 my-2"
      style={{
        borderColor:
          'var(--m-border, var(--theme-border, rgba(255,255,255,0.08)))',
        background: 'var(--color-surface, var(--theme-card, rgba(0,0,0,0.15)))',
      }}
    >
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono font-semibold">{entry.command}</span>
        <span
          className="text-[10px] uppercase tracking-wide"
          style={{ color: 'var(--m-muted,var(--theme-muted,#6b7280))' }}
        >
          agent output
        </span>
        <span className="ml-auto flex items-center gap-1">
          {long ? (
            <button
              type="button"
              className="rounded px-1.5 py-0.5 text-[11px] underline-offset-2 hover:underline"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? 'Collapse' : 'Expand'}
            </button>
          ) : null}
          {onDismiss ? (
            <button
              type="button"
              aria-label={`Dismiss ${entry.command} output`}
              className="rounded px-1.5 py-0.5 text-[11px] underline-offset-2 hover:underline"
              onClick={onDismiss}
            >
              Dismiss
            </button>
          ) : null}
        </span>
      </div>

      {entry.warning ? (
        <p className="mt-1 text-[11px]" style={{ color: 'var(--m-warn,#f59e0b)' }}>
          {entry.warning}
        </p>
      ) : null}

      {/* overflow-x on the <pre> itself: 120-column output must scroll inside
          this card, never widen the page. */}
      <pre
        className={cn(
          'mt-1 overflow-x-auto whitespace-pre font-mono text-[11px] leading-[1.35]',
          !expanded && 'max-h-56 overflow-y-hidden',
        )}
      >
        {entry.output || '(no output)'}
      </pre>

      {long && !expanded ? (
        <button
          type="button"
          className="mt-1 text-[11px] underline-offset-2 hover:underline"
          style={{ color: 'var(--m-muted,var(--theme-muted,#6b7280))' }}
          onClick={() => setExpanded(true)}
        >
          Show all {lineCount(entry.output)} lines
        </button>
      ) : null}
    </div>
  )
}

/** Every pending output card for a session, oldest first. */
export function CommandOutputList({
  sessionKey,
}: {
  sessionKey: string | null | undefined
}) {
  const entries = useCommandOutputStore((state) =>
    selectCommandOutputs(state, sessionKey),
  )
  const dismissOutput = useCommandOutputStore((state) => state.dismissOutput)

  if (entries.length === 0) return null

  return (
    <div data-testid="command-output-list">
      {entries.map((entry) => (
        <CommandOutputCard
          key={entry.id}
          entry={entry}
          onDismiss={() => dismissOutput(sessionKey, entry.id)}
        />
      ))}
    </div>
  )
}
