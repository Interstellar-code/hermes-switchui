import '@/styles/matrix-backups.css'
import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  useBackupList,
  useCreateBackup,
  useRestoreBackup,
  useRestoreUpload,
  type BackupEntry,
} from './hooks/use-backups'
import { RestoreConfirmDialog } from './components/restore-confirm-dialog'

// ── helpers ──

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const val = bytes / Math.pow(1024, i)
  return `${val.toFixed(val < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

// ── main screen ──

export function BackupsScreen() {
  const queryClient = useQueryClient()
  const listQuery = useBackupList()
  const createBackup = useCreateBackup()
  const restoreBackup = useRestoreBackup()
  const restoreUpload = useRestoreUpload()

  const [restoreTarget, setRestoreTarget] = useState<BackupEntry | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const backups = listQuery.data?.backups ?? []
  const listPending = listQuery.data?.pending ?? false
  const listLoading = listQuery.isPending // initial query fetch (no data yet)
  const isEmpty = backups.length === 0

  // ── handlers ──

  function handleCreate() {
    createBackup.mutate({})
  }

  function handleDownload(entry: BackupEntry) {
    window.open(
      '/api/backups/download?archive=' + encodeURIComponent(entry.archive),
      '_blank',
    )
  }

  function handleConfirmRestore() {
    if (!restoreTarget) return
    restoreBackup.mutate(
      { archive: restoreTarget.archive },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['backups', 'list'] })
        },
      },
    )
    setRestoreTarget(null)
  }

  function handleUploadFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.zip')) return
    restoreUpload.mutate(
      { file },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['backups', 'list'] })
        },
      },
    )
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleUploadFile(file)
    // reset so selecting the same file twice fires onChange again
    e.target.value = ''
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleUploadFile(file)
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(true)
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
  }

  // ── render ──

  return (
    <div className="bk-shell" data-screen="backups">
      <header className="bk-header">
        <div>
          <p className="bk-header-sub">HERMES SWITCH UI · Backups</p>
          <h1 className="bk-header-title">Backups</h1>
          <p className="bk-header-sub">
            Create and restore Hermes Agent data archives.
          </p>
        </div>
        <span className="bk-stats">
          <span className="bk-stats-num">{backups.length}</span> backups
        </span>
        <button
          className="bk-btn bk-btn-primary"
          onClick={handleCreate}
          disabled={createBackup.isPending}
        >
          {createBackup.isPending ? <span className="bk-spinner" /> : null}
          Create Backup
        </button>
      </header>

      <main className="bk-canvas">
        {listLoading ? (
          <div className="bk-empty">
            <span className="bk-empty-icon">{/* spinner-only state */}</span>
            <span className="bk-spinner" />
          </div>
        ) : isEmpty ? (
          <div className="bk-empty">
            <span className="bk-empty-icon">
              {listPending ? '\u25A2' : '\u25CB'}
            </span>
            <p className="bk-empty-title">
              {listPending ? 'Backup list unavailable' : 'No backups yet'}
            </p>
            <p className="bk-empty-sub">
              {listPending
                ? 'The backups endpoint is not reachable. Create a backup to get started.'
                : 'Create your first backup to get started.'}
            </p>
          </div>
        ) : (
          <div className="bk-grid">
            {backups.map((b) => (
              <BackupCard
                key={b.archive}
                entry={b}
                onDownload={() => handleDownload(b)}
                onRestore={() => setRestoreTarget(b)}
              />
            ))}
          </div>
        )}

        <div className="bk-upload">
          <h2 className="bk-upload-title">Restore from Upload</h2>
          <div
            className={'bk-upload-zone' + (isDragging ? ' dragging' : '')}
            onClick={() => fileInputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            role="button"
            tabIndex={0}
          >
            {restoreUpload.isPending
              ? 'Restoring upload\u2026'
              : 'Drop a .zip backup or click to browse'}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,application/zip"
            onChange={handleFileInputChange}
            style={{ display: 'none' }}
          />
        </div>
      </main>

      {restoreTarget && (
        <RestoreConfirmDialog
          open={true}
          archiveName={restoreTarget.name}
          onConfirm={handleConfirmRestore}
          onCancel={() => setRestoreTarget(null)}
        />
      )}
    </div>
  )
}

// ── backup card ──

function BackupCard({
  entry,
  onDownload,
  onRestore,
}: {
  entry: BackupEntry
  onDownload: () => void
  onRestore: () => void
}) {
  return (
    <div className="bk-card">
      <div className="bk-card-name" title={entry.archive}>
        {entry.name}
      </div>
      <div className="bk-card-meta">
        <span>{formatBytes(entry.size)}</span>
        <span>{formatDate(entry.mtime_iso)}</span>
      </div>
      <div className="bk-card-actions">
        <button className="bk-btn bk-btn-ghost" onClick={onDownload}>
          Download
        </button>
        <button className="bk-btn bk-btn-danger" onClick={onRestore}>
          Restore
        </button>
      </div>
    </div>
  )
}
