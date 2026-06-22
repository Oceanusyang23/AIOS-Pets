import { describe, expect, it } from 'vitest'
import { deriveSemanticMotion, shouldInterrupt } from './motion-engine'

describe('motion engine', () => {
  it('maps uncertain language to lower certainty', () => {
    expect(deriveSemanticMotion('也许可以换一条路线').certainty).toBeLessThan(.5)
  })

  it('keeps semantic signals within the normalized range', () => {
    const signal = deriveSemanticMotion('非常开心 '.repeat(100))
    expect(signal.energy).toBeLessThanOrEqual(1)
    expect(signal.valence).toBeGreaterThanOrEqual(0)
  })

  it('lets direct interaction interrupt any passive state', () => {
    expect(shouldInterrupt('wake', 'listen', 'voice')).toBe(true)
    expect(shouldInterrupt('handshake', 'idle', 'idle-loop')).toBe(false)
  })
})
