import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { hasProductionModel } from './model-registry'
import './PetStage.css'

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

const stateLabels: Record<MotionState, string> = {
  idle: '待机', wake: '唤醒', listen: '聆听', think: '思考', speak: '对话', social: '互聊', handshake: '握手',
}

const profiles: Record<PetId, Rig['profile']> = {
  atlas: { tempo: .72, amplitude: .55, openness: .78, attitude: -.08 },
  nova: { tempo: .56, amplitude: .38, openness: .42, attitude: .03 },
  muse: { tempo: 1.12, amplitude: 1.0, openness: .92, attitude: -.06 },
  milo: { tempo: .88, amplitude: .72, openness: .86, attitude: .08 },
}

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
  root.position.set(baseX, -1.33, 0)
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

function animateRig(
  rig: Rig,
  state: MotionState,
  elapsed: number,
  delta: number,
  semantic: SemanticMotion,
  lookTargetX: number,
) {
  const p = rig.profile
  const t = elapsed * p.tempo + rig.phase
  const breath = Math.sin(t * 1.65) * .028 * p.amplitude
  let rootY = -1.33 + breath
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
    scene.fog = new THREE.FogExp2('#08131d', .075)
    const camera = new THREE.PerspectiveCamera(29, 1, .1, 100)
    camera.position.set(0, 2.4, 11.5)
    camera.lookAt(0, .7, 0)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8))
    renderer.setClearColor(0x000000, 0)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    mount.appendChild(renderer.domElement)

    const hemi = new THREE.HemisphereLight('#c4f5ff', '#102431', 2.2)
    const key = new THREE.DirectionalLight('#d8f7ff', 4.4)
    key.position.set(-2, 7, 6); key.castShadow = true
    const rim = new THREE.DirectionalLight('#a36dff', 3.2)
    rim.position.set(6, 3, -4)
    scene.add(hemi, key, rim)

    const floor = mesh(new THREE.CircleGeometry(8.3, 64), new THREE.MeshStandardMaterial({ color: '#07131b', roughness: .9, metalness: .1, transparent: true, opacity: .78 }), [0, -1.36, 0])
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    scene.add(floor)
    const grid = new THREE.GridHelper(18, 36, '#246170', '#102e38')
    grid.position.y = -1.35
    ;(grid.material as THREE.Material).opacity = .25
    ;(grid.material as THREE.Material).transparent = true
    scene.add(grid)

    const rigs = agents.map((agent, index) => createPet(agent, index))
    rigs.forEach(rig => scene.add(rig.root))

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    let drag: { id: PetId; y: number; travel: number } | null = null
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
        drag = { id, y: event.clientY, travel: 0 }
        renderer.domElement.setPointerCapture(event.pointerId)
      }
    }
    const onPointerMove = (event: PointerEvent) => {
      const hit = hitTest(event)
      const handId = hit && String(hit.object.userData.bodyPart).startsWith('hand') ? hit.object.userData.agentId as PetId : null
      setHoveredHand(handId)
      renderer.domElement.style.cursor = handId ? 'grab' : hit ? 'pointer' : 'default'
      if (drag) {
        drag.travel += Math.abs(event.clientY - drag.y)
        drag.y = event.clientY
        if (drag.travel > 34) {
          latestRef.current.onHandshake(drag.id)
          drag = null
        }
      }
    }
    const onPointerUp = () => {
      if (drag && drag.travel < 8) latestRef.current.onHandshake(drag.id)
      drag = null
    }
    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerup', onPointerUp)

    const resize = () => {
      const { width, height } = mount.getBoundingClientRect()
      renderer.setSize(width, height, false)
      camera.aspect = width / Math.max(height, 1)
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(mount); resize()
    const clock = new THREE.Clock()
    let animationId = 0
    const animate = () => {
      animationId = requestAnimationFrame(animate)
      const delta = Math.min(clock.getDelta(), .05)
      const elapsed = clock.elapsedTime
      const current = latestRef.current
      const activeRig = rigs.find(rig => rig.id === current.activeId)
      rigs.forEach(rig => {
        let rigState: MotionState = 'idle'
        if (current.syncing) rigState = rig.id === current.activeId ? 'speak' : 'social'
        else if (rig.id === current.activeId) rigState = current.state
        const targetDelta = activeRig ? THREE.MathUtils.clamp((activeRig.baseX - rig.baseX) * .11, -.42, .42) : 0
        animateRig(rig, rigState, elapsed, delta, current.semantic, targetDelta)
      })
      camera.position.x = damp(camera.position.x, activeRig ? activeRig.baseX * .055 : 0, 2.5, delta)
      camera.lookAt(camera.position.x * .25, .6, 0)
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      cancelAnimationFrame(animationId)
      observer.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
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
      <div className="pet-labels">
        {agents.map(agent => <button key={agent.id} className={agent.id === activeId ? 'active' : ''} onClick={() => onSelect(agent.id)} style={{ '--pet-color': agent.color } as React.CSSProperties}>
          <i /><b>{agent.name}</b><span>{agent.role}</span>
        </button>)}
      </div>
      <div className="motion-monitor"><span className="monitor-dot" /><b>{stateLabels[state]}</b><small>{agents.every(agent => hasProductionModel(agent.id)) ? 'GLB RIG · LIVE' : 'PROCEDURAL RIG · GLB READY'}</small></div>
      <div className="gesture-hint" data-visible={Boolean(hoveredHand)}><span>↕</span> 上下晃动或轻点手部 · 握手</div>
      <div className="motion-debug" aria-label="动作状态预览">
        {(Object.keys(stateLabels) as MotionState[]).map(key => <button key={key} className={state === key ? 'active' : ''} onClick={() => onStatePreview(key)}>{stateLabels[key]}</button>)}
      </div>
    </div>
  )
}
