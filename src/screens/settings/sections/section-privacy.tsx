/**
 * section-privacy.tsx — Privacy settings section.
 *
 * Real DEFAULT_CONFIG keys:
 *   privacy.redact_pii           — hash user IDs / strip phone numbers from LLM context
 *   security.redact_secrets      — strip *_API_KEY/*_TOKEN/*_SECRET from logs
 *   security.allow_private_urls  — allow requests to private/internal IPs
 *
 * Dropped ghost keys (not in DEFAULT_CONFIG):
 *   privacy.share_anon, privacy.share_crash, privacy.share_usage,
 *   privacy.scrub_secrets, privacy.redact_paths, privacy.retention_days
 */

import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'
import { Toggle } from '../components/controls'
import { useSettingsStore } from '@/stores/settings-store'

export default function SectionPrivacy() {
  const { draft, set } = useSettingsStore()

  // privacy.*
  const redactPii = (draft['config.privacy.redact_pii'] as boolean | undefined) ?? false

  // security.* — surfaced here for discoverability
  const redactSecrets = (draft['config.security.redact_secrets'] as boolean | undefined) ?? true
  const allowPrivateUrls = (draft['config.security.allow_private_urls'] as boolean | undefined) ?? false

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Privacy</h2>
          <div className="desc">PII redaction, secret scrubbing, and network trust policy.</div>
        </div>
        <div className="meta">Section · <b>privacy · security</b></div>
      </div>

      <SettingCard title="Data redaction">
        <SettingRow
          label="Redact PII from context"
          desc="Hash user IDs and strip phone numbers before sending to the LLM"
        >
          <Toggle on={redactPii} set={(v) => set('config.privacy.redact_pii', v)} />
        </SettingRow>
        <SettingRow
          label="Redact secrets from logs"
          pill={{ t: 'recommended' }}
          desc="Strip *_API_KEY, *_TOKEN, *_SECRET values from log output"
        >
          <Toggle on={redactSecrets} set={(v) => set('config.security.redact_secrets', v)} />
        </SettingRow>
      </SettingCard>

      <SettingCard title="Network trust">
        <SettingRow
          label="Allow private / internal URLs"
          pill={{ t: 'danger' }}
          desc="Permit requests to RFC-1918 addresses (OpenWrt, proxies, VPNs)"
        >
          <Toggle on={allowPrivateUrls} set={(v) => set('config.security.allow_private_urls', v)} />
        </SettingRow>
      </SettingCard>
    </div>
  )
}
