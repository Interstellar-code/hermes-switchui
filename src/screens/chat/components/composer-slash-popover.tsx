import { memo } from 'react'
import { cn } from '@/lib/utils'

export type SlashCommandItem = {
  command: string
  description?: string
  category?: string
}

export function filterSlashCommands<T extends SlashCommandItem>(
  commands: Array<T>,
  query: string,
  maxResults = 8,
): Array<T> {
  const clean = query.trim().replace(/^\//, '').toLowerCase()
  if (!clean) {
    return commands.slice(0, maxResults)
  }

  const prefixMatches: Array<T> = []
  const substringMatches: Array<T> = []

  for (const cmd of commands) {
    const rawName = cmd.command.replace(/^\//, '').toLowerCase()
    if (rawName.startsWith(clean)) {
      prefixMatches.push(cmd)
    } else if (
      rawName.includes(clean) ||
      cmd.description?.toLowerCase().includes(clean)
    ) {
      substringMatches.push(cmd)
    }
  }

  return [...prefixMatches, ...substringMatches].slice(0, maxResults)
}

export function renderHighlightedCommand(command: string, query: string) {
  const cleanQuery = query.trim().replace(/^\//, '')
  if (!cleanQuery) return command

  const idx = command.toLowerCase().indexOf(cleanQuery.toLowerCase())
  if (idx === -1) return command

  const before = command.slice(0, idx)
  const match = command.slice(idx, idx + cleanQuery.length)
  const after = command.slice(idx + cleanQuery.length)

  return (
    <>
      {before}
      <span className="text-[var(--theme-accent)] font-semibold underline decoration-[var(--theme-accent)]/40 underline-offset-2">
        {match}
      </span>
      {after}
    </>
  )
}

export type ComposerSlashPopoverProps<T extends SlashCommandItem> = {
  query: string
  commands: Array<T>
  activeIndex: number
  onSelect: (command: T) => void
  onHover?: (index: number) => void
  className?: string
}

export const ComposerSlashPopover = memo(function ComposerSlashPopover<
  T extends SlashCommandItem,
>({
  query,
  commands,
  activeIndex,
  onSelect,
  onHover,
  className,
}: ComposerSlashPopoverProps<T>) {
  if (commands.length === 0) return null

  return (
    <div
      role="listbox"
      aria-label="Slash commands"
      data-testid="composer-slash-popover"
      className={cn(
        'absolute bottom-full left-0 mb-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] text-[var(--theme-text)] shadow-lg z-50 animate-in fade-in-0 zoom-in-95 duration-100',
        className,
      )}
    >
      <div className="max-h-64 overflow-y-auto p-1.5 space-y-0.5">
        {commands.map((cmd, index) => {
          const isActive = index === activeIndex
          return (
            <div
              key={cmd.command}
              role="option"
              aria-selected={isActive}
              data-testid={`slash-command-item-${index}`}
              onMouseEnter={() => onHover?.(index)}
              onClick={() => onSelect(cmd)}
              className={cn(
                'group flex items-center justify-between gap-3 px-2.5 py-1.5 rounded-lg text-xs cursor-pointer select-none transition-colors',
                isActive
                  ? 'bg-[var(--theme-accent)]/15 text-[var(--theme-accent)] font-medium'
                  : 'text-[var(--theme-text)] hover:bg-[var(--theme-card2)]',
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono font-medium text-[13px] tracking-tight shrink-0">
                  {renderHighlightedCommand(cmd.command, query)}
                </span>
                {cmd.description && (
                  <span
                    className={cn(
                      'truncate text-[11px]',
                      isActive
                        ? 'text-[var(--theme-text)] opacity-90'
                        : 'text-[var(--theme-muted)]',
                    )}
                  >
                    {cmd.description}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Footer hint */}
      <div className="border-t border-[var(--theme-border)]/60 bg-[var(--theme-card2)]/50 px-3 py-1.5 text-[10.5px] font-mono text-[var(--theme-muted)] flex items-center justify-between">
        <span>↑↓ navigate · Tab select · Esc close</span>
      </div>
    </div>
  )
})
