import type { ReactNode } from 'react'

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

export function SettingRow({ label, desc, pill, children, rowEnd }: SettingRowProps) {
  return (
    <div className="row">
      <div className="lbl">
        {label}
        {pill && (
          <span className={`pill${pill.k ? ` ${pill.k}` : ''}`}>{pill.t}</span>
        )}
        {desc && <span className="desc">{desc}</span>}
      </div>
      <div className={`ctl${rowEnd ? ' row-end' : ''}`}>{children}</div>
    </div>
  )
}
