import { describe, expect, it, vi } from 'vitest'
import { invalidateProjectQueries, projectsKeys } from './projects-api'

describe('Projects mutations', () => {
  it('invalidates all Projects queries after a successful write', () => {
    const invalidateQueries = vi.fn()
    invalidateProjectQueries({ invalidateQueries } as never)
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: projectsKeys.all,
    })
  })
})
