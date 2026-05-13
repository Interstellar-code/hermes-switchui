import { OperationsTopBar } from './operations-top-bar'
import { TeamRail } from './team-rail'
import { FocusPanel } from './focus-panel'
import { DispatchPanel } from './dispatch-panel'
import { OutputsStrip } from './outputs-strip'

export function OperationsLayout() {
  return (
    <>
      <OperationsTopBar />
      <div className="ops-body">
        <aside className="ops-team">
          <TeamRail />
        </aside>
        <main className="ops-main">
          <FocusPanel />
        </main>
        <DispatchPanel />
      </div>
      <section className="ops-outputs">
        <OutputsStrip />
      </section>
    </>
  )
}
