import { AnimatePresence, motion } from 'motion/react'
import { ArrowDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ScrollToBottomButtonProps = {
  className?: string
  isVisible: boolean
  unreadCount: number
  onClick: () => void
  label?: string
}

export function ScrollToBottomButton({
  className,
  isVisible,
  unreadCount,
  onClick,
  label = 'Latest',
}: ScrollToBottomButtonProps) {
  return (
    <AnimatePresence>
      {isVisible ? (
        <motion.button
          type="button"
          aria-label={
            unreadCount > 0
              ? `Scroll to latest (${unreadCount} new)`
              : 'Scroll to latest'
          }
          data-testid="scroll-to-bottom-pill"
          initial={{ opacity: 0, y: 10, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.95 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          onClick={onClick}
          className={cn(
            'pointer-events-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-mono font-medium shadow-md transition-all cursor-pointer select-none',
            'border border-[var(--theme-border)] bg-[var(--theme-card)] text-[var(--theme-text)] hover:border-[var(--theme-accent)] hover:text-[var(--theme-accent)] backdrop-blur-md',
            className,
          )}
          style={{
            boxShadow:
              '0 4px 14px color-mix(in srgb, var(--theme-accent, #10b981) 18%, rgba(0,0,0,0.12))',
          }}
        >
          <ArrowDown className="size-3.5 shrink-0 text-[var(--theme-accent)]" />
          <span>{label}</span>
          {unreadCount > 0 && (
            <span
              data-testid="scroll-to-bottom-unread"
              className="inline-flex items-center justify-center rounded-full bg-[var(--theme-accent)] text-black dark:text-black font-semibold text-[10px] px-1.5 py-0.2 min-w-4 h-4 ml-0.5 tabular-nums"
            >
              {unreadCount > 99 ? '99+' : `${unreadCount} new`}
            </span>
          )}
        </motion.button>
      ) : null}
    </AnimatePresence>
  )
}
