/**
 * section-model-registry.tsx — Model registry (P3).
 *
 * Read-only table of mounted providers/models from modelOptions().
 * Full add/edit/OAuth flows deferred to P5 (providers OAuth UI).
 */

import { useQuery } from '@tanstack/react-query'
import { SettingCard } from '../components/setting-card'
import { modelAuxiliary, modelOptions } from '@/server/hermes-api'
import { toast } from '@/components/ui/toast'

export default function SectionModelRegistry() {
  const { data: options, isLoading } = useQuery({
    queryKey: ['model-options'],
    queryFn: modelOptions,
    staleTime: 30_000,
  })

  const { data: auxiliary } = useQuery({
    queryKey: ['model-auxiliary'],
    queryFn: modelAuxiliary,
    staleTime: 30_000,
  })

  // Build a flat list of all models with provider + status
  type ModelRow = {
    provider: string
    model: string
    base_url: string
    status: string
  }

  const rows: Array<ModelRow> = []
  for (const prov of options?.providers ?? []) {
    for (const m of prov.models) {
      // Check if this model is assigned as an auxiliary task
      const auxMatch = auxiliary?.tasks.find(
        (t) => t.provider === prov.id && t.model === m,
      )
      const isMain =
        auxiliary?.main.provider === prov.id && auxiliary.main.model === m
      const status = isMain ? 'main' : auxMatch ? `aux:${auxMatch.task}` : 'mounted'
      rows.push({
        provider: prov.id,
        model: m,
        base_url: '—',
        status,
      })
    }
  }

  const mountedCount = rows.length

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Model Registry</h2>
          <div className="desc">All mounted providers and their available models.</div>
        </div>
        <div className="meta">Section · <b>model-registry</b></div>
      </div>

      <SettingCard
        title="Mounted models"
        sub={`${mountedCount} mounted`}
      >
        {isLoading ? (
          <div style={{ padding: '16px', color: 'var(--m-text-faint)', font: '12px var(--m-font-mono)' }}>
            Loading…
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: '16px', color: 'var(--m-text-faint)', font: '12px var(--m-font-mono)' }}>
            No models found. Configure providers in the Provider section.
          </div>
        ) : (
          <div className="mini-table-wrap">
            <table className="mini-table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Model</th>
                  <th>Base URL</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={`${row.provider}-${row.model}-${i}`}>
                    <td>{row.provider}</td>
                    <td style={{ fontFamily: 'var(--m-font-mono)' }}>{row.model}</td>
                    <td style={{ fontFamily: 'var(--m-font-mono)', color: 'var(--m-text-faint)' }}>{row.base_url}</td>
                    <td>
                      <span className={`pill ${row.status === 'main' ? 'success' : ''}`}>
                        {row.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--m-border)', display: 'flex', gap: '8px' }}>
          {/* OAuth provider add — deferred to P5 (providers OAuth UI) */}
          <button
            className="btn"
            onClick={() => toast('Use /settings/providers to add providers via OAuth', { type: 'info' })}
          >
            Add via OAuth
          </button>
        </div>
      </SettingCard>
    </div>
  )
}
