import { useEffect, useMemo, useRef } from 'react'
import { useRunDefinition } from '../run-definition-client'
import { toEpochMs } from '../run-status'
import { useWorkflowParsed } from '../use-workflows'
import { yamlBlockRange } from './events-model'
import { fmtDateTime } from './inspector-model'
import type { InspectorCtx } from './inspector-model'

function YamlLine({ text }: { text: string }) {
  if (/^\s*#/.test(text)) return <span className="y-c">{text}</span>
  const m = /^(\s*(?:-\s+)?)([\w.-]+)(:)(.*)$/.exec(text)
  if (!m) return <>{text}</>
  return (
    <>
      {m[1]}
      <span className="y-k">{m[2]}</span>
      {m[3]}
      {m[4]}
    </>
  )
}

export function DefinitionTab({ ctx }: { ctx: InspectorCtx }) {
  const { run, nodeRuns, features, runId } = ctx
  const pinFeature = features.includes('definition_pin')
  const pinnedQ = useRunDefinition(runId, pinFeature)
  const currentQ = useWorkflowParsed(run.workflow_id)
  const pinned =
    pinnedQ.data && pinnedQ.data.available ? pinnedQ.data.definition : null
  const current = currentQ.data?.definition
  const yaml = pinned?.yaml ?? current?.yaml ?? ''
  const failed = nodeRuns.find(
    (n) => n.status === 'failed' && n.loop_iteration == null,
  )
  const range = useMemo(
    () => (failed && yaml ? yamlBlockRange(yaml, failed.dag_node_id) : null),
    [failed, yaml],
  )
  const lines = useMemo(() => yaml.split('\n'), [yaml])
  const hlRef = useRef<HTMLSpanElement>(null)
  const yamlRef = useRef<HTMLDivElement>(null)
  // Scroll only the YAML box; scrollIntoView would also scroll the drawer/page.
  useEffect(() => {
    const box = yamlRef.current
    const hl = hlRef.current
    if (!box || !hl) return
    const b = box.getBoundingClientRect()
    const h = hl.getBoundingClientRect()
    box.scrollTop += h.top - b.top - (box.clientHeight - h.height) / 2
  }, [range?.start, yaml])

  if ((pinFeature && pinnedQ.isLoading) || currentQ.isLoading)
    return <div className="wfri-empty">Loading definition…</div>
  if (!yaml)
    return (
      <div className="wfri-empty">
        Definition for {run.workflow_id} is not available.
      </div>
    )

  const isPinned = pinned?.pinned === true
  const pinError = pinFeature && pinnedQ.isError
  const checksum = pinned?.checksum ?? current?.checksum ?? null
  const version = pinned?.version ?? current?.version ?? null
  const updated = current?.updated_at
  const updatedMs = toEpochMs(pinned?.current_updated_at ?? updated)
  const startedMs = toEpochMs(run.started_at)
  const changed =
    isPinned &&
    pinned.current_checksum != null &&
    pinned.current_checksum !== pinned.checksum

  return (
    <div className="wfri-def">
      <div className="wfri-dm">
        <span>
          version <b>{version ?? 'n/a'}</b>
        </span>
        <span>
          checksum <b>{checksum ? `${checksum.slice(0, 12)}…` : 'n/a'}</b>
        </span>
        <span>
          source <b>{isPinned ? 'snapshot' : (current?.source ?? 'current')}</b>
        </span>
        <span>
          updated <b>{updatedMs ? fmtDateTime(updatedMs) : 'n/a'}</b>
        </span>
        <span className="wfri-grow" />
        <span>read-only</span>
      </div>
      <div className="wfri-note wfri-note--banner" role="note">
        {pinError ? (
          <>
            Pinned definition unavailable — showing current.{' '}
            <button
              type="button"
              className="wfri-btn"
              disabled={pinnedQ.isFetching}
              onClick={() => void pinnedQ.refetch()}
            >
              RETRY
            </button>
          </>
        ) : isPinned ? (
          <>
            Definition as run · checksum {checksum?.slice(0, 12)}.
            {changed ? ' The workflow has changed since this run.' : ''}
          </>
        ) : (
          <>
            Graph shown is the current definition. Runs don't pin a version, so
            if this YAML is edited later the graph for this run will change too.
            {updatedMs && startedMs
              ? ` Last edit (${fmtDateTime(updatedMs).split(' · ')[0]}) is ${updatedMs <= startedMs ? 'before' : 'after'} this run started.`
              : ''}
          </>
        )}
      </div>
      <div
        ref={yamlRef}
        className="wfri-yaml"
        role="region"
        aria-label="Workflow definition YAML"
        tabIndex={0}
      >
        {lines.map((text, i) => {
          const n = i + 1
          const hl = range != null && n >= range.start && n <= range.end
          return (
            <span
              key={n}
              ref={range && n === range.start ? hlRef : undefined}
              className={`wfri-yl${hl ? ' hl' : ''}`}
            >
              <span className="n" aria-hidden="true">
                {n}
              </span>
              <span className="c">
                <YamlLine text={text} />
              </span>
            </span>
          )
        })}
      </div>
      <div className="wfri-fb">
        <button
          type="button"
          className="wfri-btn"
          // clipboard is undefined on insecure (http) origins
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          onClick={() => void navigator.clipboard?.writeText(yaml)}
        >
          COPY YAML
        </button>
        <a
          className="wfri-btn"
          href={`/workflows?wf=${encodeURIComponent(run.workflow_id)}`}
        >
          OPEN IN EDITOR
        </a>
        <span className="wfri-grow" />
        <span className="wfri-meta">
          {lines.length} lines
          {range ? ` · ${failed?.dag_node_id} highlighted` : ''}
        </span>
      </div>
    </div>
  )
}
