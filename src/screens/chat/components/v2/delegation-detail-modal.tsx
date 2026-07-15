import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useDelegationMessages } from '../../hooks/use-delegations'
import { ToolTabView } from './chat-tab-views-v2'

export type DelegationDetailModalProps = {
  childSessionId: string | null
  onClose: () => void
}

/** Shared drill-in modal: given a child delegation session, shows its tool
 * timeline via the existing `ToolTabView`. Wired from both the docked strip
 * and the delegations tab so there is one modal, not two inline expands. */
export function DelegationDetailModal({ childSessionId, onClose }: DelegationDetailModalProps) {
  const { messages, isLoading, error } = useDelegationMessages(childSessionId)

  useEffect(() => {
    if (!childSessionId) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [childSessionId, onClose])

  if (!childSessionId) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'color-mix(in srgb, black 60%, transparent)' }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border"
        style={{
          borderColor: 'var(--m-border, var(--theme-border))',
          background: 'var(--m-surface-1, var(--theme-card))',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex shrink-0 items-center justify-between border-b px-3 py-2 text-xs font-medium"
          style={{ borderColor: 'var(--m-border, var(--theme-border))' }}
        >
          <span>Delegation timeline</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="opacity-60 hover:opacity-100"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <p className="p-4 font-mono text-[10px] opacity-50">Loading transcript…</p>
          ) : error ? (
            <p className="p-4 font-mono text-[10px]" style={{ color: 'var(--theme-danger, #ef4444)' }}>
              {error}
            </p>
          ) : messages.length === 0 ? (
            <p className="p-4 font-mono text-[10px] opacity-50">No tool calls in this delegation</p>
          ) : (
            <ToolTabView messages={messages} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
