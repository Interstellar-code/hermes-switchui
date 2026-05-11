import { useProfilesFilterStore, useProfilesViewStore, usePageSize, PAGE_SIZES_GRID, PAGE_SIZES_TABLE } from '@/stores/profiles-screen-store'

type Props = {
  total: number
}

export function ProfilePager({ total }: Props) {
  const { page, setPage } = useProfilesFilterStore()
  const { setPageSize, viewMode } = useProfilesViewStore()
  const pageSize = usePageSize()
  const pageSizeOptions = viewMode === 'grid' ? PAGE_SIZES_GRID : PAGE_SIZES_TABLE

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const start = Math.min((safePage - 1) * pageSize + 1, total)
  const end = Math.min(safePage * pageSize, total)

  function go(p: number) {
    if (p < 1 || p > totalPages) return
    setPage(p)
  }

  const pages: Array<number> = []
  const range = 2
  for (let i = Math.max(1, safePage - range); i <= Math.min(totalPages, safePage + range); i++) {
    pages.push(i)
  }

  return (
    <div className="pf-pagination">
      <span>
        Showing <b>{total === 0 ? 0 : start}</b>–<b>{end}</b> of <b>{total}</b>
      </span>

      <div className="sep" />

      <span>Per page</span>
      <select
        className="pf-page-size-select"
        value={pageSize}
        onChange={(e) => {
          setPageSize(Number(e.target.value))
          setPage(1)
        }}
      >
        {pageSizeOptions.map((n) => (
          <option key={n} value={n}>{n}</option>
        ))}
      </select>

      <div className="pf-pager-nav">
        <button type="button" className="pf-pager-btn" onClick={() => go(1)} disabled={safePage === 1}>«</button>
        <button type="button" className="pf-pager-btn" onClick={() => go(safePage - 1)} disabled={safePage === 1}>‹</button>

        {pages.length > 0 && (pages[0] ?? 0) > 1 && (
          <>
            <button type="button" className="pf-pager-btn" onClick={() => go(1)}>1</button>
            {(pages[0] ?? 0) > 2 && <span style={{ padding: '0 4px', opacity: 0.4, fontSize: 10 }}>…</span>}
          </>
        )}

        {pages.map((p) => (
          <button
            key={p}
            type="button"
            className={`pf-pager-btn${p === safePage ? ' on' : ''}`}
            onClick={() => go(p)}
          >
            {p}
          </button>
        ))}

        {pages.length > 0 && (pages[pages.length - 1] ?? 0) < totalPages && (
          <>
            {(pages[pages.length - 1] ?? 0) < totalPages - 1 && (
              <span style={{ padding: '0 4px', opacity: 0.4, fontSize: 10 }}>…</span>
            )}
            <button type="button" className="pf-pager-btn" onClick={() => go(totalPages)}>{totalPages}</button>
          </>
        )}

        <button type="button" className="pf-pager-btn" onClick={() => go(safePage + 1)} disabled={safePage === totalPages}>›</button>
        <button type="button" className="pf-pager-btn" onClick={() => go(totalPages)} disabled={safePage === totalPages}>»</button>
      </div>
    </div>
  )
}
