/**
 * section-storage.tsx — Storage settings section.
 *
 * No `storage.*` keys exist in DEFAULT_CONFIG.
 * Real session-retention lives under `sessions.*`.
 * Shows a 30-day usage summary card + session-pruning config.
 * Cache path is read-only display (~/.hermes/).
 */

import { useQuery } from '@tanstack/react-query'
import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'
import { Toggle, NumberSlider } from '../components/controls'
import { useSettingsStore } from '@/stores/settings-store'
import { analyticsUsage } from '@/lib/hermes-client'

export default function SectionStorage() {
  const { draft, set } = useSettingsStore()

  const { data: usage, isLoading } = useQuery({
    queryKey: ['analytics-usage', 30],
    queryFn: () => analyticsUsage(30),
    staleTime: 60_000,
  })

  // sessions.* — real DEFAULT_CONFIG keys
  const autoPrune = (draft['config.sessions.auto_prune'] as boolean | undefined) ?? false
  const retentionDays = (draft['config.sessions.retention_days'] as number | undefined) ?? 90
  const vacuumAfterPrune = (draft['config.sessions.vacuum_after_prune'] as boolean | undefined) ?? true

  const totalTokens = usage?.total_tokens
  const totalCalls = usage?.total_calls
  const totalSessions = usage?.total_sessions
  const estimatedCost = usage?.total_estimated_cost

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Storage</h2>
          <div className="desc">Session database pruning and 30-day usage summary.</div>
        </div>
        <div className="meta">Section · <b>sessions</b></div>
      </div>

      {/* Summary card */}
      <SettingCard title="Usage (last 30 days)">
        <div
          className="kv"
          style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', fontFamily: 'var(--m-font-mono)', color: 'var(--m-text-faint)' }}
        >
          {isLoading ? (
            <span>Loading…</span>
          ) : (
            <>
              <div>
                <span style={{ color: 'var(--m-text-dim, var(--m-text-faint))' }}>Sessions</span>
                {' · '}
                <b style={{ color: 'var(--m-text)' }}>
                  {totalSessions !== undefined ? totalSessions.toLocaleString() : (usage?.sessions !== undefined ? (usage.sessions as number).toLocaleString() : '—')}
                </b>
              </div>
              <div>
                <span style={{ color: 'var(--m-text-dim, var(--m-text-faint))' }}>Tokens</span>
                {' · '}
                <b style={{ color: 'var(--m-text)' }}>
                  {totalTokens !== undefined ? totalTokens.toLocaleString() : '—'}
                </b>
              </div>
              <div>
                <span style={{ color: 'var(--m-text-dim, var(--m-text-faint))' }}>API calls</span>
                {' · '}
                <b style={{ color: 'var(--m-text)' }}>
                  {totalCalls !== undefined ? totalCalls.toLocaleString() : '—'}
                </b>
              </div>
              {estimatedCost !== undefined && (
                <div>
                  <span style={{ color: 'var(--m-text-dim, var(--m-text-faint))' }}>Est. cost</span>
                  {' · '}
                  <b style={{ color: 'var(--m-text)' }}>${estimatedCost.toFixed(4)}</b>
                </div>
              )}
              <div style={{ marginTop: 4 }}>
                <span style={{ color: 'var(--m-text-dim, var(--m-text-faint))' }}>Data path</span>
                {' · '}
                <span style={{ color: 'var(--m-text)' }}>~/.hermes/</span>
              </div>
            </>
          )}
        </div>
      </SettingCard>

      {/* Session pruning — sessions.* in DEFAULT_CONFIG */}
      <SettingCard title="Session pruning">
        <SettingRow
          label="Auto-prune sessions"
          desc="Prune ended sessions older than the retention limit at startup"
        >
          <Toggle on={autoPrune} set={(v) => set('config.sessions.auto_prune', v)} />
        </SettingRow>
        <SettingRow
          label="Retention (days)"
          desc={`Keep ${retentionDays} days of ended-session history`}
        >
          <NumberSlider
            min={7}
            max={365}
            step={1}
            value={retentionDays}
            onChange={(v) => set('config.sessions.retention_days', v)}
          />
        </SettingRow>
        <SettingRow
          label="VACUUM after prune"
          pill={{ t: 'recommended' }}
          desc="Reclaim SQLite disk space after pruning (brief write-lock)"
        >
          <Toggle on={vacuumAfterPrune} set={(v) => set('config.sessions.vacuum_after_prune', v)} />
        </SettingRow>
      </SettingCard>
    </div>
  )
}
