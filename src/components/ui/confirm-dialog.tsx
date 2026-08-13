'use client'

/**
 * confirm-dialog.tsx — the in-app replacement for `window.confirm`.
 *
 * Native `confirm()` renders browser chrome ("<host> says…"), ignores the
 * theme, blocks the main thread, and on a remote/tailnet host it shows the raw
 * hostname, which reads like a phishing prompt rather than part of the app.
 *
 * Deliberately hand-rolled instead of wrapping `shadcn/ui/dialog`: that one is
 * pinned at `z-50`, and the surfaces that ask for confirmation here already sit
 * at `z-[9999]` (Update Center) and `z-[10000]` (release notes). A Radix
 * dialog would open *behind* the thing that raised it. This portals to
 * `document.body` at `z-[10050]` so it is always on top, and styles itself from
 * the `--theme-*` variables so it matches every theme including Matrix.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { useFocusTrap } from './use-focus-trap'
import type { ReactNode } from 'react'

/** Above Update Center (9999) and its release-notes modal (10000). */
const CONFIRM_Z_INDEX = 10050

export type ConfirmOptions = {
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

export type ConfirmDialogProps = ConfirmOptions & {
  open: boolean
  /** Disables the confirm button and shows a pending label. */
  busy?: boolean
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
  busy,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  // Initial focus lands on Cancel (first focusable), so a stray Enter/Space
  // right after opening dismisses rather than fires the action.
  useFocusTrap(open, dialogRef, onCancel)

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
        style={{ zIndex: CONFIRM_Z_INDEX }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onCancel()
        }}
      >
        <motion.div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          aria-describedby="confirm-dialog-message"
          className="w-full max-w-md overflow-hidden rounded-2xl"
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.97 }}
          transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
          style={{
            background: 'var(--theme-card)',
            border: '1px solid var(--theme-border)',
            color: 'var(--theme-text)',
            boxShadow: 'var(--theme-shadow-3)',
          }}
        >
          <div className="px-5 py-4">
            <h2
              id="confirm-dialog-title"
              className="text-base font-semibold"
              style={{ color: 'var(--theme-text)' }}
            >
              {title}
            </h2>
            <div
              id="confirm-dialog-message"
              className="mt-1.5 text-sm leading-6"
              style={{ color: 'var(--theme-muted)' }}
            >
              {message}
            </div>
          </div>
          <div
            className="flex justify-end gap-2 border-t px-5 py-3"
            style={{ borderColor: 'var(--theme-border)' }}
          >
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-80"
              style={{
                background: 'var(--theme-card2)',
                color: 'var(--theme-text)',
              }}
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              style={{
                background: destructive ? '#dc2626' : 'var(--theme-accent)',
              }}
            >
              {confirmLabel}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  )
}

type PendingConfirm = ConfirmOptions & { resolve: (answer: boolean) => void }

/**
 * Promise-based confirm, so a call site reads exactly like the `window.confirm`
 * it replaces:
 *
 *   const { confirm, confirmDialog } = useConfirm()
 *   if (!(await confirm({ title, message })) ) return
 *   …
 *   return <>{confirmDialog}…</>
 *
 * A second `confirm()` while one is already open cancels the first (resolves
 * it `false`) rather than dropping its promise on the floor — an awaited
 * caller that never settles would leave its action wedged forever.
 */
export function useConfirm(): {
  confirm: (options: ConfirmOptions) => Promise<boolean>
  confirmDialog: ReactNode
} {
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  // The live resolver lives in a ref, not in the state updater: React may
  // invoke an updater twice (StrictMode), and settling a promise is a side
  // effect that must happen exactly once per answer.
  const pendingRef = useRef<PendingConfirm | null>(null)

  const settle = useCallback((answer: boolean) => {
    const current = pendingRef.current
    pendingRef.current = null
    setPending(null)
    current?.resolve(answer)
  }, [])

  // Unmounting with a promise still in flight has to settle it too, otherwise
  // an awaiting caller stays parked forever.
  useEffect(() => () => settle(false), [settle])

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        // A second ask supersedes the first rather than dropping its promise.
        pendingRef.current?.resolve(false)
        const next = { ...options, resolve }
        pendingRef.current = next
        setPending(next)
      }),
    [],
  )

  const confirmDialog = (
    <ConfirmDialog
      open={pending !== null}
      title={pending?.title ?? ''}
      message={pending?.message ?? ''}
      confirmLabel={pending?.confirmLabel}
      cancelLabel={pending?.cancelLabel}
      destructive={pending?.destructive}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  )

  return { confirm, confirmDialog }
}
