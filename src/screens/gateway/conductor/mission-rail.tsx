'use client'

import { useConductorMissions } from './use-conductor-queries'
import { MissionFilters } from './mission-filters'
import { MissionList } from './mission-list'
import { useConductorUIStore } from '@/stores/conductor-ui-store'

interface MissionRailProps {
  onNewMission: () => void
}

export function MissionRail({ onNewMission }: MissionRailProps) {
  const filterTab = useConductorUIStore((s) => s.filterTab)
  const setFilterTab = useConductorUIStore((s) => s.setFilterTab)

  const { data: missions = [] } = useConductorMissions()

  const counts = {
    live: missions.filter((m) => m.status === 'live').length,
    done: missions.filter((m) => m.status === 'done').length,
    err: missions.filter((m) => m.status === 'err').length,
  }
  const total = missions.length

  return (
    <aside className="cnd-rail">
      <div className="h-head">
        <h3>Missions</h3>
        <span className="ct">· {total} today</span>
        <div className="actions">
          <span className="ico-btn" aria-label="Search">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <path d="M21 21l-4.3-4.3M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z" />
            </svg>
          </span>
        </div>
      </div>

      <MissionFilters active={filterTab} counts={counts} onSelect={setFilterTab} />

      <MissionList />

      <div className="h-foot">
        <button onClick={onNewMission}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            width="12"
            height="12"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          new mission
        </button>
      </div>
    </aside>
  )
}
