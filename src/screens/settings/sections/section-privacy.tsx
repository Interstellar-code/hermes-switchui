/**
 * section-privacy.tsx — Privacy settings section (P5).
 */

import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'
import { Toggle } from '../components/controls'
import { useSettingsStore } from '@/stores/settings-store'

export default function SectionPrivacy() {
  const { draft, set } = useSettingsStore()

  const shareAnon = (draft['config.privacy.share_anon'] as boolean | undefined) ?? false
  const shareCrash = (draft['config.privacy.share_crash'] as boolean | undefined) ?? false
  const shareUsage = (draft['config.privacy.share_usage'] as boolean | undefined) ?? false
  const scrubSecrets = (draft['config.privacy.scrub_secrets'] as boolean | undefined) ?? true
  const redactPaths = (draft['config.privacy.redact_paths'] as boolean | undefined) ?? false
  const retentionDays = (draft['config.privacy.retention_days'] as number | undefined) ?? 90

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Privacy</h2>
          <div className="desc">Data sharing, log scrubbing, and history retention.</div>
        </div>
        <div className="meta">Section · <b>privacy</b></div>
      </div>

      <SettingCard title="Data sharing">
        <SettingRow label="Share anonymous metrics" desc="Send anonymous usage metrics to improve the product">
          <Toggle on={shareAnon} set={(v) => set('config.privacy.share_anon', v)} />
        </SettingRow>
        <SettingRow label="Share crash reports" desc="Automatically send crash reports">
          <Toggle on={shareCrash} set={(v) => set('config.privacy.share_crash', v)} />
        </SettingRow>
        <SettingRow label="Share usage analytics" desc="Share feature usage analytics">
          <Toggle on={shareUsage} set={(v) => set('config.privacy.share_usage', v)} />
        </SettingRow>
      </SettingCard>

      <SettingCard title="Security">
        <SettingRow label="Scrub secrets from logs" pill={{ t: 'recommended' }} desc="Redact API keys and tokens from log output">
          <Toggle on={scrubSecrets} set={(v) => set('config.privacy.scrub_secrets', v)} />
        </SettingRow>
        <SettingRow label="Redact filesystem paths" desc="Hide full paths in logs and error messages">
          <Toggle on={redactPaths} set={(v) => set('config.privacy.redact_paths', v)} />
        </SettingRow>
      </SettingCard>

      <SettingCard title="Retention">
        <SettingRow label="History retention (days)" desc={`${retentionDays} days`}>
          <input
            type="range"
            min={1}
            max={365}
            step={1}
            value={retentionDays}
            onChange={(e) => set('config.privacy.retention_days', parseInt(e.target.value, 10))}
          />
        </SettingRow>
      </SettingCard>
    </div>
  )
}
