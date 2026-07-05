import type { FurnitureItem } from '@/features/retro-office/core/types'

export type OfficeLayoutSnapshot = {
  furniture?: Array<FurnitureItem>
  width?: number
  height?: number
  agents?: Array<unknown>
  [key: string]: unknown
}
