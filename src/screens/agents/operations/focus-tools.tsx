import type { ToolItem } from './mock-data'

interface FocusToolsProps {
  tools: ToolItem[]
}

export function FocusTools({ tools }: FocusToolsProps) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h4>Tools used</h4>
        <span className="ct">· this mission</span>
        <span className="more">all →</span>
      </div>
      <div className="panel-body">
        <div className="tool-grid">
          {tools.map((t) => (
            <div key={t.name} className="tool-cell">
              <div className="ico">{t.ico}</div>
              <div className="nm">{t.name}</div>
              <div className="ct">{t.count}×</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
