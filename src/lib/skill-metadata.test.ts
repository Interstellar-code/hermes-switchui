import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  EMPTY_SKILL_METADATA_INDEX,
  buildSkillMetadataIndex,
  fetchSkillMetadataIndex,
  skillSlug,
} from './skill-metadata'

describe('skillSlug', () => {
  it('lowercases, drops the leading slash, and dashes spaces and underscores', () => {
    expect(skillSlug('/GIF Search')).toBe('gif-search')
    expect(skillSlug('gif_search')).toBe('gif-search')
    expect(skillSlug('  Gif-Search  ')).toBe('gif-search')
  })

  it('strips every remaining non-alphanumeric but keeps the dashes it made', () => {
    expect(skillSlug('/claude.code!')).toBe('claudecode')
    expect(skillSlug('c++ helper')).toBe('c-helper')
  })

  it('is idempotent, so a slug can be re-slugged safely', () => {
    const once = skillSlug('/Hermes Switch_UI Ops')
    expect(skillSlug(once)).toBe(once)
    expect(once).toBe('hermes-switch-ui-ops')
  })
})

describe('buildSkillMetadataIndex', () => {
  const rows = [
    {
      id: 'gif-search',
      slug: 'gif-search',
      name: 'GIF Search',
      category: 'Image & Video',
      provenance: 'bundled',
      usage: 3,
      origin: 'builtin',
    },
    {
      id: 'hermes-switchui-ops',
      slug: 'hermes-switchui-ops',
      name: 'hermes-switchui-ops',
      category: 'AI & LLMs',
      provenance: 'agent',
      usage: 54,
      origin: 'agent-created',
    },
  ]

  it('joins on every spelling a row offers', () => {
    const index = buildSkillMetadataIndex({ skills: rows })
    expect(index.get('gif-search')?.category).toBe('Image & Video')
    // `name` is the spelling the agent registers the command under, and it is
    // the one that differs from `id` — that is the join the picker depends on.
    expect(index.get(skillSlug('GIF Search'))?.category).toBe('Image & Video')
  })

  it('accepts a bare array as well as the route envelope', () => {
    expect(buildSkillMetadataIndex(rows).get('gif-search')?.category).toBe(
      'Image & Video',
    )
  })

  it('reads provenance and the invocation counter', () => {
    const index = buildSkillMetadataIndex({ skills: rows })
    expect(index.get('hermes-switchui-ops')).toMatchObject({
      provenance: 'agent',
      invocations: 54,
    })
    expect(index.get('gif-search')).toMatchObject({
      provenance: 'bundled',
      invocations: 3,
    })
  })

  it("falls back to SwitchUI's derived origin when the row carries no provenance", () => {
    const index = buildSkillMetadataIndex({
      skills: [
        { id: 'a', name: 'a', category: 'X', origin: 'agent-created' },
        { id: 'b', name: 'b', category: 'X', origin: 'marketplace' },
      ],
    })
    expect(index.get('a')?.provenance).toBe('agent')
    expect(index.get('b')?.provenance).toBe('unknown')
  })

  it('skips rows with no category — there is nothing to group them by', () => {
    const index = buildSkillMetadataIndex({
      skills: [{ id: 'a', name: 'a', category: '   ' }],
    })
    expect(index.size).toBe(0)
  })

  it('is total: any shape it does not recognize is an empty index', () => {
    expect(buildSkillMetadataIndex(null).size).toBe(0)
    expect(buildSkillMetadataIndex({ error: 'nope' }).size).toBe(0)
    expect(buildSkillMetadataIndex({ skills: [null, 7, 'x'] }).size).toBe(0)
  })

  it('is order-independent: the first row to claim a key keeps it', () => {
    const collide = [
      { id: 'dup', name: 'dup', category: 'First' },
      { id: 'dup', name: 'dup', category: 'Second' },
    ]
    expect(buildSkillMetadataIndex(collide).get('dup')?.category).toBe('First')
  })
})

describe('fetchSkillMetadataIndex', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('asks for the summary projection, not the SKILL.md bodies', async () => {
    const urls: Array<string> = []
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        urls.push(String(input))
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ skills: [] }),
        } as unknown as Response)
      }),
    )

    await fetchSkillMetadataIndex()
    // Without it this is a 1 MB payload of SKILL.md bodies the picker never
    // reads.
    expect(urls[0]).toContain('fields=summary')
  })

  it('answers an empty index on a degraded response instead of throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 503,
          json: () => Promise.resolve({}),
        } as unknown as Response),
      ),
    )
    await expect(fetchSkillMetadataIndex()).resolves.toBe(
      EMPTY_SKILL_METADATA_INDEX,
    )
  })

  it('answers an empty index when the request itself fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    )
    await expect(fetchSkillMetadataIndex()).resolves.toBe(
      EMPTY_SKILL_METADATA_INDEX,
    )
  })
})
