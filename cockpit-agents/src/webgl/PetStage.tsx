import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  resolveCrowdPosition,
  type CircleCollider,
  type OrientedBoxCollider,
  type StagePoint,
} from './crowd-motion'
import { hasProductionModel, petModelRegistry } from './model-registry'
import './PetStage.css'

const GROUND_Y = -1.66
const ATLAS_TARGET_HEIGHT = 3.82
const AVATAR_TARGET_HEIGHT = 3.66

export type MotionState = 'idle' | 'wake' | 'listen' | 'think' | 'speak' | 'social' | 'handshake' | 'dance' | 'music' | 'spin' | 'march' | 'walk' | 'return'
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
  facialMorphs: FacialMorphBinding[]
  idlePersona: IdlePersona
  accentStartedAt: number
  accentDuration: number
  nextAccentAt: number
  introStartedAt: number
  introDelay: number
  collisionRadius: number
  roam: RoamState
}

type RoamState = {
  active: boolean
  returning: boolean
  holding: boolean
  nextWaypointAt: number
  waypointIndex: number
  targetX: number
  targetZ: number
  heading: number
}

type LoadingAvatar = {
  id: PetId
  root: THREE.Group
  points: THREE.Points
  material: THREE.ShaderMaterial
  startedAt: number
  completedAt: number | null
  phase: number
}

type StageVehicle = {
  root: THREE.Group
  collider: OrientedBoxCollider
  entered: boolean
  startedAt: number
  duration: number
  fromX: number
  toX: number
  z: number
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

type StoryGesture =
  | 'routePoint'
  | 'carCheck'
  | 'musicInvite'
  | 'shyNod'
  | 'snackOffer'
  | 'happyBounce'

type StoryMotion = {
  gesture: StoryGesture
  partnerX: number
  partnerZ: number
  intensity: number
}

type StoryActor = {
  destination: StagePoint
  gesture: StoryGesture
  partnerId: PetId
}

type StoryBeat = {
  id: string
  setup: string
  caption: string
  actors: Partial<Record<PetId, StoryActor>>
}

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
  | 'leftUpperLeg' | 'leftLowerLeg' | 'leftFoot' | 'leftToes'
  | 'rightUpperLeg' | 'rightLowerLeg' | 'rightFoot' | 'rightToes'
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

type FacialMorphName =
  | 'face_blink_soft_L'
  | 'face_blink_soft_R'
  | 'face_blink_both'
  | 'face_focus_squint'
  | 'face_smile_soft'
  | 'face_mouth_open_soft'
  | 'face_listen_curious'

type FacialMorphBinding = {
  mesh: THREE.Mesh
  influences: number[]
  dictionary: Record<string, number>
}

const facialMorphNames: FacialMorphName[] = [
  'face_blink_soft_L',
  'face_blink_soft_R',
  'face_blink_both',
  'face_focus_squint',
  'face_smile_soft',
  'face_mouth_open_soft',
  'face_listen_curious',
]

const stateLabels: Record<MotionState, string> = {
  idle: '待机', wake: '唤醒', listen: '聆听', think: '思考', speak: '对话', social: '互聊', handshake: '握手',
  dance: '跳舞', music: '街舞', spin: '旋转', march: '高抬腿', walk: '走动', return: '回来',
}

const profiles: Record<PetId, Rig['profile']> = {
  atlas: { tempo: .72, amplitude: .55, openness: .78, attitude: -.08 },
  nova: { tempo: .56, amplitude: .38, openness: .42, attitude: .03 },
  muse: { tempo: 1.12, amplitude: 1.0, openness: .92, attitude: -.06 },
  milo: { tempo: .88, amplitude: .72, openness: .86, attitude: .08 },
}

type RoamProfile = {
  startDelay: number
  speed: number
  returnSpeed: number
  turnRate: number
  returnTurnRate: number
  maxTurnStep: number
  stepDistance: number
  gaitSeconds: number
  stride: number
  sway: number
  waypoints: StagePoint[]
}

const roamProfiles: Record<PetId, RoamProfile> = {
  atlas: {
    startDelay: 20,
    speed: .46,
    returnSpeed: 1.95,
    turnRate: .82,
    returnTurnRate: 1.35,
    maxTurnStep: Math.PI / 4,
    stepDistance: .92,
    gaitSeconds: 1.667,
    stride: 1,
    sway: .9,
    waypoints: [
      { x: -.85, z: .72 },
      { x: -1.65, z: 1.35 },
      { x: -2.28, z: 1.9 },
      { x: -1.15, z: 1.62 },
      { x: -.35, z: 1.02 },
    ],
  },
  nova: {
    startDelay: 24,
    speed: .5,
    returnSpeed: 2,
    turnRate: .88,
    returnTurnRate: 1.4,
    maxTurnStep: Math.PI / 4,
    stepDistance: .86,
    gaitSeconds: 1.5,
    stride: .9,
    sway: .72,
    waypoints: [
      { x: -.58, z: .82 },
      { x: -1.1, z: 1.48 },
      { x: -.45, z: 2.04 },
      { x: .62, z: 1.58 },
      { x: .82, z: .92 },
    ],
  },
  muse: {
    startDelay: 28,
    speed: .44,
    returnSpeed: 1.9,
    turnRate: .8,
    returnTurnRate: 1.32,
    maxTurnStep: Math.PI / 4,
    stepDistance: .82,
    gaitSeconds: 1.76,
    stride: .92,
    sway: 1.18,
    waypoints: [
      { x: .46, z: .86 },
      { x: 1.16, z: 1.48 },
      { x: .66, z: 2.08 },
      { x: -.46, z: 1.62 },
      { x: -.62, z: 1.02 },
    ],
  },
  milo: {
    startDelay: 32,
    speed: .4,
    returnSpeed: 1.82,
    turnRate: .74,
    returnTurnRate: 1.26,
    maxTurnStep: Math.PI / 4,
    stepDistance: .76,
    gaitSeconds: 1.9,
    stride: .82,
    sway: 1.05,
    waypoints: [
      { x: .55, z: .78 },
      { x: 1.34, z: 1.38 },
      { x: 1.86, z: 1.96 },
      { x: .72, z: 2.08 },
      { x: -.42, z: 1.35 },
    ],
  },
}

const STORY_START_DELAY = 18
const STORY_BEAT_DURATION = 20
const STORY_APPROACH_END = 6.5
const STORY_PERFORM_END = 15

const storyBeats: StoryBeat[] = [
  {
    id: 'route-check',
    setup: '冷开场：阿拓把今晚路线排得像考试计划，诺瓦觉得他过度紧张。',
    caption: '阿拓坚持“提前 12 分钟才浪漫”，诺瓦嘴上嫌弃，还是默默帮他检查车况。',
    actors: {
      atlas: { destination: { x: -3.95, z: 1.22 }, gesture: 'routePoint', partnerId: 'nova' },
      nova: { destination: { x: -1.2, z: 1.18 }, gesture: 'carCheck', partnerId: 'atlas' },
    },
  },
  {
    id: 'music-truce',
    setup: '缪思想用一首歌改变车内气氛，诺瓦说“安全优先，不要情绪驾驶”。',
    caption: '缪思把副歌调低一点；诺瓦嘴上说只听十秒，脚尖却开始悄悄打拍子。',
    actors: {
      muse: { destination: { x: 1.25, z: 1.15 }, gesture: 'musicInvite', partnerId: 'nova' },
      nova: { destination: { x: -1.25, z: 1.18 }, gesture: 'shyNod', partnerId: 'muse' },
    },
  },
  {
    id: 'snack-break',
    setup: '米洛说“顺路”其实绕了 14 分钟，阿拓差点把路线尺拿出来。',
    caption: '米洛递出隐藏菜单点心，阿拓叹气，但还是把它加入“必要补给点”。',
    actors: {
      milo: { destination: { x: 3.75, z: 1.12 }, gesture: 'snackOffer', partnerId: 'atlas' },
      atlas: { destination: { x: .75, z: 1.22 }, gesture: 'happyBounce', partnerId: 'milo' },
    },
  },
  {
    id: 'support-circle',
    setup: '小争吵后，缪思突然有点低落：她担心自己只是“车里的背景音乐”。',
    caption: '诺瓦难得认真夸她：好的声音不是打扰，是让大家愿意继续出发的理由。',
    actors: {
      nova: { destination: { x: -2.18, z: 1.08 }, gesture: 'shyNod', partnerId: 'muse' },
      muse: { destination: { x: .15, z: 1.2 }, gesture: 'musicInvite', partnerId: 'nova' },
      milo: { destination: { x: 2.65, z: 1.16 }, gesture: 'snackOffer', partnerId: 'muse' },
    },
  },
  {
    id: 'departure-cheer',
    setup: '结尾标签：四位伙伴把争论变成了一个更好的今晚计划。',
    caption: '路线、安全、歌单和零食全部就位——他们不是系统模块，是一群会互相兜底的朋友。',
    actors: {
      atlas: { destination: { x: -4.55, z: 1.24 }, gesture: 'routePoint', partnerId: 'nova' },
      nova: { destination: { x: -1.5, z: 1.1 }, gesture: 'shyNod', partnerId: 'atlas' },
      muse: { destination: { x: 1.5, z: 1.1 }, gesture: 'musicInvite', partnerId: 'milo' },
      milo: { destination: { x: 4.55, z: 1.24 }, gesture: 'snackOffer', partnerId: 'muse' },
    },
  },
]

const musicStageFormation: Record<PetId, StagePoint> = {
  atlas: { x: -4.72, z: 1.28 },
  nova: { x: -1.7, z: 1.04 },
  muse: { x: 1.7, z: 1.04 },
  milo: { x: 4.72, z: 1.28 },
}

const roleBadgeMeta: Record<PetId, { title: string; x: string }> = {
  atlas: { title: 'Navigation / Travel Agent', x: '13.4%' },
  nova: { title: 'Car Control Agent', x: '38.3%' },
  muse: { title: 'Music & Video Agent', x: '63.2%' },
  milo: { title: 'Food Service Agent', x: '86.5%' },
}

function RoleBadgeIcon({ id }: { id: PetId }) {
  if (id === 'atlas') {
    return (
      <svg className="role-icon role-icon-atlas" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3.5v17" />
        <path d="M3.5 12h17" />
        <circle cx="12" cy="12" r="4.15" />
        <circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none" />
      </svg>
    )
  }
  if (id === 'nova') {
    return (
      <svg className="role-icon role-icon-nova" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6.4 17.2a7.35 7.35 0 1 1 11.2 0" />
        <path d="M12 6.2v3.7" />
        <path d="M16.9 9.05 14.45 11.5" />
        <circle cx="12" cy="14.15" r="3.65" />
        <path d="M12 14.15h-3.1" />
      </svg>
    )
  }
  if (id === 'muse') {
    return (
      <svg className="role-icon role-icon-muse" viewBox="0 0 24 24" aria-hidden="true">
        <path className="role-icon-fill" d="M8.35 5.55v12.9c0 .82.9 1.32 1.6.88l9.55-6.38a1.08 1.08 0 0 0 0-1.8L9.95 4.77c-.7-.47-1.6.02-1.6.78Z" />
      </svg>
    )
  }
  return (
    <svg className="role-icon role-icon-milo" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7.4 13.4c-1.2 1.15-1.65 2.78-.82 4.05.9 1.38 2.95 2.05 5.42 2.05s4.52-.67 5.42-2.05c.83-1.27.38-2.9-.82-4.05" />
      <path d="M9 4.5c-1.9 2 .85 3.15-.28 5.15" />
      <path d="M12 3.85c-2.1 2.28 1.2 3.55-.2 5.9" />
      <path d="M15.05 4.5c-1.9 2 .85 3.15-.28 5.15" />
    </svg>
  )
}

const INTRO_RUN_DURATION = 2.4
const INTRO_WAVE_DURATION = 3
const PORSCHE_MODEL_URL = '/models/911_dakar_50k.glb?v=20260626-911-dakar'
const STAGE_VEHICLE_X = .38
const STAGE_VEHICLE_Z = -6.35
const STAGE_VEHICLE_YAW = -.5
const STAGE_VEHICLE_VISUAL_YAW = STAGE_VEHICLE_YAW + Math.PI
const STAGE_VEHICLE_LENGTH = 11.3
const DISABLED_VEHICLE_COLLIDER: OrientedBoxCollider = {
  x: 999,
  z: 999,
  yaw: 0,
  halfX: 0,
  halfZ: 0,
}
const STAGE_ROAM_BOUNDS = {
  minX: -6.35,
  maxX: 6.35,
  minZ: -7.65,
  maxZ: 2.35,
}
const CAMERA_ORBIT_YAW_LIMIT = .42
const CAMERA_ORBIT_PITCH_LIMIT = .24
const CAMERA_ORBIT_SENSITIVITY = .0032

const easeOutCubic = (value: number) => 1 - Math.pow(1 - THREE.MathUtils.clamp(value, 0, 1), 3)
const easeInOutSine = (value: number) => -(Math.cos(Math.PI * THREE.MathUtils.clamp(value, 0, 1)) - 1) / 2

const damp = (current: number, target: number, lambda: number, delta: number) =>
  THREE.MathUtils.damp(current, target, lambda, delta)

const normalizeAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle))

const clampHeadingStep = (current: number, target: number, maxStep = Math.PI / 4) =>
  current + THREE.MathUtils.clamp(normalizeAngle(target - current), -maxStep, maxStep)

const rotateTowardsAngle = (current: number, target: number, maxDelta: number) =>
  current + THREE.MathUtils.clamp(normalizeAngle(target - current), -maxDelta, maxDelta)

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

function createContactShadow(
  color = '#5f6878',
  opacity = .18,
  scale: [number, number, number] = [1, .32, 1],
) {
  const shadow = mesh(
    new THREE.CircleGeometry(1, 80),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
    [0, .012, 0],
    scale,
  )
  shadow.rotation.x = -Math.PI / 2
  shadow.castShadow = false
  shadow.receiveShadow = false
  shadow.renderOrder = -2
  return shadow
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
  halo.visible = false
  const contactShadow = createContactShadow('#566170', .16, [1.18, .34, 1])
  root.add(contactShadow, halo)

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
    leftUpperLeg: 'LeftUpperLeg',
    leftLowerLeg: 'LeftLowerLeg',
    leftFoot: 'LeftFoot',
    leftToes: 'LeftToes',
    rightUpperLeg: 'RightUpperLeg',
    rightLowerLeg: 'RightLowerLeg',
    rightFoot: 'RightFoot',
    rightToes: 'RightToes',
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
    bones.leftUpperLeg && bones.rightUpperLeg && 'locomotion.legs',
    bones.leftFoot && bones.rightFoot && 'locomotion.feet',
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
      material.roughness = preservePbr ? Math.min(material.roughness, .56) : .68
      material.metalness = preservePbr ? material.metalness : .03
      material.envMapIntensity = preservePbr ? .82 : .45
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

function collectFacialMorphs(root: THREE.Object3D): FacialMorphBinding[] {
  const bindings: FacialMorphBinding[] = []
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return
    if (!object.morphTargetInfluences || !object.morphTargetDictionary) return
    const hasFacialTarget = facialMorphNames.some(name => object.morphTargetDictionary?.[name] !== undefined)
    if (!hasFacialTarget) return
    bindings.push({
      mesh: object,
      influences: object.morphTargetInfluences,
      dictionary: object.morphTargetDictionary,
    })
  })
  return bindings
}

function dampFacialMorphs(
  avatar: ProductionAvatar,
  delta: number,
  targets: Partial<Record<FacialMorphName, number>>,
  lambda = 12,
) {
  if (!avatar.facialMorphs.length) return
  for (const binding of avatar.facialMorphs) {
    for (const name of facialMorphNames) {
      const index = binding.dictionary[name]
      if (index === undefined) continue
      const target = THREE.MathUtils.clamp(targets[name] ?? 0, 0, 1)
      binding.influences[index] = damp(binding.influences[index] ?? 0, target, lambda, delta)
    }
  }
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

function sampleEllipsoidSurface(
  center: THREE.Vector3,
  radius: THREE.Vector3,
  jitter = .035,
) {
  const theta = Math.random() * Math.PI * 2
  const z = Math.random() * 2 - 1
  const ring = Math.sqrt(Math.max(0, 1 - z * z))
  return new THREE.Vector3(
    center.x + Math.cos(theta) * ring * radius.x + (Math.random() - .5) * jitter,
    center.y + z * radius.y + (Math.random() - .5) * jitter,
    center.z + Math.sin(theta) * ring * radius.z + (Math.random() - .5) * jitter,
  )
}

function sampleCapsuleColumn(
  center: THREE.Vector3,
  radius: THREE.Vector3,
  height: number,
  jitter = .025,
) {
  const y = (Math.random() - .5) * height
  const angle = Math.random() * Math.PI * 2
  const edgeBias = .72 + Math.random() * .28
  return new THREE.Vector3(
    center.x + Math.cos(angle) * radius.x * edgeBias + (Math.random() - .5) * jitter,
    center.y + y + (Math.random() - .5) * jitter,
    center.z + Math.sin(angle) * radius.z * edgeBias + (Math.random() - .5) * jitter,
  )
}

function sampleLineSegment(from: THREE.Vector3, to: THREE.Vector3, jitter = .035) {
  const p = from.clone().lerp(to, Math.random())
  p.x += (Math.random() - .5) * jitter
  p.y += (Math.random() - .5) * jitter
  p.z += (Math.random() - .5) * jitter
  return p
}

function sampleLoadingParticlePosition(id: PetId) {
  const roll = Math.random()
  if (roll < .24) return sampleEllipsoidSurface(new THREE.Vector3(0, 2.34, .02), new THREE.Vector3(.58, .55, .3), .04)
  if (roll < .46) return sampleCapsuleColumn(new THREE.Vector3(0, 1.23, 0), new THREE.Vector3(.58, .5, .28), 1.35, .04)
  if (roll < .57) return sampleEllipsoidSurface(new THREE.Vector3(-.34, 2.88, -.02), new THREE.Vector3(.16, .42, .11), .035)
  if (roll < .68) return sampleEllipsoidSurface(new THREE.Vector3(.34, 2.88, -.02), new THREE.Vector3(.16, .42, .11), .035)
  if (roll < .76) return sampleCapsuleColumn(new THREE.Vector3(-.68, 1.55, .02), new THREE.Vector3(.11, .11, .1), 1.18, .03)
  if (roll < .84) return sampleCapsuleColumn(new THREE.Vector3(.68, 1.55, .02), new THREE.Vector3(.11, .11, .1), 1.18, .03)
  if (roll < .9) return sampleCapsuleColumn(new THREE.Vector3(-.24, .43, .04), new THREE.Vector3(.17, .14, .13), .82, .03)
  if (roll < .96) return sampleCapsuleColumn(new THREE.Vector3(.24, .43, .04), new THREE.Vector3(.17, .14, .13), .82, .03)
  if (id === 'atlas') return sampleLineSegment(new THREE.Vector3(-.86, .15, .08), new THREE.Vector3(-1.18, 1.55, .1), .045)
  if (id === 'nova') return sampleLineSegment(new THREE.Vector3(.15, 1.72, .18), new THREE.Vector3(.82, 1.9, .2), .05)
  if (id === 'muse') return sampleEllipsoidSurface(new THREE.Vector3(-.58, 2.32, .03), new THREE.Vector3(.14, .2, .09), .03)
  return sampleLineSegment(new THREE.Vector3(.78, 1.22, .12), new THREE.Vector3(1.08, 1.88, .1), .04)
}

function createLoadingParticleMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uReveal: { value: 0 },
      uDisperse: { value: 0 },
      uOpacity: { value: 1 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 1.8) },
    },
    vertexShader: `
      uniform float uTime;
      uniform float uReveal;
      uniform float uDisperse;
      uniform float uOpacity;
      uniform float uPixelRatio;
      attribute float aSize;
      attribute float aSeed;
      attribute float aBirth;
      attribute vec3 aScatter;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        float reveal = smoothstep(aBirth - 0.08, aBirth + 0.18, uReveal);
        float drift = sin(uTime * (0.72 + aSeed * 0.34) + aSeed * 19.37);
        vec3 loose = vec3(
          sin(uTime * 0.55 + aSeed * 31.0),
          cos(uTime * 0.64 + aSeed * 17.0),
          sin(uTime * 0.47 + aSeed * 23.0)
        ) * (0.015 + aSeed * 0.045);
        vec3 pos = position + loose + aScatter * pow(uDisperse, 1.22);
        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        float twinkle = 0.78 + sin(uTime * 2.4 + aSeed * 41.0) * 0.22;
        gl_PointSize = aSize * twinkle * uPixelRatio * (260.0 / max(1.0, -mvPosition.z));
        gl_Position = projectionMatrix * mvPosition;
        vColor = color;
        vAlpha = reveal * (1.0 - smoothstep(0.05, 1.0, uDisperse)) * uOpacity;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec2 uv = gl_PointCoord - vec2(0.5);
        float d = length(uv);
        float soft = smoothstep(0.5, 0.08, d);
        float core = smoothstep(0.18, 0.0, d) * 0.35;
        gl_FragColor = vec4(vColor, (soft + core) * vAlpha);
      }
    `,
  })
}

function createLoadingAvatar(agent: PetInfo, fallback: Rig, startedAt: number): LoadingAvatar {
  const count = agent.id === 'atlas' ? 1700 : 1450
  const positions = new Float32Array(count * 3)
  const scatters = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  const seeds = new Float32Array(count)
  const births = new Float32Array(count)
  const accent = new THREE.Color(agent.color)
  const cool = new THREE.Color(agent.id === 'milo' ? '#ffb66f' : agent.id === 'muse' ? '#ffd6f5' : agent.id === 'nova' ? '#c7a8ff' : '#bff8ff')
  const white = new THREE.Color('#ffffff')

  for (let index = 0; index < count; index += 1) {
    const position = sampleLoadingParticlePosition(agent.id)
    positions[index * 3] = position.x
    positions[index * 3 + 1] = position.y
    positions[index * 3 + 2] = position.z

    const scatter = position.clone().sub(new THREE.Vector3(0, 1.65, 0))
    if (scatter.lengthSq() < .01) scatter.set(Math.random() - .5, Math.random() + .2, Math.random() - .5)
    scatter.normalize().multiplyScalar(.42 + Math.random() * 1.25)
    scatter.y += .35 + Math.random() * .72
    scatters[index * 3] = scatter.x
    scatters[index * 3 + 1] = scatter.y
    scatters[index * 3 + 2] = scatter.z

    const color = white.clone().lerp(Math.random() > .52 ? accent : cool, .48 + Math.random() * .45)
    colors[index * 3] = color.r
    colors[index * 3 + 1] = color.g
    colors[index * 3 + 2] = color.b
    sizes[index] = .16 + Math.random() * .36
    seeds[index] = Math.random()
    births[index] = Math.pow(Math.random(), 1.35)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aScatter', new THREE.BufferAttribute(scatters, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1))
  geometry.setAttribute('aBirth', new THREE.BufferAttribute(births, 1))
  geometry.computeBoundingSphere()

  const material = createLoadingParticleMaterial()
  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  points.renderOrder = 3

  const root = new THREE.Group()
  root.name = `loading_particles_${agent.id}`
  root.position.set(fallback.baseX + (agent.id === 'atlas' ? -.08 : 0), GROUND_Y, 0)
  root.userData.agentId = agent.id
  root.add(points)

  return { id: agent.id, root, points, material, startedAt, completedAt: null, phase: fallback.phase }
}

function animateLoadingAvatar(loader: LoadingAvatar, elapsed: number, delta: number) {
  const local = Math.max(0, elapsed - loader.startedAt)
  const reveal = .16 + easeInOutSine(THREE.MathUtils.clamp(local / 1.75, 0, 1)) * .84
  const disperseProgress = loader.completedAt === null
    ? 0
    : easeOutCubic(THREE.MathUtils.clamp((elapsed - loader.completedAt) / 1.55, 0, 1))
  loader.material.uniforms.uTime.value = elapsed + loader.phase
  loader.material.uniforms.uReveal.value = reveal
  loader.material.uniforms.uDisperse.value = disperseProgress
  loader.material.uniforms.uOpacity.value = loader.completedAt === null ? .92 : 1 - disperseProgress
  loader.root.position.y = damp(loader.root.position.y, GROUND_Y + Math.sin(elapsed * .7 + loader.phase) * .018, 7, delta)
  loader.root.rotation.y = damp(loader.root.rotation.y, Math.sin(elapsed * .2 + loader.phase) * .018, 5, delta)
  loader.points.rotation.z = Math.sin(elapsed * .3 + loader.phase) * .01
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
  const collisionRadius = THREE.MathUtils.clamp(
    Math.max(size.x, size.z) * scale * .5 + .16,
    .92,
    1.68,
  )
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
  const facialMorphs = collectFacialMorphs(gltfScene)
  if (rig) {
    wrapper.userData.rigReport = rig.report
    gltfScene.userData.rigReport = rig.report
  }
  if (facialMorphs.length) {
    wrapper.userData.facialMorphs = facialMorphs.map(binding => Object.keys(binding.dictionary))
    gltfScene.userData.facialMorphs = wrapper.userData.facialMorphs
  }

  const halo = mesh(
    new THREE.RingGeometry(1.02, 1.08, 64),
    new THREE.MeshBasicMaterial({ color: agent.color, transparent: true, opacity: 0, side: THREE.DoubleSide }),
    [0, .05, -.42],
    [1.24, .44, 1],
  )
  halo.rotation.x = -Math.PI / 2
  halo.visible = false
  const contactShadow = createContactShadow('#4e5969', agent.id === 'atlas' ? .18 : .16, [1.05, .32, 1])
  wrapper.add(contactShadow, halo, gltfScene)

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
    facialMorphs,
    idlePersona: idlePersonaByPet[agent.id],
    accentStartedAt: -1,
    accentDuration: 2.4,
    nextAccentAt: introStartedAt + introDelay + INTRO_RUN_DURATION + INTRO_WAVE_DURATION + 1.6 + Math.random() * 3.5,
    introStartedAt,
    introDelay,
    collisionRadius,
    roam: {
      active: false,
      returning: false,
      holding: false,
      nextWaypointAt: 0,
      waypointIndex: 0,
      targetX: fallback.baseX + (agent.id === 'atlas' ? -.08 : 0),
      targetZ: 0,
      heading: 0,
    },
  }
}

function prepareStageVehicle(gltfScene: THREE.Group, startedAt: number): StageVehicle {
  const root = new THREE.Group()
  root.name = '911_Dakar_StageVehicle'
  gltfScene.name = '911_Dakar_Model'
  gltfScene.updateMatrixWorld(true)
  const rawBox = new THREE.Box3().setFromObject(gltfScene)
  const rawSize = new THREE.Vector3()
  rawBox.getSize(rawSize)
  if (rawSize.z > rawSize.x * 1.22) gltfScene.rotation.y = Math.PI / 2
  gltfScene.updateMatrixWorld(true)
  const orientedBox = new THREE.Box3().setFromObject(gltfScene)
  const orientedSize = new THREE.Vector3()
  orientedBox.getSize(orientedSize)
  const targetLength = STAGE_VEHICLE_LENGTH
  const longestSide = Math.max(orientedSize.x, orientedSize.z, .001)
  gltfScene.scale.setScalar(targetLength / longestSide)
  gltfScene.updateMatrixWorld(true)
  const scaledBox = new THREE.Box3().setFromObject(gltfScene)
  const scaledSize = new THREE.Vector3()
  const center = new THREE.Vector3()
  scaledBox.getSize(scaledSize)
  scaledBox.getCenter(center)
  gltfScene.position.x -= center.x
  gltfScene.position.y += GROUND_Y - scaledBox.min.y
  gltfScene.position.z -= center.z
  gltfScene.traverse(object => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true
      object.receiveShadow = true
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      materials.forEach(mat => {
        mat.transparent = false
        mat.opacity = 1
        mat.depthWrite = true
        mat.depthTest = true
        if (mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshPhysicalMaterial) {
          if (mat.map) {
            mat.map.colorSpace = THREE.SRGBColorSpace
            mat.map.needsUpdate = true
          }
          mat.roughness = THREE.MathUtils.clamp(mat.roughness, .38, .58)
          mat.metalness = Math.max(mat.metalness, .12)
          mat.envMapIntensity = 1.05
        }
        mat.needsUpdate = true
      })
    }
  })
  const vehicleShadow = createContactShadow('#253044', .22, [6.25, 1.32, 1])
  vehicleShadow.position.z = .05
  root.add(vehicleShadow, gltfScene)
  root.position.set(10.8, 0, STAGE_VEHICLE_Z)
  root.rotation.y = STAGE_VEHICLE_VISUAL_YAW
  root.visible = false
  return {
    root,
    collider: {
      x: STAGE_VEHICLE_X,
      z: STAGE_VEHICLE_Z,
      yaw: STAGE_VEHICLE_VISUAL_YAW,
      halfX: scaledSize.x * .5 + .42,
      halfZ: scaledSize.z * .5 + .48,
    },
    entered: false,
    startedAt,
    duration: 3.6,
    fromX: 10.8,
    toX: STAGE_VEHICLE_X,
    z: STAGE_VEHICLE_Z,
  }
}

function animateStageVehicle(vehicle: StageVehicle, elapsed: number, delta: number) {
  const localTime = elapsed - vehicle.startedAt
  if (!vehicle.entered || !Number.isFinite(vehicle.startedAt) || localTime < 0) {
    vehicle.root.visible = false
    return
  }
  vehicle.root.visible = true
  const progress = THREE.MathUtils.clamp(localTime / vehicle.duration, 0, 1)
  const eased = easeOutCubic(progress)
  const settle = THREE.MathUtils.smoothstep(progress, .76, 1)
  const drivePulse = Math.sin(localTime * 10.5) * (1 - settle)
  vehicle.root.position.x = THREE.MathUtils.lerp(vehicle.fromX, vehicle.toX, eased)
  vehicle.root.position.z = vehicle.z
  vehicle.root.position.y = Math.abs(drivePulse) * .012
  vehicle.root.rotation.z = damp(vehicle.root.rotation.z, drivePulse * .004, 8, delta)
  vehicle.root.rotation.y = damp(vehicle.root.rotation.y, STAGE_VEHICLE_VISUAL_YAW, 7, delta)
}

type RoamMotion = {
  active: boolean
  returning: boolean
  holding: boolean
  targetX: number
  targetZ: number
  heading: number
  speed: number
  returnSpeed: number
  turnRate: number
  returnTurnRate: number
  resolvePosition: (point: StagePoint) => StagePoint
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
  roam: RoamMotion | null,
  story: StoryMotion | null,
) {
  const t = elapsed * .8 + avatar.phase
  const breath = Math.sin(t * 1.35) * .025
  const defaultRootX = avatar.baseX + (avatar.id === 'atlas' ? -.08 : 0)
  let rootX = defaultRootX
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
  let leftArmY = 0
  let rightArmY = 0
  let leftArmZ = 0
  let leftArmX = -1.15
  let rightArmZ = 0
  let rightArmX = -1.15
  let leftLowerArmX = 0
  let rightLowerArmX = 0
  let leftLowerArmZ = 0
  let rightLowerArmZ = 0
  let leftHandX = 0
  let rightHandX = 0
  let hipsX = 0
  let hipsZ = 0
  let leftUpperLegX = 0
  let leftUpperLegZ = 0
  let rightUpperLegX = 0
  let rightUpperLegZ = 0
  let leftLowerLegX = 0
  let rightLowerLegX = 0
  let leftFootX = 0
  let leftFootZ = 0
  let rightFootX = 0
  let rightFootZ = 0
  let leftToesX = 0
  let rightToesX = 0
  let eyeY = headY * .18
  let eyeX = 0
  let fingerCurl = .04
  let fingerOpen = .2
  const blinkCycle = (elapsed * .58 + avatar.phase * .13) % 3.7
  const blinkPulse = blinkCycle < .16 ? Math.sin((blinkCycle / .16) * Math.PI) : 0
  let morphBlink = blinkPulse * .72
  let morphSquint = .04
  let morphSmile = .08 + Math.max(0, semantic.valence) * .08
  let morphMouthOpen = 0
  let morphCurious = 0

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
      leftArmY = 0
      rightArmY = 0
      leftArmZ = -.08 + groove * .04
      rightArmZ = .08 + groove * .04
      leftArmX = -1.02 + beat * .12
      rightArmX = -1.02 - beat * .12
      jawX += .025 + Math.abs(beat) * .02
      eyeX += -.04
      fingerOpen += .25 + Math.abs(beat) * .2
    }
    // atlas · 双手插兜左右张望：手收向胯部、肘部微曲、头缓慢左右扫视
    if (idleAccent.persona === 'pockets') {
      const look = Math.sin(elapsed * .52 + avatar.phase)
      leftArmY = 0
      rightArmY = 0
      leftArmZ = -.08
      rightArmZ = .08
      leftArmX = -1.38
      rightArmX = -1.38
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
      morphCurious += .18 + Math.max(0, look) * .08
      morphSquint += .08
    }
    // milo · 打哈欠伸懒腰（周期触发）
    if (idleAccent.persona === 'yawn' && idleAccent.accent >= 0) {
      const pulse = Math.sin(easeInOutSine(idleAccent.accent) * Math.PI)
      headX += -.13 * pulse
      chestX += .05 * pulse
      jawX += .2 * pulse
      morphMouthOpen += .7 * pulse
      morphBlink += .35 * pulse
      leftArmY = 0
      rightArmY = 0
      leftArmZ = THREE.MathUtils.lerp(leftArmZ, -.2, pulse)
      rightArmZ = THREE.MathUtils.lerp(rightArmZ, .2, pulse)
      leftArmX = THREE.MathUtils.lerp(leftArmX, .42, pulse)
      rightArmX = THREE.MathUtils.lerp(rightArmX, .42, pulse)
      eyeX += -.07 * pulse
      fingerOpen += .3 * pulse
    }
    // nova · 挠头思考（周期触发）
    if (idleAccent.persona === 'scratch' && idleAccent.accent >= 0) {
      const pulse = Math.sin(easeInOutSine(idleAccent.accent) * Math.PI)
      headY += -.08 * pulse
      headZ += .05 * pulse
      headX += .04 * pulse
      rightArmX = THREE.MathUtils.lerp(rightArmX, -.1, pulse)
      rightArmY = 0
      rightArmZ = THREE.MathUtils.lerp(rightArmZ, -.18 + Math.sin(elapsed * 13) * .05, pulse)
      rightLowerArmZ += -.5 * pulse
      rightHandX += Math.sin(elapsed * 16) * .04 * pulse
      fingerCurl += .25 * pulse
      morphSquint += .28 * pulse
      morphCurious += .12 * pulse
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
    leftArmY = 0
    rightArmY = 0
    leftArmZ = -.1
    rightArmZ = .1
    eyeX = -.025
    fingerCurl = .08
    fingerOpen = .45
    morphBlink = Math.max(morphBlink, .18)
    morphSmile += .18
  }
  if (state === 'listen') {
    rootRotX = .04
    rootRotY += -.18
    modelRotX = -.035
    haloOpacity = .34 + Math.sin(elapsed * 3.2) * .06
    headX = -.12
    headY = -.08 + lookTargetX * .18
    chestX = .045
    leftArmY = 0
    rightArmY = 0
    leftArmZ = -.08
    rightArmZ = .08
    eyeX = -.035
    eyeY = -.04 + lookTargetX * .1
    fingerCurl = .02
    fingerOpen = .55
    morphCurious += .65
    morphSquint += .12
    morphSmile += .04
  }
  if (state === 'think') {
    rootRotY += .22 + Math.sin(t * .7) * .06
    modelRotX = -.06
    modelRotZ = -.025
    haloOpacity = .24
    headX = -.17
    headY = .16 + Math.sin(t * .7) * .03
    chestZ = -.035
    rightArmX = -.18
    rightArmY = 0
    rightArmZ = .12
    rightLowerArmZ = .1
    eyeX = -.055
    eyeY = .06
    fingerCurl = .12
    fingerOpen = .12
    morphSquint += .45
    morphCurious += .18 + Math.max(0, Math.sin(t * .7)) * .12
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
    rightArmY = 0
    rightArmZ = .08 + beat * .04
    rightLowerArmZ = .035 + beat * .035
    leftArmY = 0
    leftArmZ = -.08 - Math.sin(elapsed * 3.2) * .03 * semantic.valence
    eyeX = beat * .012
    eyeY = lookTargetX * .08 + beat * .01
    fingerCurl = .08 + Math.abs(beat) * .08 * semantic.energy
    fingerOpen = .32 + semantic.valence * .18
    morphMouthOpen += .22 + Math.abs(beat) * .46
    morphSmile += .18 + semantic.valence * .28
    morphSquint += Math.max(0, beat) * .08
  }
  if (state === 'social') {
    rootRotY += lookTargetX * .55
    modelRotZ = Math.sin(elapsed * 2.4 + avatar.phase) * .018
    haloOpacity = .2
    headY = lookTargetX * .48
    chestZ = -lookTargetX * .045
    leftArmY = 0
    rightArmY = 0
    leftArmZ = -.06
    rightArmZ = .06
    eyeY = lookTargetX * .12
    fingerCurl = .05
    fingerOpen = .28
    morphSmile += .22
    morphCurious += .2
  }
  if (state === 'social' && story) {
    const pulse = Math.sin(elapsed * 4.2 + avatar.phase)
    const softPulse = Math.sin(elapsed * 2.15 + avatar.phase)
    const storyHeading = Math.atan2(
      story.partnerX - avatar.root.position.x,
      story.partnerZ - avatar.root.position.z,
    )
    rootRotY = storyHeading
    headY = softPulse * .035
    eyeY = softPulse * .018
    morphSmile += .22 * story.intensity
    morphCurious += .18 * story.intensity

    if (story.gesture === 'routePoint') {
      rootRotX = .035
      chestZ += -.035
      headX = -.055 + softPulse * .018
      rightArmX = -.34 + pulse * .045
      rightArmZ = -.42
      rightLowerArmZ = -.26
      rightHandX = -.08
      leftArmX = -1.2
      fingerOpen = .78
      fingerCurl = .04
      morphMouthOpen += .16 + Math.abs(pulse) * .18
    }
    if (story.gesture === 'carCheck') {
      const scan = Math.sin(elapsed * 1.35 + avatar.phase)
      rootRotX = .07
      modelRotX = -.045
      headX = -.1 + Math.max(0, softPulse) * .035
      headY += scan * .2
      rightArmX = -.62
      rightArmZ = -.12
      rightLowerArmZ = -.5
      rightHandX = -.12 + pulse * .03
      leftArmX = -1.28
      morphSquint += .35
      morphSmile += .08
      fingerCurl = .26
    }
    if (story.gesture === 'musicInvite') {
      const beat = Math.sin(elapsed * 5.4 + avatar.phase)
      rootY += Math.max(0, beat) * .032
      rootRotZ += softPulse * .035
      modelRotZ += softPulse * .025
      headZ += softPulse * .11
      leftArmX = -.18
      leftArmZ = .18
      leftLowerArmZ = .52
      rightArmX = -.48 + beat * .08
      rightArmZ = -.38
      rightLowerArmZ = -.24
      fingerOpen = .72
      morphBlink += Math.max(0, beat) * .12
      morphSmile += .36
    }
    if (story.gesture === 'shyNod') {
      const nod = Math.max(0, Math.sin(elapsed * 3.1 + avatar.phase))
      rootY += Math.max(0, pulse) * .012
      headX = -.04 + nod * .09
      headZ += softPulse * .025
      chestX += nod * .018
      leftArmX = -1.28
      rightArmX = -1.28
      leftFootX += Math.max(0, pulse) * .08
      morphSquint += nod * .12
      morphSmile += .28
    }
    if (story.gesture === 'snackOffer') {
      const offer = .7 + Math.max(0, softPulse) * .2
      rootRotX = .055
      rootY += Math.max(0, pulse) * .02
      headX = -.075
      leftArmX = -.56
      rightArmX = -.56
      leftArmZ = -.28
      rightArmZ = .28
      leftLowerArmZ = -.42 * offer
      rightLowerArmZ = .42 * offer
      leftHandX = -.12
      rightHandX = -.12
      fingerCurl = .22
      fingerOpen = .35
      morphMouthOpen += .12 + Math.max(0, pulse) * .12
      morphSmile += .38
    }
    if (story.gesture === 'happyBounce') {
      const bounce = Math.max(0, Math.sin(elapsed * 5.8 + avatar.phase))
      rootY += bounce * .055
      rootRotZ += softPulse * .04
      headZ += -softPulse * .085
      leftArmX = -.48 + bounce * .12
      rightArmX = -.48 + bounce * .12
      leftArmZ = -.24
      rightArmZ = .24
      leftLowerArmZ = -.58
      rightLowerArmZ = .58
      fingerOpen = .58
      morphBlink += bounce * .12
      morphSmile += .42
      morphMouthOpen += bounce * .16
    }
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
    rightArmX = -.2
    rightArmY = 0
    rightArmZ = -.08 + shake * .18
    rightLowerArmZ = -.1 + shake * .55
    rightHandX = shake * .5
    eyeX = -.02
    eyeY = -.03
    fingerCurl = .18 + Math.abs(shake) * .45
    fingerOpen = .08
    morphSmile += .28
    morphCurious += .22
  }

  if (state === 'music') {
    // Group street-dance mode: shared 8-count phrase with role-specific
    // accents, so the agents feel choreographed instead of each doing the
    // same loop. Kept bone angles plush and toy-safe to avoid mesh tearing.
    const stageIndex = avatar.id === 'atlas' ? 0 : avatar.id === 'nova' ? 1 : avatar.id === 'muse' ? 2 : 3
    const phrase = elapsed * (Math.PI * 2 / 1.08) + stageIndex * .54
    const eight = elapsed * (Math.PI * 2 / 4.32)
    const beat = Math.sin(phrase)
    const beat2 = Math.sin(phrase * 2)
    const hit = Math.max(0, Math.sin(phrase * 2.0)) ** 1.18
    const wave = Math.sin(eight + stageIndex * .82)
    const cross = Math.sin(eight * .5 + stageIndex * 1.15)
    const leftStep = Math.max(0, Math.sin(phrase + stageIndex * .3)) ** .9
    const rightStep = Math.max(0, -Math.sin(phrase + stageIndex * .3)) ** .9
    const cannon = Math.max(0, Math.sin(eight * 2 - stageIndex * .62)) ** 1.7
    rootY += .035 + hit * .07
    rootRotX = -.035 + hit * .035
    rootRotY = Math.sin(eight * .5 + stageIndex) * .18
    rootRotZ += beat * .075 + wave * .045
    modelRotX += -.045 + hit * .035
    modelRotZ += beat * .07
    scale = 1.025 + hit * .022
    haloOpacity = .7 + cannon * .12
    hipsX += hit * .025
    hipsZ += -beat * .12 + wave * .06
    chestX += .06 + hit * .045
    chestZ += beat * .12 + cross * .05
    headX += -.035 + hit * .045
    headY += -cross * .22 + lookTargetX * .05
    headZ += -beat * .12 + wave * .06
    leftArmY = 0
    rightArmY = 0
    leftArmX = -1.02 + leftStep * .36 - cannon * .2
    rightArmX = -1.02 + rightStep * .36 - cannon * .2
    leftArmZ = -.26 + beat * .16 - wave * .18
    rightArmZ = .26 + beat * .16 + wave * .18
    leftLowerArmX = -.18 - leftStep * .22 + cannon * .16
    rightLowerArmX = -.18 - rightStep * .22 + cannon * .16
    leftLowerArmZ = -.4 - beat2 * .16 - cannon * .18
    rightLowerArmZ = .4 + beat2 * .16 + cannon * .18
    leftHandX = Math.sin(phrase * 2.2 + stageIndex) * .08
    rightHandX = Math.sin(phrase * 2.2 + stageIndex + Math.PI) * .08
    leftUpperLegX = -.28 * leftStep + .13 * rightStep + hit * .04
    rightUpperLegX = -.28 * rightStep + .13 * leftStep + hit * .04
    leftUpperLegZ = -.06 - leftStep * .06 + wave * .02
    rightUpperLegZ = .06 + rightStep * .06 + wave * .02
    leftLowerLegX = .55 * leftStep - .18 * rightStep + cannon * .12
    rightLowerLegX = .55 * rightStep - .18 * leftStep + cannon * .12
    leftFootX = -.27 * leftStep + .08 * rightStep
    rightFootX = -.27 * rightStep + .08 * leftStep
    leftFootZ = -.09 + leftStep * .04
    rightFootZ = .09 - rightStep * .04
    leftToesX = .25 * leftStep + hit * .06
    rightToesX = .25 * rightStep + hit * .06
    jawX += .035 + hit * .05
    eyeX = -.045 + cannon * .02
    eyeY = cross * .08
    fingerCurl = .05 + hit * .1
    fingerOpen = .76 + cannon * .18
    morphMouthOpen += .2 + hit * .36
    morphSmile += .55 + cannon * .16
    morphSquint += .2 + hit * .12
    morphCurious += .14 + cannon * .28

    if (avatar.id === 'atlas') {
      // Leader: crisp route-master points and chest pops.
      rightArmX += .22 + cannon * .32
      rightArmZ += -.3 - cannon * .2
      rightLowerArmZ += -.35 - cannon * .18
      leftArmX += hit * .12
      headY += -.16 + cannon * .12
      chestZ += hit * .08
    } else if (avatar.id === 'nova') {
      // Power/popping: grounded shoulders and compact punches.
      rootY += cannon * .025
      rootRotZ += -wave * .04
      leftArmX += cannon * .28
      rightArmX += cannon * .28
      leftLowerArmZ += -.18
      rightLowerArmZ += .18
      morphSquint += .18
    } else if (avatar.id === 'muse') {
      // Wave/body roll: musical upper-body snake and headphone groove.
      headZ += Math.sin(eight * 2.2) * .12
      chestZ += Math.sin(eight * 2.2 - .7) * .18
      leftArmX += .32 * Math.max(0, wave)
      rightArmX += .32 * Math.max(0, -wave)
      leftLowerArmZ += wave * .32
      rightLowerArmZ += wave * .32
      morphBlink += Math.max(0, beat) * .18
    } else {
      // Milo: cute hype-man bounce with two-hand cheer hits.
      rootY += hit * .045
      leftArmX += .24 + cannon * .22
      rightArmX += .24 + cannon * .22
      leftArmZ -= .18
      rightArmZ += .18
      leftLowerArmZ -= .22
      rightLowerArmZ += .22
      morphMouthOpen += cannon * .22
    }
  }

  if (state === 'dance') {
    // Inspired by Mesh2Motion Dance_Loop: 1.25s phrase, visible pelvis sway,
    // spine/body roll, calf pulses and playful hand accents. Kept conservative
    // so Ata parts-v3 does not inherit Mesh2Motion's mesh stretching.
    const phrase = elapsed * (Math.PI * 2 / 1.25) + avatar.phase
    const beat = Math.sin(phrase)
    const half = Math.sin(phrase * .5 + avatar.phase * .3)
    const bodyRoll = Math.sin(phrase - .72)
    const shoulderRoll = Math.sin(phrase + .9)
    const pop = Math.max(0, Math.sin(phrase * 2.0)) ** 1.35
    const leftTap = Math.max(0, Math.sin(phrase + .25)) ** .85
    const rightTap = Math.max(0, -Math.sin(phrase + .25)) ** .85
    const pointRight = Math.max(0, Math.sin(phrase * .5 + .55)) ** .7
    const pointLeft = Math.max(0, -Math.sin(phrase * .5 + .55)) ** .7
    rootY += .028 + pop * .05 + Math.abs(beat) * .018
    rootRotX = -.025 + pop * .025
    rootRotY += half * .16 + lookTargetX * .1
    rootRotZ += bodyRoll * .115
    modelRotX += -.035 + pop * .025
    modelRotZ += beat * .055
    scale = 1.015 + pop * .016
    haloOpacity = .56 + pop * .08
    hipsX += pop * .018
    hipsZ += -bodyRoll * .14
    headX += -.035 + pop * .035
    headY += -half * .2 + lookTargetX * .05
    headZ += -bodyRoll * .11 + shoulderRoll * .035
    chestX += .045 + pop * .035
    chestZ += bodyRoll * .13
    leftArmY = 0
    rightArmY = 0
    leftArmX = -1.08 + pointLeft * .48 - pointRight * .12
    rightArmX = -1.08 + pointRight * .54 - pointLeft * .1
    leftArmZ = -.2 - shoulderRoll * .13 - pointLeft * .2
    rightArmZ = .2 - shoulderRoll * .13 + pointRight * .18
    leftLowerArmX = -.16 - pointLeft * .16
    rightLowerArmX = -.16 - pointRight * .18
    leftLowerArmZ = -.36 - beat * .18 - pointLeft * .18
    rightLowerArmZ = .36 - beat * .18 + pointRight * .2
    leftHandX = Math.sin(phrase * 2.2) * .055 - pointLeft * .045
    rightHandX = Math.sin(phrase * 2.2 + .9) * .07 + pointRight * .06
    leftUpperLegX = -.18 * leftTap + .08 * rightTap + pop * .03
    rightUpperLegX = -.18 * rightTap + .08 * leftTap + pop * .03
    leftUpperLegZ = -.045 - leftTap * .045 + bodyRoll * .018
    rightUpperLegZ = .045 + rightTap * .045 + bodyRoll * .018
    leftLowerLegX = .42 * leftTap - .12 * rightTap
    rightLowerLegX = .42 * rightTap - .12 * leftTap
    leftFootX = -.22 * leftTap + .06 * rightTap
    rightFootX = -.22 * rightTap + .06 * leftTap
    leftFootZ = -.08 + leftTap * .03
    rightFootZ = .08 - rightTap * .03
    leftToesX = .22 * leftTap + pop * .04
    rightToesX = .22 * rightTap + pop * .04
    jawX += .04 + pop * .05
    eyeX = -.045 + pointRight * .018
    eyeY = half * .08
    fingerCurl = .05 + pop * .08
    fingerOpen = .72 + Math.max(pointLeft, pointRight) * .2
    morphMouthOpen += .18 + pop * .34
    morphSmile += .48 + Math.max(pointLeft, pointRight) * .18
    morphSquint += .18 + pop * .12
    morphCurious += .14 + Math.max(pointLeft, pointRight) * .24
  }

  if (state === 'walk') {
    // Mesh2Motion Walk_Loop reference: 1.667s cycle, moderate thigh/calf
    // rotation, small pelvis travel, light wrist swing. This is used for
    // autonomous roaming so Ata feels alive without looking like he is jogging.
    const walkProfile = roamProfiles[avatar.id]
    const cycle = elapsed * (Math.PI * 2 / walkProfile.gaitSeconds) + avatar.phase
    const step = Math.sin(cycle)
    const leftStep = Math.max(0, step) ** .82
    const rightStep = Math.max(0, -step) ** .82
    const heel = Math.abs(Math.cos(cycle)) ** 2.15
    const strideScale = walkProfile.stride
    const swayScale = walkProfile.sway
    rootY += (heel * .026 + Math.max(leftStep, rightStep) * .022) * strideScale
    rootRotX = .035
    rootRotY = (roam?.heading ?? rootRotY) + step * .025
    rootRotZ += step * .025 * swayScale
    modelRotX = -.028
    modelRotZ += step * .014 * swayScale
    hipsX += heel * .012
    hipsZ += -step * .032 * swayScale
    chestX += .025 + heel * .012
    chestZ += step * .025 * swayScale
    headX += -.035 + heel * .012
    headY += -step * .055 * swayScale
    headZ += -step * .026 * swayScale
    leftArmY = 0
    rightArmY = 0
    leftArmX = -1.17 - step * .11 * strideScale
    rightArmX = -1.17 + step * .11 * strideScale
    leftArmZ = -.13 + step * .06
    rightArmZ = .13 + step * .06
    leftLowerArmX = -.22 - rightStep * .08
    rightLowerArmX = -.22 - leftStep * .08
    leftLowerArmZ = -.32 - rightStep * .1
    rightLowerArmZ = .32 + leftStep * .1
    leftHandX = Math.sin(cycle + .8) * .045
    rightHandX = Math.sin(cycle + Math.PI + .8) * .045
    leftUpperLegX = (-.44 * leftStep + .16 * rightStep) * strideScale
    rightUpperLegX = (-.44 * rightStep + .16 * leftStep) * strideScale
    leftUpperLegZ = -.025 - leftStep * .035
    rightUpperLegZ = .025 + rightStep * .035
    leftLowerLegX = (.62 * leftStep - .18 * rightStep) * strideScale
    rightLowerLegX = (.62 * rightStep - .18 * leftStep) * strideScale
    leftFootX = (-.28 * leftStep + .08 * rightStep) * strideScale
    rightFootX = (-.28 * rightStep + .08 * leftStep) * strideScale
    leftFootZ = -.04 + leftStep * .018
    rightFootZ = .04 - rightStep * .018
    leftToesX = .22 * leftStep + heel * .03
    rightToesX = .22 * rightStep + heel * .03
    fingerCurl = .18
    fingerOpen = .24
    haloOpacity = .25
    morphSmile += .08
    morphCurious += .08
  }

  if (state === 'return') {
    const cycle = elapsed * 12.8 + avatar.phase
    const stride = Math.sin(cycle)
    const leftDrive = Math.max(0, stride) ** .78
    const rightDrive = Math.max(0, -stride) ** .78
    const bounce = Math.max(leftDrive, rightDrive)
    const footFall = Math.abs(Math.cos(cycle)) ** 2.1
    rootY += bounce * .085 + footFall * .018
    rootRotX = .16
    rootRotY = (roam?.heading ?? rootRotY) + stride * .025
    rootRotZ += stride * .03
    modelRotX = -.07
    modelRotZ += stride * .028
    hipsX += -bounce * .028
    hipsZ += -stride * .04
    chestX += .07 + bounce * .03
    headX += -.08 + bounce * .018
    headY += stride * .032
    leftArmY = 0
    rightArmY = 0
    leftArmX = -1.26 - stride * .16
    rightArmX = -1.26 + stride * .16
    leftArmZ = -.2 + stride * .12
    rightArmZ = .2 + stride * .12
    leftLowerArmX = -.4 - rightDrive * .12
    rightLowerArmX = -.4 - leftDrive * .12
    leftLowerArmZ = -.48 - rightDrive * .14
    rightLowerArmZ = .48 + leftDrive * .14
    leftUpperLegX = -.58 * leftDrive + .22 * rightDrive
    rightUpperLegX = -.58 * rightDrive + .22 * leftDrive
    leftLowerLegX = .82 * leftDrive - .24 * rightDrive
    rightLowerLegX = .82 * rightDrive - .24 * leftDrive
    leftFootX = -.38 * leftDrive + .08 * rightDrive
    rightFootX = -.38 * rightDrive + .08 * leftDrive
    leftToesX = .28 * leftDrive + footFall * .035
    rightToesX = .28 * rightDrive + footFall * .035
    fingerCurl = .24
    fingerOpen = .12
    haloOpacity = .5
    morphMouthOpen += .08 + bounce * .08
    morphSmile += .22
    morphSquint += .08
  }

  if (state === 'spin') {
    const spinTime = elapsed * 3.2 + avatar.phase
    const lift = Math.sin(elapsed * 6 + avatar.phase)
    const toe = Math.max(0, lift)
    rootY += Math.max(0, lift) * .05
    rootRotY = spinTime
    rootRotZ += Math.sin(elapsed * 4 + avatar.phase) * .035
    modelRotZ += Math.sin(elapsed * 8 + avatar.phase) * .025
    haloOpacity = .5
    headX += -.025
    headZ += Math.sin(elapsed * 5 + avatar.phase) * .04
    chestZ += Math.sin(elapsed * 4 + avatar.phase) * .04
    leftArmY = 0
    rightArmY = 0
    leftArmZ = -.08
    rightArmZ = .08
    leftArmX = -.75
    rightArmX = -.75
    leftUpperLegZ = -.08
    rightUpperLegZ = .08
    leftFootZ = -.12
    rightFootZ = .12
    leftToesX = .22 * toe
    rightToesX = .22 * toe
    fingerOpen = .7
    morphSmile += .22
    morphCurious += .12
  }

  if (state === 'march') {
    const cycle = elapsed * 11.4 + avatar.phase
    const step = Math.sin(cycle)
    const armStep = Math.sin(cycle + Math.PI)
    const leftLift = Math.max(0, step) ** .78
    const rightLift = Math.max(0, -step) ** .78
    const bounce = Math.max(leftLift, rightLift)
    const footFall = Math.abs(Math.cos(cycle)) ** 2.2
    const settle = 1 - bounce
    rootY += bounce * .085 + footFall * .02
    rootRotX = .13 + bounce * .025
    rootRotZ += step * .035
    modelRotX = -.11 + bounce * .035
    modelRotZ += step * .026
    hipsX += -bounce * .038 + footFall * .018
    hipsZ += -step * .05
    haloOpacity = .46
    headX += -.105 + bounce * .02
    headY += step * .038
    chestX += .07 + bounce * .045
    leftArmY = 0
    rightArmY = 0
    leftArmZ = -.2 + armStep * .16
    rightArmZ = .2 + armStep * .16
    leftArmX = -1.28 + armStep * .16
    rightArmX = -1.28 - armStep * .16
    leftLowerArmX = -.42 - Math.max(0, -armStep) * .16
    rightLowerArmX = -.42 - Math.max(0, armStep) * .16
    leftLowerArmZ = -.48 - Math.max(0, -armStep) * .18
    rightLowerArmZ = .48 + Math.max(0, armStep) * .18
    leftHandX = -.08 + Math.max(0, -armStep) * .08
    rightHandX = -.08 + Math.max(0, armStep) * .08
    leftUpperLegX = -.76 * leftLift + .28 * rightLift
    rightUpperLegX = -.76 * rightLift + .28 * leftLift
    leftUpperLegZ = -.04 - leftLift * .055 + settle * .012
    rightUpperLegZ = .04 + rightLift * .055 - settle * .012
    leftLowerLegX = 1.14 * leftLift - .34 * rightLift
    rightLowerLegX = 1.14 * rightLift - .34 * leftLift
    leftFootX = -.52 * leftLift + .12 * rightLift
    rightFootX = -.52 * rightLift + .12 * leftLift
    leftToesX = .38 * leftLift + footFall * .05
    rightToesX = .38 * rightLift + footFall * .05
    jawX += .018
    fingerCurl = .2 + bounce * .08
    morphMouthOpen += bounce * .12
    morphSquint += bounce * .08
  }

  if (intro.kind === 'run') {
    const p = easeOutCubic(intro.progress)
    const decel = THREE.MathUtils.smoothstep(intro.progress, .68, 1) // 0 → 1 as they brake to a stop
    const run = 1 - decel                                            // running intensity, fades near arrival
    const cycle = intro.time * 14.2 + avatar.phase
    const stride = Math.sin(cycle)
    const armStep = Math.sin(cycle + Math.PI)
    const leftDrive = Math.max(0, stride) ** .76
    const rightDrive = Math.max(0, -stride) ** .76
    const bounce = Math.max(leftDrive, rightDrive)
    const footFall = Math.abs(Math.cos(cycle)) ** 2.25
    const brake = THREE.MathUtils.smoothstep(intro.progress, .76, 1)
    rootZ = -7.4 * (1 - p)
    rootY += (bounce * .095 + footFall * .02) * run - brake * .035     // springy gait, then a tiny squash on stop
    rootRotX += .24 * run - .08 * brake                                // lean into run, then settle backward
    rootRotY += Math.sin(intro.time * 2.6 + avatar.phase) * .04 * run
    rootRotZ += stride * .03 * run
    modelRotX += -.08 * run + .04 * brake
    modelRotZ += stride * .032 * run
    hipsX += (-bounce * .035 + footFall * .014) * run
    hipsZ += -stride * .048 * run
    chestX += (.08 + bounce * .04) * run
    leftArmY = 0
    rightArmY = 0
    leftArmZ = (-.22 + armStep * .14) * run
    rightArmZ = (.22 + armStep * .14) * run
    leftArmX = -1.3 + armStep * .15 * run                              // tucked arm pump; avoids Mesh2Motion-style stretching/zombie reach
    rightArmX = -1.3 - armStep * .15 * run
    leftLowerArmX = -.46 * run - Math.max(0, -armStep) * .14 * run
    rightLowerArmX = -.46 * run - Math.max(0, armStep) * .14 * run
    leftLowerArmZ = (-.5 - Math.max(0, -armStep) * .16) * run
    rightLowerArmZ = (.5 + Math.max(0, armStep) * .16) * run
    leftHandX = (-.08 + Math.max(0, -armStep) * .06) * run
    rightHandX = (-.08 + Math.max(0, armStep) * .06) * run
    leftUpperLegX = -.64 * leftDrive * run + .25 * rightDrive * run
    rightUpperLegX = -.64 * rightDrive * run + .25 * leftDrive * run
    leftUpperLegZ = (-.04 - leftDrive * .045) * run
    rightUpperLegZ = (.04 + rightDrive * .045) * run
    leftLowerLegX = .94 * leftDrive * run - .28 * rightDrive * run
    rightLowerLegX = .94 * rightDrive * run - .28 * leftDrive * run
    leftFootX = -.42 * leftDrive * run + .1 * rightDrive * run
    rightFootX = -.42 * rightDrive * run + .1 * leftDrive * run
    leftFootZ = -.035 * run
    rightFootZ = .035 * run
    leftToesX = (.3 * leftDrive + footFall * .04) * run
    rightToesX = (.3 * rightDrive + footFall * .04) * run
    headX += -.1 * run + brake * .04
    headY += rootRotY * .3
    jawX += .012 * run
    fingerCurl = .22 * run
    fingerOpen = .12 * run
    haloOpacity = .12 + p * .2
    morphMouthOpen += .08 * run
    morphSquint += .08 * run
  }
  if (intro.kind === 'wave') {
    const env = Math.sin(Math.PI * THREE.MathUtils.clamp(intro.progress, 0, 1)) // ease wave in and out over 3s
    const wave = Math.sin(intro.time * 9.2 + avatar.phase) * env
    const helloLift = easeInOutSine(THREE.MathUtils.clamp(intro.progress * 1.9, 0, 1)) *
      (1 - easeInOutSine(THREE.MathUtils.clamp((intro.progress - .82) / .18, 0, 1)))
    rootZ = 0
    rootY += Math.max(0, Math.sin(intro.time * 3.4 + avatar.phase)) * .025 * env
    rootRotY += -.035 * helloLift
    rootRotZ += wave * .018
    headY += lookTargetX * .12 + wave * .045
    headZ += wave * .035
    headX += -.03 * helloLift
    chestX += .025 * helloLift
    leftArmX = THREE.MathUtils.lerp(leftArmX, .72, helloLift)
    rightArmX = THREE.MathUtils.lerp(rightArmX, .72, helloLift)
    leftArmY = 0
    rightArmY = 0
    leftArmZ = THREE.MathUtils.lerp(leftArmZ, -.18 + wave * .08, helloLift)
    rightArmZ = THREE.MathUtils.lerp(rightArmZ, .18 + wave * .08, helloLift)
    leftLowerArmZ += (-.28 - wave * .16) * helloLift
    rightLowerArmZ += (.28 + wave * .16) * helloLift
    leftHandX += -wave * .1
    rightHandX += wave * .18
    leftUpperLegX = -.04 * helloLift
    rightUpperLegX = -.04 * helloLift
    leftLowerLegX = .12 * helloLift
    rightLowerLegX = .12 * helloLift
    fingerCurl = .04
    fingerOpen = .6
    jawX += .04 * helloLift
    haloOpacity = .3 + helloLift * .12
    morphSmile += .42 * helloLift
    morphMouthOpen += .18 * helloLift
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
    leftArmY = 0
    rightArmY = 0
    leftArmZ = 0
    leftArmX = -1.15
    rightArmZ = -.08
    rightArmX = -.95 - up * .38
    rightLowerArmZ = -.32 + up * .5
    rightHandX = up * .42
    fingerCurl = .55
    fingerOpen = .05
    haloOpacity = .6
    morphSmile += .2
  }

  morphMouthOpen = Math.max(morphMouthOpen, THREE.MathUtils.clamp(jawX * 3.2, 0, .55))
  dampFacialMorphs(avatar, delta, {
    face_blink_both: morphBlink,
    face_focus_squint: morphSquint,
    face_smile_soft: morphSmile,
    face_mouth_open_soft: morphMouthOpen,
    face_listen_curious: morphCurious,
  }, 13)

  if (roam?.active || roam?.returning || roam?.holding) {
    rootX = roam.targetX
    rootZ = roam.targetZ
    const dx = rootX - avatar.root.position.x
    const dz = rootZ - avatar.root.position.z
    const distance = Math.hypot(dx, dz)
    const speed = roam.returning ? roam.returnSpeed : roam.active ? roam.speed : 0
    if (speed > 0 && distance > .002) {
      const step = Math.min(distance, speed * delta)
      const nextX = avatar.root.position.x + (dx / distance) * step
      const nextZ = avatar.root.position.z + (dz / distance) * step
      const safePosition = roam.resolvePosition({ x: nextX, z: nextZ })
      avatar.root.position.x = safePosition.x
      avatar.root.position.z = safePosition.z
    } else if (roam.holding) {
      const safePosition = roam.resolvePosition({ x: rootX, z: rootZ })
      avatar.root.position.x = damp(avatar.root.position.x, safePosition.x, 8, delta)
      avatar.root.position.z = damp(avatar.root.position.z, safePosition.z, 8, delta)
    }
  } else {
    avatar.root.position.x = damp(avatar.root.position.x, rootX, 8, delta)
    avatar.root.position.z = damp(avatar.root.position.z, rootZ, intro.kind === 'run' ? 5 : 8, delta)
  }
  avatar.root.position.y = damp(avatar.root.position.y, rootY, 8, delta)
  avatar.root.rotation.x = damp(avatar.root.rotation.x, rootRotX, 8, delta)
  if (roam?.active || roam?.returning || roam?.holding) {
    const maxTurnPerSecond = roam.returning ? roam.returnTurnRate : roam.turnRate
    avatar.root.rotation.y = rotateTowardsAngle(avatar.root.rotation.y, rootRotY, maxTurnPerSecond * delta)
  } else {
    avatar.root.rotation.y = damp(avatar.root.rotation.y, rootRotY, 8, delta)
  }
  avatar.root.rotation.z = damp(avatar.root.rotation.z, rootRotZ, 8, delta)
  avatar.model.rotation.x = damp(avatar.model.rotation.x, modelRotX, 9, delta)
  avatar.model.rotation.z = damp(avatar.model.rotation.z, modelRotZ, 9, delta)
  const nextScale = damp(avatar.root.scale.x, scale, 9, delta)
  avatar.root.scale.setScalar(nextScale)
  dampBone(avatar.rig, 'head', delta, { x: headX, y: headY, z: headZ }, 10)
  dampBone(avatar.rig, 'neck', delta, { x: headX * .28, y: headY * .32, z: headZ * .28 }, 9)
  dampBone(avatar.rig, 'leftEye', delta, { x: eyeX, y: eyeY }, 14)
  dampBone(avatar.rig, 'rightEye', delta, { x: eyeX, y: eyeY }, 14)
  dampBone(avatar.rig, 'hips', delta, { x: hipsX, z: hipsZ }, 9)
  dampBone(avatar.rig, 'upperChest', delta, { x: chestX, z: chestZ }, 8)
  dampBone(avatar.rig, 'chest', delta, { x: chestX * .52, z: chestZ * .52 }, 8)
  dampBone(avatar.rig, 'jaw', delta, { x: jawX }, 14)
  dampBone(avatar.rig, 'leftUpperArm', delta, { x: leftArmX, y: leftArmY, z: leftArmZ }, 9)
  dampBone(avatar.rig, 'rightUpperArm', delta, { x: rightArmX, y: rightArmY, z: rightArmZ }, 9)
  dampBone(avatar.rig, 'leftLowerArm', delta, { x: leftLowerArmX, z: leftLowerArmZ }, 9)
  dampBone(avatar.rig, 'rightLowerArm', delta, { x: rightLowerArmX, z: rightLowerArmZ }, 9)
  dampBone(avatar.rig, 'leftHand', delta, { x: leftHandX }, 10)
  dampBone(avatar.rig, 'rightHand', delta, { x: rightHandX }, 10)
  dampBone(avatar.rig, 'leftUpperLeg', delta, { x: leftUpperLegX, z: leftUpperLegZ }, 10)
  dampBone(avatar.rig, 'rightUpperLeg', delta, { x: rightUpperLegX, z: rightUpperLegZ }, 10)
  dampBone(avatar.rig, 'leftLowerLeg', delta, { x: leftLowerLegX }, 10)
  dampBone(avatar.rig, 'rightLowerLeg', delta, { x: rightLowerLegX }, 10)
  dampBone(avatar.rig, 'leftFoot', delta, { x: leftFootX, z: leftFootZ }, 11)
  dampBone(avatar.rig, 'rightFoot', delta, { x: rightFootX, z: rightFootZ }, 11)
  dampBone(avatar.rig, 'leftToes', delta, { x: leftToesX }, 12)
  dampBone(avatar.rig, 'rightToes', delta, { x: rightToesX }, 12)
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

  if (state === 'music' || state === 'dance') {
    const phrase = elapsed * 5.8 + rig.phase
    const beat = Math.sin(phrase)
    const pop = Math.max(0, Math.sin(phrase * 2)) ** 1.2
    rootY += .04 + pop * .06
    rootRotZ = p.attitude + beat * .08
    spineRotX = -.03 + pop * .06
    spineRotZ = beat * .16 * p.amplitude
    headX = -.04 + pop * .05
    headY = Math.sin(phrase * .5) * .28
    headZ = -beat * .12
    leftArmZ = -.36 + beat * .24
    rightArmZ = .36 + beat * .24
    leftElbowX = -.38 - pop * .18
    rightElbowX = -.38 - pop * .18
    rightShoulderX = -.16 + pop * .24
    mouthScale = .85 + pop * 1.2
    haloOpacity = .58 + pop * .16
    scale = 1.03 + pop * .02
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
  const labelRefs = useRef<Partial<Record<PetId, HTMLButtonElement | null>>>({})
  const latestRef = useRef({ activeId, state, syncing, semantic, onSelect, onHandshake })
  const [hoveredHand, setHoveredHand] = useState<PetId | null>(null)
  const [storyCaption, setStoryCaption] = useState<string | null>(null)
  useEffect(() => {
    latestRef.current = { activeId, state, syncing, semantic, onSelect, onHandshake }
  }, [activeId, state, syncing, semantic, onSelect, onHandshake])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const scene = new THREE.Scene()
    scene.fog = new THREE.FogExp2('#f3f6fb', .012)
    const camera = new THREE.PerspectiveCamera(31, 1, .1, 100)
    camera.position.set(.12, 1.86, 9.8)
    camera.lookAt(.05, .68, -2.25)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8))
    renderer.setClearColor(0xf2f7ff, 0)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = .84
    mount.appendChild(renderer.domElement)

    const hemi = new THREE.HemisphereLight('#ffffff', '#cfd8e8', 1.45)
    const key = new THREE.DirectionalLight('#fff7ed', 4.85)
    key.position.set(-4.8, 6.8, 5.4); key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.near = .5
    key.shadow.camera.far = 18
    key.shadow.bias = -.00022
    key.shadow.normalBias = .035
    const fill = new THREE.DirectionalLight('#dceaff', .88)
    fill.position.set(4.6, 3.2, 6.5)
    const rim = new THREE.DirectionalLight('#d7e3ff', 2.65)
    rim.position.set(5.6, 4.2, -5.4)
    scene.add(hemi, key, fill, rim)

    const floor = mesh(
      new THREE.CircleGeometry(10.8, 128),
      new THREE.MeshStandardMaterial({ color: '#edf1f7', roughness: .72, metalness: 0 }),
      [0, GROUND_Y, 0],
    )
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    scene.add(floor)
    const contact = mesh(
      new THREE.CircleGeometry(8.8, 128),
      new THREE.MeshBasicMaterial({ color: '#c7ceda', transparent: true, opacity: .08, depthWrite: false }),
      [0, GROUND_Y + .004, -1.15],
      [1.18, .32, 1],
    )
    contact.rotation.x = -Math.PI / 2
    scene.add(contact)
    const grid = new THREE.GridHelper(18, 36, '#c8d6e9', '#e2ebf6')
    grid.position.y = GROUND_Y + .012
    ;(grid.material as THREE.Material).opacity = .025
    ;(grid.material as THREE.Material).transparent = true
    scene.add(grid)

    const rigs = agents.map((agent, index) => createPet(agent, index))
    rigs.forEach(rig => {
      rig.root.visible = false
      rig.root.traverse(object => object.layers.disable(0))
      scene.add(rig.root)
    })
    const productionAvatars: ProductionAvatar[] = []
    let disposed = false
    const clock = new THREE.Clock()
    let stageVehicle: StageVehicle | null = null
    const loadingAvatars = agents
      .map(agent => {
        const fallback = rigs.find(rig => rig.id === agent.id)
        return fallback ? createLoadingAvatar(agent, fallback, clock.elapsedTime) : null
      })
      .filter(Boolean) as LoadingAvatar[]
    loadingAvatars.forEach(loaderAvatar => scene.add(loaderAvatar.root))
    const loader = new GLTFLoader()
    loader.load(
      PORSCHE_MODEL_URL,
      gltf => {
        if (disposed) return
        stageVehicle = prepareStageVehicle(gltf.scene, Number.POSITIVE_INFINITY)
        scene.add(stageVehicle.root)
      },
      undefined,
      error => {
        console.warn('Failed to load 911 Dakar stage vehicle', error)
      },
    )
    agents.forEach(agent => {
      const fallback = rigs.find(rig => rig.id === agent.id)
      const entry = petModelRegistry[agent.id]
      if (!fallback || !entry.glbUrl) return
      loader.load(
        entry.glbUrl,
        gltf => {
          if (disposed) return
          const avatar = prepareProductionAvatar(gltf.scene, fallback, agent, clock.elapsedTime)
          const loadingAvatar = loadingAvatars.find(item => item.id === agent.id)
          if (loadingAvatar && loadingAvatar.completedAt === null) {
            loadingAvatar.completedAt = Math.max(clock.elapsedTime, loadingAvatar.startedAt + 1.8)
          }
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
    const cameraOrbit = {
      dragging: false,
      pointerId: -1,
      startX: 0,
      startY: 0,
      startYaw: 0,
      startPitch: 0,
      yaw: 0,
      pitch: 0,
      targetYaw: 0,
      targetPitch: 0,
    }
    let lastInteractionAt = 0
    let lastActivityKey = ''
    let lastStoryFrameKey = ''
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
      lastInteractionAt = clock.elapsedTime
      const bodyPart = hit ? String(hit.object.userData.bodyPart) : ''
      const id = hit?.object.userData.agentId as PetId | undefined
      if (id) latestRef.current.onSelect(id)
      if (hit && id && bodyPart.startsWith('hand')) {
        grab = { id, pointerY: normalizedY(event) }
        renderer.domElement.setPointerCapture(event.pointerId)
        renderer.domElement.style.cursor = 'grabbing'
        latestRef.current.onHandshake(id)
        return
      }
      cameraOrbit.dragging = true
      cameraOrbit.pointerId = event.pointerId
      cameraOrbit.startX = event.clientX
      cameraOrbit.startY = event.clientY
      cameraOrbit.startYaw = cameraOrbit.targetYaw
      cameraOrbit.startPitch = cameraOrbit.targetPitch
      renderer.domElement.setPointerCapture(event.pointerId)
      renderer.domElement.style.cursor = 'grabbing'
    }
    const onPointerMove = (event: PointerEvent) => {
      if (grab) {
        // While grabbed, feed the live pointer height to the animation loop.
        grab.pointerY = normalizedY(event)
        renderer.domElement.style.cursor = 'grabbing'
        return
      }
      if (cameraOrbit.dragging && cameraOrbit.pointerId === event.pointerId) {
        const dx = event.clientX - cameraOrbit.startX
        const dy = event.clientY - cameraOrbit.startY
        cameraOrbit.targetYaw = THREE.MathUtils.clamp(
          cameraOrbit.startYaw - dx * CAMERA_ORBIT_SENSITIVITY,
          -CAMERA_ORBIT_YAW_LIMIT,
          CAMERA_ORBIT_YAW_LIMIT,
        )
        cameraOrbit.targetPitch = THREE.MathUtils.clamp(
          cameraOrbit.startPitch - dy * CAMERA_ORBIT_SENSITIVITY,
          -CAMERA_ORBIT_PITCH_LIMIT,
          CAMERA_ORBIT_PITCH_LIMIT,
        )
        renderer.domElement.style.cursor = 'grabbing'
        return
      }
      const hit = hitTest(event)
      const handId = hit && String(hit.object.userData.bodyPart).startsWith('hand') ? hit.object.userData.agentId as PetId : null
      setHoveredHand(handId)
      renderer.domElement.style.cursor = handId ? 'grab' : hit ? 'pointer' : 'grab'
    }
    const endPointerInteraction = (event?: PointerEvent) => {
      grab = null
      if (cameraOrbit.dragging && event && renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId)
      }
      cameraOrbit.dragging = false
      cameraOrbit.pointerId = -1
      setHoveredHand(null)
      renderer.domElement.style.cursor = 'default'
    }
    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerup', endPointerInteraction)
    renderer.domElement.addEventListener('pointercancel', endPointerInteraction)
    renderer.domElement.addEventListener('pointerleave', endPointerInteraction)

    const resize = () => {
      const { width, height } = mount.getBoundingClientRect()
      const pixelRatio = Math.min(window.devicePixelRatio, 1.8)
      renderer.setPixelRatio(pixelRatio)
      renderer.setSize(width, height, false)
      camera.aspect = width / Math.max(height, 1)
      camera.updateProjectionMatrix()
      loadingAvatars.forEach(loadingAvatar => {
        loadingAvatar.material.uniforms.uPixelRatio.value = pixelRatio
      })
    }
    const observer = new ResizeObserver(resize)
    observer.observe(mount); resize()
    let animationId = 0
    const cameraLook = new THREE.Vector3(0, .54, 0)
    const labelWorldPosition = new THREE.Vector3()
    const labelScreenPosition = new THREE.Vector3()
    const homeX = (avatar: ProductionAvatar) => avatar.baseX + (avatar.id === 'atlas' ? -.08 : 0)
    const crowdBodies = (): CircleCollider[] => productionAvatars.map(avatar => ({
      id: avatar.id,
      x: avatar.root.position.x,
      z: avatar.root.position.z,
      radius: avatar.collisionRadius,
    }))
    const resolveAvatarPosition = (avatar: ProductionAvatar, point: StagePoint) => resolveCrowdPosition({
      point,
      selfId: avatar.id,
      selfRadius: avatar.collisionRadius,
      obstacles: crowdBodies(),
      vehicle: stageVehicle?.entered ? stageVehicle.collider : DISABLED_VEHICLE_COLLIDER,
      bounds: STAGE_ROAM_BOUNDS,
      clearance: .34,
    })
    const updateAvatarLabel = (avatar: ProductionAvatar) => {
      const label = labelRefs.current[avatar.id]
      if (!label) return
      const defaultX = homeX(avatar)
      const shouldFollow = avatar.roam.active || avatar.roam.returning ||
        avatar.roam.holding ||
        Math.hypot(avatar.root.position.x - defaultX, avatar.root.position.z) > .12
      if (!shouldFollow) {
        label.dataset.following = 'false'
        label.style.removeProperty('--label-x')
        label.style.removeProperty('--label-y')
        return
      }
      const { width, height } = mount.getBoundingClientRect()
      avatar.root.updateWorldMatrix(true, false)
      labelWorldPosition.set(0, .08, 0).applyMatrix4(avatar.root.matrixWorld)
      labelScreenPosition.copy(labelWorldPosition).project(camera)
      const x = (labelScreenPosition.x * .5 + .5) * width
      const y = (-labelScreenPosition.y * .5 + .5) * height
      label.dataset.following = 'true'
      label.style.setProperty('--label-x', `${THREE.MathUtils.clamp(x, 72, width - 72).toFixed(1)}px`)
      label.style.setProperty('--label-y', `${THREE.MathUtils.clamp(y, 112, height - 18).toFixed(1)}px`)
    }
    const setRoamTarget = (avatar: ProductionAvatar, desiredX: number, desiredZ: number, elapsed: number, hold = 1.35) => {
      const profile = roamProfiles[avatar.id]
      const currentX = avatar.root.position.x
      const currentZ = avatar.root.position.z
      const safeDesired = resolveAvatarPosition(avatar, { x: desiredX, z: desiredZ })
      desiredX = safeDesired.x
      desiredZ = safeDesired.z
      const dx = desiredX - currentX
      const dz = desiredZ - currentZ
      const distance = Math.hypot(dx, dz)
      if (distance < .03) {
        avatar.roam.targetX = desiredX
        avatar.roam.targetZ = desiredZ
        avatar.roam.nextWaypointAt = elapsed + hold
        return
      }
      const desiredHeading = Math.atan2(dx, dz)
      const currentHeading = Number.isFinite(avatar.roam.heading) ? avatar.roam.heading : avatar.root.rotation.y
      const nextHeading = clampHeadingStep(currentHeading, desiredHeading, profile.maxTurnStep)
      const stepDistance = Math.min(distance, profile.stepDistance)
      const steppedTarget = resolveAvatarPosition(avatar, {
        x: currentX + Math.sin(nextHeading) * stepDistance,
        z: currentZ + Math.cos(nextHeading) * stepDistance,
      })
      avatar.roam.heading = nextHeading
      avatar.roam.targetX = steppedTarget.x
      avatar.roam.targetZ = steppedTarget.z
      avatar.roam.nextWaypointAt = elapsed + hold
    }
    const pickRoamWaypoint = (avatar: ProductionAvatar, elapsed: number) => {
      const profile = roamProfiles[avatar.id]
      const waypoint = profile.waypoints[avatar.roam.waypointIndex % profile.waypoints.length]
      avatar.roam.waypointIndex = (avatar.roam.waypointIndex + 1) % profile.waypoints.length
      setRoamTarget(
        avatar,
        homeX(avatar) + waypoint.x,
        waypoint.z,
        elapsed,
        1.15 + Math.random() * .65,
      )
    }
    const animate = () => {
      animationId = requestAnimationFrame(animate)
      const delta = Math.min(clock.getDelta(), .05)
      const elapsed = clock.elapsedTime
      const current = latestRef.current
      const activityKey = `${current.activeId}:${current.state}:${current.syncing ? 1 : 0}:${grab?.id ?? '-'}`
      const activityChanged = activityKey !== lastActivityKey
      if (activityChanged) {
        if (lastActivityKey) lastInteractionAt = elapsed
        lastActivityKey = activityKey
      }
      const idleFor = elapsed - lastInteractionAt
      const musicMode = current.state === 'music'
      const musicTime = musicMode ? Math.max(0, elapsed - lastInteractionAt) : 0
      const storyReady = current.state === 'idle' && !current.syncing && !grab &&
        idleFor >= STORY_START_DELAY && productionAvatars.length === agents.length
      const storyElapsed = Math.max(0, idleFor - STORY_START_DELAY)
      const storyBeat = storyReady
        ? storyBeats[Math.floor(storyElapsed / STORY_BEAT_DURATION) % storyBeats.length]
        : null
      const storyBeatTime = storyElapsed % STORY_BEAT_DURATION
      const storyPhase = !storyBeat
        ? null
        : storyBeatTime < STORY_APPROACH_END
          ? 'approach'
          : storyBeatTime < STORY_PERFORM_END
            ? 'perform'
            : 'exit'
      const storyFrameKey = musicMode ? 'music-stage' : storyBeat && storyPhase ? `${storyBeat.id}:${storyPhase}` : ''
      const storyFrameChanged = storyFrameKey !== lastStoryFrameKey
      if (storyFrameChanged) {
        lastStoryFrameKey = storyFrameKey
        setStoryCaption(
          musicMode
            ? '音乐播放中：四位 Agent 聚到车前，进入协同街舞舞台。'
            : storyBeat
            ? storyPhase === 'perform' ? storyBeat.caption : storyBeat.setup
            : null,
        )
      }
      const activeRig = rigs.find(rig => rig.id === current.activeId)
      for (let index = loadingAvatars.length - 1; index >= 0; index -= 1) {
        const loadingAvatar = loadingAvatars[index]
        animateLoadingAvatar(loadingAvatar, elapsed, delta)
        if (loadingAvatar.completedAt !== null && elapsed - loadingAvatar.completedAt > 1.65) {
          scene.remove(loadingAvatar.root)
          loadingAvatar.points.geometry.dispose()
          loadingAvatar.material.dispose()
          loadingAvatars.splice(index, 1)
        }
      }
      rigs.forEach(rig => {
        if (productionAvatars.some(avatar => avatar.id === rig.id)) return
        let rigState: MotionState = 'idle'
        if (musicMode) rigState = 'music'
        else if (current.syncing) rigState = rig.id === current.activeId ? 'speak' : 'social'
        else if (rig.id === current.activeId) rigState = current.state
        const targetDelta = activeRig ? THREE.MathUtils.clamp((activeRig.baseX - rig.baseX) * .11, -.42, .42) : 0
        const rigGrab = grab && grab.id === rig.id ? { active: true, pointerY: grab.pointerY } : null
        animateRig(rig, rigState, elapsed, delta, current.semantic, targetDelta, rigGrab)
      })
      productionAvatars.forEach(avatar => {
        let avatarState: MotionState = 'idle'
        if (musicMode) avatarState = 'music'
        else if (current.syncing) avatarState = avatar.id === current.activeId ? 'speak' : 'social'
        else if (avatar.id === current.activeId) avatarState = current.state
        let targetDelta = activeRig ? THREE.MathUtils.clamp((activeRig.baseX - avatar.baseX) * .11, -.42, .42) : 0
        let storyMotion: StoryMotion | null = null
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
        const profile = roamProfiles[avatar.id]
        const defaultX = homeX(avatar)
        const returnRequested = current.activeId === avatar.id && current.state === 'return'
        const storyActor = storyBeat?.actors[avatar.id]
        const storyPartner = storyActor
          ? productionAvatars.find(candidate => candidate.id === storyActor.partnerId)
          : undefined
        const walkToward = (destination: StagePoint, forceRetarget = false) => {
          const distanceToStep = Math.hypot(
            avatar.root.position.x - avatar.roam.targetX,
            avatar.root.position.z - avatar.roam.targetZ,
          )
          const targetExpired = elapsed > avatar.roam.nextWaypointAt + 2.8
          if (forceRetarget || !avatar.roam.active || distanceToStep < .08 || targetExpired) {
            setRoamTarget(avatar, destination.x, destination.z, elapsed, .55)
          }
          avatar.roam.active = true
          avatar.roam.returning = false
          avatar.roam.holding = false
          avatarState = 'walk'
        }
        if (musicMode && intro.kind === 'done') {
          const formation = musicStageFormation[avatar.id]
          const distanceToStage = Math.hypot(avatar.root.position.x - formation.x, avatar.root.position.z - formation.z)
          if (distanceToStage > .22) {
            walkToward(formation, activityChanged)
          } else {
            avatar.roam.active = false
            avatar.roam.returning = false
            avatar.roam.holding = true
            avatar.roam.targetX = formation.x
            avatar.roam.targetZ = formation.z
            avatar.roam.heading = 0
            avatarState = 'music'
          }
          targetDelta = Math.sin(musicTime * 1.2 + avatar.phase) * .12
        } else if (returnRequested) {
          avatar.roam.active = false
          avatar.roam.returning = true
          avatar.roam.holding = false
          avatar.roam.targetX = defaultX
          avatar.roam.targetZ = 0
          avatar.roam.heading = clampHeadingStep(
            Number.isFinite(avatar.roam.heading) ? avatar.roam.heading : avatar.root.rotation.y,
            Math.atan2(defaultX - avatar.root.position.x, -avatar.root.position.z),
            profile.maxTurnStep,
          )
          avatarState = 'return'
        } else if (avatar.roam.returning) {
          const distanceHome = Math.hypot(avatar.root.position.x - defaultX, avatar.root.position.z)
          avatar.roam.targetX = defaultX
          avatar.roam.targetZ = 0
          avatar.roam.heading = clampHeadingStep(
            avatar.roam.heading,
            Math.atan2(defaultX - avatar.root.position.x, -avatar.root.position.z),
            profile.maxTurnStep,
          )
          avatarState = 'return'
          if (distanceHome < .08) {
            avatar.roam.returning = false
            avatar.roam.active = false
            avatar.roam.holding = false
            avatar.roam.nextWaypointAt = elapsed + profile.startDelay
            avatar.root.position.x = defaultX
            avatar.root.position.z = 0
          }
        } else if (storyBeat && storyPhase && intro.kind === 'done') {
          if (storyActor && storyPhase === 'approach') {
            walkToward(storyActor.destination, storyFrameChanged)
          } else if (storyActor && storyPhase === 'perform') {
            avatar.roam.active = false
            avatar.roam.returning = false
            avatar.roam.holding = true
            avatar.roam.targetX = avatar.root.position.x
            avatar.roam.targetZ = avatar.root.position.z
            avatarState = 'social'
            if (storyPartner) {
              targetDelta = THREE.MathUtils.clamp(
                (storyPartner.root.position.x - avatar.root.position.x) * .18,
                -.58,
                .58,
              )
              storyMotion = {
                gesture: storyActor.gesture,
                partnerX: storyPartner.root.position.x,
                partnerZ: storyPartner.root.position.z,
                intensity: THREE.MathUtils.smoothstep(
                  storyBeatTime,
                  STORY_APPROACH_END,
                  STORY_APPROACH_END + 1.2,
                ),
              }
            }
          } else {
            const distanceHome = Math.hypot(avatar.root.position.x - defaultX, avatar.root.position.z)
            if (distanceHome > .12) {
              walkToward({ x: defaultX, z: 0 }, storyFrameChanged)
            } else {
              avatar.roam.active = false
              avatar.roam.returning = false
              avatar.roam.holding = false
              avatar.root.position.x = damp(avatar.root.position.x, defaultX, 8, delta)
              avatar.root.position.z = damp(avatar.root.position.z, 0, 8, delta)
            }
          }
        } else if (intro.kind === 'done' && current.state === 'idle' && !current.syncing && !grab) {
          if (!avatar.roam.active && idleFor > profile.startDelay && elapsed > avatar.roam.nextWaypointAt) {
            avatar.roam.active = true
            avatar.roam.holding = false
            pickRoamWaypoint(avatar, elapsed)
          }
          if (avatar.roam.active) {
            const distance = Math.hypot(avatar.root.position.x - avatar.roam.targetX, avatar.root.position.z - avatar.roam.targetZ)
            const waypointExpired = elapsed > avatar.roam.nextWaypointAt + 3.8
            if ((distance < .08 && elapsed > avatar.roam.nextWaypointAt) || waypointExpired) {
              pickRoamWaypoint(avatar, elapsed)
            }
            avatarState = 'walk'
          } else if (avatar.roam.holding) {
            avatar.roam.targetX = avatar.root.position.x
            avatar.roam.targetZ = avatar.root.position.z
          }
        } else if (avatar.roam.active) {
          avatar.roam.active = false
          avatar.roam.holding = true
          avatar.roam.targetX = avatar.root.position.x
          avatar.roam.targetZ = avatar.root.position.z
          avatar.roam.nextWaypointAt = elapsed + profile.startDelay
        }
        const avatarGrab = grab && grab.id === avatar.id ? { active: true, pointerY: grab.pointerY } : null
        const roamMotion = avatar.roam.active || avatar.roam.returning || avatar.roam.holding
          ? {
              active: avatar.roam.active,
              returning: avatar.roam.returning,
              holding: avatar.roam.holding,
              targetX: avatar.roam.targetX,
              targetZ: avatar.roam.targetZ,
              heading: avatar.roam.heading,
              speed: profile.speed,
              returnSpeed: profile.returnSpeed,
              turnRate: musicMode ? 4.2 : profile.turnRate,
              returnTurnRate: musicMode ? 4.2 : profile.returnTurnRate,
              resolvePosition: (point: StagePoint) => resolveAvatarPosition(avatar, point),
            }
          : null
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
          roamMotion,
          storyMotion,
        )
      })
      if (stageVehicle && !stageVehicle.entered) {
        const avatarsReadyForVehicle = productionAvatars.length === agents.length &&
          productionAvatars.every(avatar =>
            elapsed >= avatar.introStartedAt + avatar.introDelay + INTRO_RUN_DURATION + INTRO_WAVE_DURATION + .45,
          )
        if (avatarsReadyForVehicle) {
          stageVehicle.entered = true
          stageVehicle.startedAt = elapsed + .35
          stageVehicle.root.position.set(stageVehicle.fromX, 0, stageVehicle.z)
          stageVehicle.root.visible = false
        }
      }
      if (stageVehicle) animateStageVehicle(stageVehicle, elapsed, delta)
      const spatialRoamView = productionAvatars.some(avatar =>
        (avatar.roam.active || avatar.roam.holding) && !avatar.roam.returning,
      )
      const defaultCameraX = activeRig ? activeRig.baseX * .045 : 0
      const cameraTarget = musicMode
        ? {
            x: Math.sin(musicTime * .72) * .68,
            y: 2.38 + Math.max(0, Math.sin(musicTime * 2.35)) * .2,
            z: 8.15 - Math.max(0, Math.sin(musicTime * 1.18)) * .58,
            fov: 27.6 + Math.sin(musicTime * 1.7) * 1.6,
            lookX: Math.sin(musicTime * .54) * .28,
            lookY: .82 + Math.sin(musicTime * 1.4) * .08,
            lookZ: .85,
          }
        : spatialRoamView
        ? { x: -.24, y: 4.35, z: 12.8, fov: 32.8, lookX: -.2, lookY: .55, lookZ: .92 }
        : { x: defaultCameraX + .12, y: 1.86, z: 9.8, fov: 31, lookX: defaultCameraX * .12 + .05, lookY: .68, lookZ: -2.25 }
      cameraOrbit.yaw = damp(cameraOrbit.yaw, cameraOrbit.targetYaw, 7, delta)
      cameraOrbit.pitch = damp(cameraOrbit.pitch, cameraOrbit.targetPitch, 7, delta)
      const orbitLook = new THREE.Vector3(cameraTarget.lookX, cameraTarget.lookY, cameraTarget.lookZ)
      const orbitOffset = new THREE.Vector3(
        cameraTarget.x - cameraTarget.lookX,
        cameraTarget.y - cameraTarget.lookY,
        cameraTarget.z - cameraTarget.lookZ,
      )
      const orbitSpherical = new THREE.Spherical().setFromVector3(orbitOffset)
      orbitSpherical.theta += cameraOrbit.yaw
      orbitSpherical.phi = THREE.MathUtils.clamp(
        orbitSpherical.phi + cameraOrbit.pitch,
        .34,
        Math.PI / 2 - .08,
      )
      orbitOffset.setFromSpherical(orbitSpherical)
      const orbitCamera = orbitLook.clone().add(orbitOffset)
      camera.position.x = damp(camera.position.x, orbitCamera.x, 2.5, delta)
      camera.position.y = damp(camera.position.y, orbitCamera.y, 2.2, delta)
      camera.position.z = damp(camera.position.z, orbitCamera.z, 2.2, delta)
      camera.fov = damp(camera.fov, cameraTarget.fov, 2.2, delta)
      camera.updateProjectionMatrix()
      cameraLook.x = damp(cameraLook.x, cameraTarget.lookX, 2.3, delta)
      cameraLook.y = damp(cameraLook.y, cameraTarget.lookY, 2.3, delta)
      cameraLook.z = damp(cameraLook.z, cameraTarget.lookZ, 2.3, delta)
      camera.lookAt(cameraLook)
      productionAvatars.forEach(updateAvatarLabel)
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      disposed = true
      cancelAnimationFrame(animationId)
      observer.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerup', endPointerInteraction)
      renderer.domElement.removeEventListener('pointercancel', endPointerInteraction)
      renderer.domElement.removeEventListener('pointerleave', endPointerInteraction)
      renderer.dispose()
      scene.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose()
          if (Array.isArray(object.material)) object.material.forEach(mat => mat.dispose())
          else object.material.dispose()
        }
        if (object instanceof THREE.Points) {
          object.geometry.dispose()
          if (Array.isArray(object.material)) object.material.forEach(mat => mat.dispose())
          else object.material.dispose()
        }
      })
      mount.removeChild(renderer.domElement)
    }
  }, [agents])

  return (
    <div className={`pet-webgl-stage state-${state}`}>
      <div ref={mountRef} className="pet-canvas" aria-label="四个实时骨骼 Agent 的 WebGL 舞台" />
      <div className="role-badges" aria-label="角色能力标签">
        {agents.map(agent => <button key={agent.id} className={agent.id === activeId ? 'active' : ''} onClick={() => onSelect(agent.id)} style={{ '--pet-color': agent.color, '--badge-x': roleBadgeMeta[agent.id].x } as React.CSSProperties}>
          <i><RoleBadgeIcon id={agent.id} /></i><span>{roleBadgeMeta[agent.id].title}</span>
        </button>)}
      </div>
      <div className="pet-labels">
        {agents.map((agent, index) => <button key={agent.id} ref={(node) => { labelRefs.current[agent.id] = node }} data-following="false" className={agent.id === activeId ? 'active' : ''} onClick={() => onSelect(agent.id)} style={{ '--pet-color': agent.color, gridColumn: index + 1 } as React.CSSProperties}>
          <i /><b>{agent.name}</b><span>{agent.role}</span>
        </button>)}
      </div>
      <div className="motion-monitor"><span className="monitor-dot" /><b>{stateLabels[state]}</b><small>{hasProductionModel('atlas') ? 'ATA PARTS-V3 · 7 MORPHS · SEMANTIC BONES' : 'PROCEDURAL RIG · GLB READY'}</small></div>
      <div className="story-beat" data-visible={Boolean(storyCaption)}>
        <small>LIVE STORY</small><span>{storyCaption}</span>
      </div>
      <div className="gesture-hint" data-visible={Boolean(hoveredHand)}><span>↕</span> 按住手部上下移动 · 与它握手</div>
      <div className="motion-debug" aria-label="动作状态预览">
        {(Object.keys(stateLabels) as MotionState[]).map(key => <button key={key} className={state === key ? 'active' : ''} onClick={() => onStatePreview(key)}>{stateLabels[key]}</button>)}
      </div>
    </div>
  )
}
