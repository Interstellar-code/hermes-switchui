import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { deleteBackupArchive } from './backup-delete'

let root: string
let backups: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-del-'))
  backups = path.join(root, 'backups')
  fs.mkdirSync(backups)
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

const touch = (p: string) => fs.writeFileSync(p, 'zip')

describe('deleteBackupArchive', () => {
  it('deletes a zip inside the backups dir', async () => {
    const file = path.join(backups, 'hermes-backup-1.zip')
    touch(file)
    await deleteBackupArchive(file, backups)
    expect(fs.existsSync(file)).toBe(false)
  })

  it('rejects traversal out of the backups dir', async () => {
    const outside = path.join(root, 'secret.zip')
    touch(outside)
    await expect(
      deleteBackupArchive(path.join(backups, '..', 'secret.zip'), backups),
    ).rejects.toMatchObject({ status: 403 })
    expect(fs.existsSync(outside)).toBe(true)
  })

  it('rejects nested paths, non-zip files, directories and symlinks', async () => {
    fs.mkdirSync(path.join(backups, 'sub'))
    touch(path.join(backups, 'sub', 'a.zip'))
    await expect(
      deleteBackupArchive(path.join(backups, 'sub', 'a.zip'), backups),
    ).rejects.toMatchObject({ status: 403 })

    touch(path.join(backups, 'notes.txt'))
    await expect(
      deleteBackupArchive(path.join(backups, 'notes.txt'), backups),
    ).rejects.toMatchObject({ status: 400 })

    fs.mkdirSync(path.join(backups, 'dir.zip'))
    await expect(
      deleteBackupArchive(path.join(backups, 'dir.zip'), backups),
    ).rejects.toMatchObject({ status: 404 })

    const outside = path.join(root, 'real.zip')
    touch(outside)
    fs.symlinkSync(outside, path.join(backups, 'link.zip'))
    await expect(
      deleteBackupArchive(path.join(backups, 'link.zip'), backups),
    ).rejects.toMatchObject({ status: 404 })
    expect(fs.existsSync(outside)).toBe(true)
  })

  it('404s a missing file', async () => {
    await expect(
      deleteBackupArchive(path.join(backups, 'gone.zip'), backups),
    ).rejects.toMatchObject({ status: 404 })
  })
})
