/**
 * section-model-registry.tsx — Model registry summary.
 *
 * Summary card: total models, providers count, top-3 by usage.
 * Full model management at /settings/providers.
 */

import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { SettingCard } from '../components/setting-card'
import { modelOptions, modelAuxiliary, analyticsModels } from '@/lib/hermes-client'

export default function SectionModelRegistry() {
  const navigate = useNavigate()

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

  const { data: analytics } = useQuery({
    queryKey: ['analytics-models'],
    queryFn: () => analyticsModels(30),
    staleTime: 60_000,
  })

  const totalModels = (options?.providers ?? []).reduce(
    (acc, p) => acc + p.models.length,
    0,
  )
  const providerCount = options?.providers?.length ?? 0
  const mainModel = auxiliary?.main?.model ?? ''

  // Top-3 by total tokens
  const top3 = [...(analytics?.models ?? [])]
    .sort((a, b) => {
      const aT = (a.input_tokens ?? 0) + (a.output_tokens ?? 0)
      const bT = (b.input_tokens ?? 0) + (b.output_tokens ?? 0)
      return bT - aT
    })
    .slice(0, 3)

  function fmtTokens(n: number) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`
    return String(n)
  }

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Model Registry</h2>
          <div className="desc">Mounted providers and model usage summary.</div>
        </div>
        <div className="meta">Section · <b>model-registry</b></div>
      </div>

      <SettingCard title="Status">
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {isLoading ? (
                <span style={{ fontSize: '11px', fontFamily: 'var(--m-font-mono)', color: 'var(--m-text-faint)' }}>
                  Loading…
                </span>
              ) : (
                <span style={{ fontSize: '11px', fontFamily: 'var(--m-font-mono)', color: 'var(--m-accent)' }}>
                  ✓ {totalModels} models · {providerCount} {providerCount === 1 ? 'provider' : 'providers'}
                </span>
              )}
            </div>
            <button
              className="btn"
              style={{ fontSize: '11px', padding: '4px 10px' }}
              onClick={() => void navigate({ to: '/settings/providers' })}
            >
              Open Providers →
            </button>
          </div>

          <div className="kv" style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', fontFamily: 'var(--m-font-mono)', color: 'var(--m-text-faint)' }}>
            {mainModel && (
              <div>
                <span style={{ color: 'var(--m-text-dim, var(--m-text-faint))' }}>active model</span>
                {' · '}
                {mainModel}
              </div>
            )}
          </div>

          {top3.length > 0 && (
            <div className="mini-table-wrap">
              <table className="mini-table" style={{ fontSize: '11px' }}>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Model</th>
                    <th>Tokens (30d)</th>
                  </tr>
                </thead>
                <tbody>
                  {top3.map((row, i) => (
                    <tr key={row.model}>
                      <td style={{ color: 'var(--m-text-faint)' }}>{i + 1}</td>
                      <td style={{ fontFamily: 'var(--m-font-mono)' }}>{row.model}</td>
                      <td>{fmtTokens((row.input_tokens ?? 0) + (row.output_tokens ?? 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </SettingCard>
    </div>
  )
}
