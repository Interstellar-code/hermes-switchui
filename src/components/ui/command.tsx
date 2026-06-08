'use client'

import * as React from 'react'
import { Command as CommandPrimitive } from 'cmdk'
import { SearchIcon } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/shadcn/ui/dialog'
import { cn } from '@/lib/utils'

type CommandSearchContextValue = {
  value?: string
  onValueChange?: (value: string) => void
}

const CommandSearchContext = React.createContext<CommandSearchContextValue>({})

const EMPTY_ITEMS: ReadonlyArray<unknown> = []

const CommandGroupItemsContext =
  React.createContext<ReadonlyArray<unknown>>(EMPTY_ITEMS)

type CommandProps = Omit<
  React.ComponentProps<typeof CommandPrimitive>,
  'onValueChange' | 'value'
> & {
  /**
   * Compatibility with the previous base-ui/autocomplete facade: this controls
   * the search input value, not cmdk's selected-item value.
   */
  value?: string
  onValueChange?: (value: string) => void
  /**
   * Legacy autocomplete props accepted by existing call sites. cmdk renders
   * children directly, so these are intentionally ignored.
   */
  autoHighlight?: unknown
  items?: unknown
  keepHighlight?: unknown
  mode?: unknown
}

type CommandInputProps = React.ComponentProps<typeof CommandPrimitive.Input> & {
  startAddon?: React.ReactNode
}

type CommandDialogPopupProps = React.ComponentProps<typeof DialogContent> & {
  description?: string
  title?: string
}

type CommandGroupProps<TItem> = React.ComponentProps<
  typeof CommandPrimitive.Group
> & {
  items?: ReadonlyArray<TItem>
}

type CommandCollectionProps<TItem> = Omit<
  React.ComponentProps<'div'>,
  'children'
> & {
  children?: React.ReactNode | ((item: TItem, index: number) => React.ReactNode)
}

const CommandDialog = Dialog

const CommandDialogTrigger = DialogTrigger

/**
 * Kept as a named export for the old facade. No current consumer uses this
 * imperative handle; Radix/shadcn dialog control should use open/onOpenChange.
 */
function CommandCreateHandle() {
  return {}
}

function Command({
  autoHighlight: _autoHighlight,
  children,
  className,
  items: _items,
  keepHighlight: _keepHighlight,
  mode: _mode,
  onValueChange,
  shouldFilter = false,
  value,
  loop = true,
  ...props
}: CommandProps) {
  const searchContext = React.useMemo<CommandSearchContextValue>(
    () => ({ value, onValueChange }),
    [onValueChange, value],
  )

  return (
    <CommandSearchContext.Provider value={searchContext}>
      <CommandPrimitive
        className={cn(
          'flex h-full w-full flex-col overflow-hidden rounded-md bg-transparent text-primary-900',
          className,
        )}
        data-slot="command"
        loop={loop}
        shouldFilter={shouldFilter}
        style={{ color: 'var(--theme-text)' }}
        {...props}
      >
        {children}
      </CommandPrimitive>
    </CommandSearchContext.Provider>
  )
}

function CommandDialogPopup({
  children,
  className,
  description = 'Search for a command to run.',
  showCloseButton = false,
  style,
  title = 'Command Palette',
  ...props
}: CommandDialogPopupProps) {
  return (
    <DialogContent
      className={cn(
        'flex max-h-[min(80vh,26.25rem)] min-h-0 w-[min(36rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border p-0 shadow-lg outline-none sm:max-w-xl',
        className,
      )}
      showCloseButton={showCloseButton}
      style={{
        background: 'var(--theme-card)',
        borderColor: 'var(--theme-border)',
        color: 'var(--theme-text)',
        ...style,
      }}
      {...props}
    >
      <DialogTitle className="sr-only">{title}</DialogTitle>
      <DialogDescription className="sr-only">{description}</DialogDescription>
      {children}
    </DialogContent>
  )
}

function CommandInput({
  autoFocus = true,
  className,
  placeholder,
  startAddon,
  value,
  onValueChange,
  ...props
}: CommandInputProps) {
  const searchContext = React.useContext(CommandSearchContext)
  const resolvedValue = value ?? searchContext.value
  const resolvedOnValueChange = onValueChange ?? searchContext.onValueChange
  const inputProps =
    resolvedValue === undefined
      ? { onValueChange: resolvedOnValueChange }
      : { onValueChange: resolvedOnValueChange, value: resolvedValue }

  return (
    <div
      className="flex h-12 items-center gap-2 border-b px-3"
      data-slot="command-input-wrapper"
      style={{ borderColor: 'var(--theme-border)' }}
    >
      {startAddon ?? (
        <SearchIcon
          aria-hidden="true"
          className="size-4.5 shrink-0 text-primary-500"
        />
      )}
      <CommandPrimitive.Input
        autoFocus={autoFocus}
        className={cn(
          'h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-primary-500 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        data-slot="command-input"
        placeholder={placeholder}
        {...inputProps}
        {...props}
      />
    </div>
  )
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      className={cn(
        'min-h-0 overflow-x-hidden overflow-y-auto scroll-py-2 p-2',
        className,
      )}
      data-slot="command-list"
      {...props}
    />
  )
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      className={cn('py-6 text-center text-sm text-primary-600', className)}
      data-slot="command-empty"
      {...props}
    />
  )
}

function CommandPanel({ className, style, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        '-mx-px relative min-h-0 rounded-t-xl border border-b-0 bg-clip-padding shadow-xs/5 [clip-path:inset(0_1px)] not-has-[+[data-slot=command-footer]]:-mb-px not-has-[+[data-slot=command-footer]]:rounded-b-2xl not-has-[+[data-slot=command-footer]]:[clip-path:inset(0_1px_1px_1px_round_0_0_calc(var(--radius-2xl)-1px)_calc(var(--radius-2xl)-1px))]',
        className,
      )}
      data-slot="command-panel"
      style={{
        background: 'var(--theme-card)',
        borderColor: 'var(--theme-border)',
        ...style,
      }}
      {...props}
    />
  )
}

function CommandGroup<TItem = unknown>({
  className,
  items = EMPTY_ITEMS as ReadonlyArray<TItem>,
  ...props
}: CommandGroupProps<TItem>) {
  return (
    <CommandGroupItemsContext.Provider value={items}>
      <CommandPrimitive.Group
        className={cn('[[cmdk-group]+&]:mt-1.5', className)}
        data-slot="command-group"
        {...props}
      />
    </CommandGroupItemsContext.Provider>
  )
}

function CommandGroupLabel({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('px-2 py-1.5 text-xs font-medium text-primary-600', className)}
      data-slot="command-group-label"
      {...props}
    />
  )
}

function getCollectionKey(item: unknown, index: number) {
  if (item && typeof item === 'object') {
    const record = item as Record<string, unknown>
    const value = record.value ?? record.id ?? record.key
    if (typeof value === 'string' || typeof value === 'number') {
      return value
    }
  }
  return index
}

function CommandCollection<TItem = unknown>({
  children,
  ...props
}: CommandCollectionProps<TItem>) {
  const items = React.useContext(CommandGroupItemsContext) as ReadonlyArray<TItem>

  if (typeof children === 'function') {
    return (
      <div data-slot="command-collection" {...props}>
        {items.map((item, index) => (
          <React.Fragment key={getCollectionKey(item, index)}>
            {children(item, index)}
          </React.Fragment>
        ))}
      </div>
    )
  }

  return (
    <div data-slot="command-collection" {...props}>
      {children}
    </div>
  )
}

function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      className={cn(
        'relative flex min-h-8 cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-[disabled=true]:pointer-events-none data-[selected=true]:bg-primary-100 data-[selected=true]:text-primary-900 data-[disabled=true]:opacity-50',
        className,
      )}
      data-slot="command-item"
      style={{ color: 'var(--theme-text)' }}
      {...props}
    />
  )
}

function CommandSeparator({
  alwaysRender = true,
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      alwaysRender={alwaysRender}
      className={cn('mx-2 my-2 h-px bg-border last:hidden', className)}
      data-slot="command-separator"
      {...props}
    />
  )
}

function CommandShortcut({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'ms-auto font-sans text-xs font-medium tracking-widest text-primary-500',
        className,
      )}
      data-slot="command-shortcut"
      {...props}
    />
  )
}

function CommandFooter({ className, style, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 rounded-b-[calc(var(--radius-2xl)-1px)] border-t px-5 py-3 text-xs text-primary-600',
        className,
      )}
      data-slot="command-footer"
      style={{
        borderColor: 'var(--theme-border)',
        ...style,
      }}
      {...props}
    />
  )
}

export {
  CommandCreateHandle,
  Command,
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandDialogTrigger,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandSeparator,
  CommandShortcut,
}
