import { useOperationsUIStore } from '../../../stores/operations-ui-store'
import type { OutputsFilter } from '../../../stores/operations-ui-store'
import { useOperationsOutputs } from './use-operations-queries'

const FILTER_TABS: Array<{ key: OutputsFilter; label: string }> = [
  { key: 'all', label: 'all' },
  { key: 'code', label: 'code' },
  { key: 'docs', label: 'docs' },
  { key: 'data', label: 'data' },
  { key: 'media', label: 'media' },
]

export function OutputsFilters() {
  const outputsFilter = useOperationsUIStore((s) => s.outputsFilter)
  const setOutputsFilter = useOperationsUIStore((s) => s.setOutputsFilter)
  const { data: outputs } = useOperationsOutputs()
  const all = outputs ?? []

  function countFor(key: OutputsFilter): number {
    if (key === 'all') return all.length
    return all.filter((o) => o.type === key).length
  }

  return (
    <div className="filters">
      {FILTER_TABS.map(({ key, label }) => {
        const count = countFor(key)
        return (
          <span
            key={key}
            className={`f${outputsFilter === key ? ' on' : ''}`}
            onClick={() => setOutputsFilter(key)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && setOutputsFilter(key)}
          >
            {label}
            {count > 0 && key !== 'all' ? ` · ${count}` : ''}
          </span>
        )
      })}
    </div>
  )
}
