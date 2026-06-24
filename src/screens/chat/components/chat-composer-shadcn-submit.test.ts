import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = () =>
  readFileSync(
    resolve(
      process.cwd(),
      'src/screens/chat/components/chat-composer-shadcn.tsx',
    ),
    'utf8',
  )

describe('ChatComposerShadcn submit contract', () => {
  it('awaits async onSubmit handlers before clearing composer state', () => {
    const src = source()

    expect(src).toContain('const handleSubmit = React.useCallback(async () => {')
    expect(src).toContain('await Promise.resolve(')
    expect(src).toContain(
      'onSubmit(body, attachmentPayload, effectiveFastMode, helpers)',
    )
    expect(src).toContain("setValue('')")
    expect(src).toContain('focusPrompt()')
  })
})
