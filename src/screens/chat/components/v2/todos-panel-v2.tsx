import { memo, useMemo, useState } from 'react'
import { latestTodoSnapshot } from './tool-entries'
import { relativeTime } from './tool-panel-v2'
import type { FlatToolEntry, TodoItem } from './tool-entries'

export type TodoProgress = {
  done: number
  total: number
  inProgress: number
  pending: number
  cancelled: number
  updates: number
  /** The newest todo call is still running; the list shown is the last settled one. */
  updating: boolean
}

type Bucket = 'done' | 'inProgress' | 'pending' | 'cancelled'

function bucketOf(status: string): Bucket {
  const s = status.toLowerCase().replace(/[\s-]/g, '_')
  if (s === 'completed' || s === 'done') return 'done'
  if (s === 'in_progress') return 'inProgress'
  if (s === 'cancelled' || s === 'canceled') return 'cancelled'
  return 'pending'
}

function todoCalls(entries: Array<FlatToolEntry>): Array<FlatToolEntry> {
  return entries.filter((e) => e.name.toLowerCase() === 'todo')
}

const isRunning = (e: FlatToolEntry) => e.output === undefined && !e.isError

/**
 * Latest readable todo list. While the newest todo call is still running its
 * args may be a partial patch, so fall back to the last settled call.
 */
function settledSnapshot(entries: Array<FlatToolEntry>) {
  const calls = todoCalls(entries)
  const newest = calls.reduce<FlatToolEntry | undefined>(
    (m, e) => (!m || (e.timestamp ?? 0) >= (m.timestamp ?? 0) ? e : m),
    undefined,
  )
  const updating = newest !== undefined && isRunning(newest)
  const snapshot = latestTodoSnapshot(
    updating ? calls.filter((e) => !isRunning(e)) : calls,
  )
  return { snapshot, updating }
}

/** Progress of the latest todo list; null when there is no readable list. */
export function todoProgress(
  entries: Array<FlatToolEntry>,
): TodoProgress | null {
  const { snapshot, updating } = settledSnapshot(entries)
  if (!snapshot) return null
  const p: TodoProgress = {
    done: 0,
    total: snapshot.todos.length,
    inProgress: 0,
    pending: 0,
    cancelled: 0,
    updates: todoCalls(entries).length,
    updating,
  }
  for (const t of snapshot.todos) p[bucketOf(t.status)]++
  return p
}

const GLYPH: Record<Bucket, string> = {
  done: '✓',
  inProgress: '◐',
  pending: '○',
  cancelled: '✕',
}

function Section({
  title,
  bucket,
  items,
  collapsible,
}: {
  title: string
  bucket: Bucket
  items: Array<TodoItem>
  collapsible?: boolean
}) {
  const [open, setOpen] = useState(!collapsible)
  if (items.length === 0) return null
  const header = `${title} (${items.length})`
  return (
    <section className="mb-3">
      {collapsible ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="mb-1 flex w-full items-center gap-1 text-left text-[10px] font-medium uppercase tracking-[0.16em]"
          style={{ color: 'var(--theme-muted)' }}
        >
          <span aria-hidden>{open ? '▾' : '▸'}</span>
          {header}
        </button>
      ) : (
        <h3
          className="mb-1 text-[10px] font-medium uppercase tracking-[0.16em]"
          style={{ color: 'var(--theme-muted)' }}
        >
          {header}
        </h3>
      )}
      {open && (
        <ul className="m-0 list-none space-y-1 p-0">
          {items.map((t, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span
                aria-hidden
                className="mt-0.5 shrink-0"
                style={{
                  color:
                    bucket === 'inProgress'
                      ? 'var(--theme-accent)'
                      : 'var(--theme-muted)',
                }}
              >
                {GLYPH[bucket]}
              </span>
              <span
                className={`min-w-0 break-words ${bucket === 'done' || bucket === 'cancelled' ? 'line-through' : ''}`}
                style={{
                  color:
                    bucket === 'done' || bucket === 'cancelled'
                      ? 'var(--theme-muted)'
                      : 'var(--theme-text)',
                }}
              >
                {t.content}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export const TodosPanelV2 = memo(function TodosPanel({
  entries,
}: {
  entries: Array<FlatToolEntry>
}) {
  const view = useMemo(() => {
    const calls = todoCalls(entries)
    const { snapshot, updating } = settledSnapshot(entries)
    const latestTs = calls.reduce<number | undefined>((m, e) => {
      const t = e.displayTs
      return t !== undefined && (m === undefined || t > m) ? t : m
    }, undefined)
    const groups: Record<Bucket, Array<TodoItem>> = {
      done: [],
      inProgress: [],
      pending: [],
      cancelled: [],
    }
    for (const t of snapshot?.todos ?? []) groups[bucketOf(t.status)].push(t)
    return { calls: calls.length, snapshot, updating, latestTs, groups }
  }, [entries])
  const progress = useMemo(() => todoProgress(entries), [entries])

  if (view.calls === 0) {
    return (
      <p className="p-3 text-sm" style={{ color: 'var(--theme-muted)' }}>
        No to-do list in this session
      </p>
    )
  }
  if (!progress) {
    return (
      <p className="p-3 text-sm" style={{ color: 'var(--theme-muted)' }}>
        {view.updating
          ? 'Updating…'
          : `Latest update couldn't be read (${view.calls} ${view.calls === 1 ? 'update' : 'updates'})`}
      </p>
    )
  }

  const { done, total, inProgress, pending, cancelled, updates, updating } =
    progress
  const pct = (n: number) => (total ? (n / total) * 100 : 0)
  const caption = [
    `${done} done`,
    `${inProgress} in progress`,
    `${pending} pending`,
    ...(cancelled ? [`${cancelled} cancelled`] : []),
  ].join(' · ')

  return (
    <div className="w-full min-w-0 p-3" style={{ color: 'var(--theme-text)' }}>
      {total === 0 ? (
        <p className="mb-3 text-sm" style={{ color: 'var(--theme-muted)' }}>
          The to-do list is empty
        </p>
      ) : (
        <>
          <div
            role="progressbar"
            aria-label="To-do progress"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={done}
            aria-valuetext={caption}
            className="flex h-2 w-full overflow-hidden rounded-full"
            style={{ background: 'var(--theme-border)' }}
          >
            <div
              style={{
                width: `${pct(done)}%`,
                background: 'var(--theme-accent)',
              }}
            />
            <div
              style={{
                width: `${pct(inProgress)}%`,
                background: 'var(--theme-accent)',
                opacity: 0.5,
              }}
            />
          </div>
          <p
            className="mb-3 mt-1 text-xs"
            style={{ color: 'var(--theme-muted)' }}
          >
            {caption}
          </p>
        </>
      )}
      <Section
        title="In progress"
        bucket="inProgress"
        items={view.groups.inProgress}
      />
      <Section title="Pending" bucket="pending" items={view.groups.pending} />
      <Section
        title="Done"
        bucket="done"
        items={view.groups.done}
        collapsible
      />
      <Section
        title="Cancelled"
        bucket="cancelled"
        items={view.groups.cancelled}
        collapsible
      />
      <p
        className="mt-2 border-t pt-2 text-[10px]"
        style={{
          color: 'var(--theme-muted)',
          borderColor: 'var(--theme-border)',
        }}
      >
        {updating ? 'Updating… · ' : ''}
        Latest of {updates} {updates === 1 ? 'update' : 'updates'}
        {view.latestTs !== undefined && ` · ${relativeTime(view.latestTs)}`}
      </p>
    </div>
  )
})
