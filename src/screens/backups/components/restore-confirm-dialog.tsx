import { ConfirmDialog } from '@/screens/profiles/components/confirm-dialog'

type Props = {
  open: boolean
  archiveName: string
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Thin wrapper around the shared ConfirmDialog, specialised for the backup
 * restore action.  Restore runs in force mode (proxy injects force:true
 * server-side) and overwrites all current data — it cannot be undone.
 */
export function RestoreConfirmDialog({
  open,
  archiveName,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <ConfirmDialog
      open={open}
      title="Restore backup?"
      message={
        `This will overwrite ALL current Hermes Agent data (sessions, memory, ` +
        `skills, config) with the contents of "${archiveName}".  ` +
        `Restore runs in force mode and cannot be undone.`
      }
      confirmLabel="Restore"
      cancelLabel="Cancel"
      destructive
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
