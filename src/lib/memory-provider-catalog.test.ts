import { describe, expect, it } from 'vitest'
import {
  getMemoryProviderInfo,
  MEMORY_PROVIDER_IDS,
  MEMORY_PROVIDER_SELECT_OPTIONS_WITH_DISABLED,
} from './memory-provider-catalog'

describe('memory-provider-catalog', () => {
  it('keeps the runtime memory provider ids in one shared list', () => {
    expect(MEMORY_PROVIDER_IDS).toEqual([
      'hindsight',
      'mem0',
      'openviking',
      'holographic',
      'retaindb',
      'byterover',
    ])
  })

  it('offers the shared settings select list with only disabled plus runtime providers', () => {
    expect(MEMORY_PROVIDER_SELECT_OPTIONS_WITH_DISABLED.map((option) => option.value)).toEqual([
      '',
      'hindsight',
      'mem0',
      'openviking',
      'holographic',
      'retaindb',
      'byterover',
    ])
  })

  it('does not resolve stale provider ids', () => {
    expect(getMemoryProviderInfo('honcho')).toBeNull()
    expect(getMemoryProviderInfo('builtin')).toBeNull()
  })
})
