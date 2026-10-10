import { describe, expect, it, vi } from 'vitest'
import { getKeyMeta, getPresets, listKeyMeta } from './key-meta'

vi.mock('../data/key-meta.json', () => ({
  default: [
    { id: 'agent.max_turns', label: 'Max turns' },
    { id: 'terminal.backend', label: 'Backend' },
    { id: 'logging.level', label: 'Log level' },
  ],
}))
vi.mock('../data/presets.json', () => ({
  default: [{ id: 'safe', label: 'Safe', values: { 'agent.max_turns': 10 } }],
}))

describe('key-meta loader', () => {
  it('finds by bare id and by draft key', () => {
    expect(getKeyMeta('agent.max_turns')?.label).toBe('Max turns')
    expect(getKeyMeta('config.agent.max_turns')).toBe(
      getKeyMeta('agent.max_turns'),
    )
  })

  it('returns undefined for unknown keys', () => {
    expect(getKeyMeta('nope.nothing')).toBeUndefined()
    expect(getKeyMeta('config.nope.nothing')).toBeUndefined()
  })

  it('lists all entries and presets', () => {
    expect(listKeyMeta()).toHaveLength(3)
    expect(getPresets().map((p) => p.id)).toEqual(['safe'])
  })
})
