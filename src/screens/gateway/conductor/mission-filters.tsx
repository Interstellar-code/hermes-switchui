export type FilterTab = 'all' | 'live' | 'done' | 'err'

interface MissionFiltersProps {
  active: FilterTab
  counts: { live: number; done: number; err: number }
  onSelect: (tab: FilterTab) => void
}

export function MissionFilters({ active, counts, onSelect }: MissionFiltersProps) {
  const tabs: Array<{ id: FilterTab; label: string }> = [
    { id: 'all', label: 'all' },
    { id: 'live', label: `live · ${counts.live}` },
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
