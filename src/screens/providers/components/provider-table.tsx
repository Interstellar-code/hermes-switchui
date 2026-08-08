'use client'

import { ProviderStatusPill } from './provider-card'
import type { ProviderView } from '../lib/provider-view'

export function ProviderTable({
  views,
  onOpen,
}: {
  views: Array<ProviderView>
  onOpen: (view: ProviderView) => void
}) {
  return (
    <table className="pv-table">
      <thead>
        <tr>
          <th>Provider</th>
          <th>Status</th>
          <th>Auth</th>
          <th>Models</th>
          <th>Endpoint</th>
        </tr>
      </thead>
      <tbody>
        {views.map((view) => (
          <tr
            key={view.id}
            onClick={() => onOpen(view)}
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onOpen(view)
            }}
          >
            <td>
              {view.name}
              <span className="pv-muted-cell"> · {view.id}</span>
            </td>
            <td>
              <ProviderStatusPill status={view.status} />
            </td>
            <td className="pv-muted-cell">{view.authKind}</td>
            <td className="pv-muted-cell">
              {view.modelsUnknown ? 'unknown' : view.modelCount}
            </td>
            <td className="pv-muted-cell">{view.baseUrl ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
