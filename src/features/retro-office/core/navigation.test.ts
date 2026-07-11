import { describe, expect, it } from 'vitest'

import { materializeDefaults } from '@/features/retro-office/core/furnitureDefaults'
import {
  ROAM_POINTS,
  astar,
  buildNavGrid,
  getDeskLocations,
  getGymWorkoutLocations,
  resolveGymRoute,
} from '@/features/retro-office/core/navigation'

describe('retro office navigation', () => {
  it('keeps default gym workout spots connected to office desks', () => {
    const furniture = materializeDefaults('office')
    const grid = buildNavGrid(furniture)
    const [desk] = getDeskLocations(furniture)
    const gymWorkoutLocations = getGymWorkoutLocations(furniture)

    expect(gymWorkoutLocations.map((spot) => spot.workoutStyle)).toEqual([
      'run', 'lift', 'lift', 'row', 'lift', 'bike', 'box', 'stretch',
    ])

    for (const gymSpot of gymWorkoutLocations) {
      const path = astar(gymSpot.x, gymSpot.y, desk.x, desk.y, grid)

      expect(path.length, JSON.stringify(gymSpot)).toBeGreaterThan(0)
      expect(path.at(-1)).toEqual({ x: desk.x, y: desk.y })
    }
  })

  it('keeps the gym doorway connected from the main office roam graph', () => {
    const furniture = materializeDefaults('office')
    const grid = buildNavGrid(furniture)
    const [gymSpot] = getGymWorkoutLocations(furniture)
    const [roamPoint] = ROAM_POINTS

    const gymDoorRoute = resolveGymRoute(roamPoint.x, roamPoint.y, gymSpot)
    const path = astar(
      roamPoint.x,
      roamPoint.y,
      gymDoorRoute.targetX,
      gymDoorRoute.targetY,
      grid,
    )

    expect(path.length).toBeGreaterThan(0)
    expect(path.at(-1)).toEqual({
      x: gymDoorRoute.targetX,
      y: gymDoorRoute.targetY,
    })
  })
})
