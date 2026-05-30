/**
 * section-workflows.tsx — Workflows backend status (read-only).
 *
 * The native TS workflow engine has been removed. The app now always delegates
 * to the hermes-agent workflow-engine plugin. This section surfaces that fact
 * without any toggle or mutation controls.
 *
 * Workflow definitions are stored in the plugin's SQLite DB — single source
 * of truth. Bundled YAML files (src/features/workflows/defaults/) are factory
 * seeds only; they are written to the DB on first install and ignored thereafter.
 * See docs/plans/workflow-db-single-source-of-truth.md for the full design.
 */

import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'

export default function SectionWorkflows() {
  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Workflows</h2>
          <div className="desc">Workflow backend status and storage configuration.</div>
        </div>
        <div className="meta">Section · <b>workflows</b></div>
      </div>

      <SettingCard icon="⚙️" title="Backend" sub="Workflow execution engine">
        <SettingRow
          label="Engine"
          desc="The native TypeScript engine has been removed. All workflow execution is handled by the hermes-agent workflow-engine plugin."
          pill={{ t: 'read-only' }}
        >
          <span style={{ fontFamily: 'var(--m-font-mono)', fontSize: '12px', color: 'var(--m-text-dim, var(--m-text-faint))' }}>
            Plugin (workflow-engine)
          </span>
        </SettingRow>
      </SettingCard>

      <SettingCard icon="🗄️" title="Storage" sub="Where workflow definitions live">
        <SettingRow
          label="Source of truth"
          desc="Workflow definitions are persisted in the plugin's SQLite database. Bundled YAML files are factory seeds — written once on first install, ignored on subsequent runs."
        >
          <span style={{ fontFamily: 'var(--m-font-mono)', fontSize: '12px', color: 'var(--m-text-dim, var(--m-text-faint))' }}>
            Plugin DB
          </span>
        </SettingRow>
        <SettingRow
          label="Seed YAMLs"
          desc="Located at src/features/workflows/defaults/. Changes to these files only take effect on a fresh plugin install; they do not override existing DB entries."
        >
          <span style={{ fontFamily: 'var(--m-font-mono)', fontSize: '12px', color: 'var(--m-text-dim, var(--m-text-faint))' }}>
            Factory seeds only
          </span>
        </SettingRow>
      </SettingCard>
    </div>
  )
}
