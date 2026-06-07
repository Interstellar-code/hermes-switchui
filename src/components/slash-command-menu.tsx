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
} from '@/components/shadcn/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { cn } from '@/lib/utils'

export type SlashCommandDefinition = {
  command: string
  description: string
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

export const DEFAULT_SLASH_COMMANDS: Array<SlashCommandDefinition> = [
  { command: '/new', description: 'Start new session' },
  { command: '/clear', description: 'Clear screen and start fresh' },
  { command: '/model', description: 'Show or change the current model' },
  { command: '/save', description: 'Save the current conversation' },
  { command: '/skills', description: 'Browse and manage skills' },
  { command: '/plugins', description: 'List installed plugins and their status' },
  { command: '/mcp', description: 'Manage MCP servers' },
  { command: '/skin', description: 'Change the display theme' },
  { command: '/help', description: 'Show available commands' },
]

function normalizeSearchValue(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLocaleLowerCase()
}

function slashCommandMatches(
  item: SlashCommandDefinition,
  query: string,
): boolean {
  const normalizedQuery = normalizeSearchValue(query)
  if (!normalizedQuery) return true

  return normalizeSearchValue(`${item.command} ${item.description}`).includes(
    normalizedQuery,
  )
}

const SlashCommandMenu = forwardRef(function SlashCommandMenuInner(
  { open, query, onSelect }: SlashCommandMenuProps,
  ref: Ref<SlashCommandMenuHandle>,
) {
  const [activeIndex, setActiveIndex] = useState(0)

  const filteredCommands = useMemo(() => {
    return DEFAULT_SLASH_COMMANDS.filter((item) =>
      slashCommandMatches(item, query),
    )
  }, [query])

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

export { SlashCommandMenu }
