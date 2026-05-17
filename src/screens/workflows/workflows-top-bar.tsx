interface WorkflowsTopBarProps {
  templateCount?: number
}

export function WorkflowsTopBar({ templateCount = 0 }: WorkflowsTopBarProps) {
  return (
    <header className="wf-top">
      <div>
        <div className="crumbs">
          <span>Workspace</span>
          <span className="sep">›</span>
          <span className="cur">Workflows</span>
          <span className="sep">·</span>
          <span>template library · live</span>
        </div>
        <h1>Workflows</h1>
        <div className="sub">
          Browse, inspect, and launch workflow templates exposed to Hermes
          Agent.
        </div>
      </div>
      <div className="health">
        <div className="stat">
          <span className="v ok">{templateCount}</span>
          <span className="l">templates</span>
        </div>
        <div className="stat">
          <span className="v">0</span>
          <span className="l">runs today</span>
        </div>
        <div className="stat">
          <span className="v">0</span>
          <span className="l">active</span>
        </div>
      </div>
    </header>
  )
}
