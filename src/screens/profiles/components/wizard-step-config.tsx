import { useState } from 'react'
import YAML from 'yaml'
import {
  configPreviewFromDraft,
  diffLines,
  maskSecrets,
  predictMergedConfig,
} from '../profile-config-map'
import type { NewAgentDraft } from '../types'
import type { ProfileConfig } from '@/server/profiles-browser'

type Props = {
  draft: NewAgentDraft
  errors: Array<string>
  onChange: (patch: Partial<NewAgentDraft>) => void
  config?: ProfileConfig
}

const DIFF_MARKER: Record<'added' | 'removed' | 'unchanged', string> = {
  added: '+ ',
  removed: '- ',
  unchanged: '  ',
}

export function WizardStepConfig({ draft, errors, config }: Props) {
  const [copied, setCopied] = useState(false)

  // Edit mode (config is the profile's CURRENT config, already fetched by the
  // wizard shell): show a before/after diff instead of a single preview,
  // since the write path deep-merges — what's on screen after saving is NOT
  // simply "what you typed". Create mode has nothing to diff against, so it
  // keeps the single-pane preview.
  const isEdit = !!config
  const afterSource = isEdit
    ? predictMergedConfig(config, draft)
    : configPreviewFromDraft(draft)
  const yamlText = YAML.stringify(maskSecrets(afterSource), { lineWidth: 100 })

  const beforeYamlText = isEdit
    ? YAML.stringify(maskSecrets(config), { lineWidth: 100 })
    : null

  const lines = isEdit && beforeYamlText !== null ? diffLines(beforeYamlText, yamlText) : null
  const hasChanges = lines ? lines.some((l) => l.type !== 'unchanged') : false

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(yamlText)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // fallback — clipboard unavailable
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <p className="pf-drawer-section-title" style={{ margin: 0 }}>
          {isEdit ? 'Config changes (read-only — secrets masked)' : 'Config (read-only — secrets masked)'}
        </p>
        <button type="button" className="pf-drawer-action-btn" onClick={() => void handleCopy()}>
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      {errors.length > 0 && (
        <ul className="wiz-errors">
          {errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
      {isEdit && (
        <p className="wiz-hint" style={{ marginBottom: 10 }}>
          Nested settings (agent, agent_ui, memory, skills) merge into what's already saved — a
          field this wizard doesn't send is kept as-is, not removed. MCP servers are the
          exception: the list below fully replaces the saved one.
        </p>
      )}
      {lines ? (
        hasChanges ? (
          <pre className="pf-drawer-yaml wiz-diff-yaml">
            {lines.map((l, idx) => (
              // No trailing "\n": `.wiz-diff-line` is `display: block`, so each
              // line already forms its own line box. Inside a `<pre>` the break
              // would be preserved (CSS Text 3 §4.1.1 removes only *collapsible*
              // breaks at a block's edges) and render an empty line after every
              // row. Block boundaries still yield newlines on copy.
              <span key={idx} className={`wiz-diff-line wiz-diff-${l.type}`}>
                {DIFF_MARKER[l.type]}
                {l.text}
              </span>
            ))}
          </pre>
        ) : (
          <>
            <p className="wiz-hint" style={{ marginBottom: 10 }}>
              No changes — this save will not alter the stored config.
            </p>
            <pre className="pf-drawer-yaml">{yamlText}</pre>
          </>
        )
      ) : (
        <pre className="pf-drawer-yaml">{yamlText}</pre>
      )}
    </div>
  )
}
