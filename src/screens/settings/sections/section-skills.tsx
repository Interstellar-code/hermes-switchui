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

  const autoload = (draft['config.skills.autoload'] as boolean | undefined) ?? true
  const skillsRoot = (draft['config.skills.root'] as string | undefined) ?? ''
  const hooksEnabled = (draft['config.skills.hooks_enabled'] as boolean | undefined) ?? true
  const permissionPrompt = (draft['config.skills.permission_prompt'] as boolean | undefined) ?? true
  const permissionTimeout = (draft['config.skills.permission_timeout_s'] as number | undefined) ?? 30

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

      <SettingCard title="Loading">
        <SettingRow label="Auto-load skills" desc="Automatically load all skills on agent startup">
          <label className="toggle">
            <input
              type="checkbox"
              checked={autoload}
              onChange={(e) => set('config.skills.autoload', e.target.checked)}
            />
            <span className="slider" />
          </label>
        </SettingRow>
        <SettingRow label="Skills root" desc="Directory to scan for skill definitions">
          <input
            type="text"
            className="text-input"
            value={skillsRoot}
            placeholder="e.g. ~/.hermes/skills"
            onChange={(e) => set('config.skills.root', e.target.value)}
          />
        </SettingRow>
      </SettingCard>

      <SettingCard title="Hooks & permissions">
        <SettingRow label="Hooks enabled" desc="Run skill lifecycle hooks (before/after execution)">
          <label className="toggle">
            <input
              type="checkbox"
              checked={hooksEnabled}
              onChange={(e) => set('config.skills.hooks_enabled', e.target.checked)}
            />
            <span className="slider" />
          </label>
        </SettingRow>
        <SettingRow label="Permission prompt" pill={{ t: 'security' }} desc="Prompt user before executing skills with elevated permissions">
          <label className="toggle">
            <input
              type="checkbox"
              checked={permissionPrompt}
              onChange={(e) => set('config.skills.permission_prompt', e.target.checked)}
            />
            <span className="slider" />
          </label>
        </SettingRow>
        <SettingRow label="Permission timeout" desc={`${permissionTimeout}s — seconds before prompt auto-dismisses`}>
          <input
            type="range"
            min={5}
            max={300}
            step={5}
            value={permissionTimeout}
            onChange={(e) => set('config.skills.permission_timeout_s', parseInt(e.target.value, 10))}
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
                      <label className="toggle">
                        <input
                          type="checkbox"
                          checked={skill.enabled ?? false}
                          onChange={() => void handleToggleSkill(skill.name, skill.enabled ?? false)}
                        />
                        <span className="slider" />
                      </label>
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
