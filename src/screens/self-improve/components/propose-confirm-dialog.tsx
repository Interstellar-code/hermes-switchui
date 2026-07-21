import { Button } from '@/components/shadcn/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/shadcn/ui/dialog'

type ProposeConfirmDialogProps = {
  open: boolean
  profile: string
  targetRelpath?: string | null
  proposerModel?: string | null
  judgeModel?: string | null
  pending?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ProposeConfirmDialog({
  open,
  profile,
  targetRelpath,
  proposerModel,
  judgeModel,
  pending = false,
  onConfirm,
  onCancel,
}: ProposeConfirmDialogProps) {
  if (!open) return null

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
          <DialogTitle className="text-base">
            Propose a change to {profile}?
          </DialogTitle>
          <DialogDescription className="leading-6 text-[var(--theme-muted,#7da08c)]">
            <ul className="list-disc space-y-1 pl-4">
              <li>
                Calls the proposer model (
                <strong className="font-medium text-[var(--theme-text,#d4f5e4)]">
                  {proposerModel ?? 'auto'}
                </strong>
                ) to draft one edit to{' '}
                <strong className="font-medium text-[var(--theme-text,#d4f5e4)]">
                  {targetRelpath ?? 'the profile target file'}
                </strong>
                .
              </li>
              <li>
                The draft is judged by{' '}
                <strong className="font-medium text-[var(--theme-text,#d4f5e4)]">
                  {judgeModel ?? 'the configured judge'}
                </strong>
                .
              </li>
              <li>This spends API tokens.</li>
              <li>
                Creates a proposal only — nothing is applied to your profile
                until you review and approve it.
              </li>
            </ul>
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            aria-busy={pending}
            onClick={onConfirm}
          >
            {pending ? 'Proposing…' : 'Propose'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
