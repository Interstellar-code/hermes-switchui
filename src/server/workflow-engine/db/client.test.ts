import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { closeDb, defaultWorkflowDbPath, openDb } from './client'

describe('workflow db client path resolution', () => {
  it('honors an explicit workflow DB path', () => {
    expect(
      defaultWorkflowDbPath(
        { HERMES_WORKFLOW_DB_PATH: '/tmp/custom-workflows.db' },
        '/repo/a',
      ),
    ).toBe('/tmp/custom-workflows.db')
  })

  it('keeps production on the stable app-wide DB path', () => {
    expect(
      defaultWorkflowDbPath({ NODE_ENV: 'production' }, '/repo/a'),
    ).toMatch(/\.hermes\/switchui-workflows\.db$/)
  })

  it('isolates development DBs by checkout path', () => {
    const first = defaultWorkflowDbPath(
      { NODE_ENV: 'development' },
      '/repo/hermes-switchui',
    )
    const second = defaultWorkflowDbPath(
      { NODE_ENV: 'development' },
      '/repo/hermes-switchui-a',
    )

    expect(first).not.toBe(second)
    expect(first).toContain(join('.hermes', 'dev', 'hermes-switchui-'))
    expect(second).toContain(join('.hermes', 'dev', 'hermes-switchui-a-'))
  })

  it('allows dev server reloads to reuse a same-process lock', () => {
    const dir = mkdtempSync(join(tmpdir(), 'workflow-db-lock-'))
    const dbPath = join(dir, 'switchui-workflows.db')
    const lockPath = `${dbPath}.lock`

    try {
      writeFileSync(
        lockPath,
        JSON.stringify({ pid: process.pid, startedAt: Date.now() }),
      )

      const db = openDb(dbPath)

      expect(db.open).toBe(true)
    } finally {
      closeDb()
      expect(existsSync(lockPath)).toBe(false)
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
