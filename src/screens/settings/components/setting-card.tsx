import type { ReactNode } from 'react'

type SettingCardProps = {
  icon?: ReactNode
  title: string
  sub?: string
  children?: ReactNode
  danger?: boolean
}

export function SettingCard({ icon, title, sub, children, danger }: SettingCardProps) {
  return (
    <div className={`card${danger ? ' danger-zone' : ''}`}>
      <h3>
        {icon && <span className="ic">{icon}</span>}
        {title}
        {sub && <span className="sub">{sub}</span>}
      </h3>
      {children}
    </div>
  )
}
