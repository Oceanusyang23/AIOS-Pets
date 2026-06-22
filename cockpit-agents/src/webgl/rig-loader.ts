import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { PetModelEntry, RigBoneName } from './model-registry'

export type RigValidationReport = {
  valid: boolean
  modelId: string
  resolved: RigBoneName[]
  missing: RigBoneName[]
  meshCount: number
  skinnedMeshCount: number
}

export type LoadedPetRig = {
  scene: THREE.Group
  bones: Record<RigBoneName, THREE.Object3D>
  report: RigValidationReport
}

export function validatePetRig(root: THREE.Object3D, entry: PetModelEntry): RigValidationReport {
  const resolved: RigBoneName[] = []
  const missing: RigBoneName[] = []
  for (const [contractName, modelName] of Object.entries(entry.boneMap) as [RigBoneName, string][]) {
    if (root.getObjectByName(modelName)) resolved.push(contractName)
    else missing.push(contractName)
  }
  let meshCount = 0
  let skinnedMeshCount = 0
  root.traverse(object => {
    if (object instanceof THREE.Mesh) meshCount += 1
    if (object instanceof THREE.SkinnedMesh) skinnedMeshCount += 1
  })
  return { valid: missing.length === 0, modelId: entry.id, resolved, missing, meshCount, skinnedMeshCount }
}

export function bindPetRig(root: THREE.Group, entry: PetModelEntry, report: RigValidationReport): LoadedPetRig {
  if (!report.valid) throw new Error(`Invalid ${entry.id} rig; missing bones: ${report.missing.join(', ')}`)
  const bones = {} as Record<RigBoneName, THREE.Object3D>
  for (const [contractName, modelName] of Object.entries(entry.boneMap) as [RigBoneName, string][]) {
    const node = root.getObjectByName(modelName)
    if (!node) throw new Error(`Bone ${modelName} disappeared while binding ${entry.id}`)
    bones[contractName] = node
  }
  root.scale.setScalar(entry.scale)
  root.position.y += entry.yOffset
  return { scene: root, bones, report }
}

export async function loadPetRig(entry: PetModelEntry, loader = new GLTFLoader()): Promise<LoadedPetRig> {
  if (!entry.glbUrl) throw new Error(`No GLB configured for ${entry.id}; use procedural fallback`)
  const gltf = await loader.loadAsync(entry.glbUrl)
  const report = validatePetRig(gltf.scene, entry)
  return bindPetRig(gltf.scene, entry, report)
}
