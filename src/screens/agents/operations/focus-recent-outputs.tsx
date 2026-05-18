import type { OutputItem } from '../../../server/operations-store'

interface FocusRecentOutputsProps {
  outputs: OutputItem[]
}

const FileIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
  </svg>
)

const ArtifactIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M21 15V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9" />
    <polyline points="3 15 21 15 17 21 7 21 3 15" />
  </svg>
)

const DataIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M9 9h6v6H9z" />
  </svg>
)

function OutputIcon({ type }: { type: OutputItem['type'] }) {
  if (type === 'file') return <FileIcon />
  if (type === 'artifact') return <ArtifactIcon />
  return <DataIcon />
}

export function FocusRecentOutputs({ outputs }: FocusRecentOutputsProps) {
  return (
    <div className="panel span2">
      <div className="panel-head">
        <h4>Outputs · this session</h4>
        <span className="ct">· {outputs.length} artifacts</span>
        <span className="more">all outputs →</span>
      </div>
      <div className="panel-body">
        {outputs.map((o, i) => (
          <div key={i} className="out">
            <div className="ico">
              <OutputIcon type={o.type} />
            </div>
            <div className="nm">
              {o.name}
              <small>{o.meta}</small>
            </div>
            <div className="sz">{o.time}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
