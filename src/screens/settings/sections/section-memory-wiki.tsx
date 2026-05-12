/**
 * section-memory-wiki.tsx — Memory & Wiki settings (P4).
 *
 * All rows go through the settings store / saver (dotted-path config patch).
 * Keys prefixed `config.memory.*` are expanded by saver.ts into nested patch objects.
 */

import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'
import { useSettingsStore } from '@/stores/settings-store'

export default function SectionMemoryWiki() {
  const { draft, set } = useSettingsStore()

  const memoryEnabled = (draft['config.memory.enabled'] as boolean | undefined) ?? true
  const defaultScope = (draft['config.memory.default_scope'] as string | undefined) ?? 'session'
  const autoSummarize = (draft['config.memory.auto_summarize'] as boolean | undefined) ?? false
  const topK = (draft['config.memory.top_k'] as number | undefined) ?? 5
  const citations = (draft['config.memory.citations'] as boolean | undefined) ?? false
  const wikiRoot = (draft['config.memory.wiki_root'] as string | undefined) ?? ''
  const gitSync = (draft['config.memory.git_sync'] as boolean | undefined) ?? false

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Memory &amp; Wiki</h2>
          <div className="desc">Memory retrieval, wiki integration, and git sync settings.</div>
        </div>
        <div className="meta">Section · <b>memory-wiki</b></div>
      </div>

      <SettingCard title="Memory">
        <SettingRow label="Memory enabled" desc="Enable long-term memory retrieval for sessions">
          <label className="toggle">
            <input
              type="checkbox"
              checked={memoryEnabled}
              onChange={(e) => set('config.memory.enabled', e.target.checked)}
            />
            <span className="slider" />
          </label>
        </SettingRow>
        <SettingRow label="Default scope" desc="Scope used when storing new memory entries">
          <select
            className="select-input"
            value={defaultScope}
            onChange={(e) => set('config.memory.default_scope', e.target.value)}
          >
            <option value="session">Session</option>
            <option value="project">Project</option>
            <option value="global">Global</option>
          </select>
        </SettingRow>
        <SettingRow label="Auto-summarize new pages" desc="Automatically generate a summary when a new wiki page is created">
          <label className="toggle">
            <input
              type="checkbox"
              checked={autoSummarize}
              onChange={(e) => set('config.memory.auto_summarize', e.target.checked)}
            />
            <span className="slider" />
          </label>
        </SettingRow>
        <SettingRow label="Top-K retrieval" desc={`${topK} — number of memory entries retrieved per query`}>
          <input
            type="range"
            min={1}
            max={20}
            step={1}
            value={topK}
            onChange={(e) => set('config.memory.top_k', parseInt(e.target.value, 10))}
          />
        </SettingRow>
        <SettingRow label="Citations always on" desc="Always include source citations in memory-augmented responses">
          <label className="toggle">
            <input
              type="checkbox"
              checked={citations}
              onChange={(e) => set('config.memory.citations', e.target.checked)}
            />
            <span className="slider" />
          </label>
        </SettingRow>
      </SettingCard>

      <SettingCard title="Wiki">
        <SettingRow label="Wiki root" desc="Root directory for wiki pages (relative to project)">
          <input
            type="text"
            className="text-input"
            value={wikiRoot}
            placeholder="e.g. docs/wiki"
            onChange={(e) => set('config.memory.wiki_root', e.target.value)}
          />
        </SettingRow>
        <SettingRow label="Sync to git" pill={{ t: 'recommended' }} desc="Commit wiki changes to git automatically">
          <label className="toggle">
            <input
              type="checkbox"
              checked={gitSync}
              onChange={(e) => set('config.memory.git_sync', e.target.checked)}
            />
            <span className="slider" />
          </label>
        </SettingRow>
      </SettingCard>
    </div>
  )
}
