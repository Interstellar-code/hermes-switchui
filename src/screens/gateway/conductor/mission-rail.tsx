'use client'

import '@/styles/matrix-conductor-rail.css'
import { useState } from 'react'
import {
  useConductorMissions,
  useConductorState,
} from './use-conductor-queries'
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
  const { data: stats } = useConductorState()
  const [search, setSearch] = useState('')

  const counts = {
    live: missions.filter((m) => m.status === 'live').length,
    waiting: missions.filter((m) => m.status === 'waiting').length,
    done: missions.filter(
      (m) => m.status === 'done' || m.status === 'cancelled',
    ).length,
    err: missions.filter((m) => m.status === 'err').length,
  }
  const total = missions.length

  return (
    <aside className="cnd-rail">
      <div className="h-head">
        <h3>Missions</h3>
        <span className="ct">· {stats?.runsToday ?? total} today</span>
        <div className="actions">
          <input
            type="search"
            className="h-search"
            aria-label="Search missions"
            placeholder="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <MissionFilters
        active={filterTab}
        counts={counts}
        onSelect={setFilterTab}
      />

      <MissionList search={search} />

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
