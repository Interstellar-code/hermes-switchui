// Files v2 — Cmd/Ctrl+K file-jump palette.
// Hand-rolled portal (mirrors the createPortal context-menu pattern in
// files-screen) so it inherits the Matrix `--f-*` tokens via data-screen="files".
// Reuses fuzzy/Highlight (files-search) + FIcon/KIND_COLOR/KIND_LABEL/fileKindKey
// (files-icons) from the prior phases — no duplicate search or icon logic.

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  FIcon,
  KIND_COLOR,
  KIND_LABEL,
  SvgIco,
  fileKindKey,
} from './files-icons'
import { Highlight, fuzzy } from './files-search'
import type { FileEntry } from './file-tree'

type PaletteResult = {
  file: FileEntry
  ranges: Array<[number, number]>
  score: number
}

type FilesPaletteProps = {
  files: Array<FileEntry>
  recents: Array<FileEntry>
  onClose: () => void
  onPick: (file: FileEntry) => void
}

export function FilesPalette({
  files,
  recents,
  onClose,
  onPick,
}: FilesPaletteProps) {
  const [query, setQuery] = useState('')
  const [idx, setIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
    }
  }, [])

  const results = useMemo<Array<PaletteResult>>(() => {
    const q = query.trim()
    if (!q) {
      return recents.map((file) => ({ file, ranges: [], score: 0 }))
    }
    return files
      .map((file): PaletteResult | null => {
        const nameMatch = fuzzy(q, file.name)
        const match = nameMatch ?? fuzzy(q, file.path)
        if (!match) return null
        return { file, ranges: nameMatch?.ranges ?? [], score: match.score }
      })
      .filter((r): r is PaletteResult => r !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 40)
  }, [query, files, recents])

  useEffect(() => {
    setIdx(0)
  }, [query])

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIdx((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const chosen = results.at(idx)
      if (!chosen) return
      onPick(chosen.file)
      onClose()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return createPortal(
    <div
      data-screen="files"
      className="pal-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'grid',
        placeItems: 'center',
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        className="pal"
        role="dialog"
        aria-label="Jump to file"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pal-in">
          <SvgIco name="search" size={18} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search files by name or path…"
            aria-label="Search files"
          />
          <span className="esc">ESC</span>
        </div>
        <div className="pal-hint">
          {query.trim()
            ? `${results.length} result${results.length === 1 ? '' : 's'}`
            : 'Recent files'}
        </div>
        <div className="pal-list">
          {results.length === 0 ? (
            <div className="pal-empty">
              {query.trim()
                ? `No files match “${query.trim()}”.`
                : 'No recent files.'}
            </div>
          ) : (
            results.map((r, i) => {
              const kind = fileKindKey(r.file.name)
              return (
                <div
                  key={r.file.path}
                  className={`pal-item ${i === idx ? 'sel' : ''}`}
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => {
                    onPick(r.file)
                    onClose()
                  }}
                >
                  <span className="ic" style={{ color: KIND_COLOR[kind] }}>
                    <FIcon file={r.file} size={15} />
                  </span>
                  <span className="nm">
                    <Highlight text={r.file.name} ranges={r.ranges} />
                  </span>
                  <span className="pk" style={{ color: KIND_COLOR[kind] }}>
                    {KIND_LABEL[kind]}
                  </span>
                  <span className="pth">{r.file.path}</span>
                </div>
              )
            })
          )}
        </div>
        <div className="pal-foot">
          <span>
            <kbd>↑↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
