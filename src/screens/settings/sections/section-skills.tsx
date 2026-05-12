/**
 * section-skills.tsx — Skills settings (P4).
 *
 * Config rows go through the settings store / saver.
 * Installed skills table uses react-query; toggle calls toggleSkill() directly
 * with toast feedback + query invalidation.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { SettingCard } from '../components/setting-card'
import { SettingRow } from '../components/setting-row'
import { Toggle, NumberSlider } from '../components/controls'
import { useSettingsStore } from '@/stores/settings-store'
import { listSkills, toggleSkill } from '@/server/hermes-api'
import { toast } from '@/components/ui/toast'

type SkillEntry = {
  name: string
  description?: string
  enabled?: boolean
  [key: string]: unknown
}

export default function SectionSkills() {
  const { draft, set } = useSettingsStore()
  const queryClient = useQueryClient()

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

  const { data: skillsRaw, isLoading } = useQuery({
    queryKey: ['skills-list'],
    queryFn: listSkills,
    staleTime: 30_000,
  })

  const skills = (Array.isArray(skillsRaw) ? skillsRaw : []) as Array<SkillEntry>

  async function handleToggleSkill(name: string, currentEnabled: boolean) {
    try {
      await toggleSkill(name, !currentEnabled)
      toast(`Skill "${name}" ${!currentEnabled ? 'enabled' : 'disabled'}`, { type: 'success' })
      await queryClient.invalidateQueries({ queryKey: ['skills-list'] })
    } catch {
      toast(`Failed to toggle skill "${name}"`, { type: 'error' })
    }
  }

  return (
    <div>
      <div className="section-head">
        <div>
          <h2>Skills</h2>
          <div className="desc">Skill loading, hooks, and permission settings.</div>
        </div>
        <div className="meta">Section · <b>skills</b></div>
      </div>

      <SettingCard title="Skill sources">
        <SettingRow label="Built-in skills" pill={{ t: 'read-only' }} desc="Hardcoded skill directory">
          <input
            type="text"
            className="text-input"
            value="~/.hermes/skills"
            readOnly
            disabled
          />
        </SettingRow>
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

      <SettingCard title="Installed skills">
        {isLoading ? (
          <div style={{ padding: '16px', color: 'var(--m-text-faint)', font: '12px var(--m-font-mono)' }}>
            Loading…
          </div>
        ) : skills.length === 0 ? (
          <div style={{ padding: '16px', color: 'var(--m-text-faint)', font: '12px var(--m-font-mono)' }}>
            No skills found.
          </div>
        ) : (
          <div className="mini-table-wrap">
            <table className="mini-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Description</th>
                  <th>Enabled</th>
                </tr>
              </thead>
              <tbody>
                {skills.map((skill) => (
                  <tr key={skill.name}>
                    <td style={{ font: '12px var(--m-font-mono)' }}>{skill.name}</td>
                    <td style={{ color: 'var(--m-text-faint)' }}>{skill.description ?? '—'}</td>
                    <td>
                      <Toggle
                        on={skill.enabled ?? false}
                        set={() => void handleToggleSkill(skill.name, skill.enabled ?? false)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SettingCard>
    </div>
  )
}
