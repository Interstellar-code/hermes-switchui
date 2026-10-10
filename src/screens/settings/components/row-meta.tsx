/**
 * row-meta.tsx — the metadata strip rendered compactly under a row label
 * when `SettingRow` gets a `meta: KeyMeta` (board B). Three layers, matching
 * what the settings-gap audit found users lacking:
 *
 *  1. scope + applies badges — where the value lives (config.yaml / .env /
 *     this browser) and when a change takes effect (Live / Next session /
 *     Needs restart), as `.pill` chips;
 *  2. one muted mono line — "Default X · Recommended Y · Range a–b", only the
 *     parts the meta actually carries. A value equal to `range.unlimited`
 *     (the null/0 sentinel meaning ∞) renders as ∞, for the default, the
 *     recommendation and the range's upper bound alike;
 *  3. an ⓘ tooltip (repo base-ui primitive, theme-token styled) with the
 *     key's effect, tradeoff, source, and a trust state:
 *       required set → "Locked: <value> — <reason>"
 *       verified     → "Verified"
 *       else         → "not traced in code"
 *
 * Styling is entirely existing classes (`.pill`, `.m-timestamp`, `.m-label-xs`,
 * the tooltip's own theme tokens) — this file adds no CSS and no colours.
 */

import type { KeyApplies, KeyMeta, KeyScope } from '../lib/key-meta-types'
import {
  TooltipContent,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from '@/components/ui/tooltip'

const SCOPE_BADGE: Record<KeyScope, string> = {
  'hermes-config': 'config.yaml',
  env: '.env',
  'switchui-local': 'this browser',
}

const APPLIES_BADGE: Record<KeyApplies, string> = {
  live: 'Live',
  'next-session': 'Next session',
  restart: 'Needs restart',
}

/**
 * Formats a value for the meta line. `unlimited` is the range's ∞ sentinel
 * (null/0) — any displayed value equal to it means "no limit" and shows ∞,
 * so `default: null` on agent.max_turns reads "Default ∞", not "Default null".
 */
function formatValue(value: unknown, unlimited: unknown): string {
  if (unlimited !== undefined && value === unlimited) return '∞'
  if (value === null || value === undefined) return 'none'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** "a–b" from whichever bounds exist; ∞ as the upper bound when unlimited is set. */
function formatRange(range: KeyMeta['range']): string | null {
  if (!range) return null
  const bounds: Array<string> = []
  if (range.min !== undefined) bounds.push(String(range.min))
  const max = range.unlimited !== undefined ? '∞' : range.max
  if (max !== undefined) bounds.push(String(max))
  return bounds.length > 0 ? bounds.join('–') : null
}

/** The tooltip's trust line. A locked key states its lock even if also verified. */
function formatState(meta: KeyMeta): string {
  if (meta.required) {
    return `Locked: ${formatValue(meta.required.value, meta.range?.unlimited)} — ${meta.required.reason}`
  }
  return meta.verified ? 'Verified' : 'not traced in code'
}

export function RowMeta({ meta }: { meta: KeyMeta }) {
  const unlimited = meta.range?.unlimited
  const parts: Array<string> = []
  if (meta.default !== undefined) {
    parts.push(`Default ${formatValue(meta.default, unlimited)}`)
  }
  if (meta.recommended !== undefined) {
    parts.push(`Recommended ${formatValue(meta.recommended, unlimited)}`)
  }
  const range = formatRange(meta.range)
  if (range) parts.push(`Range ${range}`)

  return (
    <div className="row-meta">
      <span className="pill">{SCOPE_BADGE[meta.scope]}</span>
      <span className="pill">{APPLIES_BADGE[meta.applies]}</span>
      {parts.length > 0 && (
        <span className="m-timestamp">{parts.join(' · ')}</span>
      )}
      <TooltipProvider>
        <TooltipRoot>
          <TooltipTrigger
            render={
              <span
                className="m-label-xs row-meta-info"
                tabIndex={0}
                aria-label="Details"
              />
            }
          >
            ⓘ
          </TooltipTrigger>
          <TooltipContent side="top">
            <div className="row-meta-tip">
              <p>{meta.effect}</p>
              {meta.tradeoff && <p>Tradeoff: {meta.tradeoff}</p>}
              <p className="m-mono">Source: {meta.source}</p>
              <p>{formatState(meta)}</p>
            </div>
          </TooltipContent>
        </TooltipRoot>
      </TooltipProvider>
    </div>
  )
}
