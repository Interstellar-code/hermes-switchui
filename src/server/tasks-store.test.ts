import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  createTask,
  deleteTask,
  listTasks,
  updateTask,
} from "./tasks-store"

let tmpHome: string
let originalHermesHome: string | undefined

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "hermes-tasks-store-"))
  originalHermesHome = process.env.HERMES_HOME
  process.env.HERMES_HOME = tmpHome
})

afterEach(() => {
  if (originalHermesHome === undefined) delete process.env.HERMES_HOME
  else process.env.HERMES_HOME = originalHermesHome
  try { rmSync(tmpHome, { recursive: true, force: true }) } catch { /* ignore */ }
})

function readTasksJson(): { tasks: Array<{ title: string; description?: string; priority?: string; column?: string; assignee?: string }> } {
  const raw = readFileSync(join(tmpHome, "tasks.json"), "utf-8")
  return JSON.parse(raw)
}

describe("writeTaskFile atomicity", () => {
  it("createTask writes valid JSON that survives re-read", () => {
    const task = createTask({ title: "Test task" })
    expect(task.id).toMatch(/^[0-9a-f-]+$/i)
    expect(task.title).toBe("Test task")

    const parsed = readTasksJson()
    expect(parsed.tasks).toHaveLength(1)
    expect(parsed.tasks[0].title).toBe("Test task")
  })

  it("tasks.json content is never a partial write", () => {
    for (let i = 0; i < 10; i++) {
      createTask({ title: "Task " + i, description: "Description " + i })
    }

    const parsed = readTasksJson()
    expect(parsed.tasks).toHaveLength(10)
    for (let i = 0; i < 10; i++) {
      expect(parsed.tasks.some((t) => t.title === "Task " + i)).toBe(true)
    }
  })

  it("updateTask does not corrupt the file", () => {
    const task = createTask({ title: "Original" })
    const updated = updateTask(task.id, { title: "Updated" })
    expect(updated?.title).toBe("Updated")

    const parsed = readTasksJson()
    expect(parsed.tasks).toHaveLength(1)
    expect(parsed.tasks[0].title).toBe("Updated")
  })

  it("deleteTask does not corrupt the file", () => {
    const a = createTask({ title: "A" })
    createTask({ title: "B" })
    const deleted = deleteTask(a.id)
    expect(deleted).toBe(true)

    const parsed = readTasksJson()
    expect(parsed.tasks).toHaveLength(1)
    expect(parsed.tasks[0].title).toBe("B")
  })

  it("atomic write leaves no leftover .tmp files", () => {
    createTask({ title: "Initial" })

    const files = readdirSync(tmpHome)
    const tmpFiles = files.filter((f) => f.includes(".tmp"))
    expect(tmpFiles).toHaveLength(0)

    expect(existsSync(join(tmpHome, "tasks.json"))).toBe(true)
    const parsed = readTasksJson()
    expect(parsed.tasks).toHaveLength(1)
  })

  it("no leftover temp files after many writes", () => {
    for (let i = 0; i < 50; i++) {
      createTask({ title: "Task-" + i })
    }
    const files = readdirSync(tmpHome)
    const tmpFiles = files.filter((f) => f.endsWith(".tmp"))
    expect(tmpFiles).toHaveLength(0)

    const parsed = readTasksJson()
    expect(parsed.tasks).toHaveLength(50)
  })

  it("readTaskFile recovers gracefully from a pre-existing corrupt file", () => {
    writeFileSync(join(tmpHome, "tasks.json"), "{corrupt json", "utf-8")

    const tasks = listTasks()
    expect(tasks).toEqual([])
  })

  it("atomic write preserves content semantics", () => {
    const task = createTask({ title: "Verify content", description: "Long description", priority: "high" })
    expect(task.priority).toBe("high")

    const parsed = readTasksJson()
    expect(parsed.tasks[0].description).toBe("Long description")
    expect(parsed.tasks[0].priority).toBe("high")
  })
})

describe("listTasks filtering", () => {
  it("filters by column", () => {
    createTask({ title: "A", column: "backlog" })
    createTask({ title: "B", column: "done" })
    createTask({ title: "C", column: "backlog" })

    const backlog = listTasks({ column: "backlog" })
    expect(backlog).toHaveLength(2)
    expect(backlog.every((t) => t.column === "backlog")).toBe(true)
  })

  it("includeDone controls whether done tasks appear", () => {
    createTask({ title: "A", column: "backlog" })
    createTask({ title: "B", column: "done" })

    const withDone = listTasks({ includeDone: true })
    expect(withDone).toHaveLength(2)

    const withoutDone = listTasks({ includeDone: false })
    expect(withoutDone).toHaveLength(1)
    expect(withoutDone[0].title).toBe("A")
  })

  it("filters by assignee", () => {
    createTask({ title: "A", assignee: "neo" })
    createTask({ title: "B", assignee: "switch" })

    const neoTasks = listTasks({ assignee: "neo" })
    expect(neoTasks).toHaveLength(1)
    expect(neoTasks[0].title).toBe("A")
  })

  it("filters by priority", () => {
    createTask({ title: "A", priority: "high" })
    createTask({ title: "B", priority: "low" })

    const high = listTasks({ priority: "high" })
    expect(high).toHaveLength(1)
    expect(high[0].title).toBe("A")
  })
})
