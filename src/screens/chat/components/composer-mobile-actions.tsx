import * as React from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/shadcn/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/shadcn/ui/popover'
import { cn } from '@/lib/utils'

export type ComposerMobileActionItem = {
  id: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  onClick: () => void
  disabled?: boolean
  active?: boolean
  description?: string
  danger?: boolean
}

export type ComposerMobileActionsMenuProps = {
  actions: Array<ComposerMobileActionItem>
  disabled?: boolean
  className?: string
}

export const ComposerMobileActionsMenu = React.memo(
  function ComposerMobileActionsMenu({
    actions,
    disabled = false,
    className,
  }: ComposerMobileActionsMenuProps) {
    const [open, setOpen] = React.useState(false)

    if (actions.length === 0) return null

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            aria-label="More actions"
            data-testid="composer-mobile-actions-trigger"
            className={cn(
              'size-8 rounded-lg text-muted-foreground transition-colors hover:text-foreground',
              open && 'bg-accent text-accent-foreground',
              className,
            )}
          >
            <Plus className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          sideOffset={8}
          data-testid="composer-mobile-actions-content"
          className="w-56 p-1 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] text-[var(--theme-text)] shadow-lg"
        >
          <div className="flex flex-col gap-0.5">
            {actions.map((action) => {
              const Icon = action.icon
              return (
                <button
                  key={action.id}
                  type="button"
                  disabled={action.disabled}
                  data-testid={`mobile-action-${action.id}`}
                  onClick={() => {
                    setOpen(false)
                    action.onClick()
                  }}
                  className={cn(
                    'group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors select-none',
                    'hover:bg-[var(--theme-card2)] focus-visible:bg-[var(--theme-card2)] focus-visible:outline-none',
                    action.active &&
                      'bg-[var(--theme-accent)]/10 text-[var(--theme-accent)] font-medium',
                    action.danger &&
                      'text-destructive hover:bg-destructive/10 focus-visible:bg-destructive/10',
                    action.disabled && 'opacity-40 pointer-events-none',
                  )}
                >
                  <Icon
                    className={cn(
                      'size-4 shrink-0',
                      action.active
                        ? 'text-[var(--theme-accent)]'
                        : action.danger
                          ? 'text-destructive'
                          : 'text-muted-foreground group-hover:text-foreground',
                    )}
                  />
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="truncate font-medium leading-none">
                      {action.label}
                    </span>
                    {action.description && (
                      <span className="truncate text-[10.5px] text-muted-foreground mt-0.5">
                        {action.description}
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </PopoverContent>
      </Popover>
    )
  },
)
