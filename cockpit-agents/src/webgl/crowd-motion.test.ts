import { describe, expect, it } from 'vitest'
import {
  pushOutsideCircles,
  pushOutsideOrientedBox,
  resolveCrowdPosition,
} from './crowd-motion'

const vehicle = { x: 0, z: -5, yaw: -.5, halfX: 4, halfZ: 1.5 }
const bounds = { minX: -6, maxX: 6, minZ: -8, maxZ: 1 }

describe('multi-agent crowd collision', () => {
  it('pushes a roaming agent outside the rotated vehicle footprint', () => {
    const result = pushOutsideOrientedBox({ x: 0, z: -5 }, vehicle, .7)
    expect(result.pushed).toBe(true)
    expect(Math.hypot(result.x, result.z + 5)).toBeGreaterThan(1.5)
  })

  it('keeps two agent bodies outside their combined safety radius', () => {
    const result = pushOutsideCircles(
      { x: .2, z: 0 },
      'atlas',
      .7,
      [{ id: 'nova', x: 0, z: 0, radius: .7 }],
      .1,
    )
    expect(result.pushed).toBe(true)
    expect(Math.hypot(result.x, result.z)).toBeGreaterThanOrEqual(1.5 - 1e-6)
  })

  it('resolves vehicle, crowd, and stage bounds in one pass', () => {
    const result = resolveCrowdPosition({
      point: { x: 20, z: -5 },
      selfId: 'muse',
      selfRadius: .68,
      obstacles: [{ id: 'milo', x: 5.7, z: -5, radius: .72 }],
      vehicle,
      bounds,
    })
    expect(result.x).toBeLessThanOrEqual(bounds.maxX)
    expect(result.z).toBeGreaterThanOrEqual(bounds.minZ)
    expect(Math.hypot(result.x - 5.7, result.z + 5)).toBeGreaterThanOrEqual(1.48 - 1e-6)
  })

  it('keeps a full-width character outside the actual 911 footprint', () => {
    const dakar = { x: .38, z: -6.35, yaw: -.5 + Math.PI, halfX: 6.07, halfZ: 3.11 }
    const radius = 1.58
    const clearance = .18
    const result = resolveCrowdPosition({
      point: { x: .35, z: -1.72 },
      selfId: 'nova',
      selfRadius: radius,
      obstacles: [],
      vehicle: dakar,
      bounds: { minX: -6.35, maxX: 6.35, minZ: -7.65, maxZ: .35 },
      clearance,
    })
    const dx = result.x - dakar.x
    const dz = result.z - dakar.z
    const cos = Math.cos(-dakar.yaw)
    const sin = Math.sin(-dakar.yaw)
    const localX = dx * cos - dz * sin
    const localZ = dx * sin + dz * cos
    const nearestX = Math.max(-dakar.halfX, Math.min(dakar.halfX, localX))
    const nearestZ = Math.max(-dakar.halfZ, Math.min(dakar.halfZ, localZ))
    const clearanceToBody = Math.hypot(localX - nearestX, localZ - nearestZ)
    expect(clearanceToBody).toBeGreaterThanOrEqual(radius + clearance - 1e-6)
  })

  it('keeps front-stage story positions clear of the 911 safety shell', () => {
    const dakar = { x: .38, z: -6.35, yaw: -.5 + Math.PI, halfX: 6.07, halfZ: 3.11 }
    const radius = 1.58
    const clearance = .34
    const stagePositions = [
      { x: -4.72, z: 1.28 },
      { x: -1.7, z: 1.04 },
      { x: 1.7, z: 1.04 },
      { x: 4.72, z: 1.28 },
      { x: -3.95, z: 1.22 },
      { x: 3.75, z: 1.12 },
    ]
    for (const point of stagePositions) {
      const result = resolveCrowdPosition({
        point,
        selfId: `agent-${point.x}`,
        selfRadius: radius,
        obstacles: [],
        vehicle: dakar,
        bounds: { minX: -6.35, maxX: 6.35, minZ: -7.65, maxZ: 2.35 },
        clearance,
      })
      const dx = result.x - dakar.x
      const dz = result.z - dakar.z
      const cos = Math.cos(-dakar.yaw)
      const sin = Math.sin(-dakar.yaw)
      const localX = dx * cos - dz * sin
      const localZ = dx * sin + dz * cos
      const nearestX = Math.max(-dakar.halfX, Math.min(dakar.halfX, localX))
      const nearestZ = Math.max(-dakar.halfZ, Math.min(dakar.halfZ, localZ))
      expect(Math.hypot(localX - nearestX, localZ - nearestZ)).toBeGreaterThanOrEqual(radius + clearance - 1e-6)
    }
  })

  it('separates held story or dance positions from neighboring agents', () => {
    const result = resolveCrowdPosition({
      point: { x: .92, z: 1.08 },
      selfId: 'muse',
      selfRadius: 1.2,
      obstacles: [{ id: 'nova', x: .35, z: 1.08, radius: 1.2 }],
      vehicle: { x: 999, z: 999, yaw: 0, halfX: 0, halfZ: 0 },
      bounds: { minX: -6.35, maxX: 6.35, minZ: -7.65, maxZ: 2.35 },
      clearance: .34,
    })

    expect(Math.hypot(result.x - .35, result.z - 1.08)).toBeGreaterThanOrEqual(2.74 - 1e-6)
  })
})
