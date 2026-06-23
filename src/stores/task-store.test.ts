import { afterEach, describe, expect, it } from 'vitest'
import { useTaskStore } from './task-store'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function resetStore() {
  useTaskStore.setState({ tasks: [], afterSync: false })
}

const baseTask = {
  title: 'Test task',
  description: 'desc',
  status: 'backlog' as const,
  priority: 'P1' as const,
  tags: [],
}

describe('task ID generation (#169)', () => {
  afterEach(resetStore)

  it('addTask produces a UUID-based ID', async () => {
    await useTaskStore.getState().addTask(baseTask)
    const [task] = useTaskStore.getState().tasks
    expect(task.id).toMatch(/^TASK-/)
    expect(task.id.replace('TASK-', '')).toMatch(UUID_RE)
  })

  it('addTask produces unique IDs on successive calls', async () => {
    await useTaskStore.getState().addTask(baseTask)
    await useTaskStore.getState().addTask({ ...baseTask, title: 'Task 2' })
    const ids = useTaskStore.getState().tasks.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('upsertMissionTasks produces UUID-based IDs', () => {
    useTaskStore.getState().upsertMissionTasks([
      { ...baseTask, missionId: 'm1' },
      { ...baseTask, title: 'Task B', missionId: 'm1' },
    ])
    const tasks = useTaskStore.getState().tasks
    for (const t of tasks) {
      expect(t.id).toMatch(/^mission-m1-/)
      const uuidPart = t.id.replace('mission-m1-', '')
      expect(uuidPart).toMatch(UUID_RE)
    }
  })

  it('upsertMissionTasks IDs are unique across calls', () => {
    useTaskStore.getState().upsertMissionTasks([{ ...baseTask, missionId: 'm1' }])
    useTaskStore.getState().upsertMissionTasks([{ ...baseTask, title: 'Task B', missionId: 'm1' }])
    const ids = useTaskStore.getState().tasks.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('persisted task growth cap (#169)', () => {
  afterEach(resetStore)

  it('addTask caps tasks at MAX_PERSISTED_TASKS (500)', async () => {
    // Seed 499 tasks directly
    const seed = Array.from({ length: 499 }, (_, i) => ({
      ...baseTask,
      id: `TASK-seed-${i}`,
      title: `Seed ${i}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }))
    useTaskStore.setState({ tasks: seed })

    // Adding one more should bring total to 500 (cap)
    await useTaskStore.getState().addTask(baseTask)
    expect(useTaskStore.getState().tasks.length).toBe(500)

    // Adding yet another must still not exceed 500
    await useTaskStore.getState().addTask({ ...baseTask, title: 'Extra' })
    expect(useTaskStore.getState().tasks.length).toBe(500)
  })

  it('upsertMissionTasks caps tasks at MAX_PERSISTED_TASKS (500)', () => {
    const seed = Array.from({ length: 498 }, (_, i) => ({
      ...baseTask,
      id: `TASK-seed-${i}`,
      title: `Seed ${i}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }))
    useTaskStore.setState({ tasks: seed })

    // Insert 10 new tasks — total would be 508 without cap
    useTaskStore.getState().upsertMissionTasks(
      Array.from({ length: 10 }, (_, i) => ({
        ...baseTask,
        title: `Mission task ${i}`,
        missionId: 'mX',
      })),
    )
    expect(useTaskStore.getState().tasks.length).toBeLessThanOrEqual(500)
  })
})
