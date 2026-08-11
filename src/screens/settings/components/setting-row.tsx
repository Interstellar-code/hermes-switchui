import { Fragment, cloneElement, isValidElement, useId } from 'react'
import type { ReactElement, ReactNode } from 'react'

type PillProps = {
  /** Display text */
  t: string
  /** Variant key: 'dirty' | 'req' | undefined */
  k?: 'dirty' | 'req'
}

type SettingRowProps = {
  label: string
  desc?: string
  pill?: PillProps
  children?: ReactNode
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
 * Rows with zero or more-than-one children (read-only display rows, rows
 * that wrap a control plus extra markup) fall back to exactly the old
 * behaviour: a plain `<label>` with no `htmlFor`, which renders identically
 * to the old `<div className="lbl">` and associates nothing. That's a no-op,
 * not a regression.
 */
export function SettingRow({ label, desc, pill, children, rowEnd }: SettingRowProps) {
  const autoId = useId()
  const labelId = `${autoId}-label`
  const controlId = `${autoId}-control`

  const singleChild =
    isValidElement(children) && (children as ReactElement).type !== Fragment
      ? (children as ReactElement<Record<string, unknown>>)
      : null

  const control = singleChild
    ? cloneElement(singleChild, {
        id: singleChild.props.id ?? controlId,
        'aria-labelledby': singleChild.props['aria-labelledby'] ?? labelId,
      })
    : children

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
