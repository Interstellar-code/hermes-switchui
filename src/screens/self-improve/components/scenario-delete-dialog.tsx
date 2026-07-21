import { Button } from '@/components/shadcn/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/shadcn/ui/dialog'

type ScenarioDeleteDialogProps = {
  open: boolean
  scenarioName: string
  scenarioId: number | null
  pending: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ScenarioDeleteDialog({
  open,
  scenarioName,
  scenarioId,
  pending,
  onConfirm,
  onCancel,
}: ScenarioDeleteDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !pending) onCancel()
      }}
    >
      <DialogContent
        className="w-[min(420px,calc(100vw-2rem))] border-[var(--theme-border,#1a2a22)] bg-[var(--theme-card,#0a0f0b)] text-[var(--theme-text,#d4f5e4)] shadow-2xl"
        showCloseButton={!pending}
      >
        <DialogHeader>
          <DialogTitle className="text-base">Delete scenario?</DialogTitle>
          <DialogDescription className="leading-6 text-[var(--theme-muted,#7da08c)]">
            <strong className="font-medium text-[var(--theme-text,#d4f5e4)]">
              {scenarioName}
            </strong>{' '}
            {scenarioId === null ? '' : `(#${scenarioId}) `}
            will be permanently deleted. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={pending || scenarioId === null}
            aria-label={
              pending ? `Deleting ${scenarioName}` : `Delete ${scenarioName}`
            }
            aria-busy={pending}
            onClick={onConfirm}
          >
            {pending ? 'Deleting…' : 'Delete scenario'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
