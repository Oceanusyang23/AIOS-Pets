export type StagePoint = {
  x: number
  z: number
}

export type StageBounds = {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export type CircleCollider = StagePoint & {
  id: string
  radius: number
}

export type OrientedBoxCollider = StagePoint & {
  yaw: number
  halfX: number
  halfZ: number
}

export type CollisionResult = StagePoint & {
  pushed: boolean
}

const EPSILON = 1e-5

function orientedBoxClearance(point: StagePoint, box: OrientedBoxCollider) {
  const dx = point.x - box.x
  const dz = point.z - box.z
  const cos = Math.cos(-box.yaw)
  const sin = Math.sin(-box.yaw)
  const localX = dx * cos - dz * sin
  const localZ = dx * sin + dz * cos
  const nearestX = Math.max(-box.halfX, Math.min(box.halfX, localX))
  const nearestZ = Math.max(-box.halfZ, Math.min(box.halfZ, localZ))
  if (Math.abs(localX) < box.halfX && Math.abs(localZ) < box.halfZ) return 0
  return Math.hypot(localX - nearestX, localZ - nearestZ)
}

function boxBoundaryCandidates(
  box: OrientedBoxCollider,
  padding: number,
  bounds: StageBounds,
  desired: StagePoint,
) {
  const localCandidates: StagePoint[] = []
  const samples = 32
  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples
    const x = -box.halfX + t * box.halfX * 2
    const z = -box.halfZ + t * box.halfZ * 2
    localCandidates.push(
      { x, z: box.halfZ + padding },
      { x, z: -box.halfZ - padding },
      { x: box.halfX + padding, z },
      { x: -box.halfX - padding, z },
    )
  }
  const corners = [
    { x: box.halfX, z: box.halfZ, start: 0 },
    { x: box.halfX, z: -box.halfZ, start: -Math.PI / 2 },
    { x: -box.halfX, z: -box.halfZ, start: Math.PI },
    { x: -box.halfX, z: box.halfZ, start: Math.PI / 2 },
  ]
  for (const corner of corners) {
    for (let index = 0; index <= 12; index += 1) {
      const angle = corner.start + (index / 12) * (Math.PI / 2)
      localCandidates.push({
        x: corner.x + Math.cos(angle) * padding,
        z: corner.z + Math.sin(angle) * padding,
      })
    }
  }

  const cos = Math.cos(box.yaw)
  const sin = Math.sin(box.yaw)
  let best: StagePoint | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const local of localCandidates) {
    const candidate = {
      x: box.x + local.x * cos - local.z * sin,
      z: box.z + local.x * sin + local.z * cos,
    }
    if (
      candidate.x < bounds.minX || candidate.x > bounds.maxX ||
      candidate.z < bounds.minZ || candidate.z > bounds.maxZ
    ) continue
    const distance = Math.hypot(candidate.x - desired.x, candidate.z - desired.z)
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

function stableDirection(id: string) {
  let hash = 0
  for (let index = 0; index < id.length; index += 1) {
    hash = ((hash << 5) - hash + id.charCodeAt(index)) | 0
  }
  const angle = ((Math.abs(hash) % 360) / 180) * Math.PI
  return { x: Math.cos(angle), z: Math.sin(angle) }
}

export function clampToStage(point: StagePoint, bounds: StageBounds): CollisionResult {
  const x = Math.max(bounds.minX, Math.min(bounds.maxX, point.x))
  const z = Math.max(bounds.minZ, Math.min(bounds.maxZ, point.z))
  return { x, z, pushed: x !== point.x || z !== point.z }
}

export function pushOutsideOrientedBox(
  point: StagePoint,
  box: OrientedBoxCollider,
  padding = 0,
): CollisionResult {
  const dx = point.x - box.x
  const dz = point.z - box.z
  const cos = Math.cos(-box.yaw)
  const sin = Math.sin(-box.yaw)
  const localX = dx * cos - dz * sin
  const localZ = dx * sin + dz * cos
  const insideX = Math.abs(localX) < box.halfX
  const insideZ = Math.abs(localZ) < box.halfZ

  let safeX = localX
  let safeZ = localZ
  if (insideX && insideZ) {
    const toXEdge = box.halfX - Math.abs(localX)
    const toZEdge = box.halfZ - Math.abs(localZ)
    if (toXEdge < toZEdge) safeX = Math.sign(localX || -1) * (box.halfX + padding)
    else safeZ = Math.sign(localZ || 1) * (box.halfZ + padding)
  } else {
    const nearestX = Math.max(-box.halfX, Math.min(box.halfX, localX))
    const nearestZ = Math.max(-box.halfZ, Math.min(box.halfZ, localZ))
    let awayX = localX - nearestX
    let awayZ = localZ - nearestZ
    let distance = Math.hypot(awayX, awayZ)
    if (distance >= padding || padding <= 0) return { ...point, pushed: false }
    if (distance < EPSILON) {
      if (Math.abs(localX) > box.halfX) awayX = Math.sign(localX || 1)
      else awayZ = Math.sign(localZ || 1)
      distance = 1
    }
    safeX = nearestX + (awayX / distance) * padding
    safeZ = nearestZ + (awayZ / distance) * padding
  }

  const worldCos = Math.cos(box.yaw)
  const worldSin = Math.sin(box.yaw)
  return {
    x: box.x + safeX * worldCos - safeZ * worldSin,
    z: box.z + safeX * worldSin + safeZ * worldCos,
    pushed: true,
  }
}

export function pushOutsideCircles(
  point: StagePoint,
  selfId: string,
  selfRadius: number,
  obstacles: CircleCollider[],
  clearance = .08,
): CollisionResult {
  let x = point.x
  let z = point.z
  let pushed = false

  for (const obstacle of obstacles) {
    if (obstacle.id === selfId) continue
    const minDistance = selfRadius + obstacle.radius + clearance
    let dx = x - obstacle.x
    let dz = z - obstacle.z
    let distance = Math.hypot(dx, dz)
    if (distance >= minDistance) continue

    if (distance < EPSILON) {
      const direction = stableDirection(`${selfId}:${obstacle.id}`)
      dx = direction.x
      dz = direction.z
      distance = 1
    }
    x = obstacle.x + (dx / distance) * minDistance
    z = obstacle.z + (dz / distance) * minDistance
    pushed = true
  }

  return { x, z, pushed }
}

export function resolveCrowdPosition({
  point,
  selfId,
  selfRadius,
  obstacles,
  vehicle,
  bounds,
  clearance = .08,
  iterations = 4,
}: {
  point: StagePoint
  selfId: string
  selfRadius: number
  obstacles: CircleCollider[]
  vehicle: OrientedBoxCollider
  bounds: StageBounds
  clearance?: number
  iterations?: number
}): CollisionResult {
  const insetBounds = {
    minX: bounds.minX + selfRadius,
    maxX: bounds.maxX - selfRadius,
    minZ: bounds.minZ + selfRadius,
    maxZ: bounds.maxZ - selfRadius,
  }
  let current = { ...point }
  let pushed = false

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const bounded = clampToStage(current, insetBounds)
    const outsideVehicle = pushOutsideOrientedBox(bounded, vehicle, selfRadius + clearance)
    let boundedVehicle = clampToStage(outsideVehicle, insetBounds)
    if (orientedBoxClearance(boundedVehicle, vehicle) < selfRadius + clearance - EPSILON) {
      const alternative = boxBoundaryCandidates(
        vehicle,
        selfRadius + clearance,
        insetBounds,
        point,
      )
      if (alternative) boundedVehicle = { ...alternative, pushed: true }
    }
    const outsideAgents = pushOutsideCircles(
      boundedVehicle,
      selfId,
      selfRadius,
      obstacles,
      clearance,
    )
    let boundedAgents = clampToStage(outsideAgents, insetBounds)

    // Near a stage edge, the direct separation vector can point out of bounds.
    // In that case choose the closest valid point on the obstacle's safety
    // circumference, which creates a stable tangent-like sidestep.
    for (const obstacle of obstacles) {
      if (obstacle.id === selfId) continue
      const minDistance = selfRadius + obstacle.radius + clearance
      const distance = Math.hypot(boundedAgents.x - obstacle.x, boundedAgents.z - obstacle.z)
      if (distance >= minDistance - EPSILON) continue
      let best: StagePoint | null = null
      let bestDistance = Number.POSITIVE_INFINITY
      for (let sample = 0; sample < 24; sample += 1) {
        const angle = (sample / 24) * Math.PI * 2
        const candidate = {
          x: obstacle.x + Math.cos(angle) * minDistance,
          z: obstacle.z + Math.sin(angle) * minDistance,
        }
        if (
          candidate.x < insetBounds.minX || candidate.x > insetBounds.maxX ||
          candidate.z < insetBounds.minZ || candidate.z > insetBounds.maxZ
        ) continue
        const candidateDistance = Math.hypot(candidate.x - point.x, candidate.z - point.z)
        if (candidateDistance < bestDistance) {
          best = candidate
          bestDistance = candidateDistance
        }
      }
      if (best) boundedAgents = { ...best, pushed: true }
    }

    pushed ||= bounded.pushed || outsideVehicle.pushed || boundedVehicle.pushed ||
      outsideAgents.pushed || boundedAgents.pushed
    const moved = Math.hypot(boundedAgents.x - current.x, boundedAgents.z - current.z)
    current = { x: boundedAgents.x, z: boundedAgents.z }
    if (moved < EPSILON) break
  }

  const bounded = clampToStage(current, insetBounds)
  return {
    x: bounded.x,
    z: bounded.z,
    pushed: pushed || bounded.pushed,
  }
}
