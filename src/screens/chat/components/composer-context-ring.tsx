import { memo } from 'react'
import { cn } from '@/lib/utils'

export type ContextUsage = {
  percent: number
  label: string
  usedFormatted: string
  maxFormatted: string
  leftFormatted: string
}

export function formatTokenK(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000
    return `${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M`
  }
  if (n >= 1_000) {
    const k = n / 1_000
    return `${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`
  }
  return String(Math.round(n))
}

export function formatContextUsage(
  used?: number | null,
  max?: number | null,
): ContextUsage | null {
  if (typeof max !== 'number' || !Number.isFinite(max) || max <= 0) {
    return null
  }
  const u = Math.max(0, typeof used === 'number' && Number.isFinite(used) ? used : 0)
  const percent = Math.min(100, Math.round((u / max) * 100))
  const left = Math.max(0, max - u)
  const usedFormatted = formatTokenK(u)
  const maxFormatted = formatTokenK(max)
  const leftFormatted = formatTokenK(left)

  return {
    percent,
    usedFormatted,
    maxFormatted,
    leftFormatted,
    label: `${percent}% used · ${usedFormatted} / ${maxFormatted} tokens · ${leftFormatted} left`,
  }
}

export type ComposerContextRingProps = {
  usedTokens?: number | null
  maxTokens?: number | null
  className?: string
}

export const ComposerContextRing = memo(function ComposerContextRing({
  usedTokens,
  maxTokens,
  className,
}: ComposerContextRingProps) {
  const usage = formatContextUsage(usedTokens, maxTokens)
  if (!usage) return null

  // Color thresholds:
  // < 70%: --theme-accent (or emerald)
  // 70% - 89%: --theme-warning
  // >= 90%: --theme-danger
  const strokeColor =
    usage.percent >= 90
      ? 'var(--theme-danger, #ef4444)'
      : usage.percent >= 70
        ? 'var(--theme-warning, #f59e0b)'
        : 'var(--theme-accent, #10b981)'

  const size = 18
  const strokeWidth = 2.2
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (usage.percent / 100) * circumference

  return (
    <div
      role="status"
      aria-label={usage.label}
      title={usage.label}
      data-testid="composer-context-ring"
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono select-none transition-colors border border-[var(--theme-border)] bg-[var(--theme-card2)]/50 text-[var(--theme-muted)] hover:text-[var(--theme-text)] hover:border-[var(--theme-accent)]/50',
        className,
      )}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="shrink-0 -rotate-90"
        aria-hidden="true"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--theme-border)"
          strokeWidth={strokeWidth}
          className="opacity-40"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          className="transition-all duration-300"
        />
      </svg>
      <span className="tabular-nums font-medium">{usage.percent}%</span>
    </div>
  )
})
