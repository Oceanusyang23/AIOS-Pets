import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { petModelRegistry, standardBoneMap } from './model-registry'
import { validatePetRig } from './rig-loader'

describe('GLB rig contract', () => {
  it('uses one stable twelve-bone contract for every pet', () => {
    expect(Object.keys(standardBoneMap)).toHaveLength(12)
    for (const entry of Object.values(petModelRegistry)) {
      expect(entry.boneMap).toEqual(standardBoneMap)
    }
  })

  it('reports missing bones instead of accepting a partial model', () => {
    const root = new THREE.Group()
    root.add(Object.assign(new THREE.Group(), { name: 'Root' }))
    const report = validatePetRig(root, petModelRegistry.atlas)
    expect(report.valid).toBe(false)
    expect(report.resolved).toContain('root')
    expect(report.missing).toContain('leftHand')
  })

  it('accepts a model containing the complete contract', () => {
    const root = new THREE.Group()
    Object.values(standardBoneMap).forEach(name => {
      const bone = new THREE.Bone()
      bone.name = name
      root.add(bone)
    })
    const report = validatePetRig(root, petModelRegistry.muse)
    expect(report.valid).toBe(true)
    expect(report.missing).toHaveLength(0)
  })
})
