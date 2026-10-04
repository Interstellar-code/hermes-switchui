import type { FilterTab } from '@/stores/conductor-ui-store'

export type { FilterTab }

interface MissionFiltersProps {
  active: FilterTab
  counts: { live: number; waiting: number; done: number; err: number }
  onSelect: (tab: FilterTab) => void
}

export function MissionFilters({ active, counts, onSelect }: MissionFiltersProps) {
  const tabs: Array<{ id: FilterTab; label: string }> = [
    { id: 'all', label: 'all' },
    { id: 'live', label: `live · ${counts.live}` },
    { id: 'waiting', label: `needs you · ${counts.waiting}` },
    { id: 'done', label: `done · ${counts.done}` },
    { id: 'err', label: `err · ${counts.err}` },
  ]

  return (
    <div className="h-filters">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={active === tab.id ? 'on' : undefined}
          onClick={() => onSelect(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
