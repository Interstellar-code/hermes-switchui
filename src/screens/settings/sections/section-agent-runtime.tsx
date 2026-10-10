/**
 * section-agent-runtime.tsx — Agent runtime settings.
 *
 * Keys verified against DEFAULT_CONFIG.agent in hermes_cli/config.py.
 * Dropped ghosts: worker_pool, queue_depth, task_timeout_s, retries,
 *   parallel_subtasks, auto_commit, verify_before_ship, capture_logs.
 * Real keys: max_turns, gateway_timeout, api_max_retries, service_tier,
 *   tool_use_enforcement.
 *
 * ## Shapes the agent actually reads
 *
 * Four of these five rows used to offer values `hermes_cli` cannot honour, so
 * a setting that looked saved had no effect:
 *
 * - `tool_use_enforcement` is `auto` | `true` | `false`, not the
 *   `auto | required | none` the old select claimed. `agent/system_prompt.py`
 *   understands only booleans (and their always/never/yes/no/on/off synonyms)
 *   or a list of model-name substrings; `required` and `none` both fell
 *   through to the `auto` branch, so "none" did not disable enforcement and
 *   "required" did not force it. The 3-way control writes the booleans. The
 *   list form stays on Raw config.
 * - `max_turns` defaults to `null` — uncapped. The row rendered a hardcoded
 *   90 while the agent ran without any cap, and moving the slider imposed one
 *   the user never asked for. The ∞ control writes `null`; the number is
 *   disabled while it is on and comes back to the last cap when it is off.
 * - `gateway_timeout` is an *idle* timeout — seconds with no activity, not a
 *   hard deadline on a response — and `0` means no timeout at all, a value
 *   the old 60..7200 slider could not reach. The floor is 0 now and the row
 *   reads "∞ off" there rather than "0s".
 * - `service_tier`'s hardcoded fallback listed `default` and `flex`, neither
 *   of which is a legal value; the schema's own enum is
 *   `'' | normal | fast | auto | cold`. The fallback is only ever rendered
 *   when the schema fetch fails, so the one case that could save a typo was
 *   the case that offered garbage. Labelled "Fast mode" because that is what
 *   the setting actually is.
 */

import { useState } from 'react'
import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'
import { NumberSlider, Segmented } from '../components/controls'
import { useSchemaOptions } from '../lib/schema-binding'
import { useSettingsStore } from '@/stores/settings-store'

/** `agent.max_turns` is `null` upstream; a number is an explicit cap. */
const DEFAULT_MAX_TURNS = 90

/** The agent's own default, also the value a `gateway_timeout` of "no key" shows. */
const DEFAULT_GATEWAY_TIMEOUT = 1800

/**
 * Fallback for `service_tier` if the gateway's schema is unreachable — the
 * legal values, taken from the schema's own enum rather than from the old
 * hand-kept list, which named two values the agent rejects.
 */
const SERVICE_TIER_FALLBACK = [
  { value: '', label: 'Default' },
  { value: 'normal', label: 'Normal' },
  { value: 'fast', label: 'Fast' },
  { value: 'auto', label: 'Auto' },
  { value: 'cold', label: 'Cold' },
]

type EnforcementChoice = 'auto' | 'on' | 'off'

const ENFORCEMENT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'auto', label: 'auto' },
  { value: 'on', label: 'on' },
  { value: 'off', label: 'off' },
]

/**
 * Which of the three the agent would act on. A boolean and its string
 * spelling both count; anything else — including the legacy `required` and
 * `none` this row used to write, and the model-substring list — is `auto` to
 * the agent, so it reads as `auto` here too rather than pretending otherwise.
 */
function enforcementChoice(raw: unknown): EnforcementChoice {
  if (raw === true || raw === 'true') return 'on'
  if (raw === false || raw === 'false') return 'off'
  return 'auto'
}

/** The value the agent reads back for a chosen segment. */
function enforcementValue(choice: string): 'auto' | boolean {
  if (choice === 'on') return true
  if (choice === 'off') return false
  return 'auto'
}

export default function SectionAgentRuntime() {
  const draft = useSettingsStore((s) => s.draft)
  const set = useSettingsStore((s) => s.set)

  const rawMaxTurns = draft['config.agent.max_turns']
  // `null` is the agent's uncapped default and the only value that means it;
  // an absent key is not, so it renders as a number rather than claiming a
  // cap the config never stated.
  const maxTurnsUnlimited = rawMaxTurns === null
  // The cap to restore when ∞ is switched back off. Seeded from whatever the
  // store holds, so a config that already caps turns comes back to its own
  // number instead of a hardcoded guess.
  const [lastMaxTurns, setLastMaxTurns] = useState(DEFAULT_MAX_TURNS)
  const maxTurns = typeof rawMaxTurns === 'number' ? rawMaxTurns : lastMaxTurns

  const gatewayTimeout =
    (draft['config.agent.gateway_timeout'] as number | undefined) ??
    DEFAULT_GATEWAY_TIMEOUT
  const apiMaxRetries =
    (draft['config.agent.api_max_retries'] as number | undefined) ?? 3
  const serviceTier =
    (draft['config.agent.service_tier'] as string | undefined) ?? ''

  const schemaTierOptions = useSchemaOptions(
    'config.agent.service_tier',
    SERVICE_TIER_FALLBACK,
  )
  // `useSchemaOptions` renders the gateway's empty string as "(unset)"
  // (`optionLabel` in schema-binding). This row has always called it "Default",
  // and the picker chooses a tier rather than clearing a field, so both the
  // schema and the fallback spell it the same way.
  const serviceTierOptions = (schemaTierOptions ?? SERVICE_TIER_FALLBACK).map(
    (opt) => (opt.value === '' ? { ...opt, label: 'Default' } : opt),
  )

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Agent Runtime</h2>
          <div className="desc">
            Turn limits, gateway timeouts, and tool enforcement.
          </div>
        </div>
        <div className="meta">
          Section · <b>agent-runtime</b>
        </div>
      </div>

      <SettingCard title="Execution limits">
        <SettingRow
          label="Max turns"
          desc="Cap on tool-calling iterations per turn — ∞ leaves the agent uncapped"
        >
          {({ labelId }) => (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: 10,
                alignItems: 'center',
              }}
            >
              <NumberSlider
                min={1}
                max={500}
                step={1}
                value={maxTurns}
                disabled={maxTurnsUnlimited}
                onChange={(v) => {
                  setLastMaxTurns(v)
                  set('config.agent.max_turns', v)
                }}
                aria-labelledby={labelId}
              />
              <button
                type="button"
                className={`chip${maxTurnsUnlimited ? ' on' : ''}`}
                aria-pressed={maxTurnsUnlimited}
                aria-label="Unlimited turns"
                onClick={() => {
                  if (maxTurnsUnlimited) {
                    set('config.agent.max_turns', maxTurns)
                  } else {
                    setLastMaxTurns(maxTurns)
                    set('config.agent.max_turns', null)
                  }
                }}
              >
                ∞
              </button>
            </div>
          )}
        </SettingRow>
        <SettingRow
          label="Gateway timeout"
          desc={`${gatewayTimeout === 0 ? '∞ off' : `${gatewayTimeout}s`} — idle seconds without activity before the gateway gives up; 0 means no timeout`}
        >
          <NumberSlider
            min={0}
            max={7200}
            step={60}
            value={gatewayTimeout}
            onChange={(v) => set('config.agent.gateway_timeout', v)}
          />
        </SettingRow>
        <SettingRow
          label="API max retries"
          desc="Times to retry a failed API call"
        >
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
        <SettingRow
          label="Fast mode"
          desc="Provider service tier sent with each request — priority lanes queue less and cost more"
        >
          <select
            className="select-input"
            value={serviceTier}
            onChange={(e) => set('config.agent.service_tier', e.target.value)}
          >
            {serviceTierOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </SettingRow>
        <SettingRow
          label="Tool use enforcement"
          desc="auto — the agent decides; on — require a tool call every turn; off — never call tools"
        >
          <Segmented
            options={ENFORCEMENT_OPTIONS}
            value={enforcementChoice(
              draft['config.agent.tool_use_enforcement'],
            )}
            onChange={(v) =>
              set('config.agent.tool_use_enforcement', enforcementValue(v))
            }
          />
        </SettingRow>
      </SettingCard>
    </div>
  )
}
