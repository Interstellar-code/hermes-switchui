/**
 * SOURCE step of the create wizard: five ways to start a workflow.
 * describe (chat pane injected by the wizard — redesign is F7), template,
 * duplicate, import YAML, blank.
 */
import {
  cloneElement,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { WorkflowEngineUnavailableError } from '../api-client'
import { IdField } from './id-field'
import { SavedGraphPreview } from './graph-preview'
import { shortIssueMessage, suggestFreeIds } from './yaml-lint'
import type { ReactElement, ReactNode } from 'react'
import type { LintIssue } from './yaml-lint'
import type { IdStatus } from './use-wizard-validation'
import type { WorkflowSummary } from '../types'

export type SourceKind =
  | 'describe'
  | 'template'
  | 'duplicate'
  | 'import'
  | 'blank'

export const BLANK_YAML = `name: My Workflow
description: New workflow
nodes:
  - id: start
    prompt: "Hello"
`

const OPTIONS: Array<{
  kind: SourceKind
  title: string
  desc: (n: number) => string
  badge?: string
}> = [
  {
    kind: 'describe',
    title: 'Describe with AI',
    desc: () => 'Chat it into shape. The graph draws itself as you refine.',
    badge: 'RECOMMENDED',
  },
  {
    kind: 'template',
    title: 'From a template',
    desc: () => 'Preview a factory or project graph, then adapt it.',
  },
  {
    kind: 'duplicate',
    title: 'Duplicate existing',
    desc: (n) => `Copy one of your ${n} workflows under a new id.`,
  },
  {
    kind: 'import',
    title: 'Import YAML',
    desc: () => 'Paste or choose a file. Checked line by line first.',
  },
  {
    kind: 'blank',
    title: 'Blank canvas',
    desc: () => 'One prompt node. Build the graph yourself.',
  },
]

interface SourceStepProps {
  kind: SourceKind
  onKind: (k: SourceKind) => void
  describePane: ReactNode
  workflows: Array<WorkflowSummary> | undefined
  workflowsLoading: boolean
  workflowsError: Error | null
  onRetryWorkflows: () => void
  selectedWorkflowId: string
  onSelectWorkflow: (id: string) => void
  id: string
  onIdChange: (id: string) => void
  idStatus: IdStatus
  takenIds: ReadonlySet<string> | null
  importText: string
  importFileName: string | null
  onImportText: (text: string, fileName?: string | null) => void
  importIssues: Array<LintIssue>
  importTooLarge: boolean
}

function EngineDown({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="wfl-error" role="alert">
      <b>Workflow engine unavailable.</b> Templates and existing workflows can’t
      be listed right now. ·{' '}
      <button type="button" className="wfl-link" onClick={onRetry}>
        Retry
      </button>
      <br />
      You can still describe, import or start from a blank canvas.
    </div>
  )
}

function Picker({
  mode,
  workflows,
  loading,
  error,
  onRetry,
  selectedId,
  onSelect,
  id,
  onIdChange,
  idStatus,
  takenIds,
}: {
  mode: 'template' | 'duplicate'
  workflows: Array<WorkflowSummary> | undefined
  loading: boolean
  error: Error | null
  onRetry: () => void
  selectedId: string
  onSelect: (id: string) => void
  id: string
  onIdChange: (id: string) => void
  idStatus: IdStatus
  takenIds: ReadonlySet<string> | null
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'bundled' | 'project'>('all')
  const pool = useMemo(
    () =>
      (workflows ?? []).filter((w) =>
        w.kind === 'subgraph'
          ? false
          : mode === 'template'
            ? w.source === 'bundled' || w.source === 'project'
            : true,
      ),
    [workflows, mode],
  )
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return pool.filter(
      (w) =>
        (filter === 'all' || w.source === filter) &&
        (!q ||
          [w.id, w.name, w.description].join(' ').toLowerCase().includes(q)),
    )
  }, [pool, query, filter])
  const selected = pool.find((w) => w.id === selectedId) ?? null
  const noun = mode === 'template' ? 'templates' : 'workflows'
  const counts = {
    all: pool.length,
    bundled: pool.filter((w) => w.source === 'bundled').length,
    project: pool.filter((w) => w.source === 'project').length,
  }
  const engineDown = error instanceof WorkflowEngineUnavailableError

  return (
    <div className="wz2-picker">
      <section className="wz2-list" aria-label={noun}>
        <label className="wfl-label" htmlFor={`wz2-q-${mode}`}>
          Search {noun}
        </label>
        <input
          id={`wz2-q-${mode}`}
          className="wfl-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${noun}…`}
        />
        {mode === 'template' && (
          <div className="wfl-chips" role="group" aria-label="Filter">
            {(['all', 'bundled', 'project'] as const).map((f) => (
              <button
                key={f}
                type="button"
                className={`wfl-chip${filter === f ? ' is-on' : ''}`}
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
              >
                {f === 'bundled' ? 'factory' : f} {counts[f]}
              </button>
            ))}
          </div>
        )}
        {loading ? (
          <div className="wfl-skeletons" aria-label={`Loading ${noun}`}>
            {[88, 72, 80, 64].map((w) => (
              <div
                key={w}
                className="wfl-skeleton wz2-sk-row"
                style={{ width: `${w}%` }}
              />
            ))}
          </div>
        ) : engineDown ? (
          <EngineDown onRetry={onRetry} />
        ) : error ? (
          <div className="wfl-error" role="alert">
            Couldn’t load {noun} ·{' '}
            <button type="button" className="wfl-link" onClick={onRetry}>
              Retry
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className="wfl-empty">No {noun} match.</div>
        ) : (
          <div
            className="wz2-rows"
            role="radiogroup"
            aria-label={`${mode} options`}
          >
            {rows.map((w) => (
              <label
                key={w.id}
                className={`wz2-row${w.id === selectedId ? ' is-sel' : ''}`}
              >
                <input
                  type="radio"
                  name={`wz2-pick-${mode}`}
                  checked={w.id === selectedId}
                  onChange={() => onSelect(w.id)}
                  aria-label={w.name || w.id}
                />
                <span className="wz2-row-n">
                  <span className="wz2-row-name">{w.name || w.id}</span>
                  <span className="wz2-chip ok">
                    {w.source === 'bundled'
                      ? 'FACTORY'
                      : w.source.toUpperCase()}
                  </span>
                </span>
                <span className="wfl-card-desc">{w.description || w.id}</span>
                <span className="wfl-meta">{w.node_count} nodes</span>
              </label>
            ))}
          </div>
        )}
      </section>
      <section className="wz2-det" aria-label={`${mode} preview`}>
        {selected ? (
          <>
            <div className="wz2-det-hd">
              <b>{selected.name || selected.id}</b>
              {selected.has_approval && (
                <span className="wz2-chip wa">APPROVAL</span>
              )}
              <span className="wfl-grow" />
              <span className="wfl-meta">{selected.node_count} nodes</span>
            </div>
            {selected.description && (
              <span className="wfl-desc">{selected.description}</span>
            )}
            <SavedGraphPreview id={selected.id} />
            <div className="wz2-boxes">
              <div className="wfl-box">
                <span className="wfl-label">Inputs</span>
                {[...selected.required_inputs, ...selected.optional_inputs]
                  .length === 0 ? (
                  <span className="wfl-hint">none</span>
                ) : (
                  <>
                    {selected.required_inputs.map((n) => (
                      <span key={n} className="wfl-hint">
                        <code>{n}</code> · required
                      </span>
                    ))}
                    {selected.optional_inputs.map((n) => (
                      <span key={n} className="wfl-hint">
                        <code>{n}</code> · optional
                      </span>
                    ))}
                  </>
                )}
              </div>
            </div>
            <IdField
              inputId={`wz2-id-${mode}`}
              value={id}
              onChange={onIdChange}
              status={idStatus}
              suggestions={suggestFreeIds(id, takenIds)}
              note={`copies all ${selected.node_count} nodes; the ${mode === 'template' ? 'template' : 'original'} stays untouched`}
            />
          </>
        ) : (
          <div className="wz2-det-empty">
            Pick {mode === 'template' ? 'a template' : 'a workflow'} to preview
            its graph.
          </div>
        )}
      </section>
    </div>
  )
}

function CodeView({
  text,
  issues,
}: {
  text: string
  issues: Array<LintIssue>
}) {
  const lines = text.split('\n')
  const bad = new Map<number, LintIssue>()
  for (const i of issues)
    if (i.line != null && !bad.has(i.line)) bad.set(i.line, i)
  return (
    <div className="wz2-code" aria-label="YAML with error markers" role="list">
      {lines.map((l, i) => {
        const n = i + 1
        const msg = bad.get(n)
        if (
          !msg &&
          lines.length > 14 &&
          ![...bad.keys()].some((b) => Math.abs(b - n) <= 1)
        )
          return null
        return (
          <div
            key={n}
            role="listitem"
            className={`wz2-yl${msg ? ' is-bad' : ''}`}
            data-line={n}
          >
            <span className="wz2-yn">{n}</span>
            <span className="wz2-yt">{l || ' '}</span>
            {msg && <span className="wz2-ym">← {shortIssueMessage(msg)}</span>}
          </div>
        )
      })}
    </div>
  )
}

function ImportPane({
  text,
  fileName,
  onText,
  issues,
  tooLarge,
  id,
  onIdChange,
  idStatus,
  takenIds,
}: {
  text: string
  fileName: string | null
  onText: (t: string, f?: string | null) => void
  issues: Array<LintIssue>
  tooLarge: boolean
  id: string
  onIdChange: (id: string) => void
  idStatus: IdStatus
  takenIds: ReadonlySet<string> | null
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)

  function jump(line: number | null) {
    const el = areaRef.current
    if (!el || line == null) return
    const lines = el.value.split('\n')
    const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0)
    el.focus()
    el.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0))
  }

  return (
    <div className="wz2-import">
      <div className="wz2-imp-hd">
        <label className="wfl-label" htmlFor="wz2-yaml">
          YAML
        </label>
        <span className="wfl-grow" />
        {fileName && <span className="wfl-meta">{fileName}</span>}
        {tooLarge ? (
          <span className="wz2-chip er">TOO LARGE</span>
        ) : issues.length > 0 ? (
          <span className="wz2-chip er">
            {issues.length} ERROR{issues.length === 1 ? '' : 'S'}
          </span>
        ) : text.trim() ? (
          <span className="wz2-chip ok">VALID</span>
        ) : null}
        <button
          type="button"
          className="wfw-btn wfw-btn--secondary wz2-sm"
          onClick={() => fileRef.current?.click()}
        >
          Choose .yaml file
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".yml,.yaml,text/yaml"
          aria-label="YAML file"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (!f) return
            void f.text().then((t) => onText(t, f.name))
            e.target.value = ''
          }}
        />
      </div>
      <textarea
        id="wz2-yaml"
        ref={areaRef}
        className="wfl-input wz2-yaml"
        value={text}
        spellCheck={false}
        aria-invalid={issues.length > 0}
        placeholder="Paste a workflow definition here…"
        onChange={(e) => onText(e.target.value, fileName)}
      />
      {tooLarge && (
        <div className="wz2-ban er" role="alert">
          <b>This YAML is larger than 1 MiB.</b> The server rejects definitions
          over 1 MiB — trim it down and paste again.
        </div>
      )}
      {!tooLarge && issues.length > 0 && (
        <>
          <CodeView text={text} issues={issues} />
          <ul className="wz2-errs" role="list" aria-label="YAML errors">
            {issues.map((i, k) => (
              <li key={`${i.line}-${i.code}-${k}`}>
                <span className="wz2-bad">✗</span>
                {i.line != null ? (
                  <button
                    type="button"
                    className="wfl-link"
                    onClick={() => jump(i.line)}
                  >
                    Line {i.line}
                  </button>
                ) : (
                  <span className="wfl-meta">{i.node_id ?? 'yaml'}</span>
                )}
                <span>{i.message}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {!tooLarge && issues.length === 0 && text.trim() && (
        <IdField
          inputId="wz2-id-import"
          value={id}
          onChange={onIdChange}
          status={idStatus}
          suggestions={suggestFreeIds(id, takenIds)}
        />
      )}
    </div>
  )
}

function isTyping(t: HTMLElement | null): boolean {
  if (!t) return false
  if (t.tagName === 'INPUT') return (t as HTMLInputElement).type !== 'radio'
  return (
    t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable
  )
}

export function SourceStep(p: SourceStepProps) {
  const { onKind } = p
  // 1–5 pick a source (not while typing in a field).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isTyping(e.target as HTMLElement | null)) return
      const idx = Number(e.key) - 1
      if (idx >= 0 && idx < OPTIONS.length) {
        e.preventDefault()
        onKind(OPTIONS[idx].kind)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onKind])

  const count = (p.workflows ?? []).filter((w) => w.kind !== 'subgraph').length
  return (
    <div className="wz2-source">
      <fieldset className="wz2-opts">
        <legend className="wfl-label">Start from</legend>
        {OPTIONS.map((o, i) => (
          <label
            key={o.kind}
            className={`wz2-opt${p.kind === o.kind ? ' is-sel' : ''}`}
          >
            <input
              type="radio"
              name="wz2-source"
              checked={p.kind === o.kind}
              aria-label={o.title}
              value={o.kind}
              onClick={() => p.onKind(o.kind)}
              onChange={() => p.onKind(o.kind)}
            />
            <span className="wz2-opt-b">
              <span className="wz2-opt-t">
                {o.title}
                {o.badge && <span className="wz2-chip ok">{o.badge}</span>}
                <span className="wz2-kb" aria-hidden="true">
                  {i + 1}
                </span>
              </span>
              <span className="wfl-hint">{o.desc(count)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="wz2-pane">
        {p.kind === 'describe' &&
          (isValidElement(p.describePane)
            ? cloneElement(
                p.describePane as ReactElement<{
                  onSwitchToTemplate?: () => void
                }>,
                {
                  onSwitchToTemplate: () => p.onKind('template'),
                },
              )
            : p.describePane)}
        {(p.kind === 'template' || p.kind === 'duplicate') && (
          <Picker
            key={p.kind}
            mode={p.kind}
            workflows={p.workflows}
            loading={p.workflowsLoading}
            error={p.workflowsError}
            onRetry={p.onRetryWorkflows}
            selectedId={p.selectedWorkflowId}
            onSelect={p.onSelectWorkflow}
            id={p.id}
            onIdChange={p.onIdChange}
            idStatus={p.idStatus}
            takenIds={p.takenIds}
          />
        )}
        {p.kind === 'import' && (
          <ImportPane
            text={p.importText}
            fileName={p.importFileName}
            onText={p.onImportText}
            issues={p.importIssues}
            tooLarge={p.importTooLarge}
            id={p.id}
            onIdChange={p.onIdChange}
            idStatus={p.idStatus}
            takenIds={p.takenIds}
          />
        )}
        {p.kind === 'blank' && (
          <div className="wz2-blank">
            <span className="wz2-h2">Blank canvas</span>
            <span className="wfl-desc">
              One prompt node. Build the rest of the graph in the next steps.
            </span>
            <pre className="wz2-pre" aria-label="Skeleton YAML">
              {BLANK_YAML}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}
