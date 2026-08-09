'use client'

/**
 * workspace-step.tsx — step 3 of 4: where does the agent actually run?
 *
 * This is the only question in the wizard that could not be *detected*, and
 * until now nothing in Switch UI asked it. The Files browser has a workspace
 * selector, but it only moves the file-browser jail root; nothing here has
 * ever written `terminal.cwd`, and the gateway's HTTP API has no cwd concept
 * at all. So the agent has been running in `$HOME` on every install, and the
 * first thing most users notice is the agent creating files in the wrong
 * place.
 *
 * Every rule about the ladder — the `.`/`auto`/`cwd` sentinels, the container
 * defaults, the multiplex caveat, the fact that profile configs do not inherit
 * — belongs to `src/server/agent-cwd.ts` and arrives here as prose in
 * `resolved.warnings`. This file renders them; it does not second-guess them.
 *
 * The write is dry-run then confirm, because this is the one control in Switch
 * UI that changes where commands execute. The user sees before → after before
 * anything is persisted.
 */
import { useEffect, useState } from 'react'
import type {
  AgentCwdPreview,
  AgentCwdStatusView,
  ResolvedCwdView,
} from '../hooks/use-agent-cwd'
import { WizardField, WizardNote, WizardPanel } from '@/components/wizard'

export type WorkspaceStepProps = {
  status: AgentCwdStatusView | null
  loading: boolean
  error: string | null
  preview: AgentCwdPreview | null
  previewing: boolean
  onPreview: (path: string) => void
  onCancelPreview: () => void
  applying: boolean
  onApply: (path: string) => void
  applied: { path: string; needsGatewayRestart: boolean } | null
  canWrite: boolean
}

const SOURCE_PROSE: Record<ResolvedCwdView['source'], string> = {
  'explicit-config': 'from terminal.cwd in this profile’s config.yaml',
  'home-sentinel': 'your home directory, because terminal.cwd is unset',
  'container-default': 'the sandbox default for this backend',
  unknown: 'undetermined from config alone',
}

function CwdLine({
  label,
  resolved,
}: {
  label: string
  resolved: ResolvedCwdView
}) {
  return (
    <div className="ob-current-fact">
      <dt className="ob-current-label">{label}</dt>
      <dd className="ob-current-value is-set">
        {resolved.path ?? 'could not be determined'}
        <span className="wz-sr"> — {SOURCE_PROSE[resolved.source]}</span>
      </dd>
    </div>
  )
}

export function WorkspaceStep({
  status,
  loading,
  error,
  preview,
  previewing,
  onPreview,
  onCancelPreview,
  applying,
  onApply,
  applied,
  canWrite,
}: WorkspaceStepProps) {
  const [path, setPath] = useState('')

  // Seed once from whatever the resolver suggests, and only while the user has
  // not typed: re-seeding after a refetch would move the caret mid-edit.
  const suggestion = status?.suggestedCwd ?? ''
  useEffect(() => {
    setPath((current) => (current === '' && suggestion ? suggestion : current))
  }, [suggestion])

  if (loading && !status) {
    return <WizardNote>Reading where the agent will run…</WizardNote>
  }

  if (!status) {
    return (
      <WizardNote tone="warn">
        {error ??
          'The workspace could not resolve the agent working directory. It will run wherever the gateway was started.'}
      </WizardNote>
    )
  }

  const { resolved } = status
  const isHomeFallback = resolved.source === 'home-sentinel'

  return (
    <div className="ob-connect">
      <section className="ob-current" aria-label="Agent working directory">
        <p className="ob-current-heading">Right now</p>
        <dl className="ob-current-facts">
          <CwdLine label="Agent runs in" resolved={resolved} />
          <div className="ob-current-fact">
            <dt className="ob-current-label">Because</dt>
            <dd className="ob-current-value is-set">
              {SOURCE_PROSE[resolved.source]}
            </dd>
          </div>
          <div className="ob-current-fact">
            <dt className="ob-current-label">Backend / profile</dt>
            <dd className="ob-current-value is-set">
              {resolved.backend} · {resolved.profile}
            </dd>
          </div>
        </dl>
      </section>

      {isHomeFallback ? (
        <WizardNote tone="warn">
          Nothing has set a working directory, so shell commands, file edits and{' '}
          <code>execute_code</code> all run in your home folder. That is rarely
          what anyone wants and it is not visible anywhere else in the app.
        </WizardNote>
      ) : null}

      {resolved.warnings.map((warning) => (
        <WizardNote tone="warn" key={warning}>
          {warning}
        </WizardNote>
      ))}

      {!status.editable ? (
        <WizardNote tone="warn">
          Editing “{status.activeProfile}” would have no effect — this gateway
          multiplexes profiles and takes its working directory from the launch
          profile “{resolved.profile}”.
        </WizardNote>
      ) : null}

      {applied ? (
        <WizardNote tone="ok">
          terminal.cwd is now {applied.path}.
          {applied.needsGatewayRestart
            ? ' The gateway reads config.yaml only at startup, so restart it before this takes effect.'
            : ''}
        </WizardNote>
      ) : null}

      {status.editable && canWrite ? (
        <WizardPanel heading="Change it">
          <WizardField
            label="Working directory"
            hint="An absolute path that already exists. Relative paths and the “.” sentinel are refused."
            htmlFor="ob-workspace-cwd"
            error={error ?? undefined}
          >
            {(fieldProps) => (
              <input
                {...fieldProps}
                type="text"
                value={path}
                placeholder={status.homeDir || '/home/you/projects/thing'}
                onChange={(event) => {
                  setPath(event.target.value)
                  if (preview) onCancelPreview()
                }}
              />
            )}
          </WizardField>

          {preview ? (
            <>
              <dl className="ob-current-facts">
                <CwdLine label="Before" resolved={preview.before} />
                <CwdLine label="After" resolved={preview.after} />
              </dl>
              {preview.after.warnings.map((warning) => (
                <WizardNote tone="warn" key={warning}>
                  {warning}
                </WizardNote>
              ))}
              <div className="ob-verify-actions">
                <button
                  type="button"
                  className="wz-btn wz-btn-primary"
                  disabled={applying}
                  onClick={() => onApply(preview.path)}
                >
                  {applying ? 'Writing…' : 'Write terminal.cwd'}
                </button>
                <button
                  type="button"
                  className="wz-btn"
                  onClick={onCancelPreview}
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <div className="ob-verify-actions">
              <button
                type="button"
                className="wz-btn"
                disabled={previewing || path.trim() === ''}
                onClick={() => onPreview(path)}
              >
                {previewing ? 'Checking…' : 'Preview change'}
              </button>
            </div>
          )}
        </WizardPanel>
      ) : (
        <WizardNote>
          {canWrite
            ? 'This profile’s working directory cannot be changed from here.'
            : 'Read-only for this run — nothing will be written to config.yaml.'}
        </WizardNote>
      )}

      <p className="wz-hint">
        Leaving this alone is a valid answer. Skip the step and the agent keeps
        running in {resolved.path ?? 'its current directory'}.
      </p>
    </div>
  )
}
