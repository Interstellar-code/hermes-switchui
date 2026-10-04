/** Header stat tiles for the Memory screen: value + label + health dot, click for a detail popover. */

import type { MnemosyneHealth } from '@/server/mnemosyne-browser'

export type TileState = 'ok' | 'warn' | 'bad'
export type HeaderTile = {
  key: string
  label: string
  value: string
  detail: string
  state?: TileState
}

type Stats = {
  counts: { total: number; triples: number }
  lastWriteAt?: string | null
  health?: MnemosyneHealth
}

const fmt = (n: number) => new Intl.NumberFormat().format(n)
const DAY = 24 * 60 * 60_000

const STATE_TEXT: Record<TileState, string> = {
  ok: 'ok',
  warn: 'warning',
  bad: 'problem',
}

function short(iso: string, now: number): string {
  if (!Number.isFinite(Date.parse(iso))) return '—'
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000))
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h`
  return `${Math.round(mins / (60 * 24))}d`
}

/** Thresholds for every health dot live here. */
export function headerTiles(s: Stats, now = Date.now()): Array<HeaderTile> {
  const tiles: Array<HeaderTile> = [
    {
      key: 'memories',
      label: 'memories',
      value: fmt(s.counts.total),
      detail: 'Working + episodic memories in this profile’s Mnemosyne DB.',
    },
    {
      key: 'triples',
      label: 'triples',
      value: fmt(s.counts.triples),
      detail: 'Subject–predicate–object facts in the knowledge graph.',
    },
  ]
  if (s.lastWriteAt) {
    const age = now - Date.parse(s.lastWriteAt)
    const valid = Number.isFinite(age)
    tiles.push({
      key: 'last-write',
      label: 'last write',
      value: short(s.lastWriteAt, now),
      detail: `Newest memory was written ${short(s.lastWriteAt, now)} ago.${age > 7 * DAY ? ' Over a week ago: nothing is being remembered.' : ''}`,
      state: !valid
        ? undefined
        : age > 30 * DAY
          ? 'bad'
          : age > 7 * DAY
            ? 'warn'
            : 'ok',
    })
  }
  const h = s.health
  const lc = h?.lastConsolidation
  if (lc?.at) {
    const age = now - Date.parse(lc.at)
    const valid = Number.isFinite(age)
    const stale = valid && age > 3 * DAY
    tiles.push({
      key: 'consolidation',
      label: 'consolidated',
      value: `${short(lc.at, now)}${lc.method ? ` · ${lc.method.toUpperCase()}` : ''}`,
      detail: `Last sleep pass folded ${lc.items ?? '?'} working memories into summaries. llm = host-LLM summary; aaak = lossy fallback compression.${stale ? ' Over 3 days ago: auto-sleep may not be running.' : ''}`,
      state: !valid
        ? undefined
        : stale
          ? 'bad'
          : lc.method === 'aaak'
            ? 'warn'
            : 'ok',
    })
  }
  if (h?.backlog) {
    const { rows, sessions, backoff } = h.backlog
    tiles.push({
      key: 'backlog',
      label: 'backlog',
      value: `${fmt(rows)} · ${fmt(sessions)} sess`,
      detail: `Unconsolidated, unpinned working memories old enough for the next sleep sweep.${backoff ? ` ${fmt(backoff)} more are in the 6h retry backoff after a failed summary.` : ''}`,
      state: backoff || rows > 1000 ? 'warn' : 'ok',
    })
  }
  if (h?.embeddings && h.embeddings.total > 0) {
    const pct = (h.embeddings.covered / h.embeddings.total) * 100
    tiles.push({
      key: 'embeddings',
      label: 'embeddings',
      value: `${Math.floor(pct)}%`,
      detail: `${fmt(h.embeddings.covered)} of ${fmt(h.embeddings.total)} working memories have a vector embedding; the rest are keyword-only in recall.`,
      state: pct < 50 ? 'bad' : pct < 95 ? 'warn' : 'ok',
    })
  }
  return tiles
}

// Top-layer popovers have no anchor; place under the tile on open.
function placeBelow(e: React.ToggleEvent<HTMLElement>) {
  const pop = e.currentTarget
  const btn = pop.previousElementSibling
  if (!btn || e.newState !== 'open') return
  const r = btn.getBoundingClientRect()
  pop.style.top = `${r.bottom + 6}px`
  pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 280))}px`
}

export function MemoryHeaderTiles({ stats }: { stats: Stats }) {
  return (
    <div className="mem-tiles" role="group" aria-label="Memory health">
      {headerTiles(stats).map((t) => {
        const id = `mem-tile-${t.key}`
        return (
          <div key={t.key} className="mem-tile-wrap">
            <button
              type="button"
              className="mem-tile"
              data-state={t.state}
              popoverTarget={id}
              aria-describedby={id}
              aria-label={`${t.label} ${t.value}${t.state ? `, ${STATE_TEXT[t.state]}` : ''}`}
            >
              {t.state && <span className="mem-tile-dot" aria-hidden="true" />}
              <span className="mem-tile-label">{t.label}</span>
              <span className="mem-tile-value">{t.value}</span>
            </button>
            <div
              id={id}
              className="mem-tile-pop"
              popover="auto"
              onBeforeToggle={placeBelow}
            >
              <b>{t.label}</b>
              <p>{t.detail}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
