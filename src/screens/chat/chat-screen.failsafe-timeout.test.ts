import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('chat-screen send failsafe timeout', () => {
  it('matches the 600s backend timeout instead of the old 120s gap', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/screens/chat/chat-screen.tsx'),
      'utf8',
    )

    expect(src).toContain('}, 600_000)')
    expect(src).not.toContain('}, 120_000)')
  })
})
