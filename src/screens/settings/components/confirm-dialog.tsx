import type { ReactNode } from 'react'
import { Button } from '@/components/shadcn/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/shadcn/ui/dialog'

type ConfirmDialogProps = {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  /** Disables the confirm button — e.g. until a typed confirmation matches. */
  confirmDisabled?: boolean
  /** Extra content rendered between the message and the action buttons. */
  children?: ReactNode
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Settings' own confirm dialog.
 *
 * `@/screens/profiles/components/confirm-dialog.tsx` portals to
 * `document.body` with `.pf-confirm-backdrop` / `.pf-confirm` /
 * `.pf-confirm-actions`, which are defined only in `matrix-crons.css` and
 * `matrix-profiles.css` (loaded by Jobs/Profiles). Because it portals, it
 * escapes `[data-screen='settings']` too, so settings' own scoped `.btn`
 * never applied either — on a cold load of `/settings` in a fresh browser
 * profile, "Delete workspace" rendered as an unstyled, unpositioned div.
 *
 * This wraps the shared `shadcn/ui/dialog` instead: it's unscoped Tailwind,
 * so it renders correctly regardless of which screen loaded first, and it
 * already carries a focus trap, Escape handling, focus restore, and a
 * correctly-labelled dialog via Radix. Keep `confirm-dialog.tsx` itself
 * unmodified — Profiles and Memory still depend on it.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  confirmDisabled,
  children,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onCancel()
      }}
    >
      <DialogContent
        className="w-[min(440px,calc(100vw-2rem))] border-[var(--m-green-500,var(--theme-accent))] bg-[var(--m-panel,var(--theme-card))] text-[var(--m-text,var(--theme-text))]"
      >
        <DialogHeader>
          <DialogTitle className="text-base">{title}</DialogTitle>
          <DialogDescription className="leading-6 text-[var(--m-text-muted,var(--theme-muted))]">
            {message}
          </DialogDescription>
        </DialogHeader>

        {children}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
