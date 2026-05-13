import { DISPATCH_DATA } from './mock-data'

export function DispatchMeta() {
  const { meta } = DISPATCH_DATA
  return (
    <div className="disp-meta">
      {meta.map((item) => (
        <span key={item.label} className={`disp-pill${item.active ? ' disp-pill--active' : ''}`}>
          {item.value ? `${item.label} · ${item.value}` : item.label}
        </span>
      ))}
    </div>
  )
}
