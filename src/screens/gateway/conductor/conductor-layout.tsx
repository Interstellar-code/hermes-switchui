import { MissionCanvas } from './mission-canvas'
import { MissionRail } from './mission-rail'
import { NowPlayingStrip } from './now-playing-strip'
import { ConductorTopBar } from './conductor-top-bar'
import { WorkerLanes } from './worker-lanes'
import { MissionDetailDrawer } from './mission-detail-drawer'

export function ConductorLayout() {
  return (
    <>
      <ConductorTopBar />
      <div className="cnd-body">
        <main className="cnd-main">
          <NowPlayingStrip />
          <MissionCanvas />
          <WorkerLanes />
        </main>
        <MissionRail />
      </div>
      <MissionDetailDrawer />
    </>
  )
}
