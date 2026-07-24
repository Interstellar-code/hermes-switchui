/**
 * format.ts — shared formatting helpers for screens.
 *
 * Consolidates the hand-rolled formatters that were duplicated across files-screen,
 * profile-card, and similar surfaces.
 */

/** Format a byte count as `B` / `KB` / `MB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Format an ISO timestamp as a short locale-aware date+time. */
export function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Format a token count as `K` / `M` / `B` (e.g. 12_300 → "12.3K"). */
export function formatTokens(n: number): string {
  if (!n || n <= 0) return '0'
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

/** Format a USD cost with sub-cent / sub-dollar precision (e.g. 0.0123 → "$0.012"). */
export function formatCostUsd(usd: number): string {
  if (usd <= 0) return '$0'
  if (usd < 0.01) return '<$0.01'
  if (usd < 1) return `$${usd.toFixed(3)}`
  if (usd < 100) return `$${usd.toFixed(2)}`
  return `$${Math.round(usd).toLocaleString()}`
}

/** Format a unix-epoch (seconds) timestamp as relative-to-now ("3h ago", "2w ago"). */
export function formatRelative(epochSeconds: number): string {
  const diff = Math.floor(Date.now() / 1000 - epochSeconds)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`
  if (diff < 86400 * 30) return `${Math.floor(diff / (86400 * 7))}w ago`
  if (diff < 86400 * 365) return `${Math.floor(diff / (86400 * 30))}mo ago`
  return `${Math.floor(diff / (86400 * 365))}y ago`
}

/** Format an ISO timestamp as relative-to-now; "—" for missing/invalid dates. */
export function formatRelativeIso(iso: string | undefined): string {
  if (!iso) return '—'
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return '—'
  return formatRelative(Math.floor(ms / 1000))
}
