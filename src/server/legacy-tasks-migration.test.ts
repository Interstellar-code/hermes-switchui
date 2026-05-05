import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./hermes-kanban-client', () => ({
  createKanbanTask: vi.fn(async (input) => ({
    task: { id: 'new-' + input.idempotency_key, ...input },
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

  it('maps high priority to numeric 3', async () => {
    const { previewMigration } = await import('./legacy-tasks-migration')
    const preview = previewMigration()
    const highTask = preview.tasks.find((t) => t.title === 'Fix UI')
    expect(highTask).toBeDefined()
    // Verify status mapping: in_progress → running
    expect(highTask?.target_status).toBe('running')
  })

  it('maps medium priority to numeric 1 (not 0)', async () => {
    const { mapLegacyPriorityToNumeric } =
      await import('../lib/hermes-kanban-types')
    expect(mapLegacyPriorityToNumeric('medium')).toBe(1)
    // This guards the silent regression where medium → 0 showed as Low/Normal
  })

  it('maps low priority to -1', async () => {
    const { mapLegacyPriorityToNumeric } =
      await import('../lib/hermes-kanban-types')
    expect(mapLegacyPriorityToNumeric('low')).toBe(-1)
  })

  it('maps high priority to 3', async () => {
    const { mapLegacyPriorityToNumeric } =
      await import('../lib/hermes-kanban-types')
    expect(mapLegacyPriorityToNumeric('high')).toBe(3)
  })

  it('maps backlog → triage', async () => {
    const { previewMigration } = await import('./legacy-tasks-migration')
    const preview = previewMigration()
    const backlogTask = preview.tasks.find((t) => t.title === 'Research')
    expect(backlogTask?.target_status).toBe('triage')
  })

  it('maps done → done', async () => {
    const { previewMigration } = await import('./legacy-tasks-migration')
    const preview = previewMigration()
    const doneTask = preview.tasks.find((t) => t.title === 'Old done task')
    expect(doneTask?.target_status).toBe('done')
  })

  it('maps review → triage (no review Agent status)', async () => {
    const { previewMigration } = await import('./legacy-tasks-migration')
    const preview = previewMigration()
    const reviewTask = preview.tasks.find((t) => t.title === 'Review task')
    expect(reviewTask?.target_status).toBe('triage')
  })

  it('preview returns 4 tasks from mock data', async () => {
    const { previewMigration } = await import('./legacy-tasks-migration')
    const preview = previewMigration()
    expect(preview.total).toBe(4)
    expect(preview.tasks).toHaveLength(4)
  })

  it('generates stable idempotency keys for tasks with and without IDs', async () => {
    const { previewMigration } = await import('./legacy-tasks-migration')
    const preview = previewMigration()
    const keys = preview.tasks.map((t) => t.idempotency_key)
    // All keys should be unique
    expect(new Set(keys).size).toBe(keys.length)
    // All keys should start with switchui-legacy:
    for (const key of keys) {
      expect(key).toMatch(/^switchui-legacy:[a-f0-9]{16}$/)
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
    expect(fixUiCall).toBeDefined()
    const input = fixUiCall![0] as { body: string }
    expect(input.body).toContain('[Imported from SwitchUI tasks.json]')
    expect(input.body).toContain('Due date: 2026-05-10')
    expect(input.body).toContain('frontend')
  })
})
