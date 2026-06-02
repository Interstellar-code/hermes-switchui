import type { A2AFleetMessage } from '@/lib/hermes-client'

// Data-driven A2A executor-mode registry.
//
// The a2a_fleet backend (v0.8.4+) returns a `mode` per peer/conversation
// (claude_code, opencode, codex, agy, …). The Matrix3D A2A view labels and
// color-codes each protocol off these values. Extensibility contract: a new
// backend mode must render with a derived label + a stable color and require
// NO change here — known modes get curated labels/colors, unknown modes fall
// back to a titleized label and a deterministic hashed hue.

const KNOWN_MODE_LABELS: Record<string, string> = {
  claude_code: 'Claude Code',
  opencode: 'OpenCode',
  codex: 'Codex',
  agy: 'Antigravity',
}

const KNOWN_MODE_ACCENTS: Record<string, string> = {
  claude_code: '#00ff41', // matrix green
  opencode: '#5fcfff', // cyan
  codex: '#ff9d3d', // amber
  agy: '#b78bff', // violet
}

export function normalizeMode(mode: string | null | undefined): string {
  return (mode ?? '').trim().toLowerCase()
}

function titleize(mode: string): string {
  return mode
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function modeLabel(mode: string | null | undefined): string {
  const key = normalizeMode(mode)
  if (!key) return 'Unknown'
  return KNOWN_MODE_LABELS[key] ?? titleize(key)
}

// Deterministic hue from the mode string so unknown modes get a stable,
// repeatable color across renders without a registry entry.
function hashHue(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) % 360
  }
  return hash
}

export function modeAccent(mode: string | null | undefined): string {
  const key = normalizeMode(mode)
  if (!key) return 'var(--m-text-ghost)'
  return KNOWN_MODE_ACCENTS[key] ?? `hsl(${hashHue(key)} 78% 64%)`
}

export type A2AMessageKind = 'orchestrator' | 'ack' | 'executor'

// Mode-agnostic direction classifier. The backend emits per-mode dir strings
// (`hermes->claude`, `hermes->codex`, `codex->hermes (ack)`, …) — classify by
// shape, not by a hardcoded executor name, so every protocol routes correctly.
export function a2aMessageKind(dir: string): A2AMessageKind {
  const normalized = (dir || '').toLowerCase()
  if (normalized.includes('(ack)')) return 'ack'
  if (normalized.startsWith('hermes->')) return 'orchestrator'
  return 'executor'
}

export function a2aMessageLabel(
  message: A2AFleetMessage,
  mode: string | null | undefined,
): string {
  const kind = a2aMessageKind(message.dir)
  if (kind === 'orchestrator') return message.from || 'Hermes'
  if (kind === 'ack') return '[queued]'
  return message.from || modeLabel(mode)
}
