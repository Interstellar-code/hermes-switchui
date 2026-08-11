/**
 * section-notifications.tsx — Notifications settings section.
 *
 * Previously held four localStorage-backed toggles (desktop, sound, task
 * done, error) — the section's entire contents. No code outside
 * src/screens/settings/ ever read any of the four hermes.notif.* keys, so
 * they persisted and did nothing. Deleted outright (plan
 * immutable-noodling-koala, Stream 1B) rather than left as dead switches.
 *
 * That leaves nothing to configure. Rather than render an empty shell, this
 * states plainly where alerts actually come from: inline toasts
 * (src/components/ui/toast.tsx) and the approvals queue — there is no
 * separate desktop/sound/email channel to turn on or off.
 */

import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'

export default function SectionNotifications() {
  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Notifications</h2>
          <div className="desc">There are no separate notification channels to configure.</div>
        </div>
        <div className="meta">Section · <b>notifications</b></div>
      </div>

      <SettingCard title="How alerts work" sub="read-only">
        <SettingRow
          label="Alerts"
          desc="Errors, saves, and pending approvals surface as inline toasts and in the approvals queue — not as desktop, sound, or email notifications."
          pill={{ t: 'read-only' }}
        >
          <span className="desc">In-app only</span>
        </SettingRow>
      </SettingCard>
    </div>
  )
}
