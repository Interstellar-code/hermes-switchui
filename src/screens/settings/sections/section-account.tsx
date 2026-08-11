/**
 * section-account.tsx — Account settings section.
 *
 * Previously exposed two localStorage-backed controls (display name,
 * organisation) — the section's entire contents. No code outside
 * src/screens/settings/ ever read either hermes.* key, so they persisted
 * and did nothing. Deleted outright (plan immutable-noodling-koala,
 * Stream 1B).
 *
 * Hermes Switch UI has no multi-user account system — sessions are local to
 * this browser profile. This card says that plainly instead of rendering an
 * empty shell or a "coming soon" placeholder.
 */

import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'

export default function SectionAccount() {
  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Account</h2>
          <div className="desc">There is no multi-user account system in this build.</div>
        </div>
        <div className="meta">Section · <b>account</b></div>
      </div>

      <SettingCard title="Local session" sub="read-only">
        <SettingRow
          label="Accounts"
          desc="Sessions are local to this browser profile and are not synced across devices or shared with other users."
          pill={{ t: 'read-only' }}
        >
          <span className="desc">Not applicable</span>
        </SettingRow>
      </SettingCard>
    </div>
  )
}
