/**
 * section-safety.tsx — Safety settings section.
 *
 * One surface for everything that jointly decides whether the agent can
 * destroy something unattended: approval mode, the permanent command
 * allowlist, and the Tirith pre-execution scanner. See safety-posture.ts for
 * the combined-state computation and its citations against
 * ~/.hermes/hermes-agent.
 *
 * Real DEFAULT_CONFIG keys (hermes_cli/config.py):
 *   approvals.mode                     — manual | smart (default) | off
 *   approvals.cron_mode                — deny (default) | approve
 *   approvals.destructive_slash_confirm — default true
 *   approvals.mcp_reload_confirm        — default true
 *   hooks_auto_accept                   — top-level, default false
 *   command_allowlist                   — top-level array, default []
 *   security.tirith_enabled             — default true
 *   security.tirith_fail_open           — default true
 */

import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'
import { Segmented, Toggle } from '../components/controls'
import {
  
  computeSafetyPosture,
  describeAllowlistEntry,
  revokeAllowlistEntry
} from '../lib/safety-posture'
import type {PostureTone} from '../lib/safety-posture';
import { useSettingsStore } from '@/stores/settings-store'

const TONE_COLOR: Record<PostureTone, string> = {
  critical: 'var(--m-danger, var(--theme-danger))',
  warning: 'var(--m-warning, var(--theme-warning))',
  ok: 'var(--m-green-500, var(--theme-accent))',
}

const TONE_LABEL: Record<PostureTone, string> = {
  critical: 'Critical',
  warning: 'Caution',
  ok: 'OK',
}

export default function SectionSafety() {
  const draft = useSettingsStore((s) => s.draft)
  const set = useSettingsStore((s) => s.set)

  const approvalsMode = (draft['config.approvals.mode'] as string | undefined) ?? 'smart'
  const cronMode = (draft['config.approvals.cron_mode'] as string | undefined) ?? 'deny'
  const destructiveSlashConfirm =
    (draft['config.approvals.destructive_slash_confirm'] as boolean | undefined) ?? true
  const mcpReloadConfirm = (draft['config.approvals.mcp_reload_confirm'] as boolean | undefined) ?? true
  const hooksAutoAccept = (draft['config.hooks_auto_accept'] as boolean | undefined) ?? false
  const tirithEnabled = (draft['config.security.tirith_enabled'] as boolean | undefined) ?? true
  const tirithFailOpen = (draft['config.security.tirith_fail_open'] as boolean | undefined) ?? true
  const commandAllowlist = (draft['config.command_allowlist'] as Array<string> | undefined) ?? []

  const posture = computeSafetyPosture({
    approvalsMode,
    approvalsCronMode: cronMode,
    destructiveSlashConfirm,
    mcpReloadConfirm,
    hooksAutoAccept,
    tirithEnabled,
    tirithFailOpen,
    commandAllowlist,
  })

  function revoke(entry: string) {
    set('config.command_allowlist', revokeAllowlistEntry(commandAllowlist, entry))
  }

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Safety</h2>
          <div className="desc">
            Everything that jointly decides whether the agent can destroy something unattended.
          </div>
        </div>
        <div className="meta">Section · <b>approvals · security</b></div>
      </div>

      {/* Combined-state posture banner — the single most important element of
          this section. Manual mode + a permissive allowlist reads as
          cautious and is not; this line says so in one sentence. */}
      <div
        role="status"
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '10px',
          padding: '12px 14px',
          margin: '0 0 16px',
          borderRadius: '6px',
          border: `1px solid ${TONE_COLOR[posture.tone]}`,
          background: `color-mix(in srgb, ${TONE_COLOR[posture.tone]} 8%, transparent)`,
        }}
      >
        <span
          style={{
            flexShrink: 0,
            fontSize: '10px',
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            padding: '3px 8px',
            borderRadius: '999px',
            color: TONE_COLOR[posture.tone],
            border: `1px solid ${TONE_COLOR[posture.tone]}`,
            fontFamily: 'var(--m-font-mono, ui-monospace, monospace)',
          }}
        >
          {TONE_LABEL[posture.tone]}
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--m-text, var(--theme-text))' }}>
            {posture.headline}
          </span>
          {posture.notes.map((note) => (
            <span key={note} style={{ fontSize: '12px', color: 'var(--m-text-faint, var(--theme-muted))' }}>
              {note}
            </span>
          ))}
        </div>
      </div>

      <SettingCard title="Command approval">
        <SettingRow
          label="Approval mode"
          desc="manual prompts for every dangerous command; smart lets an auxiliary model screen low-risk ones; off skips every prompt (YOLO)."
        >
          <Segmented
            options={[
              { value: 'manual', label: 'Manual' },
              { value: 'smart', label: 'Smart' },
              { value: 'off', label: 'Off' },
            ]}
            value={approvalsMode}
            onChange={(v) => set('config.approvals.mode', v)}
          />
        </SettingRow>
        <SettingRow
          label="Cron approval mode"
          desc="What happens when a scheduled/cron job hits a dangerous command with no one present to review it."
        >
          <Segmented
            options={[
              { value: 'deny', label: 'Deny' },
              { value: 'approve', label: 'Approve' },
            ]}
            value={cronMode}
            onChange={(v) => set('config.approvals.cron_mode', v)}
          />
        </SettingRow>
        <SettingRow
          label="Confirm destructive slash commands"
          desc="Ask before /clear, /new, /reset, or /undo discard conversation state."
        >
          <Toggle
            on={destructiveSlashConfirm}
            set={(v) => set('config.approvals.destructive_slash_confirm', v)}
          />
        </SettingRow>
        <SettingRow
          label="Confirm MCP reloads"
          desc="Ask before /reload-mcp rebuilds the tool set (invalidates the prompt cache)."
        >
          <Toggle on={mcpReloadConfirm} set={(v) => set('config.approvals.mcp_reload_confirm', v)} />
        </SettingRow>
        <SettingRow
          label="Auto-accept shell hooks"
          pill={{ t: 'danger' }}
          desc="Registers new shell-script hooks without a prompt. Needed for headless/cron runs, but means any hook a skill declares runs unreviewed."
        >
          <Toggle on={hooksAutoAccept} set={(v) => set('config.hooks_auto_accept', v)} />
        </SettingRow>
      </SettingCard>

      <SettingCard title="Pre-execution scanning (Tirith)">
        <SettingRow
          label="Tirith scanner"
          desc="Scans commands for danger signals before they run, independent of the approval prompt."
        >
          <Toggle on={tirithEnabled} set={(v) => set('config.security.tirith_enabled', v)} />
        </SettingRow>
        <SettingRow
          label="Fail open on scanner error"
          pill={tirithEnabled ? { t: 'danger' } : undefined}
          desc={
            tirithFailOpen
              ? 'On: if the scanner errors out or is unreachable, commands are allowed through as if nothing was scanned.'
              : 'Off: a scanner outage blocks risky commands instead of silently letting them through.'
          }
        >
          <Toggle
            on={tirithFailOpen}
            set={(v) => set('config.security.tirith_fail_open', v)}
            disabled={!tirithEnabled}
          />
        </SettingRow>
      </SettingCard>

      <SettingCard
        title="Permanently allowed commands"
        sub={`${commandAllowlist.length} ${commandAllowlist.length === 1 ? 'entry' : 'entries'}`}
      >
        {commandAllowlist.length === 0 ? (
          <div style={{ padding: '14px 16px', fontSize: '12px', color: 'var(--m-text-faint, var(--theme-muted))' }}>
            No commands are permanently pre-approved. Every dangerous command goes through the
            approval mode above.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {commandAllowlist.map((entry) => {
              const info = describeAllowlistEntry(entry)
              return (
                <div
                  key={entry}
                  className="row"
                  style={{ alignItems: 'flex-start', gap: '12px' }}
                >
                  <div className="lbl" style={{ flex: 1 }}>
                    <code style={{ fontFamily: 'var(--m-font-mono, ui-monospace, monospace)', fontSize: '12px' }}>{entry}</code>
                    {info.known && (
                      <span className="pill" style={{ color: TONE_COLOR.critical, borderColor: TONE_COLOR.critical }}>
                        bypasses approval
                      </span>
                    )}
                    <span className="desc">{info.description}</span>
                  </div>
                  <div className="ctl">
                    <button type="button" className="btn btn-danger" onClick={() => revoke(entry)}>
                      Revoke
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </SettingCard>
    </div>
  )
}
