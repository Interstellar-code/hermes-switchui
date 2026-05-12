/**
 * section-storage.tsx — Storage settings section (P5).
 */

import { useQuery } from '@tanstack/react-query'
import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'
import { useSettingsStore } from '@/stores/settings-store'
import { analyticsUsage } from '@/server/hermes-api'

export default function SectionStorage() {
  const { draft, set } = useSettingsStore()

  const { data: usage } = useQuery({
    queryKey: ['analytics-usage', 30],
    queryFn: () => analyticsUsage(30),
    staleTime: 60_000,
  })

  const cachePath = (draft['config.storage.cache_path'] as string | undefined) ?? ''
  const cacheCap = (draft['config.storage.cache_cap_gb'] as number | undefined) ?? 10
  const exportDir = (draft['config.storage.export_dir'] as string | undefined) ?? ''
  const attachmentCap = (draft['config.storage.attachment_cap_mb'] as number | undefined) ?? 25

  const totalTokens = usage?.total_tokens
  const totalCalls = usage?.total_calls

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Storage</h2>
          <div className="desc">Paths, cache limits, and attachment caps.</div>
        </div>
        <div className="meta">Section · <b>storage</b></div>
      </div>

      <SettingCard title="Paths">
        <SettingRow label="Cache path" desc="Directory for cached responses and embeddings">
          <input
            type="text"
            className="text-input"
            value={cachePath}
            placeholder="/tmp/hermes/cache"
            onChange={(e) => set('config.storage.cache_path', e.target.value)}
          />
        </SettingRow>
        <SettingRow label="Export folder" desc="Default directory for exported files">
          <input
            type="text"
            className="text-input"
            value={exportDir}
            placeholder="~/Downloads/hermes-exports"
            onChange={(e) => set('config.storage.export_dir', e.target.value)}
          />
        </SettingRow>
      </SettingCard>

      <SettingCard title="Limits">
        <SettingRow label="Cache cap (GB)" desc={`${cacheCap} GB`}>
          <input
            type="range"
            min={1}
            max={100}
            step={1}
            value={cacheCap}
            onChange={(e) => set('config.storage.cache_cap_gb', parseInt(e.target.value, 10))}
          />
        </SettingRow>
        <SettingRow label="Attachment size cap (MB)" desc="Maximum file size for attachments">
          <input
            type="number"
            className="text-input"
            value={attachmentCap}
            min={1}
            max={2048}
            onChange={(e) => set('config.storage.attachment_cap_mb', parseInt(e.target.value, 10))}
          />
        </SettingRow>
      </SettingCard>

      <SettingCard title="Usage">
        <SettingRow label="Current usage (last 30 days)" pill={{ t: 'live' }}>
          <span className="text-input" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {totalTokens !== undefined ? (
              <>
                <span><b>{totalTokens.toLocaleString()}</b> tokens</span>
                <span style={{ color: 'var(--m-text-faint)' }}>·</span>
                <span><b>{(totalCalls ?? 0).toLocaleString()}</b> calls</span>
              </>
            ) : (
              <span style={{ color: 'var(--m-text-faint)' }}>—</span>
            )}
          </span>
        </SettingRow>
      </SettingCard>
    </div>
  )
}
