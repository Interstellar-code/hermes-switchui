import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import {
  mapLegacyColumnToKanbanStatus,
  mapLegacyPriorityToNumeric,
} from '../lib/hermes-kanban-types'
import { createKanbanTask, updateKanbanTask } from './hermes-kanban-client'
import type {
  CreateKanbanTaskInput,
  HermesKanbanStatus,
} from '../lib/hermes-kanban-types'

const HERMES_HOME =
  process.env.HERMES_HOME ??
  process.env.CLAUDE_HOME ??
  path.join(os.homedir(), '.hermes')
const TASKS_FILE = path.join(HERMES_HOME, 'tasks.json')

type LegacyTask = {
  id?: string
  title: string
  description?: string
  body?: string
  column?: string
  priority?: string
  assignee?: string
  tags?: Array<string>
  due_date?: string
  created_at?: string
}

export type MigrationPreview = {
  total: number
  already_migrated: boolean
  tasks: Array<{
    legacy_id: string | null
    title: string
    target_status: string
    idempotency_key: string
  }>
}

export type MigrationResult = {
  imported: number
  skipped: number
  errors: Array<{ title: string; error: string }>
  backup_path: string
  marker_path: string
}

function derivedIdempotencyKey(task: LegacyTask, index: number): string {
  const stable = JSON.stringify([
    task.title ?? '',
    task.description ?? task.body ?? '',
    task.created_at ?? '',
    String(index),
  ])
  return `workspace-legacy:${crypto
    .createHash('sha256')
    .update(stable)
    .digest('hex')
    .slice(0, 16)}`
}

function legacyTaskToCreateInput(
  task: LegacyTask,
  index: number,
): { input: CreateKanbanTaskInput; desiredStatus: HermesKanbanStatus } {
  const targetStatus = mapLegacyColumnToKanbanStatus(task.column ?? 'backlog')
  const priority = mapLegacyPriorityToNumeric(task.priority ?? 'medium')
  const isTriage = targetStatus === 'triage'

  const annotations: Array<string> = ['[Imported from Workspace tasks.json]']
  if (task.due_date) annotations.push(`Due date: ${task.due_date}`)
  if (task.tags?.length) annotations.push(`Tags: ${task.tags.join(', ')}`)
  const body = [annotations.join('\n'), task.description ?? task.body ?? '']
    .filter(Boolean)
    .join('\n\n')

  return {
    desiredStatus: targetStatus,
    input: {
      title: task.title,
      body: body || null,
      priority,
      assignee: task.assignee ?? null,
      triage: isTriage,
      idempotency_key: derivedIdempotencyKey(task, index),
    },
  }
}

export function readLegacyTasks(): Array<LegacyTask> {
  try {
    const raw = fs.readFileSync(TASKS_FILE, 'utf-8')
    const parsed = JSON.parse(raw) as { tasks?: Array<LegacyTask> }
    return Array.isArray(parsed.tasks) ? parsed.tasks : []
  } catch {
    return []
  }
}

export function isMigrated(): boolean {
  return fs.existsSync(`${TASKS_FILE}.migrated`)
}

export function previewMigration(): MigrationPreview {
  const tasks = readLegacyTasks()
  return {
    total: tasks.length,
    already_migrated: isMigrated(),
    tasks: tasks.map((t, i) => ({
      legacy_id: t.id ?? null,
      title: t.title,
      target_status: mapLegacyColumnToKanbanStatus(t.column ?? 'backlog'),
      idempotency_key: derivedIdempotencyKey(t, i),
    })),
  }
}

export async function performMigration(): Promise<MigrationResult> {
  const tasks = readLegacyTasks()
  const errors: MigrationResult['errors'] = []
  let imported = 0
  let skipped = 0

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i]
    try {
      const { input, desiredStatus } = legacyTaskToCreateInput(task, i)
      const { task: created } = await createKanbanTask(input)
      if (desiredStatus !== 'triage' && desiredStatus !== 'ready') {
        await updateKanbanTask(created.id, { status: desiredStatus })
      }
      imported++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.toLowerCase().includes('idempotency') || msg.includes('409')) {
        skipped++
      } else {
        errors.push({ title: task.title, error: msg })
      }
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const backupPath = `${TASKS_FILE}.backup-${stamp}`
  const markerPath = `${TASKS_FILE}.migrated`

  try {
    fs.copyFileSync(TASKS_FILE, backupPath)
    fs.writeFileSync(
      markerPath,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          imported,
          skipped,
          errors: errors.length,
          backup: backupPath,
        },
        null,
        2,
      ),
      'utf-8',
    )
  } catch {
    // marker/backup failure is non-fatal
  }

  return {
    imported,
    skipped,
    errors,
    backup_path: backupPath,
    marker_path: markerPath,
  }
}
