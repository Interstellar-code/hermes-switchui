'use client'

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react'
import type { Ref } from 'react'

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

export type SlashCommandDefinition = {
  command: string
  description: string
  prompt?: string
  source?: 'builtin' | 'user'
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
    command: '/clear',
    description: 'Clear screen and start fresh',
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

const SlashCommandMenu = forwardRef(function SlashCommandMenuInner(
  { open, query, onSelect }: SlashCommandMenuProps,
  ref: Ref<SlashCommandMenuHandle>,
) {
  const [activeIndex, setActiveIndex] = useState(0)
  const commands = useSlashCommandDefinitions()

  const filteredCommands = useMemo(() => {
    return commands.filter((item) => slashCommandMatches(item, query))
  }, [commands, query])

  useEffect(() => {
    setActiveIndex(0)
  }, [open, query])

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
          className="pointer-events-auto overflow-hidden rounded-xl border border-primary-200 p-0 shadow-lg"
          onCloseAutoFocus={(event) => event.preventDefault()}
          onOpenAutoFocus={(event) => event.preventDefault()}
          side="top"
          sideOffset={8}
          style={{
            background: 'var(--color-surface, var(--theme-card, #1a1f2e))',
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
            <CommandList className="max-h-60 min-h-0">
              <CommandEmpty>No commands found</CommandEmpty>
              {filteredCommands.map((item, index) => (
                <CommandItem
                  key={item.command}
                  value={item.command}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseMove={() => setActiveIndex(index)}
                  onSelect={() => onSelect(item)}
                  className={cn(
                    'flex flex-col items-start gap-0.5 rounded-md px-3 py-2',
                    index === activeIndex && 'bg-primary-100 text-primary-900',
                  )}
                >
                  <span className="text-sm font-semibold">{item.command}</span>
                  <span className="text-xs text-primary-600">
                    {item.description}
                    {item.source === 'user' ? ' · Custom' : ''}
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
  const commands = useSlashCommandDefinitions()

  const filteredCommands = useMemo(() => {
    return commands.filter((item) => slashCommandMatches(item, query))
  }, [commands, query])

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  const handleOpenChange = (nextOpen: boolean) => {
    if (disabled) {
      setOpen(false)
      return
    }
    setOpen(nextOpen)
    if (!nextOpen) setQuery('')
  }

  const handleSelect = (command: SlashCommandDefinition) => {
    onSelect(command)
    setOpen(false)
    setQuery('')
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
        className="w-[min(24rem,calc(100vw_-_1rem))] overflow-hidden rounded-xl border border-primary-200 p-0 shadow-lg"
        onCloseAutoFocus={(event) => event.preventDefault()}
        side="top"
        sideOffset={8}
        style={{
          background: 'var(--color-surface, var(--theme-card, #1a1f2e))',
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
          <CommandList className="max-h-72 min-h-0">
            <CommandEmpty>No slash commands found</CommandEmpty>
            {filteredCommands.map((item) => (
              <CommandItem
                key={item.command}
                value={`${item.command} ${item.description}`}
                onSelect={() => handleSelect(item)}
                className="flex flex-col items-start gap-1 rounded-md px-3 py-2"
              >
                <span className="flex w-full items-center gap-2">
                  <span className="text-sm font-semibold">{item.command}</span>
                  <span className="ml-auto rounded-full border border-primary-200 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-primary-600">
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
