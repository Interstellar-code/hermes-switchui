import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Copy01Icon, RefreshIcon, Tick02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Reply } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ContextMenuPoint } from '@/lib/context-menu'
import { clampContextMenuPosition } from '@/lib/context-menu'
import { writeTextToClipboard } from '@/lib/clipboard'
import { cn } from '@/lib/utils'

export type MessageContextMenuPosition = ContextMenuPoint

type MessageContextMenuProps = {
  position: MessageContextMenuPosition
  text: string
  onClose: () => void
  onReply?: () => void
  onQuote?: () => void
  onRetry?: () => void
}

type MenuActionProps = {
  icon: ReactNode
  label: string
  onClick: () => void
  danger?: boolean
}

function MenuAction({ icon, label, onClick, danger = false }: MenuActionProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
        danger
          ? 'text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40'
          : 'text-primary-800 hover:bg-primary-50 dark:text-primary-200 dark:hover:bg-primary-900/40',
      )}
    >
      <span className="flex size-4 items-center justify-center">{icon}</span>
      <span>{label}</span>
    </button>
  )
}

export function MessageContextMenu({
  position,
  text,
  onClose,
  onReply,
  onQuote,
  onRetry,
}: MessageContextMenuProps) {
  const [copied, setCopied] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose()
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  const resolvedPosition = useMemo(() => {
    if (typeof window === 'undefined') return position
    return clampContextMenuPosition(
      position,
      { width: 188, height: onQuote ? (onReply && onRetry ? 184 : 148) : (onReply && onRetry ? 148 : 112) },
      { width: window.innerWidth, height: window.innerHeight },
    )
  }, [onQuote, onReply, onRetry, position])

  const canCopy = text.trim().length > 0

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="Message actions"
      onContextMenu={(event) => event.preventDefault()}
      style={{
        position: 'fixed',
        top: resolvedPosition.y,
        left: resolvedPosition.x,
        zIndex: 1200,
        minWidth: 188,
        overflow: 'hidden',
        borderRadius: 10,
        border: '1px solid var(--theme-border)',
        background: 'var(--theme-card)',
        boxShadow: '0 18px 48px rgba(0,0,0,0.35)',
        backdropFilter: 'blur(14px)',
      }}
    >
      {canCopy ? (
        <MenuAction
          icon={
            <HugeiconsIcon
              icon={copied ? Tick02Icon : Copy01Icon}
              size={15}
              strokeWidth={1.8}
            />
          }
          label={copied ? 'Copied' : 'Copy'}
          onClick={() => {
            void writeTextToClipboard(text)
              .then(() => setCopied(true))
              .catch(() => undefined)
              .finally(() => onClose())
          }}
        />
      ) : null}
      {onReply ? (
        <MenuAction
          icon={<Reply size={15} strokeWidth={1.8} />}
          label="Reply"
          onClick={() => {
            onReply()
            onClose()
          }}
        />
      ) : null}
      {onQuote ? (
        <MenuAction
          icon={<Reply size={15} strokeWidth={1.8} />}
          label="Quote"
          onClick={() => {
            onQuote()
            onClose()
          }}
        />
      ) : null}
      {onRetry ? (
        <MenuAction
          icon={<HugeiconsIcon icon={RefreshIcon} size={15} strokeWidth={1.8} />}
          label="Retry"
          danger
          onClick={() => {
            onRetry()
            onClose()
          }}
        />
      ) : null}
    </div>,
    document.body,
  )
}
