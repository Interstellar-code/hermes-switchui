/**
 * section-skills.tsx — Skills settings summary + config.
 *
 * Summary card: enabled count, source paths, top categories.
 * Full skill management is at /skills.
 * Config rows: external dirs, template vars, inline shell, timeout.
 */

import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'
import { Toggle, NumberSlider } from '../components/controls'
import { useSettingsStore } from '@/stores/settings-store'
import { listSkills } from '@/server/hermes-api'

type SkillEntry = {
  name: string
  description?: string
  enabled?: boolean
  category?: string
  [key: string]: unknown
}

export default function SectionSkills() {
  const { draft, set } = useSettingsStore()
  const navigate = useNavigate()

  // Skill sources
  const externalDirs = (draft['config.skills.external_dirs'] as string[] | string | undefined) ?? []
  const templateVars = (draft['config.skills.template_vars'] as boolean | undefined) ?? true

  // Inline shell
  const inlineShell = (draft['config.skills.inline_shell'] as boolean | undefined) ?? false
  const inlineShellTimeout = (draft['config.skills.inline_shell_timeout'] as number | undefined) ?? 10

  // Convert external_dirs for textarea: Array → newline-joined string
  const externalDirsText = Array.isArray(externalDirs) ? externalDirs.join('\n') : (externalDirs || '')

  // Handle textarea changes: split by newline, filter empty/trimmed
  function setExternalDirs(text: string) {
    const dirs = text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
    set('config.skills.external_dirs', dirs)
  }

  const { data: skillsRaw, isLoading, isError } = useQuery({
    queryKey: ['skills-list'],
    queryFn: listSkills,
    staleTime: 30_000,
    retry: 1,
  })

  const skills = (Array.isArray(skillsRaw) ? skillsRaw : []) as Array<SkillEntry>
  const notDetected = isError || (!isLoading && skills.length === 0)
  const enabledCount = skills.filter(s => s.enabled).length
  const totalCount = skills.length

  // External dirs summary
  const externalDirsArr = Array.isArray(externalDirs) ? externalDirs : externalDirs ? [externalDirs] : []
  const extSummary = externalDirsArr.length > 0
    ? `${externalDirsArr.length} ${externalDirsArr.length === 1 ? 'dir' : 'dirs'} · ${externalDirsArr[0]}`
    : 'None configured'

  // Top categories (up to 5)
  const categoryMap: Record<string, number> = {}
  for (const skill of skills) {
    const cat = skill.category ?? 'Uncategorized'
    categoryMap[cat] = (categoryMap[cat] ?? 0) + 1
  }
  const topCategories = Object.entries(categoryMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Skills</h2>
          <div className="desc">Skill loading, hooks, and permission settings.</div>
        </div>
        <div className="meta">Section · <b>skills</b></div>
      </div>

      <SettingCard title="Status">
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '14px', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--m-text)' }}>
                ⭐ Skills
              </span>
              {isLoading ? (
                <span style={{ fontSize: '11px', color: 'var(--m-text-faint)', fontFamily: 'var(--m-font-mono)' }}>loading…</span>
              ) : notDetected ? (
                <span style={{ fontSize: '11px', fontFamily: 'var(--m-font-mono)', color: 'var(--m-danger, #e05)' }}>⚠ Not detected</span>
              ) : (
                <span style={{ fontSize: '11px', fontFamily: 'var(--m-font-mono)', color: 'var(--m-accent)' }}>
                  ✓ {enabledCount}/{totalCount} enabled
                </span>
              )}
            </div>
            <button
              className="btn"
              style={{ fontSize: '11px', padding: '4px 10px' }}
              onClick={() => void navigate({ to: '/skills' })}
            >
              Open Manager →
            </button>
          </div>

          <div className="kv" style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', fontFamily: 'var(--m-font-mono)', color: 'var(--m-text-faint)' }}>
            <div>
              <span style={{ color: 'var(--m-text-dim, var(--m-text-faint))' }}>Built-in · </span>
              <span>~/.hermes/skills</span>
            </div>
            <div>
              <span style={{ color: 'var(--m-text-dim, var(--m-text-faint))' }}>External · </span>
              <span>{extSummary}</span>
            </div>
          </div>

          {topCategories.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '2px' }}>
              {topCategories.map(([cat, count]) => (
                <span
                  key={cat}
                  style={{
                    fontSize: '11px',
                    fontFamily: 'var(--m-font-mono)',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    background: 'var(--m-bg-alt, var(--m-surface))',
                    border: '1px solid var(--m-border)',
                    color: 'var(--m-text-faint)',
                  }}
                >
                  {cat} · {count}
                </span>
              ))}
            </div>
          )}
        </div>
      </SettingCard>

      <SettingCard title="Skill sources">
        <SettingRow label="External skill dirs" desc="One path per line (e.g. ~/.agents/skills, /shared/team-skills)">
          <textarea
            className="text-input"
            style={{ fontFamily: 'var(--m-font-mono)', minHeight: '120px', resize: 'vertical' }}
            value={externalDirsText}
            placeholder="~/.agents/skills&#10;/shared/team-skills"
            onChange={(e) => setExternalDirs(e.target.value)}
          />
        </SettingRow>
        <SettingRow label="Template variables" desc="Substitute ${HERMES_SKILL_DIR} and ${HERMES_SESSION_ID} in SKILL.md">
          <Toggle on={templateVars} set={(v) => set('config.skills.template_vars', v)} />
        </SettingRow>
      </SettingCard>

      <SettingCard title="Inline shell">
        <SettingRow label="Inline shell" pill={{ t: 'danger' }} desc="Pre-execute !`cmd` snippets in SKILL.md">
          <Toggle on={inlineShell} set={(v) => set('config.skills.inline_shell', v)} />
        </SettingRow>
        <SettingRow label="Inline shell timeout" desc="Maximum seconds per !`cmd` snippet">
          <NumberSlider
            min={1}
            max={60}
            step={1}
            value={inlineShellTimeout}
            onChange={(v) => set('config.skills.inline_shell_timeout', v)}
          />
        </SettingRow>
      </SettingCard>
    </div>
  )
}
