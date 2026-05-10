'use client'

/* ── Shared MCP SVG icons ── */
export const Ico = {
  search: (
    <svg className="mcp-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  ),
  fold: (
    <svg className="mcp-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="m9 6-6 6 6 6M21 6h-9M21 12h-6M21 18h-9" />
    </svg>
  ),
  unfold: (
    <svg className="mcp-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="m15 6 6 6-6 6M3 6h9M3 12h6M3 18h9" />
    </svg>
  ),
  plus: (
    <svg className="mcp-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  refresh: (
    <svg className="mcp-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M21 12a9 9 0 0 1-15.3 6.36L3 15" />
      <path d="M3 21v-6h6" />
      <path d="M3 12A9 9 0 0 1 18.3 5.64L21 9" />
      <path d="M21 3v6h-6" />
    </svg>
  ),
  x: (
    <svg className="mcp-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 6 18 18M18 6 6 18" />
    </svg>
  ),
  warn: (
    <svg className="mcp-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M12 3 2 21h20zM12 9v6M12 17.5v.5" />
    </svg>
  ),
  grid: (
    <svg className="mcp-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  rows: (
    <svg className="mcp-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  ),
  tool: (
    <svg className="mcp-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M14 7a4 4 0 0 1-5 5L4 17l3 3 5-5a4 4 0 0 1 5-5l3-3-3-3z" />
    </svg>
  ),
  copy: (
    <svg className="mcp-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  ),
  edit: (
    <svg className="mcp-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  ),
  trash: (
    <svg className="mcp-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  ),
  shield: (
    <svg className="mcp-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M12 2 4 6v6c0 5.25 3.5 9.74 8 11 4.5-1.26 8-5.75 8-11V6Z" />
    </svg>
  ),
  doc: (
    <svg className="mcp-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
    </svg>
  ),
  log: (
    <svg className="mcp-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  bolt: (
    <svg className="mcp-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
    </svg>
  ),
}

/* ── Shared helper ── */
export function serverInitials(id: string): string {
  return id
    .replace(/-/g, ' ')
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}
