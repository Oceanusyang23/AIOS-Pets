import type { PetId } from './PetStage'

export type RigBoneName =
  | 'root' | 'spine' | 'head' | 'leftEar' | 'rightEar'
  | 'leftShoulder' | 'rightShoulder' | 'leftElbow' | 'rightElbow'
  | 'leftHand' | 'rightHand' | 'mouth'

export type PetModelEntry = {
  id: PetId
  glbUrl: string | null
  scale: number
  yOffset: number
  boneMap: Record<RigBoneName, string>
}

export const standardBoneMap: Record<RigBoneName, string> = {
  root: 'Root', spine: 'Spine', head: 'Head', leftEar: 'Ear_L', rightEar: 'Ear_R',
  leftShoulder: 'Shoulder_L', rightShoulder: 'Shoulder_R', leftElbow: 'Elbow_L', rightElbow: 'Elbow_R',
  leftHand: 'Hand_L', rightHand: 'Hand_R', mouth: 'Mouth',
}

export const petModelRegistry: Record<PetId, PetModelEntry> = {
  atlas: { id: 'atlas', glbUrl: '/models/atlas-rigged.glb?v=20260623-rig-v2', scale: 1, yOffset: 0, boneMap: standardBoneMap },
  nova: { id: 'nova', glbUrl: '/models/nova.glb?v=20260623-rig-v2', scale: 1, yOffset: 0, boneMap: standardBoneMap },
  muse: { id: 'muse', glbUrl: '/models/muse.glb?v=20260623-rig-v2', scale: 1, yOffset: 0, boneMap: standardBoneMap },
  milo: { id: 'milo', glbUrl: '/models/milo.glb?v=20260623-rig-v2', scale: 1, yOffset: 0, boneMap: standardBoneMap },
}

export const hasProductionModel = (id: PetId) => Boolean(petModelRegistry[id].glbUrl)

export const getModelReadiness = () => {
  const entries = Object.values(petModelRegistry)
  const ready = entries.filter(entry => entry.glbUrl).length
  return { ready, total: entries.length, fallback: entries.length - ready }
}

/**
 * Drop a GLB into public/models and set glbUrl here. The runtime adapter can then
 * bind the named bones to the same motion protocol used by the procedural rig.
 */
