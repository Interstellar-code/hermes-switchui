import { useConductorMissions } from './use-conductor-queries'
import { MissionCard } from './mission-card'
import type { Mission } from './use-conductor-queries'
import type { FilterTab } from '@/stores/conductor-ui-store'
import { useConductorUIStore } from '@/stores/conductor-ui-store'

function filterMissions(missions: Array<Mission>, tab: FilterTab): Array<Mission> {
  if (tab === 'all') return missions
  if (tab === 'live') return missions.filter((m) => m.status === 'live')
  if (tab === 'done') return missions.filter((m) => m.status === 'done')
  return missions.filter((m) => m.status === 'err')
}

export function MissionList() {
  const filterTab = useConductorUIStore((s) => s.filterTab)
  const { data: missions = [] } = useConductorMissions()
  const visible = filterMissions(missions, filterTab)

  const nowMissions = visible.filter((m) => m.dayGroup === 'now')
  const earlierMissions = visible.filter((m) => m.dayGroup === 'today')
  const yesterdayMissions = visible.filter((m) => m.dayGroup === 'yesterday')

  return (
    <div className="h-list">
      {nowMissions.length > 0 && (
        <>
          <div className="h-day">
            Now <span style={{ color: 'var(--m-green-500, #00ff41)', marginLeft: 'auto' }}>●</span>
          </div>
          {nowMissions.map((m) => (
            <MissionCard key={m.id} mission={m} />
          ))}
        </>
      )}

      {earlierMissions.length > 0 && (
        <>
          <div className="h-day">Earlier today</div>
          {earlierMissions.map((m) => (
            <MissionCard key={m.id} mission={m} />
          ))}
        </>
      )}

      {yesterdayMissions.length > 0 && (
        <>
          <div className="h-day">Yesterday</div>
          {yesterdayMissions.map((m) => (
            <MissionCard key={m.id} mission={m} />
          ))}
        </>
      )}

      {visible.length === 0 && (
        <div className="h-day" style={{ opacity: 0.5 }}>No missions</div>
      )}
    </div>
  )
}
