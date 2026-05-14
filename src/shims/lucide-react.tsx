import type { SVGProps } from 'react'

function Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="8" />
    </svg>
  )
}

export const Pencil = Icon
export const Check = Icon
export const Map = Icon
export const Maximize = Icon
export const Monitor = Icon
export const Armchair = Icon
export const Settings2 = Icon
export const Camera = Icon
export const UserPlus = Icon
export const Trash2 = Icon
export const Users = Icon
export const X = Icon
export const MessageSquare = Icon
export const ChevronDown = Icon
export const ChevronLeft = Icon
export const ChevronRight = Icon
export const Mic = Icon
