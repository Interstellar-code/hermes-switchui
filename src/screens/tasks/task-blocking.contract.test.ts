import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('task blocking surfaces', () => {
  it('share the structured block helper across create, move, and detail flows', () => {
    const dialogSource = readFileSync(new URL('./task-dialog.tsx', import.meta.url), 'utf8')
    const screenSource = readFileSync(new URL('./tasks-screen.tsx', import.meta.url), 'utf8')
    const detailSource = readFileSync(new URL('./task-detail-drawer.tsx', import.meta.url), 'utf8')

    expect(dialogSource).toContain('formatKanbanBlockReason')
    expect(screenSource).toContain('formatKanbanBlockReason')
    expect(detailSource).toContain('parseKanbanBlockReason')
    expect(detailSource).toContain('formatKanbanBlockReason')
  })
})
