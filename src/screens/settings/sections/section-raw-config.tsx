/**
 * section-raw-config.tsx — Raw YAML config editor (P7).
 *
 * Mirrors Hermes dashboard /config page. Allows direct editing of ~/.hermes/config.yaml
 * with upload/download capabilities.
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getConfigRaw, putConfigRaw } from '@/lib/hermes-client'
import { SettingCard } from '../components/setting-card'
import { toast } from '@/components/ui/toast'

export default function SectionRawConfig() {
  const [yamlText, setYamlText] = useState<string>('')
  const [isDirty, setIsDirty] = useState(false)
  const fileInputRef = useState<HTMLInputElement | null>(null)[1]

  const { data: configData, isLoading, refetch } = useQuery({
    queryKey: ['config', 'raw'],
    queryFn: getConfigRaw,
    staleTime: 60_000,
  })

  // Seed textarea on mount or when config data changes
  if (configData && !isDirty && yamlText !== configData.yaml) {
    setYamlText(configData.yaml)
  }

  async function handleSave() {
    try {
      await putConfigRaw(yamlText)
      setIsDirty(false)
      toast('Config saved successfully')
      void refetch()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      toast(`Failed to save config: ${message}`)
    }
  }

  function handleDiscard() {
    if (configData) {
      setYamlText(configData.yaml)
      setIsDirty(false)
      toast('Changes discarded')
    }
  }

  function handleDownload() {
    const blob = new Blob([yamlText], { type: 'text/yaml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'config.yaml'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast('Config downloaded')
  }

  function handleUploadClick() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.yaml,.yml'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (file) {
        try {
          const text = await file.text()
          setYamlText(text)
          setIsDirty(true)
          toast('Config file loaded')
        } catch (err) {
          toast('Failed to read file')
        }
      }
    }
    input.click()
  }

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Raw config</h2>
          <div className="desc">Direct editing of ~/.hermes/config.yaml</div>
        </div>
        <div className="meta">Section · <b>raw-config</b></div>
      </div>

      <SettingCard title="Config file path">
        <div style={{ padding: '12px', font: '500 12px var(--m-font-mono)', color: 'var(--m-text-faint)' }}>
          ~/.hermes/config.yaml
        </div>
      </SettingCard>

      <SettingCard title="Warning">
        <div style={{ padding: '12px', fontSize: 13, color: 'var(--m-text-warn)', lineHeight: 1.5 }}>
          Direct YAML edits bypass form validation — corruption can break the gateway. Use the FORM sections for safer edits.
        </div>
      </SettingCard>

      <SettingCard title="Editor">
        <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <textarea
            className="text-input"
            rows={30}
            value={yamlText}
            onChange={(e) => {
              setYamlText(e.target.value)
              setIsDirty(true)
            }}
            disabled={isLoading}
            style={{
              minHeight: '60vh',
              fontFamily: 'var(--m-font-mono)',
              fontSize: 12,
              lineHeight: 1.5,
              padding: '12px',
              border: '1px solid var(--m-border)',
              borderRadius: '4px',
            }}
            placeholder="Loading config..."
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn"
              onClick={() => { void handleSave() }}
              disabled={!isDirty || isLoading}
              style={{ opacity: !isDirty || isLoading ? 0.5 : 1, cursor: !isDirty || isLoading ? 'not-allowed' : 'pointer' }}
            >
              Save
            </button>
            <button
              type="button"
              className="btn"
              onClick={handleDiscard}
              disabled={!isDirty || isLoading}
              style={{ opacity: !isDirty || isLoading ? 0.5 : 1, cursor: !isDirty || isLoading ? 'not-allowed' : 'pointer' }}
            >
              Discard
            </button>
            <button
              type="button"
              className="btn"
              onClick={handleDownload}
              disabled={isLoading}
              style={{ opacity: isLoading ? 0.5 : 1, cursor: isLoading ? 'not-allowed' : 'pointer' }}
            >
              Download
            </button>
            <button
              type="button"
              className="btn"
              onClick={handleUploadClick}
              disabled={isLoading}
              style={{ opacity: isLoading ? 0.5 : 1, cursor: isLoading ? 'not-allowed' : 'pointer' }}
            >
              Upload
            </button>
          </div>
        </div>
      </SettingCard>
    </div>
  )
}
