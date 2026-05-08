'use client'

/**
 * sidebar-detail-drawer-v2.tsx — Right-anchored detail drawer for the v2 sessions sidebar.
 *
 * Reads open state from useSidebarDetailStore.
 * Three modes: task | mem | cron-run.
 * Closes on ESC, click-outside, or close button.
 */

import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSidebarDetailStore } from '@/stores/sidebar-detail-store'
import { fetchJobOutput, getLatestJobOutputText } from '@/lib/jobs-api'
import { fetchTasks } from '@/lib/tasks-api'

// ── Memory fetch ───────────────────────────────────────────────────────────────

async function fetchMemoryGet(encodedPath: string): Promise<{ content: string; name: string; updatedAt?: number }> {
  const res = await fetch(`/api/memory/get?path=${encodedPath}`)
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Failed to load memory: ${res.status}`)
  }
  return res.json() as Promise<{ content: string; name: string; updatedAt?: number }>
}

// ── Task detail fetch (fetches board then finds by id) ─────────────────────────

async function fetchTaskById(taskId: string) {
  const tasks = await fetchTasks({ include_done: true, include_archived: true })
  return tasks.find((t) => t.id === taskId) ?? null
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const DRAWER_WIDTH = 380

// ── Main drawer ───────────────────────────────────────────────────────────────

export function SidebarDetailDrawerV2() {
  const { open, closeDrawer } = useSidebarDetailStore()
  const overlayRef = useRef<HTMLDivElement>(null)

  // ESC to close
  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeDrawer()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, closeDrawer])

  if (!open) return null

  return (
    <>
      {/* Click-outside backdrop */}
      <div
        ref={overlayRef}
        aria-hidden
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 49,
          background: 'transparent',
        }}
        onClick={closeDrawer}
      />
      {/* Drawer panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Detail"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: DRAWER_WIDTH,
          zIndex: 50,
          background: 'var(--theme-card)',
          borderLeft: '1px solid var(--theme-border)',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.4)',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 12px',
            borderBottom: '1px solid var(--theme-border)',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: 10,
              color: 'var(--theme-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            {open.kind === 'task' ? 'task' : open.kind === 'mem' ? 'memory' : 'cron run'}
          </span>
          <button
            type="button"
            aria-label="Close detail drawer"
            onClick={closeDrawer}
            style={{
              background: 'transparent',
              border: '1px solid var(--theme-border)',
              borderRadius: 3,
              color: 'var(--theme-muted)',
              cursor: 'pointer',
              fontSize: 12,
              lineHeight: 1,
              width: 20,
              height: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
            }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
          {open.kind === 'task' && <TaskDetail taskId={open.id} />}
          {open.kind === 'mem' && <MemDetail encodedPath={open.id} />}
          {open.kind === 'cron-run' && <CronRunDetail jobId={open.id} />}
        </div>
      </div>
    </>
  )
}

// ── Task detail panel ─────────────────────────────────────────────────────────

function TaskDetail({ taskId }: { taskId: string }) {
  const { data: task, isLoading, error } = useQuery({
    queryKey: ['drawer', 'task', taskId],
    queryFn: () => fetchTaskById(taskId),
    staleTime: 15_000,
  })

  if (isLoading) return <LoadingState />
  if (error) return <ErrorState message={error instanceof Error ? error.message : 'Failed to load task'} />
  if (!task) return <ErrorState message="Task not found" />

  const statusColor =
    task.status === 'running' ? '#00ff41'
    : task.status === 'done' ? '#7dff9a'
    : task.status === 'archived' ? '#6b7280'
    : 'var(--theme-muted)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--theme-text)', lineHeight: 1.4 }}>
        {task.title}
      </h2>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Chip label="status" value={task.status} color={statusColor} />
        {task.assignee && <Chip label="assignee" value={task.assignee} color="#8b5cf6" />}
        {task.priority != null && <Chip label="priority" value={String(task.priority)} color="#d6ff5f" />}
      </div>
      {task.summary && (
        <PreBlock label="summary">{task.summary}</PreBlock>
      )}
      {task.body && (
        <PreBlock label="body">{task.body}</PreBlock>
      )}
      {task.result && (
        <PreBlock label="result">{task.result}</PreBlock>
      )}
      {task.last_spawn_error && (
        <PreBlock label="last error">{task.last_spawn_error}</PreBlock>
      )}
    </div>
  )
}

// ── Memory detail panel ───────────────────────────────────────────────────────

function MemDetail({ encodedPath }: { encodedPath: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['drawer', 'mem', encodedPath],
    queryFn: () => fetchMemoryGet(encodedPath),
    staleTime: 30_000,
  })

  if (isLoading) return <LoadingState />
  if (error) return <ErrorState message={error instanceof Error ? error.message : 'Failed to load memory file'} />
  if (!data) return <ErrorState message="File not found" />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--theme-text)', lineHeight: 1.4 }}>
        {data.name}
      </h2>
      {data.updatedAt && (
        <span style={{ fontSize: 9, color: 'var(--theme-muted)', fontFamily: 'var(--font-mono, monospace)' }}>
          updated {new Date(data.updatedAt).toLocaleString()}
        </span>
      )}
      <pre
        style={{
          margin: 0,
          padding: '8px 10px',
          background: 'var(--theme-bg)',
          border: '1px solid var(--theme-border)',
          borderRadius: 4,
          fontSize: 11,
          lineHeight: 1.6,
          color: 'var(--theme-text)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflowX: 'auto',
          fontFamily: 'var(--font-mono, monospace)',
        }}
      >
        {data.content}
      </pre>
    </div>
  )
}

// ── Cron run detail panel ─────────────────────────────────────────────────────

function CronRunDetail({ jobId }: { jobId: string }) {
  const { data: outputs, isLoading, error } = useQuery({
    queryKey: ['drawer', 'cron-run', jobId],
    queryFn: () => fetchJobOutput(jobId, 5),
    staleTime: 20_000,
  })

  if (isLoading) return <LoadingState />
  if (error) return <ErrorState message={error instanceof Error ? error.message : 'Failed to load run output'} />

  const text = outputs ? getLatestJobOutputText(outputs) : ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--theme-text)', lineHeight: 1.4 }}>
        Cron run output
      </h2>
      <span style={{ fontSize: 9, color: 'var(--theme-muted)', fontFamily: 'var(--font-mono, monospace)' }}>
        job: {jobId}
      </span>
      {text ? (
        <pre
          style={{
            margin: 0,
            padding: '8px 10px',
            background: 'var(--theme-bg)',
            border: '1px solid var(--theme-border)',
            borderRadius: 4,
            fontSize: 11,
            lineHeight: 1.6,
            color: 'var(--theme-text)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            overflowX: 'auto',
            fontFamily: 'var(--font-mono, monospace)',
          }}
        >
          {text}
        </pre>
      ) : (
        <span style={{ fontSize: 11, color: 'var(--theme-muted)' }}>No output available.</span>
      )}
    </div>
  )
}

// ── Shared micro-components ───────────────────────────────────────────────────

function LoadingState() {
  return (
    <div style={{ color: 'var(--theme-muted)', fontSize: 11, fontFamily: 'var(--font-mono, monospace)' }}>
      loading…
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <div style={{ color: '#ff5f5f', fontSize: 11, fontFamily: 'var(--font-mono, monospace)' }}>
      {message}
    </div>
  )
}

function Chip({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        padding: '1px 6px',
        borderRadius: 10,
        fontSize: 9,
        fontFamily: 'var(--font-mono, monospace)',
        background: `color-mix(in srgb, ${color} 18%, transparent)`,
        color,
        border: `1px solid ${color}55`,
      }}
    >
      <span style={{ opacity: 0.6 }}>{label}:</span>
      {value}
    </span>
  )
}

function PreBlock({ label, children }: { label: string; children: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span
        style={{
          fontSize: 9,
          color: 'var(--theme-muted)',
          fontFamily: 'var(--font-mono, monospace)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        {label}
      </span>
      <pre
        style={{
          margin: 0,
          padding: '6px 8px',
          background: 'var(--theme-bg)',
          border: '1px solid var(--theme-border)',
          borderRadius: 4,
          fontSize: 11,
          lineHeight: 1.5,
          color: 'var(--theme-text)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontFamily: 'var(--font-mono, monospace)',
        }}
      >
        {children}
      </pre>
    </div>
  )
}
