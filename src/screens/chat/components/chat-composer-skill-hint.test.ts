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

/**
 * The skill-argument affordance.
 *
 * Picking a skill inserts `"/skill "` and dismisses the menu — skills carry no
 * `subcommands`, so there is nothing left to complete — and the menu closes for
 * good at the second space. Every hint the picker showed therefore disappears
 * exactly when the user starts typing the argument, and a skill's argument is
 * not decoration: it is appended to the skill prompt as an explicit instruction.
 * The composer has to carry that explanation past the point where the menu let
 * go of it.
 *
 * The behaviour itself is covered in `components/slash-command-menu.test.tsx`
 * (`findSkillInvocation`, `skillArgumentNotice`); this pins the wiring, in the
 * source-contract style the composer's other tests use.
 */
describe('ChatComposerShadcn skill-argument affordance', () => {
  it('derives the hint from the composer text, not from what was picked', () => {
    const src = source()

    // Derived from `value`, so it holds for a hand-typed `/arxiv …` too and —
    // the point of it — survives the second space.
    expect(src).toContain('findSkillInvocation(value, slashCommands)')
    expect(src).toContain('const slashCommands = useSlashCommandDefinitions()')
  })

  it('renders the notice for as long as the text invokes a skill', () => {
    const src = source()

    expect(src).toContain('{skillInvocation && (')
    expect(src).toContain('skillArgumentNotice(skillInvocation.command)')
    expect(src).toContain('data-testid="skill-argument-hint"')
  })

  it('imports the affordance from the picker, so both surfaces say one thing', () => {
    const src = source()
    // `lastIndexOf`: the value import follows the type-only one.
    const end = src.lastIndexOf("} from '@/components/slash-command-menu'")
    const importBlock = src.slice(src.lastIndexOf('import {', end), end)
    expect(importBlock).toContain('findSkillInvocation')
    expect(importBlock).toContain('skillArgumentNotice')
  })
})
