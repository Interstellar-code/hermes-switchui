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

  it('never lets an onSubmit rejection escape as an unhandled promise', () => {
    // `handleSubmit` is wired to onClick/onKeyDown, which discard the promise
    // it returns. Anything thrown past this catch reaches the user as a red
    // console trace plus a message that silently never sent — which is exactly
    // how a refused profile send used to surface.
    const src = source()
    const handleSubmit = src.slice(
      src.indexOf('const handleSubmit = React.useCallback(async () => {'),
      src.indexOf('const handleQueueSubmit'),
    )
    expect(handleSubmit).toContain('} catch (err) {')
    expect(handleSubmit).toContain('showErrorToast(')
    expect(src).toContain("import { showErrorToast } from '@/components/error-toast'")
  })

  it('does not clobber content that onSubmit put back after a refusal', () => {
    // A refused send restores the user's message through `helpers`; clearing
    // unconditionally one tick later would throw it away again.
    const src = source()
    expect(src).toContain("setValue((prev) => (prev === value ? '' : prev))")
    expect(src).toContain(
      'setAttachments((prev) => (prev === attachments ? [] : prev))',
    )
  })
})
