import { LaneLegend } from './lane-legend'
import { LaneRow } from './lane-row'
import { LANES, NOW_LEFT } from './mock-data'
import type { LaneScale } from '@/stores/conductor-ui-store'
import { useConductorUIStore } from '@/stores/conductor-ui-store'

const SCALE_LABELS: Array<{ id: LaneScale; label: string }> = [
  { id: '1M',  label: '1m' },
  { id: '5M',  label: '5m' },
  { id: '15M', label: '15m' },
  { id: '1H',  label: '1h' },
]

export function WorkerLanes() {
  const laneScale = useConductorUIStore((s) => s.laneScale)
  const setLaneScale = useConductorUIStore((s) => s.setLaneScale)

  return (
    <div className="lanes-wrap">
      <div className="lanes-head">
        <h3>Worker timeline</h3>
        <span className="ct">· 6 lanes · last 06:00</span>
        <div className="right">
          <div className="scale">
            {SCALE_LABELS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                className={laneScale === id ? 'on' : undefined}
                onClick={() => setLaneScale(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="ico-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M5 12h14M12 5v14" />
            </svg>
          </span>
        </div>
      </div>

      <div className="lanes">
        {/* tick row */}
        <div className="ticks">
          <div />
          <div className="row">
            <span>-5:00</span>
            <span>-4:30</span>
            <span>-4:00</span>
            <span>-3:30</span>
            <span>-3:00</span>
            <span>-2:30</span>
            <span>-2:00</span>
            <span>-1:30</span>
            <span>-1:00</span>
            <span>-0:30</span>
            <span>now</span>
            <span>+0:30</span>
          </div>
        </div>

        {LANES.map((lane) => (
          <LaneRow
            key={lane.name}
            name={lane.name}
            role={lane.role}
            dotStatus={lane.dotStatus}
            nowLineLeft={NOW_LEFT}
            blocks={lane.blocks}
          />
        ))}
      </div>

      <LaneLegend />
    </div>
  )
}
