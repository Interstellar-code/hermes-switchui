/**
 * section-workspace.tsx — Workspace settings section.
 *
 * Previously exposed five localStorage-backed controls (workspace name,
 * language, timezone, date format, startup view) plus an always-empty
 * read-only "Workspace ID" field. A repo-wide sweep found no code outside
 * src/screens/settings/ ever read any of those hermes.* keys — they
 * persisted to localStorage and did nothing. Deleted outright (plan
 * immutable-noodling-koala, Stream 1B) rather than left as controls that
 * silently no-op.
 *
 * What's left is a short, honest, read-only card. There is no per-workspace
 * identity to configure in this build, so this shows real browser-detected
 * values instead of rendering an empty shell or a "coming soon" placeholder.
 */

import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'

export default function SectionWorkspace() {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const locale = typeof navigator !== 'undefined' ? navigator.language : 'en'

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Workspace</h2>
          <div className="desc">Regional details detected from this browser.</div>
        </div>
        <div className="meta">Section · <b>workspace</b></div>
      </div>

      <SettingCard title="Detected" sub="read-only">
        <SettingRow label="Timezone" desc="From the browser; not configurable in this build" pill={{ t: 'read-only' }}>
          <span className="desc">{timezone}</span>
        </SettingRow>
        <SettingRow label="Locale" desc="From the browser; not configurable in this build" pill={{ t: 'read-only' }}>
          <span className="desc">{locale}</span>
        </SettingRow>
      </SettingCard>
    </div>
  )
}
