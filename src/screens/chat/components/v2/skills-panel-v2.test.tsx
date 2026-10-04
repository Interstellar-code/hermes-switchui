// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SkillsPanelV2,
  distinctSkillCount,
  groupSkills,
} from './skills-panel-v2'
import type React from 'react'
import type { FlatToolEntry } from './tool-entries'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))

afterEach(cleanup)

let n = 0
const e = (
  name: string,
  input?: Record<string, unknown>,
  extra: Partial<FlatToolEntry> = {},
): FlatToolEntry => ({
  key: `k${n++}`,
  isCall: true,
  name,
  callId: `c${n}`,
  input,
  timestamp: Date.now() - 1000 * n,
  ...extra,
})

describe('SkillsPanelV2', () => {
  it('badges come from all calls, count is distinct', () => {
    const entries = [
      e('skill_view', { name: 'a' }),
      e('skill_manage', { action: 'patch', name: 'a' }),
      e('skill_view', { name: 'b' }),
    ]
    const a = groupSkills(entries).groups.find((g) => g.name === 'a')!
    expect(a.loaded && a.edited && !a.deleted).toBe(true)
    expect(a.count).toBe(2)
    expect(distinctSkillCount(entries)).toBe(2)
    render(<SkillsPanelV2 entries={entries} />)
    expect(screen.getAllByText('EDITED')).toHaveLength(1)
  })

  it('collapses skills_list into a footnote, not a row', () => {
    const entries = [
      e('skills_list'),
      e('skills_list'),
      e('skill_view', { name: 'a' }),
    ]
    expect(distinctSkillCount(entries)).toBe(1)
    render(<SkillsPanelV2 entries={entries} />)
    expect(screen.getByText('Catalog listed 2×')).toBeTruthy()
  })

  it('sorts errors first and expands with first error line', () => {
    const entries = [
      e('skill_view', { name: 'new' }, { timestamp: 9e12 }),
      e(
        'skill_view',
        { name: 'bad' },
        { isError: true, output: 'boom\nstack', timestamp: 1 },
      ),
    ]
    expect(groupSkills(entries).groups.map((g) => g.name)).toEqual([
      'bad',
      'new',
    ])
    render(<SkillsPanelV2 entries={entries} />)
    const btn = screen.getAllByRole('button')[0]
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('boom')).toBeTruthy()
  })

  it('shows search only above 8 skills and filters', () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      e('skill_view', { name: `s${i}` }),
    )
    const { unmount } = render(<SkillsPanelV2 entries={many.slice(0, 8)} />)
    expect(screen.queryByLabelText('Search skills')).toBeNull()
    unmount()
    render(<SkillsPanelV2 entries={many} />)
    fireEvent.change(screen.getByLabelText('Search skills'), {
      target: { value: 's3' },
    })
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('empty state, skills link, and no fetch', () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    render(<SkillsPanelV2 entries={[]} />)
    expect(screen.getByText('No skills used in this session')).toBeTruthy()
    expect(screen.getByText('Open Skills page →').getAttribute('href')).toBe(
      '/skills',
    )
    expect(f).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('shows times from displayTs only; synthetic timestamps only order', () => {
    const entries = [
      e('skill_view', { name: 'a' }, { timestamp: 5 }),
      e('skill_view', { name: 'b' }, { timestamp: 9, displayTs: Date.now() }),
    ]
    const groups = groupSkills(entries).groups
    expect(groups.map((g) => g.name)).toEqual(['b', 'a'])
    expect(groups[1].lastTs).toBeUndefined()
    render(<SkillsPanelV2 entries={entries} />)
    expect(screen.getAllByText('just now')).toHaveLength(1)
    expect(screen.queryByText(/d ago/)).toBeNull()
  })

  it('reads wrapped args and merges names case-insensitively', () => {
    const entries = [
      e('skill_view', { value: JSON.stringify({ name: 'Foo' }) }),
      e('skill_view', { name: 'foo' }),
    ]
    expect(groupSkills(entries).groups.map((g) => [g.name, g.count])).toEqual([
      ['foo', 2],
    ])
  })
})
