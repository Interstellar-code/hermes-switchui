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

/** Format a unix-epoch (seconds) timestamp as relative-to-now ("3h ago"). */
export function formatRelative(epochSeconds: number): string {
  const diff = Math.floor(Date.now() / 1000 - epochSeconds)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}
