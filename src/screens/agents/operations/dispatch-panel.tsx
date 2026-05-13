import { DispatchHeader } from './dispatch-header'
import { DispatchModes } from './dispatch-modes'
import { DispatchComposer } from './dispatch-composer'
import { DispatchMeta } from './dispatch-meta'
import { RoutingPreview } from './routing-preview'

export function DispatchPanel() {
  return (
    <aside className="ops-dispatch">
      <DispatchHeader />
      <DispatchModes />
      <DispatchComposer />
      <DispatchMeta />
      <RoutingPreview />
      <div className="disp-foot">
        <button className="disp-btn-ghost">save draft</button>
        <button className="disp-btn-prim">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            width="12"
            height="12"
            aria-hidden
          >
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
          dispatch
        </button>
      </div>
    </aside>
  )
}
