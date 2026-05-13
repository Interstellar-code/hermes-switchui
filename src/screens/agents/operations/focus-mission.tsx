import type { FocusMission } from './mock-data'

interface FocusMissionProps {
  mission: FocusMission
}

export function FocusMission({ mission }: FocusMissionProps) {
  return (
    <div className="panel mission span2">
      <div className="panel-head">
        <h4>Current mission</h4>
        <span className="ct">· {mission.traceId} · started {mission.startedAt}</span>
        <span className="more">view trace →</span>
      </div>
      <div className="panel-body">
        <div>
          <div className="prompt">{mission.prompt}</div>
          <div className="stage">
            {mission.stages.map((s) => (
              <span key={s.label} className={`st${s.state === 'done' ? ' done' : s.state === 'now' ? ' now' : ''}`}>
                {s.label}
              </span>
            ))}
          </div>
        </div>
        <div className="timing">
          <b>{mission.elapsed}</b>
          elapsed
        </div>
      </div>
    </div>
  )
}
