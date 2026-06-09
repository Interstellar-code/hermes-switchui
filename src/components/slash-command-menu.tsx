'use client'

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react'
import type { ReactNode, Ref } from 'react'

import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from '@/components/shadcn/ui/popover'
import { Button } from '@/components/shadcn/ui/button'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { useEnabledUserCommands } from '@/lib/commands-api'
import { cn } from '@/lib/utils'

export type SlashCommandSource = 'builtin' | 'user'

export type SlashCommandDefinition = {
  command: string
  description: string
  prompt?: string
  source?: SlashCommandSource
}

export type SlashCommandMenuProps = {
  open: boolean
  query: string
  onSelect: (command: SlashCommandDefinition) => void
}

export type SlashCommandMenuHandle = {
  moveSelection: (step: number) => void
  selectActive: () => boolean
}

export type SlashCommandPickerProps = {
  disabled?: boolean
  onSelect: (command: SlashCommandDefinition) => void
}

export const DEFAULT_SLASH_COMMANDS: Array<SlashCommandDefinition> = [
  { command: '/new', description: 'Start new session', source: 'builtin' },
  {
    command: '/reset',
    description: 'Start a fresh conversation',
    source: 'builtin',
  },
  {
    command: '/clear',
    description: 'Clear screen and start fresh',
    source: 'builtin',
  },
  {
    command: '/stop',
    description: 'Stop the running agent',
    source: 'builtin',
  },
  {
    command: '/title',
    description: 'Set the session title (/title <name>)',
    source: 'builtin',
  },
  {
    command: '/reasoning',
    description: 'Change reasoning effort (off | low | adaptive)',
    source: 'builtin',
  },
  {
    command: '/model',
    description: 'Show or change the current model',
    source: 'builtin',
  },
  {
    command: '/save',
    description: 'Save the current conversation',
    source: 'builtin',
  },
  {
    command: '/skills',
    description: 'Browse and manage skills',
    source: 'builtin',
  },
  {
    command: '/plugins',
    description: 'List installed plugins and their status',
    source: 'builtin',
  },
  { command: '/mcp', description: 'Manage MCP servers', source: 'builtin' },
  {
    command: '/skin',
    description: 'Change the display theme',
    source: 'builtin',
  },
  {
    command: '/help',
    description: 'Show available commands',
    source: 'builtin',
  },
]

type SourceFilter = 'all' | SlashCommandSource

type TabDef = {
  id: SourceFilter
  label: string
  icon: ReactNode
}

const SOURCE_TABS: Array<TabDef> = [
  {
    id: 'all',
    label: 'all',
    icon: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M3 6h18M3 12h18M3 18h18" />
      </svg>
    ),
  },
  {
    id: 'builtin',
    label: 'built-in',
    icon: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    ),
  },
  {
    id: 'user',
    label: 'custom',
    icon: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
]

function normalizeSearchValue(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLocaleLowerCase()
}

export function slashCommandMatches(
  item: SlashCommandDefinition,
  query: string,
): boolean {
  const normalizedQuery = normalizeSearchValue(query)
  if (!normalizedQuery) return true

  return normalizeSearchValue(
    `${item.command} ${item.description} ${item.source ?? ''}`,
  ).includes(normalizedQuery)
}

export function useSlashCommandDefinitions(): Array<SlashCommandDefinition> {
  const commandsQuery = useEnabledUserCommands()

  return useMemo<Array<SlashCommandDefinition>>(() => {
    const userCommands = commandsQuery.data.map((command) => ({
      command: command.slash,
      description: command.description || command.name,
      prompt: command.prompt,
      source: 'user' as const,
    }))
    return [...DEFAULT_SLASH_COMMANDS, ...userCommands]
  }, [commandsQuery.data])
}

function CommandSourceTabs({
  activeTab,
  onTabChange,
  counts,
}: {
  activeTab: SourceFilter
  onTabChange: (tab: SourceFilter) => void
  counts: Record<SourceFilter, number>
}) {
  return (
    <div
      role="tablist"
      aria-label="Filter slash commands by source"
      className="flex items-center gap-0.5 rounded-md p-0.5 mx-2 mt-2"
      style={{
        background: 'var(--m-surface-2, var(--theme-card2, rgba(0,0,0,0.15)))',
        border: '1px solid var(--m-border, var(--theme-border, rgba(255,255,255,0.08)))',
      }}
    >
      {SOURCE_TABS.map((tab) => {
        const isActive = tab.id === activeTab
        const count = counts[tab.id] || 0
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            aria-controls="slash-command-list"
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-mono font-medium transition-all duration-150 select-none',
              isActive
                ? 'text-[var(--m-green,#4ade80)]'
                : 'text-[var(--m-muted,var(--theme-muted,#6b7280))] hover:text-[var(--m-text,var(--theme-text))]',
            )}
            style={
              isActive
                ? {
                    background: 'var(--m-green-10, rgba(74,222,128,0.10))',
                    border: '1px solid var(--m-green-30, rgba(74,222,128,0.30))',
                    boxShadow: 'inset 0 1px 3px rgba(74,222,128,0.10)',
                  }
                : {
                    background: 'transparent',
                    border: '1px solid transparent',
                  }
            }
          >
            <span className={isActive ? 'text-[var(--m-green,#4ade80)]' : ''}>
              {tab.icon}
            </span>
            {tab.label}
            <span
              className="ml-0.5 tabular-nums opacity-60"
              style={{ color: 'var(--m-muted,var(--theme-muted,#6b7280))' }}
            >
              {count}
            </span>
          </button>
        )
      })}
    </div>
  )
}

const SlashCommandMenu = forwardRef(function SlashCommandMenuInner(
  { open, query, onSelect }: SlashCommandMenuProps,
  ref: Ref<SlashCommandMenuHandle>,
) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [sourceTab, setSourceTab] = useState<SourceFilter>('all')
  const commands = useSlashCommandDefinitions()

  const sourceCounts = useMemo<Record<SourceFilter, number>>(() => {
    const matching = commands.filter((item) => slashCommandMatches(item, query))
    return {
      all: matching.length,
      builtin: matching.filter((item) => (item.source ?? 'builtin') === 'builtin').length,
      user: matching.filter((item) => item.source === 'user').length,
    }
  }, [commands, query])

  const filteredCommands = useMemo(() => {
    const matching = commands.filter((item) => slashCommandMatches(item, query))
    if (sourceTab === 'all') return matching
    return matching.filter((item) =>
      sourceTab === 'user' ? item.source === 'user' : (item.source ?? 'builtin') === sourceTab,
    )
  }, [commands, query, sourceTab])

  useEffect(() => {
    setActiveIndex(0)
  }, [open, query, sourceTab])

  useEffect(() => {
    if (filteredCommands.length === 0) {
      setActiveIndex(0)
      return
    }
    setActiveIndex((previous) =>
      Math.max(0, Math.min(previous, filteredCommands.length - 1)),
    )
  }, [filteredCommands.length])

  useImperativeHandle(
    ref,
    () => ({
      moveSelection(step: number) {
        if (!open || filteredCommands.length === 0) return
        const direction = step >= 0 ? 1 : -1
        setActiveIndex((previous) => {
          const next = previous + direction
          if (next < 0) return filteredCommands.length - 1
          if (next >= filteredCommands.length) return 0
          return next
        })
      },
      selectActive() {
        if (!open || filteredCommands.length === 0) return false
        const selectedIndex = Math.max(
          0,
          Math.min(activeIndex, filteredCommands.length - 1),
        )
        const selected = filteredCommands[selectedIndex]
        onSelect(selected)
        return true
      },
    }),
    [activeIndex, filteredCommands, onSelect, open],
  )

  if (!open) return null

  return (
    <div className="pointer-events-none absolute inset-x-2 bottom-[calc(100%+0.5rem)] z-[70]">
      <Popover modal={false} open={open}>
        <PopoverAnchor asChild>
          <span aria-hidden="true" className="block h-px w-full" />
        </PopoverAnchor>
        <PopoverContent
          align="start"
          className="pointer-events-auto overflow-hidden rounded-xl border p-0 shadow-lg"
          onCloseAutoFocus={(event) => event.preventDefault()}
          onOpenAutoFocus={(event) => event.preventDefault()}
          side="top"
          sideOffset={8}
          style={{
            background: 'var(--color-surface, var(--theme-card, #1a1f2e))',
            borderColor: 'var(--m-border, var(--theme-border, rgba(255,255,255,0.08)))',
            maxWidth: 'calc(100vw - 1rem)',
            minWidth: '16rem',
            width:
              'var(--radix-popover-trigger-width, min(28rem, calc(100vw - 1rem)))',
          }}
        >
          <Command
            autoHighlight={false}
            keepHighlight={false}
            mode="none"
            shouldFilter={false}
            value={query}
            onValueChange={() => {}}
          >
            <CommandSourceTabs
              activeTab={sourceTab}
              onTabChange={setSourceTab}
              counts={sourceCounts}
            />
            <CommandList id="slash-command-list" className="max-h-60 min-h-0 px-1 pb-1">
              <CommandEmpty>No commands found</CommandEmpty>
              {filteredCommands.map((item, index) => (
                <CommandItem
                  key={item.command}
                  value={item.command}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseMove={() => setActiveIndex(index)}
                  onSelect={() => onSelect(item)}
                  className={cn(
                    'flex flex-col items-start gap-0.5 rounded-md px-3 py-2 mx-1',
                    index === activeIndex && 'bg-primary-100 text-primary-900',
                  )}
                >
                  <span className="flex w-full items-center gap-2">
                    <span className="text-sm font-semibold font-mono">{item.command}</span>
                    <span
                      className="ml-auto rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
                      style={{
                        borderColor: item.source === 'user'
                          ? 'var(--m-green-30, rgba(74,222,128,0.30))'
                          : 'var(--m-border, var(--theme-border, rgba(255,255,255,0.08)))',
                        color: item.source === 'user'
                          ? 'var(--m-green,#4ade80)'
                          : 'var(--m-muted,var(--theme-muted,#6b7280))',
                      }}
                    >
                      {item.source === 'user' ? 'Custom' : 'Built-in'}
                    </span>
                  </span>
                  <span className="text-xs text-primary-600">
                    {item.description}
                  </span>
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
})

function SlashCommandPicker({ disabled, onSelect }: SlashCommandPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [sourceTab, setSourceTab] = useState<SourceFilter>('all')
  const commands = useSlashCommandDefinitions()

  const sourceCounts = useMemo<Record<SourceFilter, number>>(() => {
    const matching = commands.filter((item) => slashCommandMatches(item, query))
    return {
      all: matching.length,
      builtin: matching.filter((item) => (item.source ?? 'builtin') === 'builtin').length,
      user: matching.filter((item) => item.source === 'user').length,
    }
  }, [commands, query])

  const filteredCommands = useMemo(() => {
    const matching = commands.filter((item) => slashCommandMatches(item, query))
    if (sourceTab === 'all') return matching
    return matching.filter((item) =>
      sourceTab === 'user' ? item.source === 'user' : (item.source ?? 'builtin') === sourceTab,
    )
  }, [commands, query, sourceTab])

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  const handleOpenChange = (nextOpen: boolean) => {
    if (disabled) {
      setOpen(false)
      return
    }
    setOpen(nextOpen)
    if (!nextOpen) {
      setQuery('')
      setSourceTab('all')
    }
  }

  const handleSelect = (command: SlashCommandDefinition) => {
    onSelect(command)
    setOpen(false)
    setQuery('')
    setSourceTab('all')
  }

  return (
    <Popover modal={false} open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          aria-label="Browse slash commands"
          aria-expanded={open}
          title="Slash commands"
          className={cn(open && 'text-primary')}
        >
          <span className="text-base font-semibold leading-none">/</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(24rem,calc(100vw_-_1rem))] overflow-hidden rounded-xl border p-0 shadow-lg"
        onCloseAutoFocus={(event) => event.preventDefault()}
        side="top"
        sideOffset={8}
        style={{
          background: 'var(--color-surface, var(--theme-card, #1a1f2e))',
          borderColor: 'var(--m-border, var(--theme-border, rgba(255,255,255,0.08)))',
        }}
      >
        <Command
          items={filteredCommands}
          mode="none"
          shouldFilter={false}
          value={query}
          onValueChange={setQuery}
        >
          <CommandInput placeholder="Search slash commands" />
          <CommandSourceTabs
            activeTab={sourceTab}
            onTabChange={setSourceTab}
            counts={sourceCounts}
          />
          <CommandList id="slash-command-list" className="max-h-72 min-h-0 px-1 pb-1">
            <CommandEmpty>No slash commands found</CommandEmpty>
            {filteredCommands.map((item) => (
              <CommandItem
                key={item.command}
                value={`${item.command} ${item.description}`}
                onSelect={() => handleSelect(item)}
                className="flex flex-col items-start gap-1 rounded-md px-3 py-2 mx-1"
              >
                <span className="flex w-full items-center gap-2">
                  <span className="text-sm font-semibold font-mono">{item.command}</span>
                  <span
                    className="ml-auto rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
                    style={{
                      borderColor: item.source === 'user'
                        ? 'var(--m-green-30, rgba(74,222,128,0.30))'
                        : 'var(--m-border, var(--theme-border, rgba(255,255,255,0.08)))',
                      color: item.source === 'user'
                        ? 'var(--m-green,#4ade80)'
                        : 'var(--m-muted,var(--theme-muted,#6b7280))',
                    }}
                  >
                    {item.source === 'user' ? 'Custom' : 'Built-in'}
                  </span>
                </span>
                <span className="text-xs text-primary-600">
                  {item.description}
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export { SlashCommandMenu, SlashCommandPicker }
