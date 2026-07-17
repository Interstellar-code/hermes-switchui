// @vitest-environment jsdom

import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSharedTicker } from './use-shared-ticker'

describe('useSharedTicker', () => {
  afterEach(() => vi.restoreAllMocks())

  it('does not start an interval when disabled', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')

    renderHook(() => useSharedTicker(1000, false))

    expect(setIntervalSpy).not.toHaveBeenCalled()
  })
})
