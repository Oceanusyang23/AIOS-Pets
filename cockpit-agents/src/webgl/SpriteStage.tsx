import { useRef, useState } from 'react'
import conceptImage from '../assets/pets-concept.png'
import type { MotionState, PetId } from './PetStage'
import './SpriteStage.css'
import './SpriteStageMotion.css'
import './SpriteStageConcept.css'

type PetInfo = { id: PetId; name: string; role: string; color: string }
type Props = {
  agents: PetInfo[]
  activeId: PetId
  state: MotionState
  syncing: boolean
  onSelect: (id: PetId) => void
  onHandshake: (id: PetId) => void
  onStatePreview: (state: MotionState) => void
}

const stateLabels: Record<MotionState, string> = {
  idle: '待机', wake: '唤醒', listen: '聆听', think: '思考', speak: '对话', social: '互聊', handshake: '握手',
  dance: '跳舞', music: '街舞', spin: '旋转', march: '高抬腿', walk: '走动', return: '回来',
}

const stateEffects: Record<MotionState, { symbol: string; label: string }> = {
  idle: { symbol: '·', label: '微呼吸 / 环境注视' },
  wake: { symbol: '✦', label: '注意力已聚焦' },
  listen: { symbol: '◖  ◗', label: '正在捕捉你的声音' },
  think: { symbol: '· · ·', label: '正在形成回应' },
  speak: { symbol: '≋', label: '语义驱动动作' },
  social: { symbol: '↔', label: '伙伴视线同步' },
  handshake: { symbol: '↕', label: '触觉确认' },
  dance: { symbol: '♪', label: '节拍律动' },
  music: { symbol: '♫', label: '四人街舞舞台' },
  spin: { symbol: '⟳', label: '原地旋转' },
  march: { symbol: '▵', label: '高抬腿小跑' },
  walk: { symbol: '↝', label: '空间漫游' },
  return: { symbol: '↩', label: '跑回默认位' },
}

const positions: Record<PetId, { left: string; width: string; handLeft: string; handTop: string }> = {
  atlas: { left: '4%', width: '24%', handLeft: '7.5%', handTop: '45%' },
  nova: { left: '28%', width: '23%', handLeft: '45.5%', handTop: '53%' },
  muse: { left: '51%', width: '22%', handLeft: '66%', handTop: '35%' },
  milo: { left: '73%', width: '23%', handLeft: '91%', handTop: '43%' },
}

export function SpriteStage({ agents, activeId, state, syncing, onSelect, onHandshake, onStatePreview }: Props) {
  const dragRef = useRef<{ id: PetId; y: number; travel: number } | null>(null)
  const [hoveredHand, setHoveredHand] = useState<PetId | null>(null)

  const beginGesture = (id: PetId, event: React.PointerEvent<HTMLButtonElement>) => {
    dragRef.current = { id, y: event.clientY, travel: 0 }
    event.currentTarget.setPointerCapture(event.pointerId)
    onSelect(id)
  }
  const moveGesture = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag) return
    drag.travel += Math.abs(event.clientY - drag.y)
    drag.y = event.clientY
    if (drag.travel > 28) {
      onHandshake(drag.id)
      dragRef.current = null
    }
  }
  const endGesture = () => {
    const drag = dragRef.current
    if (drag && drag.travel < 7) onHandshake(drag.id)
    dragRef.current = null
  }

  return <div className="sprite-stage" data-state={state} data-active={activeId} data-syncing={syncing}>
    <img className="sprite-source sprite-base" src={conceptImage} alt="四位 AI 伙伴设计稿" />
    <div className="sprite-vignette" />
    {agents.map(agent => <div key={agent.id} className={`sprite-character sprite-${agent.id} ${agent.id === activeId ? 'active' : ''}`} style={{ '--sprite-color': agent.color } as React.CSSProperties}>
      <img className="sprite-source sprite-body" src={conceptImage} alt="" />
      <img className={`sprite-source sprite-part part-${agent.id}-head`} src={conceptImage} alt="" />
      <img className={`sprite-source sprite-part part-${agent.id}-primary`} src={conceptImage} alt="" />
      <img className={`sprite-source sprite-part part-${agent.id}-secondary`} src={conceptImage} alt="" />
    </div>)}
    {agents.map(agent => <button key={agent.id} className={`sprite-select ${agent.id === activeId ? 'active' : ''}`} style={{ left: positions[agent.id].left, width: positions[agent.id].width, '--sprite-color': agent.color } as React.CSSProperties} onClick={() => onSelect(agent.id)} aria-label={`${agent.name} ${agent.role}`}><i /><b>{agent.name}</b><span>{agent.role}</span></button>)}
    {agents.map(agent => <button key={`hand-${agent.id}`} className="sprite-hand-hit" style={{ left: positions[agent.id].handLeft, top: positions[agent.id].handTop } as React.CSSProperties} aria-label={`和${agent.name}握手`} onPointerEnter={() => setHoveredHand(agent.id)} onPointerLeave={() => setHoveredHand(null)} onPointerDown={event => beginGesture(agent.id, event)} onPointerMove={moveGesture} onPointerUp={endGesture} />)}
    <div className="sprite-status"><i /><div><b>{stateLabels[state]} · {agents.find(agent => agent.id === activeId)?.name}</b><span>2.5D DESIGN FIDELITY PILOT</span></div></div>
    <div className="sprite-state-effect" data-state={state}><b>{stateEffects[state].symbol}</b><span>{stateEffects[state].label}</span></div>
    <div className="sprite-gesture-hint" data-visible={Boolean(hoveredHand)}><b>↕</b> 轻点或上下晃动手部</div>
    <div className="sprite-motion-debug" aria-label="2.5D 动作预览">{(Object.keys(stateLabels) as MotionState[]).map(key => <button key={key} className={state === key ? 'active' : ''} onClick={() => onStatePreview(key)}>{stateLabels[key]}</button>)}</div>
  </div>
}
