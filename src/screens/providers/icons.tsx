'use client'

/* ── Shared provider-screen SVG icons ── */
export const Ico = {
  search: (
    <svg
      className="pv-ico"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  ),
  fold: (
    <svg
      className="pv-ico"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <path d="m9 6-6 6 6 6M21 6h-9M21 12h-6M21 18h-9" />
    </svg>
  ),
  unfold: (
    <svg
      className="pv-ico"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <path d="m15 6 6 6-6 6M3 6h9M3 12h6M3 18h9" />
    </svg>
  ),
  plus: (
    <svg
      className="pv-ico"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  refresh: (
    <svg
      className="pv-ico"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <path d="M21 12a9 9 0 0 1-15.3 6.36L3 15" />
      <path d="M3 21v-6h6" />
      <path d="M3 12A9 9 0 0 1 18.3 5.64L21 9" />
      <path d="M21 3v6h-6" />
    </svg>
  ),
  grid: (
    <svg
      className="pv-ico"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />
    </svg>
  ),
  rows: (
    <svg
      className="pv-ico"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  ),
  key: (
    <svg
      className="pv-ico"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <circle cx="8" cy="12" r="4" />
      <path d="M12 12h9M18 12v4M15.5 12v3" />
    </svg>
  ),
  bolt: (
    <svg
      className="pv-ico"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
    </svg>
  ),
  trash: (
    <svg
      className="pv-ico"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6" />
    </svg>
  ),
  edit: (
    <svg
      className="pv-ico"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <path d="M4 20h4L19 9l-4-4L4 16z" />
    </svg>
  ),
  warn: (
    <svg
      className="pv-ico"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <path d="M12 3 2 21h20zM12 9v6M12 17.5v.5" />
    </svg>
  ),
}

/** Two-letter fallback when a provider has no logo asset. */
export function providerInitials(name: string): string {
  const words = name
    .replace(/[^a-z0-9\s-]/gi, ' ')
    .trim()
    .split(/[\s-]+/)
  if (words.length === 0 || !words[0]) return '??'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}
