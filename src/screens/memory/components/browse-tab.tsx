import { useQuery } from '@tanstack/react-query'

type MnemosyneStatsResponse = {
  checkedAt: number
  db: { exists: boolean }
  counts: {
    working: number
    episodic: number
    triples: number
    fts: number
    total: number
  }
  missingReason?: string
}

async function apiFetch<T>(url: string): Promise<T> {
  const res = await fetch(url)
  const payload = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) {
    throw new Error(payload.error ?? `Request failed (${res.status})`)
  }
  return payload as T
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value)
}

function formatCheckedAt(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function BrowseTab() {
  const { data, isLoading, isError, error, refetch, isFetching } =
    useQuery<MnemosyneStatsResponse>({
      queryKey: ['memory', 'browse', 'stats'],
      queryFn: () => apiFetch('/api/memory/stats'),
      staleTime: 30_000,
    })

  if (isLoading) {
    return <div className="mem-loading">Loading matrix memory stats…</div>
  }

  if (isError) {
    const message = error instanceof Error ? error.message : 'Failed to load matrix memory stats'
    return (
      <section className="mbrowse-shell">
        <div className="mbrowse-hero mbrowse-panel">
          <div className="mbrowse-kicker">Browse</div>
          <h2>Could not load memory stats</h2>
          <p>{message}</p>
          <div className="mbrowse-actions">
            <button type="button" className="mem-btn" onClick={() => void refetch()}>
              Retry
            </button>
          </div>
        </div>
      </section>
    )
  }

  if (!data) return null

  if (!data.db.exists) {
    return (
      <section className="mbrowse-shell">
        <div className="mbrowse-hero mbrowse-panel">
          <div className="mbrowse-kicker">Browse</div>
          <h2>Mnemosyne database unavailable</h2>
          <p>
            {data.missingReason}
          </p>
          <div className="mbrowse-actions">
            <button type="button" className="mem-btn" onClick={() => void refetch()}>
              Retry
            </button>
          </div>
        </div>
      </section>
    )
  }

  const cards = [
    {
      label: 'Working Memory',
      value: data.counts.working,
      detail: 'Active working-memory rows',
    },
    {
      label: 'Episodic Memory',
      value: data.counts.episodic,
      detail: 'Long-term archived rows',
    },
    {
      label: 'Triples',
      value: data.counts.triples,
      detail: 'Extracted knowledge graph triples',
    },
    {
      label: 'FTS Rows',
      value: data.counts.fts,
      detail: 'Full-text search index rows',
    },
    {
      label: 'Total Tracked',
      value: data.counts.total,
      detail: 'Working + episodic combined',
    },
  ]

  return (
    <section className="mbrowse-shell">
      <div className="mbrowse-hero-grid">
        <article className="mbrowse-panel mbrowse-hero">
          <div className="mbrowse-kicker">Matrix DB Overview</div>
          <h2>Live Mnemosyne stats at a glance</h2>
          <p>
            A read-only operational view of the default local Matrix memory bank.
            This is the first Browse release: safe stats now, richer search and
            detail browsing next.
          </p>
          <div className="mbrowse-pills">
            <span className="mbrowse-pill">Default bank connected</span>
            <span className="mbrowse-pill">SQLite read-only</span>
            <span className="mbrowse-pill is-muted">
              Last refresh: {formatCheckedAt(data.checkedAt)}
              {isFetching ? ' · refreshing…' : ''}
            </span>
          </div>
        </article>

        <aside className="mbrowse-panel mbrowse-summary">
          <div className="mbrowse-kicker">Operational Summary</div>
          <h3>What this answers fast</h3>
          <div className="mbrowse-summary-list">
            <div className="mbrowse-summary-item">
              <span>Is memory ingestion alive?</span>
              <strong>{data.counts.total > 0 ? 'Yes' : 'No data yet'}</strong>
            </div>
            <div className="mbrowse-summary-item">
              <span>How large is the bank?</span>
              <strong>{formatCount(data.counts.total)} rows</strong>
            </div>
            <div className="mbrowse-summary-item">
              <span>Is graph extraction active?</span>
              <strong>{formatCount(data.counts.triples)} triples</strong>
            </div>
            <div className="mbrowse-summary-item">
              <span>Is full-text search populated?</span>
              <strong>{formatCount(data.counts.fts)} FTS rows</strong>
            </div>
          </div>
        </aside>
      </div>

      <div className="mbrowse-stats-grid">
        {cards.map((card) => (
          <article key={card.label} className="mbrowse-stat-card">
            <div className="mbrowse-stat-label">{card.label}</div>
            <div className="mbrowse-stat-value">{formatCount(card.value)}</div>
            <div className="mbrowse-stat-detail">{card.detail}</div>
          </article>
        ))}
      </div>

      <div className="mbrowse-bottom-grid">
        <article className="mbrowse-panel">
          <div className="mbrowse-kicker">Why this tab exists</div>
          <h3>Stats first, browse depth next</h3>
          <p>
            This keeps the initial implementation small and stable while opening
            a clean seam for search, filters, cards, and memory-detail surfaces.
          </p>
          <div className="mbrowse-callout">
            Next phase: search input, tier/source filters, recent-vs-importance
            sorting, paginated result cards, and a full-row detail drawer.
          </div>
        </article>

        <article className="mbrowse-panel">
          <div className="mbrowse-kicker">State handling</div>
          <h3>Read-only and failure-aware</h3>
          <p>
            The tab should stay explicit and calm in loading, missing-database,
            and unexpected error states without affecting the existing Memory,
            Wiki, Graph, Settings, or Chat tabs.
          </p>
          <div className="mbrowse-callout is-soft">
            Current DB detected: <strong>yes</strong>
          </div>
        </article>
      </div>
    </section>
  )
}
