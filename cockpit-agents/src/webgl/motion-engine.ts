import type { MotionState, PetId } from './PetStage'

export type SemanticMotion = {
  energy: number
  valence: number
  certainty: number
}

export type MotionSource = 'idle-loop' | 'voice' | 'touch' | 'gesture' | 'agent-room' | 'motion-lab'

export type MotionTrace = {
  id: string
  agentId: PetId
  state: MotionState
  source: MotionSource
  semantic: SemanticMotion
  timestamp: number
}

export const MOTION_PRIORITY: Record<MotionState, number> = {
  idle: 0,
  social: 1,
  speak: 2,
  think: 3,
  listen: 4,
  wake: 5,
  dance: 5,
  spin: 5,
  march: 5,
  walk: 2,
  return: 6,
  handshake: 6,
}

export const clampSignal = (value: number) => Math.max(0, Math.min(1, value))

export function deriveSemanticMotion(text: string): SemanticMotion {
  const lower = text.toLowerCase()
  return {
    energy: clampSignal(.38 + text.length / 55),
    valence: lower.includes('别') || lower.includes('拥堵') || lower.includes('风险') ? .35 : .72,
    certainty: lower.includes('可能') || lower.includes('也许') ? .48 : .86,
  }
}

export function shouldInterrupt(current: MotionState, incoming: MotionState, source: MotionSource) {
  if (source === 'gesture' || source === 'touch' || source === 'voice') return true
  return MOTION_PRIORITY[incoming] >= MOTION_PRIORITY[current]
}

export function makeMotionTrace(
  agentId: PetId,
  state: MotionState,
  source: MotionSource,
  semantic: SemanticMotion,
): MotionTrace {
  return {
    id: `${timestampId()}-${agentId}-${state}`,
    agentId,
    state,
    source,
    semantic: { ...semantic },
    timestamp: Date.now(),
  }
}

function timestampId() {
  return Date.now().toString(36)
}
