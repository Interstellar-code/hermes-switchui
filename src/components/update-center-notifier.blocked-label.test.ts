import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('UpdateCenterNotifier blocked state label', () => {
  it('shows a non-interactive blocked label instead of a fake review-required button', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/components/update-center-notifier.tsx'),
      'utf8',
    )

    expect(src).toContain('Blocked')
    expect(src).not.toContain('Review required')
    expect(src).toContain('aria-label={`${product.label} update blocked`}')
  })
})
