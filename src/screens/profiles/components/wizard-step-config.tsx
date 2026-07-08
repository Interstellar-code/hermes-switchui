import { useState } from 'react'
import YAML from 'yaml'
import { configPreviewFromDraft, maskSecrets } from '../profile-config-map'
import type { NewAgentDraft } from '../types'
import type { ProfileConfig } from '@/server/profiles-browser'

type Props = {
  draft: NewAgentDraft
  errors: Array<string>
  onChange: (patch: Partial<NewAgentDraft>) => void
  config?: ProfileConfig
}

export function WizardStepConfig({ draft, errors, config }: Props) {
  const [copied, setCopied] = useState(false)

  const source = config ? maskSecrets(config) : maskSecrets(configPreviewFromDraft(draft))
  const yamlText = YAML.stringify(source, { lineWidth: 100 })

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
          Config (read-only — secrets masked)
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
      <pre className="pf-drawer-yaml">{yamlText}</pre>
    </div>
  )
}
