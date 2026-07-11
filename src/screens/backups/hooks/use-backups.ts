import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from '@/components/ui/toast'

export type BackupEntry = {
  name: string       // filename, e.g. "hermes-backup-20260709-143052.zip"
  archive: string    // full server path, e.g. "/Users/x/.hermes/backups/hermes-backup-....zip"
  size: number       // bytes
  mtime: number      // unix epoch seconds
  mtime_iso: string  // ISO 8601 timestamp
}

export type BackupListResult = {
  backups: Array<BackupEntry>
  pending: boolean  // true when the list endpoint doesn't exist yet (404) or dashboard unavailable
}

export type CreateBackupResponse = {
  ok: boolean
  pid: number
  name: string
  archive: string
}

// Backend list response uses field names: name, path, size, modified.
// SwitchUI normalizes to: name, archive, size, mtime, mtime_iso.
function mapBackupEntry(b: {
  name: string
  path: string
  size: number
  modified: string
}): BackupEntry {
  return {
    name: b.name,
    archive: b.path,
    size: b.size,
    mtime: Math.floor(new Date(b.modified).getTime() / 1000),
    mtime_iso: b.modified,
  }
}

export function useBackupList() {
  return useQuery({
    queryKey: ['backups', 'list'],
    queryFn: async (): Promise<BackupListResult> => {
      const res = await fetch('/api/backups/list')
      const body = await res.json().catch(() => ({ pending: true }))
      // Proxy returns {ok:false, pending:true, backups:[]} when the endpoint
      // is unreachable. The dashboard's success response is {backups: [...]}
      // with NO ok field — check for the array, not body.ok.
      if (body.pending === true || !Array.isArray(body.backups)) {
        return { backups: [], pending: body.pending ?? true }
      }
      return {
        backups: body.backups.map(mapBackupEntry),
        pending: false,
      }
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    retry: false,  // don't retry — pending is a valid state, not a transient error
  })
}

export function useCreateBackup() {
  return useMutation({
    mutationFn: async (opts?: { output?: string }): Promise<CreateBackupResponse> => {
      const res = await fetch('/api/backups/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(opts?.output ? { output: opts.output } : {}),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || 'Backup creation failed')
      return data
    },
    // NO onSuccess invalidation — fire-and-forget per design.
    // The backup runs async (spawned pid); the list won't update immediately anyway.
    onSuccess: (data) => {
      toast(`Backup started\n${data.archive}`, { type: 'success' })
    },
    onError: (err: Error) => {
      toast(`Backup failed\n${err.message}`, { type: 'error' })
    },
  })
}

export function useRestoreBackup() {
  return useMutation({
    mutationFn: async ({ archive }: { archive: string }) => {
      const res = await fetch('/api/backups/restore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ archive }),  // proxy injects force:true server-side
      })
      const data = await res.json().catch(() => ({ ok: false }))
      if (!res.ok || !data.ok) throw new Error(data.error || 'Restore failed')
      return data
    },
    onSuccess: () => {
      toast('Restore started\nData will be overwritten shortly.', { type: 'info' })
    },
    onError: (err: Error) => {
      toast(`Restore failed\n${err.message}`, { type: 'error' })
    },
  })
}

export function useRestoreUpload() {
  return useMutation({
    mutationFn: async ({ file }: { file: File }) => {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/backups/restore-upload', {
        method: 'POST',
        body: formData,  // do NOT set content-type — browser sets multipart boundary
      })
      const data = await res.json().catch(() => ({ ok: false }))
      if (!res.ok || !data.ok) throw new Error(data.error || 'Upload restore failed')
      return data
    },
    onSuccess: () => {
      toast('Restore started\nUpload received, restoring...', { type: 'info' })
    },
    onError: (err: Error) => {
      toast(`Upload restore failed\n${err.message}`, { type: 'error' })
    },
  })
}
