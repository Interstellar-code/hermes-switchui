import { Fragment, cloneElement, isValidElement, useId } from 'react'
import type { ReactElement, ReactNode } from 'react'

type PillProps = {
  /** Display text */
  t: string
  /** Variant key: 'dirty' | 'req' | undefined */
  k?: 'dirty' | 'req'
}

/** Ids a row exposes so a wrapped control can name itself. */
export type SettingRowIds = {
  /** Id of the row's `<label>`; target of `aria-labelledby`. */
  labelId: string
  /** Id the row's `<label htmlFor>` points at. */
  controlId: string
}

type SettingRowProps = {
  label: string
  desc?: string
  pill?: PillProps
  /**
   * The row's control. Pass a single element and it is named automatically.
   *
   * Pass a function when the control is wrapped in layout markup — a row with
   * an input plus buttons, say. Auto-naming cannot see into a wrapper, so such
   * rows would otherwise announce as unnamed; the function receives the ids to
   * wire up by hand.
   */
  children?: ReactNode | ((ids: SettingRowIds) => ReactNode)
  /** Align control to flex-end */
  rowEnd?: boolean
}

/**
 * `.lbl` used to be a plain `<div>` — no `<label>`, no `htmlFor`, nothing
 * announcing a name to a screen reader. 24 consumers pass exactly one
 * control element as `children` (an `<input>`/`<select>`, or one of
 * `Toggle`/`Segmented`/`NumberSlider`/`PasswordField` from `controls.tsx`),
 * so that single child is the association target: it gets `id` (for a real
 * `<label htmlFor>`) and `aria-labelledby` (so composite widgets like
 * `Segmented`'s `role="radiogroup"`, which a `label[for]` can't legally
 * target, still get a name). Both are only filled in when the child hasn't
 * already set its own — nothing here can clobber an explicit id a caller
 * assigned.
 *
 * Rows with zero or more-than-one children (read-only display rows) fall back
 * to exactly the old behaviour: a plain `<label>` with no `htmlFor`, which
 * renders identically to the old `<div className="lbl">` and associates
 * nothing. That's a no-op, not a regression.
 *
 * Rows whose control is wrapped in layout markup — an input plus Save/Cancel
 * buttons, say — cannot be reached by that clone, and so stayed unnamed. They
 * pass a function as `children` instead and wire the ids up themselves.
 */
export function SettingRow({ label, desc, pill, children, rowEnd }: SettingRowProps) {
  const autoId = useId()
  const labelId = `${autoId}-label`
  const controlId = `${autoId}-control`

  // A render-prop child names itself, so auto-association is skipped entirely.
  const rendered =
    typeof children === 'function'
      ? (children as (ids: SettingRowIds) => ReactNode)({ labelId, controlId })
      : children

  const singleChild =
    typeof children !== 'function' &&
    isValidElement(rendered) &&
    (rendered as ReactElement).type !== Fragment
      ? (rendered as ReactElement<Record<string, unknown>>)
      : null

  const control = singleChild
    ? cloneElement(singleChild, {
        id: singleChild.props.id ?? controlId,
        'aria-labelledby': singleChild.props['aria-labelledby'] ?? labelId,
      })
    : rendered

  return (
    <div className="row">
      <label className="lbl" id={labelId} htmlFor={singleChild ? controlId : undefined}>
        {label}
        {pill && (
          <span className={`pill${pill.k ? ` ${pill.k}` : ''}`}>{pill.t}</span>
        )}
        {desc && <span className="desc">{desc}</span>}
      </label>
      <div className={`ctl${rowEnd ? ' row-end' : ''}`}>{control}</div>
    </div>
  )
}
