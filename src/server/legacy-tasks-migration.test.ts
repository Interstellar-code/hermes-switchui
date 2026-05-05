import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./hermes-kanban-client', () => ({
  createKanbanTask: vi.fn(async (input) => ({
    task: { id: 'new-' + input.idempotency_key, ...input },
  })),
  updateKanbanTask: vi.fn(async (id, input) => ({
    task: { id, ...input },
  })),
}))

vi.mock('node:fs', () => {
  const tasks = [
    {
      id: 'legacy-1',
      title: 'Fix UI',
      description: 'Details about the fix',
      column: 'in_progress',
      priority: 'high',
      tags: ['frontend'],
      due_date: '2026-05-10',
    },
    {
      title: 'Research',
      description: '',
      column: 'backlog',
      priority: 'medium',
    },
    {
      title: 'Old done task',
      description: 'Already done',
      column: 'done',
      priority: 'low',
    },
    {
      title: 'Review task',
      description: 'Needs review',
      column: 'review',
      priority: 'medium',
    },
  ]
  return {
    default: {
      readFileSync: vi.fn(() => JSON.stringify({ tasks })),
      existsSync: vi.fn(() => false),
      copyFileSync: vi.fn(),
      writeFileSync: vi.fn(),
    },
    readFileSync: vi.fn(() => JSON.stringify({ tasks })),
    existsSync: vi.fn(() => false),
    copyFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  }
})

describe('legacy-tasks-migration', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('maps in_progress to running in preview', async () => {
    const { previewMigration } = await import('./legacy-tasks-migration')
    const preview = previewMigration()
    const highTask = preview.tasks.find((t) => t.title === 'Fix UI')
    expect(highTask?.target_status).toBe('running')
  })

  it('maps priorities correctly', async () => {
    const { mapLegacyPriorityToNumeric } = await import('../lib/hermes-kanban-types')
    expect(mapLegacyPriorityToNumeric('medium')).toBe(1)
    expect(mapLegacyPriorityToNumeric('low')).toBe(-1)
    expect(mapLegacyPriorityToNumeric('high')).toBe(3)
  })

  it('maps backlog to triage and done to done', async () => {
    const { previewMigration } = await import('./legacy-tasks-migration')
    const preview = previewMigration()
    expect(preview.tasks.find((t) => t.title === 'Research')?.target_status).toBe('triage')
    expect(preview.tasks.find((t) => t.title === 'Old done task')?.target_status).toBe('done')
  })

  it('maps review to triage', async () => {
    const { previewMigration } = await import('./legacy-tasks-migration')
    const preview = previewMigration()
    expect(preview.tasks.find((t) => t.title === 'Review task')?.target_status).toBe('triage')
  })

  it('generates stable workspace idempotency keys', async () => {
    const { previewMigration } = await import('./legacy-tasks-migration')
    const preview = previewMigration()
    const keys = preview.tasks.map((t) => t.idempotency_key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const key of keys) {
      expect(key).toMatch(/^workspace-legacy:[a-f0-9]{16}$/)
    }
  })

  it('body includes migration annotation and due date', async () => {
    const { performMigration } = await import('./legacy-tasks-migration')
    const { createKanbanTask } = await import('./hermes-kanban-client')
    await performMigration()
    const calls = (createKanbanTask as ReturnType<typeof vi.fn>).mock.calls
    const fixUiCall = calls.find(
      (c: Array<unknown>) => (c[0] as { title: string }).title === 'Fix UI',
    )
    const input = fixUiCall?.[0] as { body: string }
    expect(input.body).toContain('[Imported from Workspace tasks.json]')
    expect(input.body).toContain('Due date: 2026-05-10')
    expect(input.body).toContain('frontend')
  })
})
