/**
 * NodeLog — terminal-style stdout/stderr of one bash/script node (F5b).
 * Live while the node runs (auto-scroll with a FOLLOW toggle), stored history
 * once it has finished. Used by the node panel and the Inspect OUTPUT tab.
 */
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import '@/styles/node-log.css'
import { useNodeLog } from './use-node-log'
import type { LogChunk } from './use-node-log'
import type { SubscribeNodeLog } from '@/screens/workflows/use-workflow-events'
import { toast } from '@/components/ui/toast'

/** Node types whose executors stream `node_log`. */
export const LOG_TYPES = new Set(['bash', 'script'])

type Seg =
  | { key: string; kind: 'text'; stream: LogChunk['stream']; text: string }
  | { key: string; kind: 'sep'; text: string }

/**
 * Adjacent same-stream chunks collapse into one span (a 14k-row log renders a
 * handful of nodes); attempt dividers and truncation markers break runs.
 */
export function logSegments(chunks: Array<LogChunk>): Array<Seg> {
  const out: Array<Seg> = []
  let attempt = 1
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]
    if (c.first && i > 0)
      out.push({
        key: `a${c.key}`,
        kind: 'sep',
        text: `── attempt ${++attempt} ──\n`,
      })
    if (c.truncated) {
      out.push({
        key: `t${c.key}`,
        kind: 'sep',
        text: '── truncated at 256KB by the engine ──\n',
      })
      continue
    }
    const prev = out.at(-1)
    if (prev?.kind === 'text' && prev.stream === c.stream) prev.text += c.text
    else out.push({ key: c.key, kind: 'text', stream: c.stream, text: c.text })
  }
  return out
}

export function countLines(chunks: Array<LogChunk>): number {
  let n = 0
  let last = ''
  for (const c of chunks) {
    if (!c.text) continue
    for (
      let i = c.text.indexOf('\n');
      i !== -1;
      i = c.text.indexOf('\n', i + 1)
    )
      n++
    last = c.text
  }
  return last && !last.endsWith('\n') ? n + 1 : n
}

const canCopy = () =>
  // clipboard is undefined on insecure (http) origins

  typeof navigator !== 'undefined' && !!navigator.clipboard

export const NodeLog = memo(function NodeLogView({
  runId,
  nodeRunId,
  live,
  subscribe,
  label = 'LOG',
}: {
  runId: string
  nodeRunId: string
  live: boolean
  subscribe?: SubscribeNodeLog
  label?: string
}) {
  const log = useNodeLog({ runId, nodeRunId, enabled: true, live, subscribe })
  const [follow, setFollow] = useState(true)
  const [said, setSaid] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)
  const scrolledFor = useRef<string | null>(null)
  const segs = useMemo(() => logSegments(log.chunks), [log.chunks])
  const lines = useMemo(() => countLines(log.chunks), [log.chunks])
  const truncs = useMemo(
    () => log.chunks.filter((c) => c.truncated).length,
    [log.chunks],
  )
  const hasErr = useMemo(
    () => log.chunks.some((c) => c.stream === 'stderr' && c.text),
    [log.chunks],
  )

  // Follow the tail; a finished log also opens at its end (once per node run).
  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box || log.chunks.length === 0) return
    if (follow || scrolledFor.current !== nodeRunId) {
      box.scrollTop = box.scrollHeight
      scrolledFor.current = nodeRunId
    }
  }, [log.chunks, follow, nodeRunId])

  // Scrolling up pauses FOLLOW; scrolling back to the bottom resumes it.
  const onScroll = () => {
    const box = boxRef.current
    if (!box || !live) return
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 8
    if (atBottom !== follow) setFollow(atBottom)
  }
  // A node that stops running stops following too (nothing more will arrive).
  useEffect(() => {
    if (!live) setFollow(false)
  }, [live])

  // Screen readers hear state changes only, never the streamed text.
  const wasLive = useRef(live)
  useEffect(() => {
    if (wasLive.current && !live)
      setSaid(`${label} finished · ${lines} line${lines === 1 ? '' : 's'}`)
    wasLive.current = live
  }, [live])
  useEffect(() => {
    if (truncs > 0) setSaid(`${label} truncated at 256KB by the engine`)
  }, [truncs, label])
  useEffect(() => {
    if (log.dropped) setSaid(`${label}: oldest output dropped (512KB limit)`)
  }, [log.dropped, label])

  const copyable = canCopy()
  const copy = () => {
    const text = log.chunks.map((c) => c.text).join('')
    navigator.clipboard.writeText(text).then(
      () => toast('Output copied'),
      () => toast('Copy failed', { type: 'error' }),
    )
  }

  return (
    <div className="nlog">
      <div className="nlog-h">
        <span className="nlog-lbl">
          {label}
          {live && <span className="nlog-live"> · LIVE</span>}
        </span>
        <span className="nlog-grow" />
        {live && (
          <button
            type="button"
            className="nlog-btn"
            aria-pressed={follow}
            onClick={() => setFollow((f) => !f)}
          >
            FOLLOW
          </button>
        )}
        <button
          type="button"
          className="nlog-btn"
          disabled={!copyable || log.chunks.length === 0}
          title={copyable ? undefined : 'Clipboard unavailable on this origin'}
          onClick={copy}
        >
          COPY
        </button>
      </div>
      <div
        ref={boxRef}
        className="nlog-box"
        role="log"
        aria-live="off"
        aria-label={`${label} output`}
        tabIndex={0}
        onScroll={onScroll}
      >
        {log.hasEarlier && (
          <button
            type="button"
            className="nlog-more"
            disabled={log.loadingEarlier}
            onClick={log.loadEarlier}
          >
            {log.loadingEarlier ? 'LOADING…' : 'LOAD EARLIER OUTPUT'}
          </button>
        )}
        {segs.length > 0 ? (
          <pre className="nlog-pre">
            {segs.map((s) => (
              <span
                key={s.key}
                className={
                  s.kind === 'sep'
                    ? 'nlog-sep'
                    : s.stream === 'stderr'
                      ? 'nlog-err'
                      : undefined
                }
              >
                {s.text}
              </span>
            ))}
          </pre>
        ) : (
          <div className="nlog-empty">
            {log.loading
              ? 'Loading output…'
              : log.error
                ? 'Could not load the output log.'
                : live
                  ? 'Waiting for output…'
                  : 'No output was captured for this step.'}
          </div>
        )}
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {said}
      </span>
      <span className="nlog-meta">
        {lines} line{lines === 1 ? '' : 's'}
        {hasErr && ' · stderr tinted'}
        {log.dropped && ' · oldest output dropped (512KB limit)'}
      </span>
    </div>
  )
})
