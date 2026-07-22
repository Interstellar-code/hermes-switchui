'use client'

/**
 * DiffView — renders a unified diff string with +/- line coloring.
 * No external dependencies; uses simple line-by-line classification.
 */

interface DiffViewProps {
  diff: string
  className?: string
}

export interface DiffRow {
  before: string | null
  after: string | null
  kind: 'context' | 'change'
}

/**
 * Converts a unified diff into aligned changed hunks. The plugin intentionally
 * stores a diff rather than full file snapshots, so context outside each hunk
 * is not invented here.
 */
export function parseSplitDiff(diff: string): Array<DiffRow> {
  const rows: Array<DiffRow> = []
  let deleted: Array<string> = []
  let added: Array<string> = []

  const flushChanges = () => {
    const length = Math.max(deleted.length, added.length)
    for (let index = 0; index < length; index += 1) {
      rows.push({
        before: deleted[index] ?? null,
        after: added[index] ?? null,
        kind: 'change',
      })
    }
    deleted = []
    added = []
  }

  for (const line of diff.split('\n')) {
    if (
      line.startsWith('diff ') ||
      line.startsWith('index ') ||
      line.startsWith('---') ||
      line.startsWith('+++')
    ) {
      continue
    }
    if (line.startsWith('@@')) {
      flushChanges()
      rows.push({ before: line, after: line, kind: 'context' })
    } else if (line.startsWith('-')) {
      deleted.push(line.slice(1))
    } else if (line.startsWith('+')) {
      added.push(line.slice(1))
    } else {
      flushChanges()
      rows.push({
        before: line.startsWith(' ') ? line.slice(1) : line,
        after: line.startsWith(' ') ? line.slice(1) : line,
        kind: 'context',
      })
    }
  }
  flushChanges()
  return rows
}

export function SplitDiffView({ diff, className }: DiffViewProps) {
  const rows = parseSplitDiff(diff)
  if (!diff || rows.length === 0) {
    return (
      <div className={`si-diff-empty ${className ?? ''}`}>
        No diff available
      </div>
    )
  }

  return (
    <div className={`si-split-diff ${className ?? ''}`}>
      <div className="si-split-diff-head" aria-hidden>
        <span>Original</span>
        <span>Proposed</span>
      </div>
      <div className="si-split-diff-body" aria-label="Proposed file changes">
        {rows.map((row, index) => (
          <div
            key={`${index}-${row.before ?? ''}-${row.after ?? ''}`}
            className={`si-split-diff-row si-split-diff-row--${row.kind}`}
          >
            {row.kind === 'context' ? (
              <code>{row.before ?? ''}</code>
            ) : (
              <>
                <code className="si-split-diff-before">{row.before ?? ''}</code>
                <code className="si-split-diff-after">{row.after ?? ''}</code>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export function DiffView({ diff, className }: DiffViewProps) {
  if (!diff) {
    return (
      <div className={`si-diff-empty ${className ?? ''}`}>
        No diff available
      </div>
    )
  }

  const lines = diff.split('\n')

  return (
    <div className={`si-diff-root ${className ?? ''}`}>
      <pre className="si-diff-pre">
        {lines.map((line, i) => {
          let cls = 'si-diff-line'
          if (line.startsWith('+++') || line.startsWith('---')) {
            cls += ' si-diff-line--file'
          } else if (line.startsWith('@@')) {
            cls += ' si-diff-line--hunk'
          } else if (line.startsWith('+')) {
            cls += ' si-diff-line--add'
          } else if (line.startsWith('-')) {
            cls += ' si-diff-line--del'
          } else {
            cls += ' si-diff-line--ctx'
          }
          return (
            <span key={i} className={cls}>
              {line}
              {'\n'}
            </span>
          )
        })}
      </pre>
    </div>
  )
}
