/**
 * use-focus-trap.ts — the missing half of `role="dialog" aria-modal="true"` (P-16).
 *
 * Used by the hand-rolled dialogs that cannot be Radix. The profile dialogs
 * (`.wiz-modal`, `.pf-confirm`) have to stay that way: `.wiz-modal` and
 * `.wiz-backdrop` are declared *inside* the `[data-screen="profiles"]` block in
 * matrix-profiles.css, so a Radix `Dialog.Portal` — which mounts to
 * `document.body` — would render them completely unstyled. The shared
 * `ui/confirm-dialog.tsx` stays hand-rolled for a different reason: it must
 * stack *above* surfaces that already sit at z-9999+ (Update Center), which
 * Radix's fixed `z-50` cannot do.
 *
 * What Radix would have given us for free is therefore implemented here once:
 * initial focus, a Tab cycle, Escape, and focus restore.
 *
 * Nesting matters: the wizard opens `ConfirmDialog` on top of itself, so both
 * traps are mounted at the same time. A module-level stack makes only the
 * topmost one respond to keys, otherwise one Escape would cancel the
 * confirmation *and* the wizard behind it.
 */

import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * Focusable descendants in DOM order.
 *
 * Deliberately does not consult layout (`offsetParent`, `getClientRects`):
 * jsdom reports every element as unlaid-out, which would make this return an
 * empty list in every test. These dialogs never hide subtrees with CSS, so the
 * attribute checks below are sufficient in practice.
 */
export function focusableWithin(root: HTMLElement): Array<HTMLElement> {
  return Array.from(
    root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(
    (el) =>
      !el.hasAttribute('hidden') &&
      el.getAttribute('aria-hidden') !== 'true' &&
      el.tabIndex !== -1,
  )
}

/** Innermost-last. Only the last entry reacts to Tab/Escape. */
const trapStack: Array<HTMLElement> = []

export function useFocusTrap(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  onEscape?: () => void,
): void {
  // Held in a ref so a fresh `onEscape` identity each render does not tear the
  // trap down and re-run initial focus, which would yank the caret out of
  // whatever the user was typing in.
  const escapeRef = useRef(onEscape)
  escapeRef.current = onEscape

  useEffect(() => {
    if (!open) return
    const node = ref.current
    if (!node) return

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null

    trapStack.push(node)

    const initial = focusableWithin(node)
    if (initial.length > 0) {
      initial[0].focus()
    } else {
      // Nothing focusable yet (async body) — park focus on the dialog itself so
      // it is never left behind on the page underneath.
      node.setAttribute('tabindex', '-1')
      node.focus()
    }

    function onKeyDown(event: KeyboardEvent) {
      if (trapStack[trapStack.length - 1] !== node) return

      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        escapeRef.current?.()
        return
      }
      if (event.key !== 'Tab') return

      const items = focusableWithin(node)
      if (items.length === 0) {
        event.preventDefault()
        return
      }
      const firstItem = items[0]
      const lastItem = items[items.length - 1]
      const active =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null

      if (!active || !node.contains(active)) {
        event.preventDefault()
        firstItem.focus()
        return
      }
      if (event.shiftKey && active === firstItem) {
        event.preventDefault()
        lastItem.focus()
      } else if (!event.shiftKey && active === lastItem) {
        event.preventDefault()
        firstItem.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)

    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      const at = trapStack.lastIndexOf(node)
      if (at !== -1) trapStack.splice(at, 1)
      // Focus goes back to whatever opened the dialog — unless that element is
      // gone (a card that was just deleted or re-rendered), in which case the
      // browser's own fallback to <body> is the honest outcome.
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [open, ref])
}
