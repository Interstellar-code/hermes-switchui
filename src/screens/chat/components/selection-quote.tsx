import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { TextQuote } from 'lucide-react'
import type { RefObject } from 'react'

// Selected text when the whole selection sits inside `container`, else ''.
// Newlines are kept — quotes carry code and multi-line passages verbatim.
export function getContainedSelectionText(
  container: HTMLElement | null,
): string {
  if (typeof window === 'undefined' || !container) return ''
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed) return ''
  const { anchorNode, focusNode } = selection
  if (
    !anchorNode ||
    !focusNode ||
    !container.contains(anchorNode) ||
    !container.contains(focusNode)
  )
    return ''
  return selection.toString().trim() ? selection.toString() : ''
}

export function isQuoteShortcut(event: KeyboardEvent): boolean {
  return (
    (event.metaKey || event.ctrlKey) &&
    event.shiftKey &&
    !event.altKey &&
    event.code === 'KeyQ'
  )
}

type Anchor = { top: number; left: number; text: string }

// Floating "Quote" button over a selection inside `bubbleRef`, plus the
// Cmd/Ctrl+Shift+Q shortcut. Document listeners are attached only while this
// bubble owns a selection, so idle messages cost nothing.
export function useSelectionQuote(
  bubbleRef: RefObject<HTMLElement | null>,
  onQuote: ((text: string) => void) | undefined,
) {
  const [anchor, setAnchor] = useState<Anchor | null>(null)

  const capture = useCallback(() => {
    if (!onQuote) return
    const text = getContainedSelectionText(bubbleRef.current)
    const range = text ? window.getSelection()?.getRangeAt(0) : null
    if (!text || !range) {
      setAnchor(null)
      return
    }
    const rect = range.getBoundingClientRect()
    setAnchor({ top: rect.top, left: rect.left + rect.width / 2, text })
  }, [bubbleRef, onQuote])

  const quote = useCallback(() => {
    if (!anchor || !onQuote) return
    onQuote(anchor.text)
    setAnchor(null)
    window.getSelection()?.removeAllRanges()
  }, [anchor, onQuote])

  useEffect(() => {
    if (!anchor) return
    const hide = () => setAnchor(null)
    const onSelectionChange = () => {
      if (!getContainedSelectionText(bubbleRef.current)) hide()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide()
      else if (isQuoteShortcut(event)) {
        event.preventDefault()
        quote()
      }
    }
    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [anchor, bubbleRef, quote])

  const button =
    anchor && typeof document !== 'undefined'
      ? createPortal(
          <button
            type="button"
            // Keep the selection alive through the click.
            onMouseDown={(event) => event.preventDefault()}
            onClick={quote}
            title="Quote selection (⌘/Ctrl+Shift+Q)"
            className="fixed z-50 flex -translate-x-1/2 -translate-y-full items-center gap-1 rounded-md border border-border bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-md hover:bg-muted"
            style={{ top: anchor.top - 6, left: anchor.left }}
          >
            <TextQuote className="size-3.5 text-amber-500" aria-hidden="true" />
            Quote
          </button>,
          document.body,
        )
      : null

  return { capture, button }
}
