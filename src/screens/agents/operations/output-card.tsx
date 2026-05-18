import type { TeamOutput } from '../../../server/operations-store'

interface OutputCardProps {
  output: TeamOutput
}

export function OutputCard({ output }: OutputCardProps) {
  return (
    <div className="out-card">
      <div className="t">
        <span className="who">{output.agent}</span>
        {' · '}
        {output.typeLabel}
      </div>
      <div className="nm">{output.name}</div>
      <div className="pv">{output.preview}</div>
      <div className="ft">
        <span>{output.time}</span>
        <span className="sz">{output.size}</span>
      </div>
    </div>
  )
}
