/**
 * section-agent-runtime.tsx — Agent runtime settings (P3).
 *
 * All keys go through the settings store / saver (dotted-path config patch).
 * Keys are prefixed `config.agent.*` so saver.ts builds nested patch objects.
 */

import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'
import { useSettingsStore } from '@/stores/settings-store'

export default function SectionAgentRuntime() {
  const { draft, set } = useSettingsStore()

  const workerPool = (draft['config.agent.worker_pool'] as number | undefined) ?? 4
  const queueDepth = (draft['config.agent.queue_depth'] as number | undefined) ?? 32
  const taskTimeout = (draft['config.agent.task_timeout_s'] as number | undefined) ?? 300
  const retries = (draft['config.agent.retries'] as number | undefined) ?? 3
  const parallelSubtasks = (draft['config.agent.parallel_subtasks'] as number | undefined) ?? 4
  const autoCommit = (draft['config.agent.auto_commit'] as boolean | undefined) ?? false
  const verifyBeforeShip = (draft['config.agent.verify_before_ship'] as boolean | undefined) ?? true
  const captureLogs = (draft['config.agent.capture_logs'] as boolean | undefined) ?? true

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Agent Runtime</h2>
          <div className="desc">Worker pool, queue, task execution, and safety settings.</div>
        </div>
        <div className="meta">Section · <b>agent-runtime</b></div>
      </div>

      <SettingCard title="Worker pool">
        <SettingRow label="Worker pool size" desc="Number of concurrent agent workers">
          <input
            type="number"
            className="text-input"
            value={workerPool}
            min={1}
            max={64}
            onChange={(e) => set('config.agent.worker_pool', parseInt(e.target.value, 10))}
          />
        </SettingRow>
        <SettingRow label="Queue depth" desc="Maximum number of queued tasks">
          <input
            type="number"
            className="text-input"
            value={queueDepth}
            min={1}
            max={1024}
            onChange={(e) => set('config.agent.queue_depth', parseInt(e.target.value, 10))}
          />
        </SettingRow>
        <SettingRow label="Parallel sub-tasks" desc="Max sub-tasks running in parallel per agent">
          <input
            type="number"
            className="text-input"
            value={parallelSubtasks}
            min={1}
            max={32}
            onChange={(e) => set('config.agent.parallel_subtasks', parseInt(e.target.value, 10))}
          />
        </SettingRow>
      </SettingCard>

      <SettingCard title="Execution">
        <SettingRow label="Task timeout" desc={`${taskTimeout}s — max seconds before a task is cancelled`}>
          <input
            type="range"
            min={30}
            max={3600}
            step={30}
            value={taskTimeout}
            onChange={(e) => set('config.agent.task_timeout_s', parseInt(e.target.value, 10))}
          />
        </SettingRow>
        <SettingRow label="Retry count" desc="Times to retry a failed task before giving up">
          <input
            type="number"
            className="text-input"
            value={retries}
            min={0}
            max={10}
            onChange={(e) => set('config.agent.retries', parseInt(e.target.value, 10))}
          />
        </SettingRow>
      </SettingCard>

      <SettingCard title="Safety & logging">
        <SettingRow label="Auto-commit on success" pill={{ t: 'danger' }} desc="Automatically commit changes when a task succeeds">
          <label className="toggle">
            <input
              type="checkbox"
              checked={autoCommit}
              onChange={(e) => set('config.agent.auto_commit', e.target.checked)}
            />
            <span className="slider" />
          </label>
        </SettingRow>
        <SettingRow label="Verify before ship" desc="Run verification step before finalising output">
          <label className="toggle">
            <input
              type="checkbox"
              checked={verifyBeforeShip}
              onChange={(e) => set('config.agent.verify_before_ship', e.target.checked)}
            />
            <span className="slider" />
          </label>
        </SettingRow>
        <SettingRow label="Capture agent logs" desc="Persist agent stdout/stderr to log files">
          <label className="toggle">
            <input
              type="checkbox"
              checked={captureLogs}
              onChange={(e) => set('config.agent.capture_logs', e.target.checked)}
            />
            <span className="slider" />
          </label>
        </SettingRow>
      </SettingCard>
    </div>
  )
}
