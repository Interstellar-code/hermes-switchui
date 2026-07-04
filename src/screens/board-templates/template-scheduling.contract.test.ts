import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('board template scheduling surfaces', () => {
  it('use the shared schedule summary helper in both grid and list views', () => {
    const cardSource = readFileSync(new URL('./components/template-card.tsx', import.meta.url), 'utf8')
    const screenSource = readFileSync(new URL('./board-templates-screen.tsx', import.meta.url), 'utf8')

    expect(cardSource).toContain('summarizeTemplateSchedule')
    expect(screenSource).toContain('summarizeTemplateSchedule')
    expect(screenSource).toContain('<th>Schedule</th>')
  })
})
