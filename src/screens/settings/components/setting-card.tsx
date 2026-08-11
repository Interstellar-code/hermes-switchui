import type { ReactNode } from 'react'

type SettingCardProps = {
  icon?: ReactNode
  title: string
  sub?: string
  children?: ReactNode
  danger?: boolean
  /**
   * Optional. `'self'` marks a card whose controls write immediately and are
   * therefore not covered by the save bar. Omitting it (the default) renders
   * exactly as before.
   */
  saves?: 'store' | 'self'
}

export function SettingCard({ icon, title, sub, children, danger, saves }: SettingCardProps) {
  return (
    <div className={`card${danger ? ' danger-zone' : ''}`} data-saves={saves}>
      <h3>
        {icon && <span className="ic">{icon}</span>}
        {title}
        {sub && <span className="sub">{sub}</span>}
        {saves === 'self' && <span className="sub">Saves immediately</span>}
      </h3>
      {children}
    </div>
  )
}
