import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { hasProductionModel, petModelRegistry } from './model-registry'
import './PetStage.css'

const GROUND_Y = -1.66
const ATLAS_TARGET_HEIGHT = 3.82
const AVATAR_TARGET_HEIGHT = 3.66

export type MotionState = 'idle' | 'wake' | 'listen' | 'think' | 'speak' | 'social' | 'handshake'
export type PetId = 'atlas' | 'muse' | 'milo' | 'nova'

type PetInfo = {
  id: PetId
  name: string
  role: string
  trait: string
  color: string
}

type SemanticMotion = {
  energy: number
  valence: number
  certainty: number
}

type Props = {
  agents: PetInfo[]
  activeId: PetId
  state: MotionState
  syncing: boolean
  semantic: SemanticMotion
  onSelect: (id: PetId) => void
  onHandshake: (id: PetId) => void
  onStatePreview: (state: MotionState) => void
}

type Rig = {
  id: PetId
  root: THREE.Group
  spine: THREE.Group
  head: THREE.Group
  leftEar: THREE.Group
  rightEar: THREE.Group
  leftShoulder: THREE.Group
  rightShoulder: THREE.Group
  leftElbow: THREE.Group
  rightElbow: THREE.Group
  leftHand: THREE.Mesh
  rightHand: THREE.Mesh
  mouth: THREE.Mesh
  halo: THREE.Mesh
  baseX: number
  phase: number
  profile: { tempo: number; amplitude: number; openness: number; attitude: number }
}

type ProductionAvatar = {
  id: PetId
  root: THREE.Group
  model: THREE.Group
  halo: THREE.Mesh
  baseX: number
  phase: number
  rig?: ProductionRig
  idlePersona: IdlePersona
  accentStartedAt: number
  accentDuration: number
  nextAccentAt: number
  introStartedAt: number
  introDelay: number
}

// Each avatar keeps one fixed idle "personality" (thematically matched to its role).
type IdlePersona = 'music' | 'yawn' | 'scratch' | 'pockets'

const idlePersonaByPet: Record<PetId, IdlePersona> = {
  muse: 'music',    // 音乐策展人 · 陶醉听歌（持续律动）
  milo: 'yawn',     // 松弛吃货 · 偶尔伸懒腰打哈欠
  atlas: 'pockets', // 出行管家 · 双手插兜左右张望
  nova: 'scratch',  // 理性守护者 · 偶尔挠头思考
}

// Idle accent passed into the animator each frame.
// `accent >= 0` is the 0..1 progress of a periodic gesture (yawn / scratch);
// continuous personas (music / pockets) always animate and pass accent = 1.
type IdleAccent = { persona: IdlePersona; accent: number }

// Live handshake grab: arm tracks the pointer's vertical position in real time.
type HandshakeGrab = { active: boolean; pointerY: number }

type IntroPhase =
  | { kind: 'run'; progress: number; time: number }
  | { kind: 'wave'; progress: number; time: number }
  | { kind: 'done' }

// Left-to-right arrival order so they don't all stop in lockstep.
const introOrderByPet: Record<PetId, number> = { atlas: 0, nova: 1, muse: 2, milo: 3 }
const INTRO_STAGGER = 0.26

type ProductionRigBone =
  | 'hips' | 'spine' | 'chest' | 'upperChest' | 'neck' | 'head' | 'jaw'
  | 'leftEye' | 'rightEye'
  | 'leftShoulder' | 'leftUpperArm' | 'leftLowerArm' | 'leftHand'
  | 'rightShoulder' | 'rightUpperArm' | 'rightLowerArm' | 'rightHand'
  | 'leftIndexProximal' | 'leftIndexIntermediate' | 'leftIndexDistal'
  | 'rightIndexProximal' | 'rightIndexIntermediate' | 'rightIndexDistal'
  | 'leftThumbProximal' | 'leftThumbIntermediate' | 'leftThumbDistal'
  | 'rightThumbProximal' | 'rightThumbIntermediate' | 'rightThumbDistal'
  | 'leftMiddleProximal' | 'leftMiddleIntermediate' | 'leftMiddleDistal'
  | 'rightMiddleProximal' | 'rightMiddleIntermediate' | 'rightMiddleDistal'

type ProductionRig = {
  bones: Partial<Record<ProductionRigBone, THREE.Object3D>>
  baseRotations: Map<THREE.Object3D, THREE.Euler>
  report: {
    requiredResolved: number
    requiredTotal: number
    optionalResolved: number
    optionalTotal: number
    missingRequired: string[]
    semanticChannels: string[]
  }
}

const stateLabels: Record<MotionState, string> = {
  idle: '待机', wake: '唤醒', listen: '聆听', think: '思考', speak: '对话', social: '互聊', handshake: '握手',
}

const profiles: Record<PetId, Rig['profile']> = {
  atlas: { tempo: .72, amplitude: .55, openness: .78, attitude: -.08 },
  nova: { tempo: .56, amplitude: .38, openness: .42, attitude: .03 },
  muse: { tempo: 1.12, amplitude: 1.0, openness: .92, attitude: -.06 },
  milo: { tempo: .88, amplitude: .72, openness: .86, attitude: .08 },
}

const roleBadgeMeta: Record<PetId, { symbol: string; title: string; x: string }> = {
  atlas: { symbol: '⌖', title: 'Navigation / Travel Agent', x: '13.4%' },
  nova: { symbol: '◴', title: 'Car Control Agent', x: '38.3%' },
  muse: { symbol: '▶', title: 'Music & Video Agent', x: '63.2%' },
  milo: { symbol: '♨', title: 'Food Service Agent', x: '86.5%' },
}

const INTRO_RUN_DURATION = 2.4
const INTRO_WAVE_DURATION = 3

const easeOutCubic = (value: number) => 1 - Math.pow(1 - THREE.MathUtils.clamp(value, 0, 1), 3)
const easeInOutSine = (value: number) => -(Math.cos(Math.PI * THREE.MathUtils.clamp(value, 0, 1)) - 1) / 2

const damp = (current: number, target: number, lambda: number, delta: number) =>
  THREE.MathUtils.damp(current, target, lambda, delta)

function material(color: string, roughness = .72) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: .08 })
}

function mesh(
  geometry: THREE.BufferGeometry,
  mat: THREE.Material,
  position: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] = [1, 1, 1],
) {
  const item = new THREE.Mesh(geometry, mat)
  item.position.set(...position)
  item.scale.set(...scale)
  item.castShadow = true
  item.receiveShadow = true
  return item
}

function tag(meshItem: THREE.Object3D, id: PetId, bodyPart: string) {
  meshItem.userData.agentId = id
  meshItem.userData.bodyPart = bodyPart
  meshItem.traverse(child => {
    child.userData.agentId = id
    child.userData.bodyPart = bodyPart
  })
}

function createArm(id: PetId, side: 'left' | 'right', cloth: THREE.Material, skin: THREE.Material) {
  const shoulder = new THREE.Group()
  const direction = side === 'left' ? -1 : 1
  shoulder.position.set(direction * .58, .96, 0)
  const upper = mesh(new THREE.CapsuleGeometry(.13, .48, 6, 10), cloth, [0, -.28, 0])
  upper.rotation.z = direction * -.08
  shoulder.add(upper)
  const elbow = new THREE.Group()
  elbow.position.set(direction * .04, -.56, 0)
  shoulder.add(elbow)
  const lower = mesh(new THREE.CapsuleGeometry(.115, .38, 6, 10), cloth, [0, -.22, 0])
  elbow.add(lower)
  const hand = mesh(new THREE.SphereGeometry(.16, 16, 12), skin, [0, -.5, .02], [1, 1.08, .78])
  elbow.add(hand)
  tag(hand, id, side === 'right' ? 'hand' : 'hand-left')
  const hitTarget = mesh(
    new THREE.SphereGeometry(.34, 12, 8),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    [0, -.5, .02],
  )
  hitTarget.castShadow = false
  elbow.add(hitTarget)
  tag(hitTarget, id, side === 'right' ? 'hand' : 'hand-left')
  return { shoulder, elbow, hand }
}

function createPet(info: PetInfo, index: number): Rig {
  const id = info.id
  const profile = profiles[id]
  const root = new THREE.Group()
  const baseX = (index - 1.5) * 2.05
  root.position.set(baseX, GROUND_Y + .03, 0)
  root.scale.setScalar(.92)
  root.userData.agentId = id

  const accent = material(info.color)
  const dark = material(id === 'nova' ? '#151a20' : id === 'muse' ? '#392154' : id === 'milo' ? '#efe1bc' : '#2a7b78')
  const skin = material('#d9c0a2', .9)
  const white = material('#e9f4f3', .82)
  const black = material('#111820', .56)
  const sole = material('#171b21', .95)

  const halo = mesh(new THREE.RingGeometry(.82, .86, 48), new THREE.MeshBasicMaterial({ color: info.color, transparent: true, opacity: .1, side: THREE.DoubleSide }), [0, .08, -.35], [1.3, .42, 1])
  halo.rotation.x = -Math.PI / 2
  root.add(halo)

  const legs = new THREE.Group()
  root.add(legs)
  const legSpread = id === 'nova' ? .37 : .31
  for (const side of [-1, 1]) {
    const leg = mesh(new THREE.CapsuleGeometry(.22, .52, 7, 12), dark, [side * legSpread, .35, 0])
    const shoe = mesh(new THREE.SphereGeometry(.27, 18, 12), sole, [side * legSpread, -.02, .13], [1.18, .62, 1.38])
    legs.add(leg, shoe)
  }

  const spine = new THREE.Group()
  spine.position.y = .98
  root.add(spine)
  const body = mesh(new THREE.CapsuleGeometry(.54, .72, 8, 18), dark, [0, .3, 0], id === 'milo' ? [1.08, 1, .92] : [1, 1, .9])
  tag(body, id, 'body')
  spine.add(body)

  const chest = mesh(new THREE.BoxGeometry(.68, .3, .12), accent, [0, .27, .49], [.88, .78, 1])
  chest.rotation.x = -.06
  spine.add(chest)
  if (id === 'nova') {
    const belt = mesh(new THREE.BoxGeometry(.92, .12, .18), accent, [0, -.02, .43])
    spine.add(belt)
  }
  if (id === 'atlas') {
    const lanyard = mesh(new THREE.BoxGeometry(.24, .35, .07), white, [0, .1, .57])
    spine.add(lanyard)
  }

  const left = createArm(id, 'left', dark, skin)
  const right = createArm(id, 'right', dark, skin)
  spine.add(left.shoulder, right.shoulder)

  const neck = new THREE.Group()
  neck.position.set(0, 1.12, 0)
  spine.add(neck)
  const head = new THREE.Group()
  neck.add(head)
  const hood = mesh(new THREE.SphereGeometry(.62, 24, 18), accent, [0, 0, 0], [1, 1.02, .94])
  tag(hood, id, 'head')
  head.add(hood)
  const face = mesh(new THREE.SphereGeometry(.47, 24, 18), skin, [0, -.03, .42], [1, .84, .32])
  head.add(face)
  for (const side of [-1, 1]) {
    const eyeWhite = mesh(new THREE.SphereGeometry(.085, 16, 10), white, [side * .19, .04, .58], [1, 1.25, .55])
    const pupil = mesh(new THREE.SphereGeometry(.045, 12, 8), black, [side * .19, .04, .64], [1, 1.25, .45])
    head.add(eyeWhite, pupil)
  }
  const mouth = mesh(new THREE.BoxGeometry(.16, .027, .025), black, [0, -.2, .66])
  head.add(mouth)

  const earGeometry = new THREE.ConeGeometry(.18, .5, 16)
  const leftEar = new THREE.Group()
  const rightEar = new THREE.Group()
  leftEar.position.set(-.34, .52, 0)
  rightEar.position.set(.34, .52, 0)
  const earLeftMesh = mesh(earGeometry, accent)
  const earRightMesh = mesh(earGeometry, accent)
  earLeftMesh.rotation.z = .12
  earRightMesh.rotation.z = -.12
  leftEar.add(earLeftMesh); rightEar.add(earRightMesh); head.add(leftEar, rightEar)

  if (id === 'muse') {
    const band = mesh(new THREE.TorusGeometry(.55, .06, 8, 24, Math.PI), black, [0, .18, .04])
    band.rotation.z = Math.PI
    const leftCup = mesh(new THREE.CylinderGeometry(.16, .16, .12, 16), accent, [-.55, .02, .08])
    const rightCup = mesh(new THREE.CylinderGeometry(.16, .16, .12, 16), accent, [.55, .02, .08])
    leftCup.rotation.z = rightCup.rotation.z = Math.PI / 2
    head.add(band, leftCup, rightCup)
  }
  if (id === 'milo') {
    const brim = mesh(new THREE.CylinderGeometry(.5, .62, .11, 24), accent, [0, .43, .05])
    head.add(brim)
    const cup = mesh(new THREE.CylinderGeometry(.13, .16, .42, 16), white, [.02, -.45, .02])
    right.elbow.add(cup)
  }
  if (id === 'nova') {
    const visor = mesh(new THREE.BoxGeometry(.78, .12, .12), accent, [0, .21, .57])
    visor.rotation.x = -.12
    head.add(visor)
  }
  if (id === 'atlas') {
    const phone = mesh(new THREE.BoxGeometry(.27, .48, .06), black, [-.02, -.45, .06])
    left.elbow.add(phone)
  }

  return {
    id, root, spine, head, leftEar, rightEar,
    leftShoulder: left.shoulder, rightShoulder: right.shoulder,
    leftElbow: left.elbow, rightElbow: right.elbow,
    leftHand: left.hand, rightHand: right.hand, mouth, halo,
    baseX, phase: index * 1.77 + .6, profile,
  }
}

function shouldKeepLeftClusterOnly(root: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(root)
  const size = new THREE.Vector3()
  box.getSize(size)
  return size.x / Math.max(size.y, .001) > 1.35
}

function keepLeftClusterOnly(root: THREE.Object3D, keepRatio = .38) {
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return
    const source = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone()
    const position = source.getAttribute('position') as THREE.BufferAttribute | undefined
    if (!position || position.count < 3) return

    let minX = Infinity
    let maxX = -Infinity
    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index)
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
    }
    const cutoff = minX + (maxX - minX) * keepRatio
    const nextAttributes = new Map<string, number[]>()
    for (const name of Object.keys(source.attributes)) nextAttributes.set(name, [])

    for (let index = 0; index < position.count; index += 3) {
      const centroidX = (position.getX(index) + position.getX(index + 1) + position.getX(index + 2)) / 3
      if (centroidX > cutoff) continue
      for (const [name, attribute] of Object.entries(source.attributes)) {
        const bufferAttribute = attribute as THREE.BufferAttribute
        const values = nextAttributes.get(name)!
        for (let vertex = index; vertex < index + 3; vertex += 1) {
          for (let component = 0; component < bufferAttribute.itemSize; component += 1) {
            values.push(bufferAttribute.getComponent(vertex, component))
          }
        }
      }
    }

    const trimmed = new THREE.BufferGeometry()
    for (const [name, values] of nextAttributes) {
      const sourceAttribute = source.getAttribute(name) as THREE.BufferAttribute | undefined
      if (!sourceAttribute || values.length === 0) continue
      trimmed.setAttribute(name, new THREE.Float32BufferAttribute(values, sourceAttribute.itemSize, sourceAttribute.normalized))
    }
    trimmed.computeBoundingBox()
    trimmed.computeBoundingSphere()
    object.geometry = trimmed
    source.dispose()
  })
}

function bindProductionRig(root: THREE.Object3D): ProductionRig | undefined {
  const boneMap: Record<ProductionRigBone, string> = {
    hips: 'Hips',
    spine: 'Spine',
    chest: 'Chest',
    upperChest: 'UpperChest',
    neck: 'Neck',
    head: 'Head',
    jaw: 'Jaw',
    leftEye: 'LeftEye',
    rightEye: 'RightEye',
    leftShoulder: 'LeftShoulder',
    leftUpperArm: 'LeftUpperArm',
    leftLowerArm: 'LeftLowerArm',
    leftHand: 'LeftHand',
    rightShoulder: 'RightShoulder',
    rightUpperArm: 'RightUpperArm',
    rightLowerArm: 'RightLowerArm',
    rightHand: 'RightHand',
    leftIndexProximal: 'LeftIndexProximal',
    leftIndexIntermediate: 'LeftIndexIntermediate',
    leftIndexDistal: 'LeftIndexDistal',
    rightIndexProximal: 'RightIndexProximal',
    rightIndexIntermediate: 'RightIndexIntermediate',
    rightIndexDistal: 'RightIndexDistal',
    leftThumbProximal: 'LeftThumbProximal',
    leftThumbIntermediate: 'LeftThumbIntermediate',
    leftThumbDistal: 'LeftThumbDistal',
    rightThumbProximal: 'RightThumbProximal',
    rightThumbIntermediate: 'RightThumbIntermediate',
    rightThumbDistal: 'RightThumbDistal',
    leftMiddleProximal: 'LeftMiddleProximal',
    leftMiddleIntermediate: 'LeftMiddleIntermediate',
    leftMiddleDistal: 'LeftMiddleDistal',
    rightMiddleProximal: 'RightMiddleProximal',
    rightMiddleIntermediate: 'RightMiddleIntermediate',
    rightMiddleDistal: 'RightMiddleDistal',
  }
  const bones: Partial<Record<ProductionRigBone, THREE.Object3D>> = {}
  const baseRotations = new Map<THREE.Object3D, THREE.Euler>()
  for (const [contractName, nodeName] of Object.entries(boneMap) as [ProductionRigBone, string][]) {
    const bone = root.getObjectByName(nodeName)
    if (!bone) continue
    bones[contractName] = bone
    baseRotations.set(bone, bone.rotation.clone())
  }
  const required: ProductionRigBone[] = [
    'hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'jaw',
    'leftEye', 'rightEye',
    'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
    'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  ]
  const optional = (Object.keys(boneMap) as ProductionRigBone[]).filter(name => !required.includes(name))
  const missingRequired = required.filter(name => !bones[name])
  const semanticChannels = [
    bones.head && 'gaze.head',
    bones.leftEye && bones.rightEye && 'gaze.eyes',
    bones.jaw && 'expression.jaw',
    bones.upperChest && 'posture.chest',
    bones.leftUpperArm && bones.rightUpperArm && 'gesture.arms',
    (bones.leftIndexProximal || bones.leftMiddleProximal || bones.leftThumbProximal || bones.rightIndexProximal || bones.rightMiddleProximal || bones.rightThumbProximal) && 'gesture.fingers',
  ].filter(Boolean) as string[]
  const report = {
    requiredResolved: required.length - missingRequired.length,
    requiredTotal: required.length,
    optionalResolved: optional.filter(name => bones[name]).length,
    optionalTotal: optional.length,
    missingRequired,
    semanticChannels,
  }
  return report.requiredResolved >= 12 ? { bones, baseRotations, report } : undefined
}

function stabilizeAvatarMaterials(root: THREE.Object3D, preservePbr = false) {
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    materials.forEach(material => {
      if (!(material instanceof THREE.MeshStandardMaterial) && !(material instanceof THREE.MeshPhysicalMaterial)) return
      if (material.map) {
        material.map.colorSpace = THREE.SRGBColorSpace
        material.map.flipY = false
        material.map.needsUpdate = true
      }
      if (!preservePbr) {
        material.normalMap = null
        material.roughnessMap = null
        material.metalnessMap = null
      }
      material.roughness = .68
      material.metalness = .03
      material.envMapIntensity = .45
      material.needsUpdate = true
    })
  })
}

function dampBone(
  rig: ProductionRig | undefined,
  boneName: ProductionRigBone,
  delta: number,
  offset: Partial<Pick<THREE.Euler, 'x' | 'y' | 'z'>>,
  lambda = 9,
) {
  const bone = rig?.bones[boneName]
  if (!bone) return
  const base = rig?.baseRotations.get(bone)
  if (!base) return
  bone.rotation.x = damp(bone.rotation.x, base.x + (offset.x ?? 0), lambda, delta)
  bone.rotation.y = damp(bone.rotation.y, base.y + (offset.y ?? 0), lambda, delta)
  bone.rotation.z = damp(bone.rotation.z, base.z + (offset.z ?? 0), lambda, delta)
}

function dampFingerCurl(
  rig: ProductionRig | undefined,
  side: 'left' | 'right',
  finger: 'index' | 'middle' | 'thumb',
  curl: number,
  delta: number,
  spread = 0,
) {
  const prefix = `${side}${finger[0].toUpperCase()}${finger.slice(1)}` as 'leftIndex' | 'rightIndex' | 'leftMiddle' | 'rightMiddle' | 'leftThumb' | 'rightThumb'
  dampBone(rig, `${prefix}Proximal` as ProductionRigBone, delta, { x: curl, z: spread }, 11)
  dampBone(rig, `${prefix}Intermediate` as ProductionRigBone, delta, { x: curl * .72 }, 11)
  dampBone(rig, `${prefix}Distal` as ProductionRigBone, delta, { x: curl * .48 }, 11)
}

function driveSemanticFingers(rig: ProductionRig | undefined, delta: number, curl: number, openness: number) {
  dampFingerCurl(rig, 'left', 'index', curl * .72, delta, -openness * .025)
  dampFingerCurl(rig, 'left', 'middle', curl, delta)
  dampFingerCurl(rig, 'left', 'thumb', curl * .52, delta, openness * .03)
  dampFingerCurl(rig, 'right', 'index', curl * .72, delta, openness * .025)
  dampFingerCurl(rig, 'right', 'middle', curl, delta)
  dampFingerCurl(rig, 'right', 'thumb', curl * .52, delta, -openness * .03)
}

// Periodic personas (yawn / scratch) fire an occasional accent gesture; the rest
// of the time the avatar holds a calm idle with arms naturally hanging.
function resolveIdleAccent(avatar: ProductionAvatar, elapsed: number): IdleAccent {
  const persona = avatar.idlePersona
  if (persona === 'music' || persona === 'pockets') {
    // Continuous personas are always animating.
    return { persona, accent: 1 }
  }
  if (avatar.accentStartedAt >= 0 && elapsed - avatar.accentStartedAt > avatar.accentDuration) {
    avatar.accentStartedAt = -1
    avatar.nextAccentAt = elapsed + 4.5 + Math.random() * 5.5
  }
  if (avatar.accentStartedAt < 0 && elapsed > avatar.nextAccentAt) {
    avatar.accentStartedAt = elapsed
    avatar.accentDuration = persona === 'yawn' ? 2.7 : 2.2
  }
  const accent = avatar.accentStartedAt >= 0
    ? THREE.MathUtils.clamp((elapsed - avatar.accentStartedAt) / avatar.accentDuration, 0, 1)
    : -1
  return { persona, accent }
}

function prepareProductionAvatar(gltfScene: THREE.Group, fallback: Rig, agent: PetInfo, introStartedAt: number): ProductionAvatar {
  const wrapper = new THREE.Group()
  wrapper.name = `production_${agent.id}_wrapper`
  wrapper.position.set(fallback.baseX + (agent.id === 'atlas' ? -.08 : 0), GROUND_Y, -6.2)
  wrapper.userData.agentId = agent.id

  if (shouldKeepLeftClusterOnly(gltfScene)) keepLeftClusterOnly(gltfScene)

  const box = new THREE.Box3().setFromObject(gltfScene)
  const size = new THREE.Vector3()
  const center = new THREE.Vector3()
  box.getSize(size)
  box.getCenter(center)
  const targetHeight = agent.id === 'atlas' ? ATLAS_TARGET_HEIGHT : AVATAR_TARGET_HEIGHT
  const scale = targetHeight / Math.max(size.y, .001)
  gltfScene.scale.setScalar(scale)
  gltfScene.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale)
  gltfScene.rotation.y = 0
  gltfScene.traverse(object => {
    object.userData.agentId = agent.id
    object.userData.bodyPart = 'body'
    if (object instanceof THREE.Mesh) {
      object.castShadow = true
      object.receiveShadow = true
    }
  })
  stabilizeAvatarMaterials(gltfScene, true)
  const rig = bindProductionRig(gltfScene)
  if (rig) {
    wrapper.userData.rigReport = rig.report
    gltfScene.userData.rigReport = rig.report
  }

  const halo = mesh(
    new THREE.RingGeometry(1.02, 1.08, 64),
    new THREE.MeshBasicMaterial({ color: agent.color, transparent: true, opacity: .16, side: THREE.DoubleSide }),
    [0, .05, -.42],
    [1.24, .44, 1],
  )
  halo.rotation.x = -Math.PI / 2
  wrapper.add(halo, gltfScene)

  const handHit = mesh(
    new THREE.SphereGeometry(.42, 18, 12),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    [.72, 1.45, .22],
  )
  handHit.castShadow = false
  tag(handHit, agent.id, 'hand')
  wrapper.add(handHit)

  const introDelay = introOrderByPet[agent.id] * INTRO_STAGGER

  return {
    id: agent.id,
    root: wrapper,
    model: gltfScene,
    halo,
    baseX: fallback.baseX,
    phase: fallback.phase,
    rig,
    idlePersona: idlePersonaByPet[agent.id],
    accentStartedAt: -1,
    accentDuration: 2.4,
    nextAccentAt: introStartedAt + introDelay + INTRO_RUN_DURATION + INTRO_WAVE_DURATION + 1.6 + Math.random() * 3.5,
    introStartedAt,
    introDelay,
  }
}

function animateProductionAvatar(
  avatar: ProductionAvatar,
  state: MotionState,
  elapsed: number,
  delta: number,
  semantic: SemanticMotion,
  lookTargetX: number,
  intro: IntroPhase,
  idleAccent: IdleAccent | null,
  handshake: HandshakeGrab | null,
) {
  const t = elapsed * .8 + avatar.phase
  const breath = Math.sin(t * 1.35) * .025
  let rootY = GROUND_Y + breath
  let rootZ = 0
  let rootRotX = 0
  let rootRotY = lookTargetX * .18 + Math.sin(t * .38) * .018
  let rootRotZ = Math.sin(t * .44) * .014
  let modelRotX = 0
  let modelRotZ = 0
  let scale = 1
  let haloOpacity = .14
  let headX = Math.sin(t * .7) * .018
  let headY = lookTargetX * .38 + Math.sin(t * .46) * .012
  let headZ = Math.sin(t * .42) * .014
  let chestX = Math.sin(t * 1.1) * .012
  let chestZ = Math.sin(t * .52) * .01
  let jawX = 0
  let leftArmZ = -1.05
  let leftArmX = 0
  let rightArmZ = 1.05
  let rightArmX = 0
  let leftLowerArmZ = 0
  let rightLowerArmZ = 0
  let rightHandX = 0
  let eyeY = headY * .18
  let eyeX = 0
  let fingerCurl = .04
  let fingerOpen = .2

  if (state === 'idle' && idleAccent) {
    // muse · 陶醉听歌：持续的头部律动、肩膀微晃、手指打拍、眼神微闭
    if (idleAccent.persona === 'music') {
      const groove = Math.sin(elapsed * 2.6 + avatar.phase)
      const beat = Math.sin(elapsed * 5.2 + avatar.phase)
      headY += groove * .17
      headZ += groove * .13
      headX += Math.abs(beat) * .03 - .015
      chestZ += groove * .05
      rootRotZ += groove * .03
      rootY += Math.max(0, beat) * .02
      leftArmZ = -.98 + groove * .07
      rightArmZ = .98 - groove * .07
      leftArmX = beat * .07
      rightArmX = -beat * .07
      jawX += .025 + Math.abs(beat) * .02
      eyeX += -.04
      fingerOpen += .25 + Math.abs(beat) * .2
    }
    // atlas · 双手插兜左右张望：手收向胯部、肘部微曲、头缓慢左右扫视
    if (idleAccent.persona === 'pockets') {
      const look = Math.sin(elapsed * .52 + avatar.phase)
      leftArmZ = -.74
      rightArmZ = .74
      leftArmX = -.18
      rightArmX = -.18
      leftLowerArmZ = -.52
      rightLowerArmZ = .52
      fingerCurl = .55
      fingerOpen = 0
      headY = look * .52
      headX += Math.sin(elapsed * .4) * .03 - .02
      headZ += look * .05
      eyeX = -.01
      eyeY = look * .26
      rootRotZ += Math.sin(elapsed * .5 + avatar.phase) * .02
    }
    // milo · 打哈欠伸懒腰（周期触发）
    if (idleAccent.persona === 'yawn' && idleAccent.accent >= 0) {
      const pulse = Math.sin(easeInOutSine(idleAccent.accent) * Math.PI)
      headX += -.13 * pulse
      chestX += .05 * pulse
      jawX += .2 * pulse
      leftArmZ = THREE.MathUtils.lerp(leftArmZ, -.5, pulse)
      rightArmZ = THREE.MathUtils.lerp(rightArmZ, .5, pulse)
      leftArmX += -.26 * pulse
      rightArmX += -.26 * pulse
      eyeX += -.07 * pulse
      fingerOpen += .3 * pulse
    }
    // nova · 挠头思考（周期触发）
    if (idleAccent.persona === 'scratch' && idleAccent.accent >= 0) {
      const pulse = Math.sin(easeInOutSine(idleAccent.accent) * Math.PI)
      headY += -.08 * pulse
      headZ += .05 * pulse
      headX += .04 * pulse
      rightArmX += -.2 * pulse
      rightArmZ = THREE.MathUtils.lerp(rightArmZ, -.5 + Math.sin(elapsed * 13) * .05, pulse)
      rightLowerArmZ += -.5 * pulse
      rightHandX += Math.sin(elapsed * 16) * .04 * pulse
      fingerCurl += .25 * pulse
    }
  }

  if (state === 'wake') {
    const pulse = Math.sin(elapsed * 9)
    rootY += .055 + Math.abs(pulse) * .025
    rootRotY += -.12
    modelRotZ = pulse * .018
    scale = 1.025 + Math.max(0, pulse) * .018
    haloOpacity = .5
    headX = -.05
    headZ = pulse * .026
    leftArmZ = -.88
    rightArmZ = .88
    eyeX = -.025
    fingerCurl = .08
    fingerOpen = .45
  }
  if (state === 'listen') {
    rootRotX = .04
    rootRotY += -.18
    modelRotX = -.035
    haloOpacity = .34 + Math.sin(elapsed * 3.2) * .06
    headX = -.12
    headY = -.08 + lookTargetX * .18
    chestX = .045
    leftArmZ = -.94
    rightArmZ = .94
    eyeX = -.035
    eyeY = -.04 + lookTargetX * .1
    fingerCurl = .02
    fingerOpen = .55
  }
  if (state === 'think') {
    rootRotY += .22 + Math.sin(t * .7) * .06
    modelRotX = -.06
    modelRotZ = -.025
    haloOpacity = .24
    headX = -.17
    headY = .16 + Math.sin(t * .7) * .03
    chestZ = -.035
    rightArmX = -.08
    rightArmZ = .48
    rightLowerArmZ = .1
    eyeX = -.055
    eyeY = .06
    fingerCurl = .12
    fingerOpen = .12
  }
  if (state === 'speak') {
    const beat = Math.sin(elapsed * (4.8 + semantic.energy * 3.4) + avatar.phase)
    rootY += Math.max(0, beat) * .028
    rootRotY += lookTargetX * .35 + beat * .045
    modelRotZ = beat * .028 * Math.max(.4, semantic.valence)
    scale = 1.01 + Math.abs(beat) * .012
    haloOpacity = .32 + Math.abs(beat) * .16
    headX = beat * .035
    headY = lookTargetX * .24 + beat * .018
    headZ = beat * .025
    chestZ = beat * .022
    jawX = .018 + Math.abs(beat) * .045
    rightArmZ = .72 + beat * .08
    rightLowerArmZ = .035 + beat * .035
    leftArmZ = -.82 - Math.sin(elapsed * 3.2) * .04 * semantic.valence
    eyeX = beat * .012
    eyeY = lookTargetX * .08 + beat * .01
    fingerCurl = .08 + Math.abs(beat) * .08 * semantic.energy
    fingerOpen = .32 + semantic.valence * .18
  }
  if (state === 'social') {
    rootRotY += lookTargetX * .55
    modelRotZ = Math.sin(elapsed * 2.4 + avatar.phase) * .018
    haloOpacity = .2
    headY = lookTargetX * .48
    chestZ = -lookTargetX * .045
    leftArmZ = -.9
    rightArmZ = .9
    eyeY = lookTargetX * .12
    fingerCurl = .05
    fingerOpen = .28
  }
  if (state === 'handshake') {
    const shake = Math.sin(elapsed * 12) * .04
    rootRotX = .065
    rootRotY += -.18
    modelRotZ = -.035 + shake
    rootY += Math.max(0, Math.sin(elapsed * 4)) * .025
    haloOpacity = .58
    headX = -.06
    headY = -.08
    rightArmX = -.18
    rightArmZ = -.18 + shake * .7
    rightLowerArmZ = -.1 + shake * .55
    rightHandX = shake * .5
    eyeX = -.02
    eyeY = -.03
    fingerCurl = .18 + Math.abs(shake) * .45
    fingerOpen = .08
  }

  if (intro.kind === 'run') {
    const p = easeOutCubic(intro.progress)
    const decel = THREE.MathUtils.smoothstep(intro.progress, .68, 1) // 0 → 1 as they brake to a stop
    const run = 1 - decel                                            // running intensity, fades near arrival
    const cycle = intro.time * 12.5 + avatar.phase
    const stride = Math.sin(cycle)
    const bounce = Math.abs(Math.sin(cycle))
    rootZ = -7.4 * (1 - p)
    rootY += bounce * .12 * run                                       // springy gait, settles on stop
    rootRotX += .18 * (1 - p) - .05 * decel                           // lean into the run, straighten up on arrival
    rootRotY += Math.sin(intro.time * 3 + avatar.phase) * .05 * run
    modelRotZ += stride * .05 * run
    leftArmZ = -.86
    rightArmZ = .86
    leftArmX = stride * .5 * run                                      // arms pump front/back
    rightArmX = -stride * .5 * run
    leftLowerArmZ = -.34 * run                                        // elbows bent while running, relax at stop
    rightLowerArmZ = .34 * run
    headX += -.07 * run
    headY += rootRotY * .3
    haloOpacity = .12 + p * .2
  }
  if (intro.kind === 'wave') {
    const env = Math.sin(Math.PI * THREE.MathUtils.clamp(intro.progress, 0, 1)) // ease wave in and out over 3s
    const wave = Math.sin(intro.time * 8.5 + avatar.phase) * env
    rootZ = 0
    rootY += Math.max(0, Math.sin(intro.time * 3.4 + avatar.phase)) * .02 * env
    rootRotY += -.04 * env
    headY += lookTargetX * .12 + wave * .04
    headZ += wave * .03
    headX += -.03 * env
    rightArmX += -.35 * env
    rightArmZ = .9 - 1.5 * env + wave * .24                           // raise the right arm and wave
    rightLowerArmZ += (-.2 + wave * .18) * env
    rightHandX += wave * .18
    fingerCurl = .04
    fingerOpen = .6
    jawX += .03 * env
    haloOpacity = .3 + env * .12
  }

  // Live handshake: while a hand is grabbed, the right arm reaches toward the
  // viewer and its height tracks the pointer in real time — like a real shake.
  if (intro.kind === 'done' && handshake?.active) {
    const up = THREE.MathUtils.clamp(handshake.pointerY, -1, 1)
    rootRotX = .07
    rootRotY += -.1
    headX = -.05
    headY = 0
    headZ = 0
    leftArmZ = -1.0
    leftArmX = 0
    rightArmZ = -.28
    rightArmX = -.95 - up * .38
    rightLowerArmZ = -.32 + up * .5
    rightHandX = up * .42
    fingerCurl = .55
    fingerOpen = .05
    haloOpacity = .6
  }

  avatar.root.position.y = damp(avatar.root.position.y, rootY, 8, delta)
  avatar.root.position.z = damp(avatar.root.position.z, rootZ, intro.kind === 'run' ? 5 : 8, delta)
  avatar.root.rotation.x = damp(avatar.root.rotation.x, rootRotX, 8, delta)
  avatar.root.rotation.y = damp(avatar.root.rotation.y, rootRotY, 8, delta)
  avatar.root.rotation.z = damp(avatar.root.rotation.z, rootRotZ, 8, delta)
  avatar.model.rotation.x = damp(avatar.model.rotation.x, modelRotX, 9, delta)
  avatar.model.rotation.z = damp(avatar.model.rotation.z, modelRotZ, 9, delta)
  const nextScale = damp(avatar.root.scale.x, scale, 9, delta)
  avatar.root.scale.setScalar(nextScale)
  dampBone(avatar.rig, 'head', delta, { x: headX, y: headY, z: headZ }, 10)
  dampBone(avatar.rig, 'neck', delta, { x: headX * .28, y: headY * .32, z: headZ * .28 }, 9)
  dampBone(avatar.rig, 'leftEye', delta, { x: eyeX, y: eyeY }, 14)
  dampBone(avatar.rig, 'rightEye', delta, { x: eyeX, y: eyeY }, 14)
  dampBone(avatar.rig, 'upperChest', delta, { x: chestX, z: chestZ }, 8)
  dampBone(avatar.rig, 'chest', delta, { x: chestX * .52, z: chestZ * .52 }, 8)
  dampBone(avatar.rig, 'jaw', delta, { x: jawX }, 14)
  dampBone(avatar.rig, 'leftUpperArm', delta, { x: leftArmX, z: leftArmZ }, 9)
  dampBone(avatar.rig, 'rightUpperArm', delta, { x: rightArmX, z: rightArmZ }, 9)
  dampBone(avatar.rig, 'leftLowerArm', delta, { z: leftLowerArmZ }, 9)
  dampBone(avatar.rig, 'rightLowerArm', delta, { z: rightLowerArmZ }, 9)
  dampBone(avatar.rig, 'rightHand', delta, { x: rightHandX }, 10)
  driveSemanticFingers(avatar.rig, delta, fingerCurl, fingerOpen)
  const haloMat = avatar.halo.material as THREE.MeshBasicMaterial
  haloMat.opacity = damp(haloMat.opacity, haloOpacity, 7, delta)
}

function animateRig(
  rig: Rig,
  state: MotionState,
  elapsed: number,
  delta: number,
  semantic: SemanticMotion,
  lookTargetX: number,
  handshake: HandshakeGrab | null,
) {
  const p = rig.profile
  const t = elapsed * p.tempo + rig.phase
  const breath = Math.sin(t * 1.65) * .028 * p.amplitude
  let rootY = GROUND_Y + .03 + breath
  let rootRotZ = p.attitude + Math.sin(t * .42) * .015
  let spineRotX = 0
  let spineRotZ = 0
  let headX = Math.sin(t * .58) * .025
  let headY = Math.sin(t * .37) * .06
  let headZ = Math.sin(t * .7) * .025
  let leftArmZ = -.22 - p.openness * .1
  let rightArmZ = .22 + p.openness * .1
  let leftElbowX = 0
  let rightElbowX = 0
  let rightShoulderX = 0
  let mouthScale = .2
  let haloOpacity = .08
  let scale = 1

  if (state === 'wake') {
    const pulse = Math.sin(elapsed * 8 + rig.phase)
    rootY += .08 + Math.abs(pulse) * .035
    scale = 1.04 + pulse * .018
    headX = -.08
    leftArmZ -= .12; rightArmZ += .12
    haloOpacity = .4
  }
  if (state === 'listen') {
    headZ = -.13 + Math.sin(t * .7) * .025
    headY = lookTargetX
    leftArmZ = -.36
    leftElbowX = -.82
    spineRotX = .04
    haloOpacity = .28 + Math.sin(elapsed * 3) * .06
  }
  if (state === 'think') {
    headX = -.13
    headY = .22 + Math.sin(t * .48) * .08
    headZ = .08
    rightArmZ = .42
    rightElbowX = -1.08
    spineRotZ = -.045
    haloOpacity = .2
  }
  if (state === 'speak') {
    const beat = Math.sin(elapsed * (5 + semantic.energy * 3) + rig.phase)
    headX = beat * .035 * p.amplitude
    headY = lookTargetX
    spineRotZ = beat * .025 * p.amplitude
    rightArmZ = .4 + beat * .19 * p.openness
    rightElbowX = -.65 + beat * .3
    leftArmZ = -.3 - Math.sin(elapsed * 3.2) * .1 * semantic.valence
    mouthScale = .75 + Math.abs(beat) * 1.4
    haloOpacity = .3 + Math.abs(beat) * .14
  }
  if (state === 'social') {
    headY = lookTargetX
    headX = Math.max(0, Math.sin(elapsed * 2.3 + rig.phase)) * .045 * semantic.certainty
    spineRotZ = -lookTargetX * .13
    leftArmZ -= .06
    rightArmZ += .06
    haloOpacity = .13
  }
  if (state === 'handshake') {
    const shake = Math.sin(elapsed * 9) * .08
    rootRotZ = -.025
    spineRotX = .08
    rightArmZ = .05
    rightShoulderX = -1.22
    rightElbowX = -.2 + shake
    headX = Math.max(0, Math.sin(elapsed * 4)) * .035
    haloOpacity = .48
  }

  if (handshake?.active) {
    const up = THREE.MathUtils.clamp(handshake.pointerY, -1, 1)
    spineRotX = .08
    rightArmZ = .05
    rightShoulderX = -1.2 - up * .35
    rightElbowX = -.2 + up * .42
    headX = .03
    haloOpacity = .5
  }

  rig.root.position.y = damp(rig.root.position.y, rootY, 8, delta)
  rig.root.rotation.z = damp(rig.root.rotation.z, rootRotZ, 7, delta)
  const nextScale = damp(rig.root.scale.x, .92 * scale, 9, delta)
  rig.root.scale.setScalar(nextScale)
  rig.spine.rotation.x = damp(rig.spine.rotation.x, spineRotX, 8, delta)
  rig.spine.rotation.z = damp(rig.spine.rotation.z, spineRotZ, 8, delta)
  rig.head.rotation.x = damp(rig.head.rotation.x, headX, 9, delta)
  rig.head.rotation.y = damp(rig.head.rotation.y, headY, 8, delta)
  rig.head.rotation.z = damp(rig.head.rotation.z, headZ, 9, delta)
  rig.leftShoulder.rotation.z = damp(rig.leftShoulder.rotation.z, leftArmZ, 9, delta)
  rig.rightShoulder.rotation.z = damp(rig.rightShoulder.rotation.z, rightArmZ, 9, delta)
  rig.rightShoulder.rotation.x = damp(rig.rightShoulder.rotation.x, rightShoulderX, 9, delta)
  rig.leftElbow.rotation.x = damp(rig.leftElbow.rotation.x, leftElbowX, 9, delta)
  rig.rightElbow.rotation.x = damp(rig.rightElbow.rotation.x, rightElbowX, 9, delta)
  rig.mouth.scale.y = damp(rig.mouth.scale.y, mouthScale, 12, delta)
  const haloMat = rig.halo.material as THREE.MeshBasicMaterial
  haloMat.opacity = damp(haloMat.opacity, haloOpacity, 7, delta)
  rig.leftEar.rotation.z = Math.sin(t * 1.15) * .04 - (state === 'listen' ? .1 : 0)
  rig.rightEar.rotation.z = -Math.sin(t * 1.12) * .04 + (state === 'listen' ? .1 : 0)
}

export function PetStage({ agents, activeId, state, syncing, semantic, onSelect, onHandshake, onStatePreview }: Props) {
  const mountRef = useRef<HTMLDivElement>(null)
  const latestRef = useRef({ activeId, state, syncing, semantic, onSelect, onHandshake })
  const [hoveredHand, setHoveredHand] = useState<PetId | null>(null)
  useEffect(() => {
    latestRef.current = { activeId, state, syncing, semantic, onSelect, onHandshake }
  }, [activeId, state, syncing, semantic, onSelect, onHandshake])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const scene = new THREE.Scene()
    scene.fog = new THREE.FogExp2('#edf5ff', .038)
    const camera = new THREE.PerspectiveCamera(27, 1, .1, 100)
    camera.position.set(0, 2.1, 10.4)
    camera.lookAt(0, .55, 0)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8))
    renderer.setClearColor(0xf2f7ff, 0)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.15
    mount.appendChild(renderer.domElement)

    const hemi = new THREE.HemisphereLight('#ffffff', '#d6e4f3', 3.15)
    const key = new THREE.DirectionalLight('#ffffff', 5.8)
    key.position.set(-3.8, 6.4, 6.2); key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.near = .5
    key.shadow.camera.far = 18
    const fill = new THREE.DirectionalLight('#dff1ff', 2.15)
    fill.position.set(4, 3.5, 5)
    const rim = new THREE.DirectionalLight('#c8d9ff', 3.05)
    rim.position.set(5.6, 4.4, -4.6)
    scene.add(hemi, key, fill, rim)

    const floor = mesh(
      new THREE.CircleGeometry(8.8, 96),
      new THREE.MeshStandardMaterial({ color: '#f7fbff', roughness: .64, metalness: .02, transparent: true, opacity: .9 }),
      [0, GROUND_Y, 0],
    )
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    scene.add(floor)
    const contact = mesh(
      new THREE.CircleGeometry(7.6, 96),
      new THREE.MeshBasicMaterial({ color: '#d9e8fb', transparent: true, opacity: .3, depthWrite: false }),
      [0, GROUND_Y + .006, 0],
      [1.2, .34, 1],
    )
    contact.rotation.x = -Math.PI / 2
    scene.add(contact)
    const grid = new THREE.GridHelper(18, 36, '#c8d6e9', '#e2ebf6')
    grid.position.y = GROUND_Y + .012
    ;(grid.material as THREE.Material).opacity = .12
    ;(grid.material as THREE.Material).transparent = true
    scene.add(grid)

    const rigs = agents.map((agent, index) => createPet(agent, index))
    rigs.forEach(rig => scene.add(rig.root))
    const productionAvatars: ProductionAvatar[] = []
    let disposed = false
    const clock = new THREE.Clock()
    const loader = new GLTFLoader()
    agents.forEach(agent => {
      const fallback = rigs.find(rig => rig.id === agent.id)
      const entry = petModelRegistry[agent.id]
      if (!fallback || !entry.glbUrl) return
      loader.load(
        entry.glbUrl,
        gltf => {
          if (disposed) return
          const avatar = prepareProductionAvatar(gltf.scene, fallback, agent, clock.elapsedTime)
          fallback.root.visible = false
          productionAvatars.push(avatar)
          scene.add(avatar.root)
        },
        undefined,
        error => {
          console.warn(`Failed to load ${agent.id} GLB; using procedural fallback`, error)
        },
      )
    })

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    // Live handshake grab: holds which avatar's hand is grabbed and the pointer's
    // normalized vertical position (+1 top … -1 bottom) so the arm can track it.
    let grab: { id: PetId; pointerY: number } | null = null
    const normalizedY = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      return -((event.clientY - rect.top) / rect.height) * 2 + 1
    }
    const hitTest = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      return raycaster.intersectObjects(scene.children, true).find(hit => hit.object.userData.agentId)
    }
    const onPointerDown = (event: PointerEvent) => {
      const hit = hitTest(event)
      if (!hit) return
      const id = hit.object.userData.agentId as PetId
      latestRef.current.onSelect(id)
      if (String(hit.object.userData.bodyPart).startsWith('hand')) {
        grab = { id, pointerY: normalizedY(event) }
        renderer.domElement.setPointerCapture(event.pointerId)
        renderer.domElement.style.cursor = 'grabbing'
        latestRef.current.onHandshake(id)
      }
    }
    const onPointerMove = (event: PointerEvent) => {
      if (grab) {
        // While grabbed, feed the live pointer height to the animation loop.
        grab.pointerY = normalizedY(event)
        renderer.domElement.style.cursor = 'grabbing'
        return
      }
      const hit = hitTest(event)
      const handId = hit && String(hit.object.userData.bodyPart).startsWith('hand') ? hit.object.userData.agentId as PetId : null
      setHoveredHand(handId)
      renderer.domElement.style.cursor = handId ? 'grab' : hit ? 'pointer' : 'default'
    }
    const endGrab = () => {
      grab = null
      setHoveredHand(null)
      renderer.domElement.style.cursor = 'default'
    }
    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerup', endGrab)
    renderer.domElement.addEventListener('pointercancel', endGrab)
    renderer.domElement.addEventListener('pointerleave', endGrab)

    const resize = () => {
      const { width, height } = mount.getBoundingClientRect()
      renderer.setSize(width, height, false)
      camera.aspect = width / Math.max(height, 1)
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(mount); resize()
    let animationId = 0
    const animate = () => {
      animationId = requestAnimationFrame(animate)
      const delta = Math.min(clock.getDelta(), .05)
      const elapsed = clock.elapsedTime
      const current = latestRef.current
      const activeRig = rigs.find(rig => rig.id === current.activeId)
      rigs.forEach(rig => {
        if (productionAvatars.some(avatar => avatar.id === rig.id)) return
        let rigState: MotionState = 'idle'
        if (current.syncing) rigState = rig.id === current.activeId ? 'speak' : 'social'
        else if (rig.id === current.activeId) rigState = current.state
        const targetDelta = activeRig ? THREE.MathUtils.clamp((activeRig.baseX - rig.baseX) * .11, -.42, .42) : 0
        const rigGrab = grab && grab.id === rig.id ? { active: true, pointerY: grab.pointerY } : null
        animateRig(rig, rigState, elapsed, delta, current.semantic, targetDelta, rigGrab)
      })
      productionAvatars.forEach(avatar => {
        let avatarState: MotionState = 'idle'
        if (current.syncing) avatarState = avatar.id === current.activeId ? 'speak' : 'social'
        else if (avatar.id === current.activeId) avatarState = current.state
        const targetDelta = activeRig ? THREE.MathUtils.clamp((activeRig.baseX - avatar.baseX) * .11, -.42, .42) : 0
        let intro: IntroPhase = { kind: 'done' }
        const introElapsed = Math.max(0, elapsed - avatar.introStartedAt - avatar.introDelay)
        if (introElapsed < INTRO_RUN_DURATION) {
          intro = { kind: 'run', progress: introElapsed / INTRO_RUN_DURATION, time: introElapsed }
        } else if (introElapsed < INTRO_RUN_DURATION + INTRO_WAVE_DURATION) {
          const waveTime = introElapsed - INTRO_RUN_DURATION
          intro = { kind: 'wave', progress: waveTime / INTRO_WAVE_DURATION, time: waveTime }
        }
        const idleReady = intro.kind === 'done' && avatarState === 'idle' && !current.syncing
        const idleAccent = idleReady ? resolveIdleAccent(avatar, elapsed) : null
        if (!idleReady && avatar.accentStartedAt >= 0) {
          avatar.accentStartedAt = -1
          avatar.nextAccentAt = elapsed + 3 + Math.random() * 4
        }
        const avatarGrab = grab && grab.id === avatar.id ? { active: true, pointerY: grab.pointerY } : null
        animateProductionAvatar(
          avatar,
          avatarState,
          elapsed,
          delta,
          current.semantic,
          targetDelta,
          intro,
          idleAccent,
          avatarGrab,
        )
      })
      camera.position.x = damp(camera.position.x, activeRig ? activeRig.baseX * .045 : 0, 2.5, delta)
      camera.lookAt(camera.position.x * .18, .54, 0)
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      disposed = true
      cancelAnimationFrame(animationId)
      observer.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerup', endGrab)
      renderer.domElement.removeEventListener('pointercancel', endGrab)
      renderer.domElement.removeEventListener('pointerleave', endGrab)
      renderer.dispose()
      scene.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose()
          if (Array.isArray(object.material)) object.material.forEach(mat => mat.dispose())
          else object.material.dispose()
        }
      })
      mount.removeChild(renderer.domElement)
    }
  }, [agents])

  return (
    <div className="pet-webgl-stage">
      <div ref={mountRef} className="pet-canvas" aria-label="四个实时骨骼 Agent 的 WebGL 舞台" />
      <div className="role-badges" aria-label="角色能力标签">
        {agents.map(agent => <button key={agent.id} className={agent.id === activeId ? 'active' : ''} onClick={() => onSelect(agent.id)} style={{ '--pet-color': agent.color, '--badge-x': roleBadgeMeta[agent.id].x } as React.CSSProperties}>
          <i>{roleBadgeMeta[agent.id].symbol}</i><span>{roleBadgeMeta[agent.id].title}</span>
        </button>)}
      </div>
      <div className="pet-labels">
        {agents.map(agent => <button key={agent.id} className={agent.id === activeId ? 'active' : ''} onClick={() => onSelect(agent.id)} style={{ '--pet-color': agent.color } as React.CSSProperties}>
          <i /><b>{agent.name}</b><span>{agent.role}</span>
        </button>)}
      </div>
      <div className="motion-monitor"><span className="monitor-dot" /><b>{stateLabels[state]}</b><small>{hasProductionModel('atlas') ? '4 RIGGED AGENTS · SEMANTIC BONES' : 'PROCEDURAL RIG · GLB READY'}</small></div>
      <div className="gesture-hint" data-visible={Boolean(hoveredHand)}><span>↕</span> 按住手部上下移动 · 与它握手</div>
      <div className="motion-debug" aria-label="动作状态预览">
        {(Object.keys(stateLabels) as MotionState[]).map(key => <button key={key} className={state === key ? 'active' : ''} onClick={() => onStatePreview(key)}>{stateLabels[key]}</button>)}
      </div>
    </div>
  )
}
