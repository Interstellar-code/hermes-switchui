'use client'

/**
 * DiffView — renders a unified diff string with +/- line coloring.
 * No external dependencies; uses simple line-by-line classification.
 */

interface DiffViewProps {
  diff: string
  className?: string
}

export function DiffView({ diff, className }: DiffViewProps) {
  if (!diff) {
    return <div className={`si-diff-empty ${className ?? ''}`}>No diff available</div>
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
