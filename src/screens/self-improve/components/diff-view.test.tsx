// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SplitDiffView, parseSplitDiff } from './diff-view'

describe('split diff', () => {
  const diff = [
    '--- a/SOUL.md',
    '+++ b/SOUL.md',
    '@@ -1,2 +1,2 @@',
    '-Old rule',
    '+New rule',
    ' Shared',
  ].join('\n')

  it('aligns deletions and additions without inventing full file content', () => {
    expect(parseSplitDiff(diff)).toEqual([
      { before: '@@ -1,2 +1,2 @@', after: '@@ -1,2 +1,2 @@', kind: 'context' },
      { before: 'Old rule', after: 'New rule', kind: 'change' },
      { before: 'Shared', after: 'Shared', kind: 'context' },
    ])
  })

  it('labels the original and proposed columns', () => {
    render(<SplitDiffView diff={diff} />)
    expect(screen.getByText('Original')).toBeTruthy()
    expect(screen.getByText('Proposed')).toBeTruthy()
    expect(screen.getByText('Old rule')).toBeTruthy()
    expect(screen.getByText('New rule')).toBeTruthy()
    expect(screen.getAllByText('Shared')).toHaveLength(1)
  })
})
