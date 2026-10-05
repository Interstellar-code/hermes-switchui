/**
 * NodeLog — terminal-style stdout/stderr of one bash/script node (F5b).
 * Live while the node runs (auto-scroll with a FOLLOW toggle), stored history
 * once it has finished. Used by the node panel and the Inspect OUTPUT tab.
 */
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import '@/styles/node-log.css'
import { useNodeLog } from './use-node-log'
import type { SubscribeNodeLog } from '@/screens/workflows/use-workflow-events'

/** Node types whose executors stream `node_log`. */
export const LOG_TYPES = new Set(['bash', 'script'])

// clipboard is undefined on insecure (http) origins
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
const copy = (text: string) => void navigator.clipboard?.writeText(text)

export function NodeLog({
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
  const boxRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const box = boxRef.current
    if (follow && box) box.scrollTop = box.scrollHeight
  }, [log.chunks, follow])

  // Scrolling up pauses FOLLOW; scrolling back to the bottom resumes it.
  const onScroll = () => {
    const box = boxRef.current
    if (!box) return
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 8
    if (atBottom !== follow) setFollow(atBottom)
  }
  // A node that stops running stops following too (nothing more will arrive).
  useEffect(() => {
    if (!live) setFollow(false)
  }, [live])

  const text = log.chunks.map((c) => c.text).join('')
  const lines = text
    ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
    : 0

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
          disabled={!text}
          onClick={() => copy(text)}
        >
          COPY
        </button>
      </div>
      <div
        ref={boxRef}
        className="nlog-box"
        role="log"
        aria-live="polite"
        aria-label={`${label} output`}
        tabIndex={0}
        onScroll={onScroll}
      >
        {log.chunks.length > 0 ? (
          <pre className="nlog-pre">
            {log.chunks.map((c, i) => (
              <Fragment key={c.seq}>
                {c.first && i > 0 && (
                  <span className="nlog-sep">── resumed ──{'\n'}</span>
                )}
                <span
                  className={c.stream === 'stderr' ? 'nlog-err' : undefined}
                >
                  {c.text}
                </span>
              </Fragment>
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
      <span className="nlog-meta">
        {lines} line{lines === 1 ? '' : 's'}
        {log.chunks.some((c) => c.stream === 'stderr') && ' · stderr tinted'}
        {log.truncated && ' · truncated at 256KB by the engine'}
        {log.partial && ' · older output not loaded'}
      </span>
    </div>
  )
}
