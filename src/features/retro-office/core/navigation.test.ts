import { describe, expect, it } from 'vitest'

import { materializeDefaults } from '@/features/retro-office/core/furnitureDefaults'
import {
  ROAM_POINTS,
  assignDeskIndexByAgentId,
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
      'run',
      'lift',
      'lift',
      'row',
      'lift',
      'bike',
      'box',
      'stretch',
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

describe('assignDeskIndexByAgentId', () => {
  const deskUids = materializeDefaults('office')
    .filter((item) => item.type === 'desk_cubicle')
    .map((item) => item._uid)

  it('gives each agent the same desk regardless of roster order', () => {
    const a = assignDeskIndexByAgentId(
      ['trinity', 'hermes-switch', 'neo', 'morpheus'],
      deskUids,
      {},
    )
    const b = assignDeskIndexByAgentId(
      ['neo', 'morpheus', 'trinity', 'hermes-switch'],
      deskUids,
      {},
    )
    expect(a).toEqual(b)
    expect(new Set(Object.values(a)).size).toBe(4)
  })

  it('wraps deterministically when there are more agents than desks', () => {
    const ids = Array.from({ length: deskUids.length + 3 }, (_, i) => `a${i}`)
    const a = assignDeskIndexByAgentId(ids, deskUids, {})
    const b = assignDeskIndexByAgentId([...ids].reverse(), deskUids, {})
    expect(a).toEqual(b)
    expect(Object.keys(a)).toHaveLength(ids.length)
    for (const index of Object.values(a)) {
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(deskUids.length)
    }
  })

  it('honours explicit desk uid assignments', () => {
    const result = assignDeskIndexByAgentId(['neo', 'trinity'], deskUids, {
      [deskUids[2]]: 'neo',
    })
    expect(result.neo).toBe(2)
    expect(result.trinity).not.toBe(2)
  })
})
