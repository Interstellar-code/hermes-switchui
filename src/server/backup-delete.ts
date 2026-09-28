import fs from 'node:fs/promises'
import path from 'node:path'
import { getActiveProfileName, getProfilesRoot } from './profiles-browser'

// hermes-agent's dashboard lists/downloads backups but has no delete route,
// so the BFF deletes locally. The guard mirrors the dashboard's own
// `/api/ops/backup/download` containment check (ops.py) — only a real .zip
// file directly inside the profile's backups directory may be removed.

export class BackupDeleteError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

/** `<hermes home>/backups` for default, `<profiles>/<name>/backups` otherwise. */
export function activeProfileBackupDir(): string {
  const profile = getActiveProfileName()
  const profilesRoot = getProfilesRoot()
  const home =
    profile === 'default'
      ? path.dirname(profilesRoot)
      : path.join(profilesRoot, profile)
  return path.join(home, 'backups')
}

export async function deleteBackupArchive(
  archive: string,
  backupDir: string,
): Promise<void> {
  if (!archive || path.extname(archive).toLowerCase() !== '.zip') {
    throw new BackupDeleteError('Not a backup archive', 400)
  }
  let dir: string
  let target: string
  try {
    dir = await fs.realpath(backupDir)
    const entry = await fs.lstat(archive)
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw new BackupDeleteError('Backup not found', 404)
    }
    target = await fs.realpath(archive)
  } catch (err) {
    if (err instanceof BackupDeleteError) throw err
    throw new BackupDeleteError('Backup not found', 404)
  }
  if (path.dirname(target) !== dir) {
    throw new BackupDeleteError(
      'Backup is outside the profile backup directory',
      403,
    )
  }
  await fs.unlink(target)
}
