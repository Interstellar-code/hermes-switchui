/**
 * section-execution.tsx — Terminal / code-execution settings.
 *
 * Real DEFAULT_CONFIG keys (hermes_cli/config.py `terminal:` / `code_execution:`):
 *   terminal.backend                       — local (default) | docker | ssh |
 *     singularity | modal | daytona. Only local/docker are editable here —
 *     see the note in the backend picker for why.
 *   terminal.cwd                           — NOT edited here. `/api/agent-cwd`
 *     (src/server/agent-cwd.ts) already resolves + previews + writes this,
 *     surfaced in the chat composer's cwd chip (session-selectors-v2.tsx).
 *     Building a second editor here would drift from that resolver's actual
 *     ladder, so this section only shows its read-only status.
 *   terminal.timeout                       — default 180 (seconds)
 *   terminal.persistent_shell              — default True; NO-OP on the
 *     local backend (tools/terminal_tool.py:1440-1444)
 *   terminal.docker_image                  — default
 *     'nikolaik/python-nodejs:python3.11-nodejs20'
 *   terminal.docker_volumes                — array of "host:container" strings
 *   terminal.docker_mount_cwd_to_workspace — default False
 *   terminal.docker_network                — default True (False = --network=none)
 *   terminal.container_cpu                 — default 1
 *   terminal.container_memory              — default 5120 (MB)
 *   terminal.container_disk                — default 51200 (MB)
 *   code_execution.mode                    — 'project' (default) | 'strict'
 *     (code_execution_tool.py:1700 — the only two values)
 *
 * Left to the raw-config editor, deliberately: terminal.modal_mode,
 * terminal.singularity_image, terminal.modal_image, terminal.daytona_image,
 * terminal.docker_env, terminal.docker_forward_env, terminal.docker_extra_args,
 * terminal.docker_run_as_host_user, terminal.env_passthrough, terminal.home_mode,
 * terminal.daemon_term_grace_seconds — and the ssh/singularity/modal/daytona/
 * vercel backends entirely (see the backend picker note).
 */

import { useQuery } from '@tanstack/react-query'
import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'
import { NumberSlider, Segmented, Toggle } from '../components/controls'
import type { ReactNode } from 'react'
import { useSettingsStore } from '@/stores/settings-store'
import {
  agentCwdSourceDetail,
  agentCwdSourceLabel,
  fetchAgentCwd,
} from '@/screens/chat/components/chat-composer-services'
import { HermesDocsLink } from '@/components/hermes-docs-link'

// Backends we can validate and support in this picker. The rest
// (singularity, modal, daytona, ssh/vercel-style remotes) stay in the raw
// YAML editor — we have no way to test them here, and a picker that silently
// mis-describes an untested backend is worse than no picker at all.
const EDITABLE_BACKENDS: Array<{ value: string; label: string }> = [
  { value: 'local', label: 'Local' },
  { value: 'docker', label: 'Docker' },
]

// code_execution_tool.py:1700 — the only two supported values.
const EXECUTION_MODES: Array<{ value: string; label: string }> = [
  { value: 'project', label: 'Project' },
  { value: 'strict', label: 'Strict' },
]

function WarningNote({ children }: { children: ReactNode }) {
  return (
    <div
      role="note"
      style={{
        display: 'flex',
        gap: '8px',
        padding: '10px 12px',
        margin: '0 0 12px',
        borderRadius: '6px',
        border: '1px solid var(--m-warning, var(--theme-warning, #e0a500))',
        background: 'color-mix(in srgb, var(--m-warning, var(--theme-warning, #e0a500)) 8%, transparent)',
        fontSize: '12px',
        color: 'var(--m-text)',
        lineHeight: 1.4,
      }}
    >
      <span aria-hidden style={{ flexShrink: 0 }}>⚠</span>
      <span>{children}</span>
    </div>
  )
}

function parseVolumes(raw: string): Array<string> {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

export default function SectionExecution() {
  const { draft, set } = useSettingsStore()

  const backend = (draft['config.terminal.backend'] as string | undefined) ?? 'local'
  const isKnownBackend = EDITABLE_BACKENDS.some((b) => b.value === backend)
  const isDocker = backend === 'docker'

  const timeout = (draft['config.terminal.timeout'] as number | undefined) ?? 180
  const persistentShell = (draft['config.terminal.persistent_shell'] as boolean | undefined) ?? true
  const codeExecutionMode = (draft['config.code_execution.mode'] as string | undefined) ?? 'project'

  const dockerImage =
    (draft['config.terminal.docker_image'] as string | undefined) ??
    'nikolaik/python-nodejs:python3.11-nodejs20'
  const dockerVolumes = (draft['config.terminal.docker_volumes'] as Array<string> | undefined) ?? []
  const dockerMountCwd =
    (draft['config.terminal.docker_mount_cwd_to_workspace'] as boolean | undefined) ?? false
  const dockerNetwork = (draft['config.terminal.docker_network'] as boolean | undefined) ?? true
  const containerCpu = (draft['config.terminal.container_cpu'] as number | undefined) ?? 1
  const containerMemory = (draft['config.terminal.container_memory'] as number | undefined) ?? 5120
  const containerDisk = (draft['config.terminal.container_disk'] as number | undefined) ?? 51200

  const { data: cwdStatus, isLoading: cwdLoading } = useQuery({
    queryKey: ['agent-cwd', 'settings-execution'],
    queryFn: fetchAgentCwd,
    staleTime: 15_000,
  })

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Execution</h2>
          <div className="desc">Where and how the agent runs shell commands and code.</div>
        </div>
        <div className="meta">Section · <b>terminal · code_execution</b></div>
      </div>

      <SettingCard title="Working directory">
        <SettingRow
          label="Agent working directory"
          desc="Read-only here — set it from the working-directory chip in the chat composer, which previews the change before writing terminal.cwd."
        >
          <span style={{ fontSize: '12px', fontFamily: 'var(--m-font-mono)', color: 'var(--m-text)' }}>
            {cwdLoading
              ? '…'
              : (cwdStatus?.resolved.path ?? 'undetermined')}
          </span>
        </SettingRow>
        {cwdStatus && (
          <SettingRow
            label="Source"
            desc={agentCwdSourceDetail(cwdStatus.resolved)}
          >
            <span style={{ fontSize: '12px', color: 'var(--m-text-faint)' }}>
              {agentCwdSourceLabel(cwdStatus.resolved.source)} · backend {cwdStatus.resolved.backend} ·
              profile {cwdStatus.resolved.profile}
            </span>
          </SettingRow>
        )}
        {cwdStatus?.resolved.warnings.map((warning) => (
          <WarningNote key={warning}>{warning}</WarningNote>
        ))}
        {cwdStatus && !cwdStatus.hasTerminalBlock && cwdStatus.resolved.warnings.length === 0 && (
          <WarningNote>
            This profile has no <code>terminal:</code> block. Profile configs do not inherit from the
            default profile (hermes_cli/config.py reads only HERMES_HOME/config.yaml), so switching to
            this profile silently drops any terminal.cwd set elsewhere and the agent runs in $HOME.
          </WarningNote>
        )}
      </SettingCard>

      <SettingCard title="Backend">
        {!isKnownBackend && (
          <WarningNote>
            Current backend is <code>{backend}</code>, which is not editable from this picker. Switching
            here would replace it with local or docker — leave this section alone and edit
            terminal.backend in the raw config editor instead.
          </WarningNote>
        )}
        <SettingRow
          label="Terminal backend"
          desc="Only local and docker are supported here — we cannot test Modal, Singularity, Daytona, or SSH-style remotes in this UI, and a broken picker for them is worse than no picker. Configure those via the raw config editor."
        >
          <Segmented
            options={EDITABLE_BACKENDS}
            value={isKnownBackend ? backend : ''}
            onChange={(v) => set('config.terminal.backend', v)}
          />
        </SettingRow>
        <div style={{ margin: '-6px 0 12px', fontSize: '11px' }}>
          <HermesDocsLink path="user-guide/docker.md" label="Docker backend docs ↗" />
        </div>
        <SettingRow label="Command timeout" desc={`${timeout}s — max seconds a terminal command may run`}>
          <NumberSlider
            min={10}
            max={3600}
            step={10}
            value={timeout}
            onChange={(v) => set('config.terminal.timeout', v)}
          />
        </SettingRow>
        <SettingRow
          label="Persistent shell"
          pill={backend === 'local' ? { t: 'no-op' } : undefined}
          desc={
            backend === 'local'
              ? 'This is a no-op on the local backend (tools/terminal_tool.py:1440-1444) — local only reads TERMINAL_LOCAL_PERSISTENT, which no config key sets. Toggling it here changes nothing while backend is local.'
              : 'Keep a long-lived shell across commands so cwd/env vars survive between calls.'
          }
        >
          <Toggle on={persistentShell} set={(v) => set('config.terminal.persistent_shell', v)} />
        </SettingRow>
      </SettingCard>

      <SettingCard title="Code execution">
        <SettingRow
          label="Execution mode"
          desc={
            codeExecutionMode === 'strict'
              ? 'Scripts run isolated in a temp directory with hermes-agent’s own Python — maximum reproducibility, but project deps and relative paths will not resolve.'
              : "Scripts run in the session's working directory with the active virtualenv — project deps and relative paths resolve normally."
          }
        >
          <Segmented
            options={EXECUTION_MODES}
            value={codeExecutionMode}
            onChange={(v) => set('config.code_execution.mode', v)}
          />
        </SettingRow>
      </SettingCard>

      {isDocker && (
        <details className="card" style={{ padding: '0' }}>
          <summary
            style={{
              cursor: 'pointer',
              padding: '14px 18px',
              fontSize: '13px',
              fontWeight: 600,
              color: 'var(--m-text)',
            }}
          >
            Advanced Docker settings
          </summary>
          <div style={{ padding: '0 18px 18px' }}>
            <SettingRow label="Docker image" desc="Image used for sandboxed docker terminal sessions">
              <input
                type="text"
                className="text-input"
                value={dockerImage}
                onChange={(e) => set('config.terminal.docker_image', e.target.value)}
              />
            </SettingRow>
            <SettingRow
              label="Mount host cwd to /workspace"
              pill={{ t: 'danger' }}
              desc="Off by default — passing host directories into the sandbox weakens isolation. When ON, the agent's filesystem view becomes the bind-mounted host directory at /workspace instead of an isolated container filesystem; files it writes land directly on your host."
            >
              <Toggle
                on={dockerMountCwd}
                set={(v) => set('config.terminal.docker_mount_cwd_to_workspace', v)}
              />
            </SettingRow>
            <SettingRow
              label="Docker volumes"
              desc={'One "host_path:container_path" mount per line (standard docker -v syntax).'}
            >
              <textarea
                className="text-input"
                rows={3}
                style={{ width: '100%', fontFamily: 'var(--m-font-mono)', fontSize: '12px' }}
                value={dockerVolumes.join('\n')}
                onChange={(e) => set('config.terminal.docker_volumes', parseVolumes(e.target.value))}
              />
            </SettingRow>
            <SettingRow label="Network access" desc="Off runs the container with --network=none (no egress)">
              <Toggle on={dockerNetwork} set={(v) => set('config.terminal.docker_network', v)} />
            </SettingRow>
            <SettingRow label="CPU limit" desc={`${containerCpu} core(s)`}>
              <NumberSlider
                min={1}
                max={16}
                step={1}
                value={containerCpu}
                onChange={(v) => set('config.terminal.container_cpu', v)}
              />
            </SettingRow>
            <SettingRow label="Memory limit" desc={`${containerMemory} MB`}>
              <NumberSlider
                min={512}
                max={32768}
                step={512}
                value={containerMemory}
                onChange={(v) => set('config.terminal.container_memory', v)}
              />
            </SettingRow>
            <SettingRow label="Disk limit" desc={`${containerDisk} MB`}>
              <NumberSlider
                min={1024}
                max={204800}
                step={1024}
                value={containerDisk}
                onChange={(v) => set('config.terminal.container_disk', v)}
              />
            </SettingRow>
          </div>
        </details>
      )}
    </div>
  )
}
