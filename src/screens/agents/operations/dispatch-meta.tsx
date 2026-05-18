// Static dispatch meta pills. The values displayed here are the *defaults*
// the dispatch composer applies — they are not live data from the gateway.
// When a future endpoint exposes per-user dispatch presets, swap this to a
// query hook.
const DISPATCH_META: Array<{ label: string; value: string; active?: boolean }> = [
  { label: 'priority', value: 'normal', active: true },
  { label: 'budget', value: '25k tok' },
  { label: 'deadline', value: '30m' },
  { label: '+ tags', value: '' },
]

export function DispatchMeta() {
  return (
    <div className="disp-meta">
      {DISPATCH_META.map((item) => (
        <span
          key={item.label}
          className={`disp-pill${item.active ? ' disp-pill--active' : ''}`}
        >
          {item.value ? `${item.label} · ${item.value}` : item.label}
        </span>
      ))}
    </div>
  )
}
