import { useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useFocusTrap } from './use-focus-trap'

type Props = {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  onConfirm,
  onCancel,
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const messageId = useId()

  // P-16: this used to handle Escape and nothing else — focus stayed on the
  // page behind the dialog, Tab walked straight out of it, and it never came
  // back. The hook covers all four (initial focus, Tab cycle, Escape, restore)
  // and keeps the innermost dialog the only one listening when the wizard
  // stacks this on top of itself.
  useFocusTrap(open, dialogRef, onCancel)

  if (!open) return null

  return createPortal(
    <div className="pf-confirm-backdrop" onClick={onCancel}>
      <div
        ref={dialogRef}
        className="pf-confirm"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
      >
        <h3 id={titleId}>{title}</h3>
        <p id={messageId}>{message}</p>
        <div className="pf-confirm-actions">
          <button type="button" className="btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={destructive ? 'btn btn-danger' : 'btn btn-primary'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
