/**
 * section-performance.tsx — Performance settings section (P5).
 */

import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'
import { Segmented, Toggle } from '../components/controls'
import { useSettingsStore } from '@/stores/settings-store'
import { gatewayStatus } from '@/server/hermes-api'

const BG_OPTIONS = [
  { value: 'pause', label: 'Pause' },
  { value: 'low-power', label: 'Low power' },
  { value: 'normal', label: 'Normal' },
]

const LS_HW_ACCEL = 'hermes.perf.hw_accel'
const LS_PREFETCH = 'hermes.perf.prefetch'
const LS_BG = 'hermes.perf.bg'

export default function SectionPerformance() {
  const { draft, set, load, committed } = useSettingsStore()
  const seeded = useRef(false)

  useEffect(() => {
    if (seeded.current) return
    seeded.current = true
    const hwAccel = localStorage.getItem(LS_HW_ACCEL)
    const prefetch = localStorage.getItem(LS_PREFETCH)
    const bg = localStorage.getItem(LS_BG)
    load({
      ...committed,
      [LS_HW_ACCEL]: hwAccel !== null ? hwAccel === 'true' : true,
      [LS_PREFETCH]: prefetch !== null ? prefetch === 'true' : true,
      [LS_BG]: bg ?? 'normal',
    })
  }, [committed, load])

  const { data: status } = useQuery({
    queryKey: ['gateway-status'],
    queryFn: gatewayStatus,
    staleTime: 15_000,
    refetchInterval: 15_000,
  })

  const hwAccel = (draft[LS_HW_ACCEL] as boolean | undefined) ?? true
  const prefetch = (draft[LS_PREFETCH] as boolean | undefined) ?? true
  const bg = (draft[LS_BG] as string | undefined) ?? 'normal'

  const cpu = status?.cpu
  const rss = status?.rss

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Performance</h2>
          <div className="desc">Hardware acceleration, prefetching, and background behaviour.</div>
        </div>
        <div className="meta">Section · <b>performance</b></div>
      </div>

      <SettingCard title="Rendering">
        <SettingRow
          label="Hardware acceleration"
          pill={{ t: 'restart req' }}
          desc="Use GPU rendering where available"
        >
          <Toggle on={hwAccel} set={(v) => set(LS_HW_ACCEL, v)} />
        </SettingRow>
        <SettingRow label="Prefetch on hover" desc="Start loading pages when hovering navigation links">
          <Toggle on={prefetch} set={(v) => set(LS_PREFETCH, v)} />
        </SettingRow>
      </SettingCard>

      <SettingCard title="Background behaviour">
        <SettingRow label="Background behaviour" desc="How Hermes behaves when the window is not focused">
          <Segmented options={BG_OPTIONS} value={bg} onChange={(v) => set(LS_BG, v)} />
        </SettingRow>
      </SettingCard>

      <SettingCard title="Process snapshot">
        <SettingRow label="Gateway process" pill={{ t: 'live' }}>
          <span style={{ display: 'flex', gap: 12, fontSize: 12, fontFamily: 'var(--m-font-mono)' }}>
            {cpu !== undefined ? (
              <>
                <span>CPU <b>{typeof cpu === 'number' ? cpu.toFixed(1) : cpu}%</b></span>
                <span style={{ color: 'var(--m-text-faint)' }}>·</span>
                <span>RSS <b>{typeof rss === 'number' ? (rss / 1024 / 1024).toFixed(1) : rss} MB</b></span>
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
