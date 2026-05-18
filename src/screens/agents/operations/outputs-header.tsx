import { useOperationsUIStore } from '../../../stores/operations-ui-store'
import { OutputsFilters } from './outputs-filters'
import { useOperationsOutputs } from './use-operations-queries'

export function OutputsHeader() {
  const autoRefresh = useOperationsUIStore((s) => s.autoRefresh)
  const setAutoRefresh = useOperationsUIStore((s) => s.setAutoRefresh)
  const { data: outputs } = useOperationsOutputs()
  const count = outputs?.length ?? 0

  return (
    <div className="out-head">
      <h4>Team outputs · today</h4>
      <span className="ct">· {count} artifacts</span>
      <OutputsFilters />
      <div className="right">
        <span
          className={`out-refresh-toggle${autoRefresh ? ' on' : ''}`}
          onClick={() => setAutoRefresh(!autoRefresh)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && setAutoRefresh(!autoRefresh)}
        >
          auto-refresh · {autoRefresh ? 'on' : 'off'}
        </span>
        <span className="ico-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="14" height="14">
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" />
          </svg>
        </span>
      </div>
    </div>
  )
}
