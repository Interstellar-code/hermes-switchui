import type { FurnitureItem } from '@/features/retro-office/core/types'

export type OfficeLayoutSnapshot = {
  furniture?: FurnitureItem[]
  width?: number
  height?: number
  agents?: unknown[]
  [key: string]: unknown
}
