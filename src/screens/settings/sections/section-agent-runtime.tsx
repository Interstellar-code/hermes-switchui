/**
 * section-agent-runtime.tsx — Agent runtime settings.
 *
 * Keys verified against DEFAULT_CONFIG.agent in hermes_cli/config.py.
 * Dropped ghosts: worker_pool, queue_depth, task_timeout_s, retries,
 *   parallel_subtasks, auto_commit, verify_before_ship, capture_logs.
 * Real keys: max_turns, gateway_timeout, api_max_retries, service_tier,
 *   tool_use_enforcement.
 */

import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'
import { NumberSlider } from '../components/controls'
import { useSettingsStore } from '@/stores/settings-store'

export default function SectionAgentRuntime() {
  const { draft, set } = useSettingsStore()

  const maxTurns = (draft['config.agent.max_turns'] as number | undefined) ?? 90
  const gatewayTimeout = (draft['config.agent.gateway_timeout'] as number | undefined) ?? 1800
  const apiMaxRetries = (draft['config.agent.api_max_retries'] as number | undefined) ?? 3
  const serviceTier = (draft['config.agent.service_tier'] as string | undefined) ?? ''
  const toolUseEnforcement = (draft['config.agent.tool_use_enforcement'] as string | undefined) ?? 'auto'

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Agent Runtime</h2>
          <div className="desc">Turn limits, gateway timeouts, and tool enforcement.</div>
        </div>
        <div className="meta">Section · <b>agent-runtime</b></div>
      </div>

      <SettingCard title="Execution limits">
        <SettingRow label="Max turns" desc="Maximum conversation turns before agent stops">
          <NumberSlider
            min={1}
            max={500}
            step={1}
            value={maxTurns}
            onChange={(v) => set('config.agent.max_turns', v)}
          />
        </SettingRow>
        <SettingRow label="Gateway timeout" desc={`${gatewayTimeout}s — max seconds for gateway response`}>
          <NumberSlider
            min={60}
            max={7200}
            step={60}
            value={gatewayTimeout}
            onChange={(v) => set('config.agent.gateway_timeout', v)}
          />
        </SettingRow>
        <SettingRow label="API max retries" desc="Times to retry a failed API call">
          <NumberSlider
            min={0}
            max={10}
            step={1}
            value={apiMaxRetries}
            onChange={(v) => set('config.agent.api_max_retries', v)}
          />
        </SettingRow>
      </SettingCard>

      <SettingCard title="Service">
        <SettingRow label="Service tier" desc="Provider service tier (leave blank for default)">
          <input
            type="text"
            className="text-input"
            value={serviceTier}
            placeholder="default"
            onChange={(e) => set('config.agent.service_tier', e.target.value)}
          />
        </SettingRow>
        <SettingRow label="Tool use enforcement" desc="How tool use is enforced: auto, required, or none">
          <select
            className="select-input"
            value={toolUseEnforcement}
            onChange={(e) => set('config.agent.tool_use_enforcement', e.target.value)}
          >
            <option value="auto">auto</option>
            <option value="required">required</option>
            <option value="none">none</option>
          </select>
        </SettingRow>
      </SettingCard>
    </div>
  )
}
