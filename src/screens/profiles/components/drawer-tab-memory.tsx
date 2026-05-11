import { useState } from 'react'
import type { MemoryConfig, MemoryProvider } from '@/server/profiles-browser'

type Props = {
  memoryEnabled: boolean
  memoryProvider: MemoryProvider
  readonly: boolean
  onSave: (patch: { memory: MemoryConfig }) => Promise<void>
}

const PROVIDERS: Array<{ id: MemoryProvider; label: string; desc: string }> = [
  { id: 'hindsight', label: 'Hindsight', desc: 'Lightweight local memory. Stores key facts and decisions from conversations.' },
  { id: 'mem0', label: 'Mem0', desc: 'Cloud-hosted memory graph. Requires Mem0 API key in .env.' },
  { id: 'openviking', label: 'OpenViking', desc: 'Open-source memory layer with vector search support.' },
  { id: 'holographic', label: 'Holographic', desc: 'Experimental multi-dimensional memory with retrieval scoring.' },
  { id: 'retaindb', label: 'RetainDB', desc: 'Database-backed persistent memory. Survives agent restarts.' },
  { id: 'byterover', label: 'ByteRover', desc: 'Edge-cached memory provider. Low-latency retrieval.' },
]

export function DrawerTabMemory({ memoryEnabled, memoryProvider, readonly, onSave }: Props) {
  const [enabled, setEnabled] = useState(memoryEnabled)
  const [provider, setProvider] = useState<MemoryProvider>(memoryProvider)
  const [busy, setBusy] = useState(false)

  const dirty = enabled !== memoryEnabled || provider !== memoryProvider

  async function handleSave() {
    setBusy(true)
    try {
      await onSave({ memory: { memory_enabled: enabled, provider } })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <p className="pf-drawer-section-title">Memory</p>

      {/* Toggle */}
      <div className="wiz-toggle-row" style={{ marginBottom: 22 }}>
        <button
          type="button"
          className={`wiz-toggle${enabled ? ' on' : ''}`}
          onClick={() => !readonly && setEnabled(!enabled)}
          role="switch"
          aria-checked={enabled}
          style={{ cursor: readonly ? 'not-allowed' : 'pointer', opacity: readonly ? .6 : 1 }}
        >
          <span className="wiz-toggle-thumb" />
        </button>
        <div>
          <div style={{ fontWeight: 600, fontSize: 13, fontFamily: 'var(--m-font-mono,ui-monospace,monospace)', color: 'var(--m-text-strong,var(--theme-text))' }}>
            {enabled ? 'Memory enabled' : 'Memory disabled'}
          </div>
          <div className="wiz-hint" style={{ marginTop: 2 }}>
            {enabled
              ? 'Agent persists facts and context across sessions.'
              : 'Each session starts fresh with no memory of previous conversations.'}
          </div>
        </div>
      </div>

      {/* Provider */}
      {enabled && (
        <div className="field" style={{ marginBottom: 20 }}>
          <label style={{ fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--m-text-faint,var(--theme-muted))', display: 'block', marginBottom: 8 }}>
            Provider
          </label>
          <div className="memory-providers">
            {PROVIDERS.map((p) => (
              <div
                key={p.id}
                className={`skill${provider === p.id ? ' on' : ''}`}
                style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4, padding: '10px 12px', cursor: readonly ? 'not-allowed' : 'pointer', opacity: readonly ? .6 : 1 }}
                onClick={() => !readonly && setProvider(p.id)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                  <div className="chk" />
                  <span style={{ fontWeight: 600, fontSize: 12 }}>{p.label}</span>
                </div>
                <div style={{ fontSize: 10, opacity: .65, lineHeight: 1.5, paddingLeft: 22 }}>{p.desc}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!readonly && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="pf-drawer-btn-save" onClick={() => void handleSave()} disabled={!dirty || busy}>
            {busy ? 'Saving…' : 'Save Changes'}
          </button>
          {dirty && (
            <button type="button" className="pf-drawer-btn-cancel" onClick={() => { setEnabled(memoryEnabled); setProvider(memoryProvider) }}>
              Reset
            </button>
          )}
        </div>
      )}
    </div>
  )
}
