export function LaneLegend() {
  return (
    <div className="legend">
      <span className="l"><span className="sw run" />execute</span>
      <span className="l"><span className="sw tool" />tool call</span>
      <span className="l"><span className="sw review" />review</span>
      <span className="l"><span className="sw handoff" />handoff</span>
      <span className="l"><span className="sw err" />error / retry</span>
      <span className="l" style={{ marginLeft: 'auto' }}>scroll horizontally · click any block to inspect</span>
    </div>
  )
}
