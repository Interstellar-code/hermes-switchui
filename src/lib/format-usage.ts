/** Compact token count: 999, 1.0k..999.9k, 1.2M. */
export function compactTokens(n: number): string {
  if (n < 1000) return String(n)
  const k = Math.round(n / 100) / 10
  return k < 1000 ? `${k.toFixed(1)}k` : `${(n / 1e6).toFixed(1)}M`
}

/** "12.4k" or "12.4k · $0.03"; '—' when no tokens reported. */
export function formatUsageLabel(
  totalTokens: number | null | undefined,
  costUsd: number | null | undefined,
): string {
  if (!totalTokens) return '—'
  const cost =
    costUsd == null
      ? ''
      : ` · ${costUsd < 0.01 ? '<$0.01' : `$${costUsd.toFixed(2)}`}`
  return compactTokens(totalTokens) + cost
}
