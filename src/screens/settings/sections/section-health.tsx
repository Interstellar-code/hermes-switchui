/**
 * section-health.tsx — Config health (board C, P5B).
 *
 * Everything on this page derives from the live store draft through the pure
 * P5A lib (`checkConfigHealth` / `applyPreset`), so it re-renders as the user
 * edits. Fix buttons and preset buttons only call `setMany` — they change the
 * draft and mark keys dirty; nothing is saved until the user goes through the
 * P6 save review in the save bar.
 *
 * Skipped from board C on purpose: the "UI controls miswired" tile (board E,
 * not this plan), "Export YAML" / "Open raw config" buttons, and the
 * "locked in section pages / unlock" behaviour (out of scope per brief).
 */

import { SettingCard } from '../components/setting-card'
import { applyPreset, checkConfigHealth } from '../lib/config-health'
import { getPresets, listKeyMeta } from '../lib/key-meta'
import type { HealthFinding } from '../lib/config-health'
import type { KeyMeta } from '../lib/key-meta-types'
import { useSettingsStore } from '@/stores/settings-store'

const CONFIG_PREFIX = 'config.'

/** Draft key for a meta entry — mirrors config-health's private `draftKey`. */
function draftKeyOf(meta: KeyMeta): string {
  return meta.scope === 'hermes-config' ? `${CONFIG_PREFIX}${meta.id}` : meta.id
}

/** Value equality over the list/map values config keys carry. */
function sameValue(a: unknown, b: unknown): boolean {
  if (
    typeof a === 'object' &&
    a !== null &&
    typeof b === 'object' &&
    b !== null
  ) {
    return JSON.stringify(a) === JSON.stringify(b)
  }
  return a === b
}

/** Human value for chips and diffs: strings bare, everything else JSON. */
function formatValue(value: unknown): string {
  if (value === undefined) return 'unset'
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/** Chip label for a draft key: bare id, `config.` prefix stripped. */
function chipLabel(key: string): string {
  return key.startsWith(CONFIG_PREFIX) ? key.slice(CONFIG_PREFIX.length) : key
}

/**
 * `HealthFinding` carries no key list, so the four rules whose fix is `{}`
 * (nothing a value patch can express) get their affected keys named here.
 * Ids are stable — they come from `lib/config-health.ts` rules.
 */
const NO_FIX_KEYS: Record<string, Array<string>> = {
  'legacy-fallback-model': ['fallback_model', 'fallback_providers'],
  'legacy-flat-api-server-keys': [
    'platforms.api_server.host',
    'platforms.api_server.port',
    'platforms.api_server.extra.host',
    'platforms.api_server.extra.port',
  ],
  'browser-cdp-url-pinned': ['browser.cdp_url'],
  'hygiene-limit-tuned': ['compression.hygiene_hard_message_limit'],
}

/** ▲ issue · ◆ info · ◇ legacy — board C's severity markers. */
function severityMarker(finding: HealthFinding): {
  glyph: string
  label: string
  cls: string
} {
  if (finding.id.startsWith('legacy-')) {
    return { glyph: '◇', label: 'legacy', cls: 'health-sev health-sev-legacy' }
  }
  if (finding.severity === 'info') {
    return { glyph: '◆', label: 'info', cls: 'health-sev health-sev-info' }
  }
  return { glyph: '▲', label: 'issue', cls: 'health-sev health-sev-issue' }
}

/** Affected keys as chips: the fix keys, or the finding's keys when fix is {}. */
function findingChips(finding: HealthFinding): Array<string> {
  const fixKeys = Object.keys(finding.fix)
  if (fixKeys.length > 0) return fixKeys.map(chipLabel)
  return NO_FIX_KEYS[finding.id] ?? []
}

/** Short display name + muted tail from labels like "Power (long runs…)". */
function splitLabel(label: string): { name: string; tail: string } {
  const open = label.indexOf(' (')
  if (open === -1) return { name: label, tail: '' }
  return {
    name: label.slice(0, open),
    tail: label.slice(open + 2).replace(/\)$/, ''),
  }
}

export default function SectionHealth() {
  const draft = useSettingsStore((s) => s.draft)
  const setMany = useSettingsStore((s) => s.setMany)

  const meta = listKeyMeta()
  const findings = checkConfigHealth(draft, meta)

  // Score strip. "Dead / duplicate" findings also count as issues (their
  // severity is warn) — the board's tiles overlap the same way.
  const requiredEntries = meta.flatMap((m) =>
    m.required ? [{ id: m.id, key: draftKeyOf(m), required: m.required }] : [],
  )
  const requiredOk = requiredEntries.filter((e) =>
    sameValue(draft[e.key], e.required.value),
  ).length
  const issues = findings.filter(
    (f) => f.severity === 'error' || f.severity === 'warn',
  ).length
  const offRecommended = findings.filter((f) => f.severity === 'info').length
  const deadOrDuplicate = findings.filter((f) =>
    f.id.startsWith('legacy-'),
  ).length

  const fixable = findings.filter((f) => Object.keys(f.fix).length > 0)
  const fixAllPatch: Record<string, unknown> = {}
  for (const f of fixable) Object.assign(fixAllPatch, f.fix)

  const presetBlocks = getPresets().map((preset) => ({
    preset,
    patch: applyPreset(draft, preset, meta),
  }))

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Config health</h2>
          <div className="desc">
            Your config.yaml checked against upstream defaults, SwitchUI
            recommendations and what the UI needs to work.
          </div>
        </div>
        <div className="meta">
          Section · <b>overview</b>
        </div>
      </div>

      {/* Score strip — board C minus the "UI controls miswired" tile (board E). */}
      <div
        className="health-strip"
        role="group"
        aria-label="Config health summary"
      >
        <div className="health-tile">
          <span className="health-tile-num health-ok">
            {requiredOk}/{requiredEntries.length}
          </span>
          <span className="health-tile-cap">SwitchUI required ok</span>
        </div>
        <div className="health-tile">
          <span className="health-tile-num health-issue">{issues}</span>
          <span className="health-tile-cap">Issues</span>
        </div>
        <div className="health-tile">
          <span className="health-tile-num health-info">{offRecommended}</span>
          <span className="health-tile-cap">Off-recommended</span>
        </div>
        <div className="health-tile">
          <span className="health-tile-num health-legacy">
            {deadOrDuplicate}
          </span>
          <span className="health-tile-cap">Dead / duplicate keys</span>
        </div>
      </div>

      <div className="health-cols">
        {/* Findings list */}
        <SettingCard title="Findings" sub={`${findings.length} total`}>
          <div className="health-fixall-bar">
            <button
              className="btn"
              onClick={() => setMany(fixAllPatch)}
              disabled={fixable.length === 0}
            >
              Fix all
            </button>
          </div>
          {findings.length === 0 ? (
            <div className="health-empty">
              No findings — this config matches the checked defaults,
              recommendations and SwitchUI requirements.
            </div>
          ) : (
            findings.map((f) => {
              const marker = severityMarker(f)
              const chips = findingChips(f)
              const fixEntries = Object.entries(f.fix)
              return (
                <div className="health-iss" key={f.id}>
                  <span
                    className={marker.cls}
                    role="img"
                    aria-label={marker.label}
                  >
                    {marker.glyph}
                  </span>
                  <div className="health-iss-body">
                    <div className="health-iss-msg">
                      {f.message}
                      {chips.map((chip) => (
                        <span className="health-chip" key={chip}>
                          {chip}
                        </span>
                      ))}
                    </div>
                    {fixEntries.length > 0 && (
                      <div className="health-diff">
                        {fixEntries.map(([key, value]) => (
                          <span className="health-diff-item" key={key}>
                            <span className="health-diff-key">
                              {chipLabel(key)}
                            </span>{' '}
                            <span className="health-diff-old">
                              {formatValue(draft[key])}
                            </span>{' '}
                            →{' '}
                            <span className="health-diff-new">
                              {formatValue(value)}
                            </span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {fixEntries.length > 0 && (
                    <button
                      className="btn btn-sm"
                      onClick={() => setMany(f.fix)}
                    >
                      Fix
                    </button>
                  )}
                </div>
              )
            })
          )}
        </SettingCard>

        {/* Right column: presets + required keys */}
        <div className="health-side">
          <SettingCard title="Presets">
            <div className="health-pre-list">
              {presetBlocks.map(({ preset, patch }) => {
                const { name, tail } = splitLabel(preset.label)
                return (
                  <div className="health-pre" key={preset.id}>
                    <div className="health-pre-h">
                      <span className="health-pre-name">{name}</span>
                      {preset.id === 'balanced' && (
                        <span
                          className="health-pre-tag"
                          role="img"
                          aria-label="recommended"
                        >
                          ◆ recommended
                        </span>
                      )}
                    </div>
                    {tail && <div className="health-pre-tail">{tail}</div>}
                    <div className="health-pre-lines">
                      {Object.entries(preset.values).map(([id, value]) => (
                        <div className="health-pl" key={id}>
                          <span>{id}</span>
                          <b>{formatValue(value)}</b>
                        </div>
                      ))}
                    </div>
                    <div className="health-pre-foot">
                      <button
                        className="btn"
                        disabled={Object.keys(patch).length === 0}
                        onClick={() => setMany(patch)}
                      >
                        Apply {Object.keys(patch).length} changes
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </SettingCard>

          <SettingCard
            title="Required for SwitchUI"
            sub={`${requiredOk}/${requiredEntries.length} ✓`}
          >
            {requiredEntries.map((e) => {
              const ok = sameValue(draft[e.key], e.required.value)
              return (
                <div className="health-lock" key={e.id}>
                  <span className="health-chip">{e.id}</span>
                  <span className={`health-lock-state ${ok ? 'ok' : 'bad'}`}>
                    {formatValue(draft[e.key])}{' '}
                    {ok ? '✓' : `✗ ${e.required.reason}`}
                  </span>
                </div>
              )
            })}
            <div className="health-lock-note">
              Presets never change these keys.
            </div>
          </SettingCard>
        </div>
      </div>
    </div>
  )
}
