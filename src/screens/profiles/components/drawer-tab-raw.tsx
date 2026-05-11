import { useState } from 'react'
import type { ProfileConfig } from '@/server/profiles-browser'
import YAML from 'yaml'

type Props = {
  config: ProfileConfig
  configPath: string
}

export function DrawerTabRaw({ config, configPath }: Props) {
  const [copied, setCopied] = useState(false)

  const yamlText = YAML.stringify(config, { lineWidth: 100 })

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(yamlText)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // fallback
    }
  }

  function handleOpenInEditor() {
    // Show the path in a toast-like way — user can open in their own editor
    alert(`Config path:\n${configPath}`)
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <p className="pf-drawer-section-title" style={{ margin: 0 }}>Raw Config (read-only)</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="pf-drawer-action-btn" onClick={() => void handleCopy()}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button type="button" className="pf-drawer-action-btn" onClick={handleOpenInEditor}>
            Show path
          </button>
        </div>
      </div>
      <div style={{ fontFamily: 'monospace', fontSize: 10, opacity: .45, marginBottom: 8, wordBreak: 'break-all' }}>
        {configPath}
      </div>
      <pre className="pf-drawer-yaml">{yamlText}</pre>
    </div>
  )
}
