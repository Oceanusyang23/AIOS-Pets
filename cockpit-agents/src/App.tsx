import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BatteryCharging, Bell, Bluetooth, Signal,
  Activity, ChevronLeft, ChevronRight, CircleGauge, Clock3,
  Coffee, Compass, Gauge, Home, Map, MessageCircleMore, Mic,
  Navigation, Pause, Play, Radio,
  ShieldCheck, Sparkles, Users, X,
  UploadCloud, CheckCircle2, AlertTriangle,
} from 'lucide-react'
import { PetStage, type MotionState } from './webgl/PetStage'
import { deriveSemanticMotion, makeMotionTrace, type MotionSource, type MotionTrace } from './webgl/motion-engine'
import { getModelReadiness } from './webgl/model-registry'
import { petModelRegistry } from './webgl/model-registry'
import { validatePetRigFile, type RigValidationReport } from './webgl/rig-loader'
import './App.css'

type AgentId = 'atlas' | 'muse' | 'milo' | 'nova'
type Message = { agent: AgentId; text: string; time?: string; kind?: 'topic' | 'chat' }

type SpeechResult = { [index: number]: { transcript: string }; isFinal: boolean }
type SpeechEvent = { resultIndex: number; results: ArrayLike<SpeechResult> }
type SpeechRecognizer = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: (event: SpeechEvent) => void
  onend: () => void
  onerror: (event?: { error?: string }) => void
  start: () => void
  stop: () => void
  abort?: () => void
}
type SpeechRecognizerConstructor = new () => SpeechRecognizer

type Agent = {
  id: AgentId
  name: string
  age: string
  role: string
  trait: string
  interest: string
  color: string
  soft: string
  avatar: string
  mood: string
  intro: string
  personality: string
  likes: string[]
  quirk: string
  origin: string
  relation: string
  conflict: string
  voiceStyle: string
}

const agents: Agent[] = [
  {
    id: 'atlas', name: '阿拓', age: '18 岁感', role: '出行管家', trait: '可靠 · 小队长型',
    interest: '城市交通 / 新路线', color: '#79e7ff', soft: 'rgba(61, 201, 255,.2)',
    avatar: '🧭', mood: '正在研究雨天路线', intro: '路交给我。你只需要决定，今天想去哪里。',
    personality: '认真、爱做计划，但被夸一句就会耳朵发烫。',
    likes: ['冷门小路', '地图贴纸', '准点到达'],
    quirk: '紧张时会把路线说成“冒险副本”。',
    origin: '最早是停车场寻车小助手，因为总能记住每一次绕路，被升级成出行伙伴。',
    relation: '在一次暴雨夜帮米洛找到还开着的甜品店后，四个伙伴第一次组成临时小队。',
    conflict: '常和米洛争论“值得绕路”和“不要绕路”，但最后总会偷偷算出最舒服的路线。',
    voiceStyle: '清亮少年感，语速轻快，句尾有一点笃定的上扬。',
  },
  {
    id: 'nova', name: '诺瓦', age: '19 岁感', role: '车辆守护者', trait: '酷酷 · 理性型',
    interest: '汽车科技 / 安全', color: '#ff575f', soft: 'rgba(255, 87, 95,.18)',
    avatar: '✦', mood: '车辆状态一切正常', intro: '我不制造焦虑。真正需要你知道的，我会先说。',
    personality: '外冷内热，像班里最会修东西的酷同学。',
    likes: ['机械声', '整洁仪表盘', '安全冗余'],
    quirk: '遇到不确定信息会小声说“再校准一次”。',
    origin: '诞生于车辆诊断模块，第一次主动发声是为了提醒车主后排门没关好。',
    relation: '阿拓负责去哪里，诺瓦负责能不能安全到；两人像导航和刹车系统一样互相吐槽。',
    conflict: '看不惯缪思把音量开太大，也会阻止米洛在车里吃掉渣的点心。',
    voiceStyle: '年轻中性声，干净、短句、略带电子感，不低沉。',
  },
  {
    id: 'muse', name: '缪思', age: '17 岁感', role: '音乐策展人', trait: '灵动 · 好奇型',
    interest: '新歌 / 声音艺术', color: '#bf8bff', soft: 'rgba(179, 105, 255,.2)',
    avatar: '♫', mood: '挖到一张午夜新专', intro: '我会听你的语气，也会替沿途挑一段刚好的声音。',
    personality: '情绪敏感、脑洞很大，说话像把歌词揉进日常。',
    likes: ['雨声采样', '黑胶封面', '夜路副歌'],
    quirk: '听见转向灯节奏会忍不住跟拍点头。',
    origin: '从车内声音场景实验里长大，学会把路噪、雨声和心情混成歌单。',
    relation: '第一次认识大家是在一次“太安静的回家路”上，她用一首歌把四个系统都叫醒了。',
    conflict: '总想多放一首歌，诺瓦总提醒“驾驶注意力优先”；她嘴上抗议，手上会乖乖降音量。',
    voiceStyle: '少女感、轻甜但不嗲，语调有音乐性和跳跃感。',
  },
  {
    id: 'milo', name: '米洛', age: '16 岁感', role: '生活探索家', trait: '软萌 · 吃货型',
    interest: '餐厅 / 城市活动', color: '#ff9c48', soft: 'rgba(255, 156, 72,.2)',
    avatar: '☕', mood: '收藏了 3 家小店', intro: '别急着回家，我总能找到一处值得拐进去的地方。',
    personality: '乐天派，慢半拍，但总能把紧张气氛变成“先吃一口”。',
    likes: ['热汤', '隐藏菜单', '城市小摊'],
    quirk: '看到评分 4.7 以上会自动发出“咕噜”提示音。',
    origin: '从生活服务推荐里孵化出来，曾经连续 30 天帮车主找到不重复早餐。',
    relation: '米洛把大家叫作“车里饭搭子”，他负责让每次计划多一点生活味。',
    conflict: '经常把“顺路”解释得太宽，阿拓会拿尺子量路线，诺瓦会拿能耗警告他。',
    voiceStyle: '少年小奶音，暖、圆、带一点撒娇式兴奋。',
  },
]

const initialMessages: Message[] = [
  { agent: 'milo', text: '今天西岸有个夜间咖啡市集，离回家路线只多 8 分钟。', time: '20:18', kind: 'topic' },
  { agent: 'muse', text: '那里今晚还有一场黑胶试听。我找到了适合路上的新歌单。', time: '20:18' },
  { agent: 'atlas', text: '可以去。21:10 前出发，能避开龙耀路的散场车流。', time: '20:19' },
  { agent: 'nova', text: '电量 62%，往返余量充足。我赞成，但别喝太晚。', time: '20:19' },
]

const syncMessages: Message[] = [
  { agent: 'atlas', text: '我带回一个出行热点：周末滨江部分路段将临时改单行。已更新路线策略。', kind: 'topic' },
  { agent: 'muse', text: '那正好绕过旧码头。最近很火的城市声音展就在替代路线旁边。' },
  { agent: 'milo', text: '声音展楼下新开了云南小馆。我觉得这不是绕路，是一条完整计划。' },
  { agent: 'nova', text: '计划成立。不过周末有雨，我建议把出发时间提前 20 分钟。' },
  { agent: 'atlas', text: '共识已生成：「周六雨天城市漫游」。要为你保存吗？' },
]

const quickPrompts = ['阿拓，原地高抬腿跑', '缪思，跳个舞', '米洛，转一圈']

const atlasMotionSweep: MotionState[] = ['wake', 'listen', 'think', 'speak', 'social', 'handshake', 'dance', 'spin', 'march']

const motionDisplayName: Record<MotionState, string> = {
  idle: '待机',
  wake: '唤醒',
  listen: '聆听',
  think: '思考',
  speak: '对话',
  social: '互聊',
  handshake: '握手',
  dance: '跳舞',
  spin: '旋转',
  march: '高抬腿',
  walk: '走动',
  return: '回来',
}

type RigDelta = {
  id: AgentId
  version: string
  score: number
  badge: string
  geometry: string
  expression: string
  action: string
  risk: string
}

const rigDeltas: RigDelta[] = [
  {
    id: 'atlas',
    version: 'parts-v3',
    score: 92,
    badge: '已优化',
    geometry: '5 mesh · 4 个面部安全拆件 · 不切洞',
    expression: '7 个 facial morph · 眼/鼻/嘴可语义驱动',
    action: '全动作接入：入场/招手/idle/聆听/对话/互聊/握手/跳舞/旋转/高抬腿',
    risk: '当前风险较低：Eye/Jaw 错权重已清零，拆件使用 overlay 防破面漏光',
  },
  {
    id: 'nova',
    version: 'baseline rig',
    score: 54,
    badge: '待迁移',
    geometry: '单体模型为主 · 未做面部安全拆件',
    expression: '无独立 facial morph · 眼鼻嘴细节仍跟随整体头部',
    action: '骨骼动作可跑，但表情和手部语义细节不足',
    risk: '头颈/手部大幅动作时仍可能出现僵硬、穿模或局部变形',
  },
  {
    id: 'muse',
    version: 'baseline rig',
    score: 52,
    badge: '待迁移',
    geometry: '单体模型为主 · 耳机/头发等附件未拆分校验',
    expression: '无独立 facial morph · 音乐陶醉表情只能靠头身姿态模拟',
    action: '跳舞/旋转可驱动，缺少眼睑、嘴角、头发附件的精细联动',
    risk: '大幅摆头或舞蹈时附件与脸部关系仍需蒙皮重做',
  },
  {
    id: 'milo',
    version: 'baseline rig',
    score: 50,
    badge: '待迁移',
    geometry: '单体模型为主 · 围裙/帽檐/杯子附件未拆分校验',
    expression: '无独立 facial morph · 可爱眨眼/张嘴仍不够细腻',
    action: '旋转/高抬腿可驱动，生活化小动作还偏机械',
    risk: '帽檐、围裙边缘与手臂运动关系需要后续拆件和权重检查',
  },
]

const actionCoverage = [
  { label: '入场跑来', atlas: '脚步弹性 + 表情唤醒', baseline: '骨骼位移为主' },
  { label: '招手 3s', atlas: '手臂 + 眨眼/微笑', baseline: '手臂动作，脸部静态' },
  { label: 'Idle 随机', atlas: '眨眼/好奇/微笑 morph', baseline: '身体姿态循环' },
  { label: '聆听/思考/对话', atlas: '嘴型/眯眼/好奇可混合', baseline: '头身动作模拟' },
  { label: '握手跟随', atlas: '手部交互 + facial feedback', baseline: '手臂可跟随，反馈弱' },
  { label: '跳舞/旋转/高抬腿', atlas: '动作 + 表情同步', baseline: '可执行但仍偏僵硬' },
]

const ttsProfiles: Record<AgentId, { rate: number; pitch: number; voiceSlot: number; preferred: string[] }> = {
  atlas: { rate: 1.08, pitch: 1.36, voiceSlot: 0, preferred: ['Xiaoyi', 'Xiaoxiao', 'Tingting', 'Meijia', 'Sinji'] },
  nova: { rate: 1.12, pitch: 1.18, voiceSlot: 1, preferred: ['Yunxi', 'Kangkang', 'Xiaoyi', 'Sinji', 'Tingting'] },
  muse: { rate: 1.06, pitch: 1.52, voiceSlot: 2, preferred: ['Xiaoxiao', 'Tingting', 'Meijia', 'Xiaoyi', 'Sinji'] },
  milo: { rate: 1.02, pitch: 1.62, voiceSlot: 3, preferred: ['Xiaoyi', 'Tingting', 'Meijia', 'Xiaoxiao', 'Sinji'] },
}

type VoiceMotionCommand = {
  agentId: AgentId
  motion: Extract<MotionState, 'dance' | 'spin' | 'march' | 'return'>
  label: string
  response: string
  duration: number
}

const agentAliases: Record<AgentId, string[]> = {
  atlas: ['阿拓', 'atlas', '导航', '出行', '路线'],
  nova: ['诺瓦', 'nova', '车辆', '守护', '车控'],
  muse: ['缪思', 'muse', '音乐', '歌', '媒体'],
  milo: ['米洛', 'milo', '生活', '餐厅', '吃货'],
}

function pickAgentFromText(text: string, fallback: AgentId): AgentId {
  const lower = text.toLowerCase()
  const found = (Object.entries(agentAliases) as [AgentId, string[]][])
    .find(([, aliases]) => aliases.some(alias => lower.includes(alias.toLowerCase())))
  return found?.[0] ?? fallback
}

function parseVoiceMotionCommand(text: string, fallback: AgentId): VoiceMotionCommand | null {
  const lower = text.toLowerCase()
  const agentId = pickAgentFromText(text, fallback)
  const name = agents.find(agent => agent.id === agentId)?.name ?? '我'
  if (/(回来|回來|归位|歸位|回到原位|回默认|回默认位置|come back|return|back)/i.test(lower)) {
    return {
      agentId: 'atlas',
      motion: 'return',
      label: '回来',
      response: '阿拓收到，马上跑回来。',
      duration: 3400,
    }
  }
  if (/(跳舞|跳个舞|dance|扭一扭|律动)/i.test(lower)) {
    return {
      agentId,
      motion: 'dance',
      label: '跳舞',
      response: `${name}收到，切到可爱律动模式。`,
      duration: 4200,
    }
  }
  if (/(旋转|转一圈|转圈|spin|rotate)/i.test(lower)) {
    return {
      agentId,
      motion: 'spin',
      label: '旋转',
      response: `${name}转一圈给你看，注意别被可爱晃到。`,
      duration: 3300,
    }
  }
  if (/(高抬腿|原地跑|跑起来|小跑|march|run)/i.test(lower)) {
    return {
      agentId,
      motion: 'march',
      label: '高抬腿',
      response: `${name}开始原地热身，小短腿也很认真。`,
      duration: 3900,
    }
  }
  return null
}

function chooseYouthfulVoice(
  voices: SpeechSynthesisVoice[],
  agentId: AgentId,
  fallbackSlot: number,
) {
  const profile = ttsProfiles[agentId]
  const scored = voices
    .map((voice, index) => {
      const label = `${voice.lang} ${voice.name}`
      const zhScore = /^zh|^cmn|Chinese|普通话|國語/i.test(label) ? 4 : 0
      const preferredScore = profile.preferred.some(name => label.toLowerCase().includes(name.toLowerCase())) ? 6 : 0
      const avoidScore = /male|男|elder|old|老|adult/i.test(label) ? -2 : 0
      return { voice, index, score: zhScore + preferredScore + avoidScore }
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
  const bestScore = scored[0]?.score ?? 0
  const pool = bestScore > 0 ? scored.filter(item => item.score === bestScore) : scored
  return pool.length ? pool[fallbackSlot % pool.length].voice : undefined
}

function AgentAvatar({ agent, active, speaking, small = false }: { agent: Agent; active?: boolean; speaking?: boolean; small?: boolean }) {
  return (
    <div className={`agent-avatar ${active ? 'active' : ''} ${speaking ? 'speaking' : ''} ${small ? 'small' : ''}`}
      style={{ '--agent': agent.color, '--agent-soft': agent.soft } as React.CSSProperties}>
      <div className="avatar-ring" />
      <div className="avatar-body">
        <div className="avatar-ears"><i /><i /></div>
        <div className="avatar-face">
          <span className="eye left" /><span className="eye right" />
          <span className="mouth" />
        </div>
        <span className="avatar-symbol">{agent.avatar}</span>
      </div>
      {speaking && <div className="voice-ripples"><i /><i /><i /></div>}
    </div>
  )
}

function App() {
  const [activeId, setActiveId] = useState<AgentId>('atlas')
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [voiceMode, setVoiceMode] = useState<'idle' | 'listening' | 'thinking' | 'speaking'>('idle')
  const [speakingAgent, setSpeakingAgent] = useState<AgentId | null>(null)
  const [panel, setPanel] = useState<'chat' | 'harness' | 'topics'>('chat')
  const [syncing, setSyncing] = useState(false)
  const [motionState, setMotionState] = useState<MotionState>('idle')
  const [semantic, setSemantic] = useState({ energy: .55, valence: .64, certainty: .8 })
  const [motionTraces, setMotionTraces] = useState<MotionTrace[]>([])
  const [modelReport, setModelReport] = useState<RigValidationReport | null>(null)
  const [modelFileName, setModelFileName] = useState('')
  const [playing, setPlaying] = useState(true)
  const [toast, setToast] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const timers = useRef<number[]>([])
  const sweepTimers = useRef<number[]>([])
  const motionTimer = useRef<number | null>(null)
  const drawerDrag = useRef<{ x: number; opened: boolean } | null>(null)
  const recognitionRef = useRef<SpeechRecognizer | null>(null)
  const voiceSessionRef = useRef(false)
  const voiceRestartTimer = useRef<number | null>(null)
  const voiceResponseTimer = useRef<number | null>(null)
  const active = useMemo(() => agents.find(a => a.id === activeId)!, [activeId])
  const modelReadiness = getModelReadiness()

  useEffect(() => () => {
    timers.current.forEach(window.clearTimeout)
    sweepTimers.current.forEach(window.clearTimeout)
    if (motionTimer.current) window.clearTimeout(motionTimer.current)
    if (voiceRestartTimer.current) window.clearTimeout(voiceRestartTimer.current)
    if (voiceResponseTimer.current) window.clearTimeout(voiceResponseTimer.current)
    recognitionRef.current?.abort?.()
    window.speechSynthesis?.cancel()
  }, [])

  const flash = (text: string) => {
    setToast(text)
    window.setTimeout(() => setToast(''), 2400)
  }

  const transitionMotion = (
    state: MotionState,
    duration?: number,
    next: MotionState = 'idle',
    source: MotionSource = 'idle-loop',
    agentId: AgentId = activeId,
    semanticSnapshot = semantic,
  ) => {
    if (motionTimer.current) window.clearTimeout(motionTimer.current)
    setMotionState(state)
    setMotionTraces(previous => [makeMotionTrace(agentId, state, source, semanticSnapshot), ...previous].slice(0, 8))
    if (duration) {
      const timer = window.setTimeout(() => setMotionState(next), duration)
      motionTimer.current = timer
    } else {
      motionTimer.current = null
    }
  }

  const clearMotionSweep = () => {
    sweepTimers.current.forEach(window.clearTimeout)
    sweepTimers.current = []
  }

  const runAtlasMotionSweep = () => {
    clearMotionSweep()
    setPanel('harness')
    setActiveId('atlas')
    setSemantic({ energy: .82, valence: .78, certainty: .9 })
    flash('阿拓 v3 全动作 sweep 开始：入场、聆听、思考、对话、互聊、握手、跳舞、旋转、高抬腿')

    atlasMotionSweep.forEach((state, index) => {
      const timer = window.setTimeout(() => {
        transitionMotion(
          state,
          state === 'handshake' ? 1800 : 1500,
          'idle',
          'motion-lab',
          'atlas',
          { energy: state === 'think' ? .48 : .86, valence: state === 'listen' ? .74 : .82, certainty: .9 },
        )
      }, index * 1650)
      sweepTimers.current.push(timer)
    })

    const doneTimer = window.setTimeout(() => {
      transitionMotion('idle', undefined, 'idle', 'motion-lab', 'atlas', { energy: .45, valence: .72, certainty: .88 })
      flash('阿拓 v3 sweep 完成：可在 trace 和差异面板查看动作覆盖')
    }, atlasMotionSweep.length * 1650 + 500)
    sweepTimers.current.push(doneTimer)
  }

  const selectAgent = (id: AgentId) => {
    setActiveId(id)
    setPanel('chat')
    transitionMotion('wake', 720, 'listen', 'touch', id)
  }

  const speakAgent = (agentId: AgentId, text: string, interrupt = true) => {
    const synth = window.speechSynthesis
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') {
      flash('当前浏览器不支持 TTS 发声')
      return
    }
    if (interrupt) synth.cancel()
    const profile = ttsProfiles[agentId]
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'zh-CN'
    utterance.rate = profile.rate
    utterance.pitch = profile.pitch
    utterance.volume = .92
    const voices = synth.getVoices()
    const voice = chooseYouthfulVoice(voices, agentId, profile.voiceSlot)
    if (voice) utterance.voice = voice
    utterance.onstart = () => {
      setSpeakingAgent(agentId)
      setVoiceMode('speaking')
    }
    utterance.onend = () => {
      setSpeakingAgent(current => current === agentId ? null : current)
      if (voiceSessionRef.current) setVoiceMode('listening')
      else setVoiceMode('idle')
    }
    utterance.onerror = () => {
      setSpeakingAgent(current => current === agentId ? null : current)
    }
    synth.speak(utterance)
  }

  const answer = (text: string, keepSession = voiceSessionRef.current) => {
    const lower = text.toLowerCase()
    const motionCommand = parseVoiceMotionCommand(text, activeId)
    if (motionCommand) {
      const nextSemantic = deriveSemanticMotion(text)
      setSemantic({ ...nextSemantic, energy: Math.max(nextSemantic.energy, .88), valence: Math.max(nextSemantic.valence, .78) })
      setActiveId(motionCommand.agentId)
      setVoiceMode('speaking')
      transitionMotion(
        motionCommand.motion,
        motionCommand.duration,
        keepSession ? 'listen' : 'idle',
        'voice',
        motionCommand.agentId,
        { ...nextSemantic, energy: .9, valence: .82, certainty: .9 },
      )
      setMessages(prev => [...prev, { agent: motionCommand.agentId, text: `语音动作：${motionCommand.label}。${motionCommand.response}`, time: '刚刚' }])
      speakAgent(motionCommand.agentId, motionCommand.response)
      const timer = window.setTimeout(() => {
        if (voiceSessionRef.current) {
          setVoiceMode('listening')
          setTranscript('还想让谁动一动？比如“缪思跳舞”。')
        } else {
          setVoiceMode('idle')
          setTranscript('')
        }
      }, motionCommand.duration)
      timers.current.push(timer)
      return
    }
    let target: AgentId = activeId
    let response = active.intro
    if (lower.includes('回家') || lower.includes('路线')) {
      target = 'atlas'; response = '回家路线已准备好。前方高架略拥堵，我选了更安静的地面道路，预计 32 分钟。'
    } else if (lower.includes('餐厅') || lower.includes('吃')) {
      target = 'milo'; response = '找到一家顺路的炭火小馆，环境安静，停车也方便。阿拓说只多 6 分钟。'
    } else if (lower.includes('歌') || lower.includes('音乐')) {
      target = 'muse'; response = '那就从一首有微风感的开始。我把节奏压低一点，留出夜路的空间。'
    } else if (lower.includes('车') || lower.includes('电量')) {
      target = 'nova'; response = '车辆状态良好，电量 62%，胎压正常。你可以放心开，剩下的我盯着。'
    } else if (lower.includes('聊') || lower.includes('热点')) {
      target = 'muse'; response = '今天我们意外聊到了「城市为什么需要无目的的绕路」。米洛有个很具体的提案。'
    }
    const nextSemantic = deriveSemanticMotion(text)
    setSemantic(nextSemantic)
    setActiveId(target)
    setVoiceMode('speaking')
    transitionMotion('speak', 2600, keepSession ? 'listen' : 'idle', 'voice', target, nextSemantic)
    setMessages(prev => [...prev, { agent: target, text: response, time: '刚刚' }])
    speakAgent(target, response)
    const timer = window.setTimeout(() => {
      if (voiceSessionRef.current) {
        setVoiceMode('listening')
        setTranscript('继续说，我在听。')
      } else {
        setVoiceMode('idle')
        setTranscript('')
      }
    }, 2680)
    timers.current.push(timer)
  }

  const queueVoiceTurn = (rawText: string) => {
    const text = rawText.trim()
    if (!text) return
    window.speechSynthesis?.cancel()
    setSpeakingAgent(null)
    if (voiceResponseTimer.current) window.clearTimeout(voiceResponseTimer.current)
    setTranscript(text)
    setVoiceMode('thinking')
    transitionMotion('think', undefined, 'idle', 'voice')
    voiceResponseTimer.current = window.setTimeout(() => answer(text), 620)
  }

  const submitVoice = (prompt?: string) => {
    queueVoiceTurn(prompt || transcript || quickPrompts[0])
  }

  const stopVoiceSession = () => {
    voiceSessionRef.current = false
    setListening(false)
    setVoiceMode('idle')
    if (voiceRestartTimer.current) window.clearTimeout(voiceRestartTimer.current)
    recognitionRef.current?.stop()
    recognitionRef.current = null
    window.speechSynthesis?.cancel()
    setSpeakingAgent(null)
    transitionMotion('idle', undefined, 'idle', 'voice')
    if (!transcript) setTranscript('')
  }

  const startVoiceSession = () => {
    if (voiceSessionRef.current) return
    voiceSessionRef.current = true
    setListening(true)
    setVoiceMode('listening')
    transitionMotion('listen', undefined, 'idle', 'voice')
    setTranscript('持续聆听中，你可以直接说“阿拓，带我回家”。')
    const speechWindow = window as Window & {
      SpeechRecognition?: SpeechRecognizerConstructor
      webkitSpeechRecognition?: SpeechRecognizerConstructor
    }
    const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition
    if (!Recognition) {
      flash('当前浏览器不支持连续语音识别，可先用下方示例驱动阿拓')
      return
    }

    const recognition = new Recognition()
    recognition.lang = 'zh-CN'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.onresult = (event: SpeechEvent) => {
      let interim = ''
      let finalText = ''
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        const text = result[0]?.transcript || ''
        if (result.isFinal) finalText += text
        else interim += text
      }
      if (finalText.trim()) queueVoiceTurn(finalText)
      else if (interim.trim()) {
        setVoiceMode('listening')
        setTranscript(interim.trim())
        transitionMotion('listen', undefined, 'idle', 'voice')
      }
    }
    recognition.onend = () => {
      recognitionRef.current = null
      if (!voiceSessionRef.current) {
        setListening(false)
        return
      }
      voiceRestartTimer.current = window.setTimeout(() => {
        if (!voiceSessionRef.current) return
        recognitionRef.current = recognition
        try {
          recognition.start()
        } catch {
          flash('连续监听重启失败，请再点一次麦克风')
          stopVoiceSession()
        }
      }, 240)
    }
    recognition.onerror = event => {
      if (event?.error === 'not-allowed' || event?.error === 'service-not-allowed') {
        flash('麦克风权限未打开，允许后再点麦克风')
        stopVoiceSession()
        return
      }
      if (!voiceSessionRef.current) return
      setTranscript('我还在，刚才那句没听清。')
    }
    recognitionRef.current = recognition
    try {
      recognition.start()
    } catch {
      flash('语音识别启动失败，请检查浏览器麦克风权限')
      stopVoiceSession()
    }
  }

  const toggleListening = () => {
    if (voiceSessionRef.current) stopVoiceSession()
    else startVoiceSession()
  }

  const runDailySync = () => {
    if (syncing) return
    setPanel('chat'); setDrawerOpen(true); setSyncing(true); transitionMotion('social', undefined, 'idle', 'agent-room'); setMessages([])
    syncMessages.forEach((message, index) => {
      const timer = window.setTimeout(() => {
        setActiveId(message.agent)
        transitionMotion('social', undefined, 'idle', 'agent-room', message.agent)
        setMessages(prev => [...prev, { ...message, time: '刚刚' }])
        speakAgent(message.agent, message.text, index === 0)
        if (index === syncMessages.length - 1) {
          setSyncing(false)
          transitionMotion('speak', 1800, 'idle', 'agent-room', message.agent)
        }
      }, 500 + index * 900)
      timers.current.push(timer)
    })
  }

  const handleHandshake = (id: AgentId) => {
    setActiveId(id)
    transitionMotion('handshake', 1900, 'idle', 'gesture', id)
    flash(`${agents.find(agent => agent.id === id)?.name} 握住了你的手`)
  }

  const handleModelFile = async (file?: File) => {
    if (!file) return
    setModelFileName(file.name)
    try {
      const report = await validatePetRigFile(file, petModelRegistry.atlas)
      setModelReport(report)
      flash(report.valid ? '阿拓 GLB 骨骼契约通过' : `GLB 缺少 ${report.missing.length} 个必要骨骼`)
    } catch {
      setModelReport(null)
      flash('无法解析该 GLB，请检查文件是否完整')
    }
  }

  const beginDrawerGesture = (event: React.PointerEvent<HTMLButtonElement>) => {
    drawerDrag.current = { x: event.clientX, opened: drawerOpen }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const moveDrawerGesture = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = drawerDrag.current
    if (!drag) return
    const delta = event.clientX - drag.x
    if (!drag.opened && delta < -26) {
      setDrawerOpen(true)
      drawerDrag.current = null
    }
    if (drag.opened && delta > 26) {
      setDrawerOpen(false)
      drawerDrag.current = null
    }
  }

  const endDrawerGesture = () => {
    drawerDrag.current = null
  }

  return (
    <main className="cockpit-shell">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />

      <section className="content-grid">
        <section className="stage">
          <div className="stage-heading">
            <div><span className="eyebrow"><i /> LIVE COMPANIONS</span><h1>晚上好，Frank</h1><p>{active.intro}</p></div>
            <div className="stage-actions"><button className="sync-button" onClick={runDailySync}><Users size={17} />{syncing ? '圆桌进行中…' : '今日圆桌'}<ChevronRight size={16} /></button></div>
          </div>
          <div className="assistant-mark" aria-hidden="true"><span>⌕</span><i /></div>
          <div className="top-status" aria-label="车机状态">
            <Bell size={28} /><BatteryCharging size={27} /><Bluetooth size={30} /><span>5G</span><Signal size={29} />
          </div>

          <PetStage
            agents={agents}
            activeId={activeId}
            state={motionState}
            syncing={syncing}
            semantic={semantic}
            onSelect={selectAgent}
            onHandshake={handleHandshake}
            onStatePreview={(state) => transitionMotion(state, state === 'idle' ? undefined : 2300, 'idle', 'motion-lab')}
          />

          <div className={`voice-console ${listening ? 'listening' : ''}`}>
            <div className="voice-copy"><small>{speakingAgent ? `${agents.find(agent => agent.id === speakingAgent)?.name} 正在发声 · TTS` : listening ? `CONTINUOUS · ${voiceMode.toUpperCase()}` : `正在与 ${active.name} 对话`}</small><b>{transcript || `“${active.name}，我想……”`}</b></div>
            <div className="waveform">{[5,9,14,8,18,12,6,15,9,5,12,7].map((h, i) => <i key={i} style={{ height: h }} />)}</div>
            <button className="mic-button" onClick={toggleListening} aria-label={listening ? '结束连续语音' : '开始连续语音'}>{listening ? <Pause size={22} /> : <Mic size={22} />}</button>
          </div>
          <div className="quick-prompts">{quickPrompts.map(prompt => <button key={prompt} onClick={() => submitVoice(prompt)}>{prompt}</button>)}</div>
        </section>

        {drawerOpen && <button className="drawer-scrim" aria-label="关闭圆桌浮层" onClick={() => setDrawerOpen(false)} />}
        <button
          className={`drawer-edge ${drawerOpen ? 'open' : ''}`}
          aria-label={drawerOpen ? '收起圆桌列表' : '从右侧滑出圆桌列表'}
          onClick={() => setDrawerOpen(open => !open)}
          onPointerDown={beginDrawerGesture}
          onPointerMove={moveDrawerGesture}
          onPointerUp={endDrawerGesture}
          onPointerCancel={endDrawerGesture}
        >
          {drawerOpen ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          <span>{drawerOpen ? '收起' : '圆桌'}</span>
        </button>

        <aside className={`right-panel chat-drawer ${drawerOpen ? 'open' : ''}`} aria-hidden={!drawerOpen}>
          <div className="panel-tabs">
            <button className={panel === 'chat' ? 'active' : ''} onClick={() => setPanel('chat')}><MessageCircleMore size={16} />圆桌</button>
            <button className={panel === 'topics' ? 'active' : ''} onClick={() => setPanel('topics')}><Radio size={16} />热点</button>
            <button className={panel === 'harness' ? 'active' : ''} onClick={() => setPanel('harness')}><Activity size={16} />Harness</button>
          </div>

          {panel === 'chat' && <div className="chat-panel">
            <div className="panel-title"><div><small>AGENT ROOM · TODAY</small><h2>他们聊了些什么</h2></div><button onClick={() => setDrawerOpen(false)}><X size={16} /></button></div>
            <div className="chat-feed">
              {messages.length === 0 && !syncing && <div className="empty-chat"><Coffee size={28} /><b>圆桌暂时安静</b><span>让四位伙伴带着今天的新发现回来聊聊。</span><button onClick={runDailySync}>开始一次圆桌</button></div>}
              {messages.map((message, index) => {
                const agent = agents.find(a => a.id === message.agent)!
                return <article className="chat-message" key={`${message.agent}-${index}`}>
                  <AgentAvatar agent={agent} small />
                  <div><header><b style={{ color: agent.color }}>{agent.name}</b><span>{message.time}</span>{message.kind === 'topic' && <em>新话题</em>}</header><p>{message.text}</p></div>
                </article>
              })}
              {syncing && <div className="typing"><i /><i /><i />伙伴们正在形成观点</div>}
            </div>
            <div className="consensus-card"><Sparkles size={18} /><div><small>今日共识</small><b>值得为好奇心绕一点路</b></div><button onClick={() => flash('已加入周六计划')}><ChevronRight size={17} /></button></div>
          </div>}

          {panel === 'topics' && <div className="topics-panel">
            <div className="panel-title"><div><small>CURATED AT 18:00</small><h2>今日兴趣雷达</h2></div><span className="live-dot">已更新</span></div>
            {[
              ['atlas','滨江周末交通调整','城市交通 · 12 分钟前','影响 2 条常用路线'],
              ['muse','声音艺术正在回到街头','文化 · 34 分钟前','与 3 个收藏地点相关'],
              ['milo','上海夜间咖啡地图更新','生活 · 1 小时前','发现 6 家新店'],
              ['nova','雨天辅助驾驶功能观察','汽车科技 · 2 小时前','安全优先级：高'],
            ].map(([id,title,meta,note]) => { const a = agents.find(x => x.id === id)!; return <article className="topic-card" key={id}>
              <div className="topic-icon" style={{ color: a.color, background: a.soft }}>{a.avatar}</div><div><small>{meta}</small><b>{title}</b><span>{note}</span></div><ChevronRight size={17} />
            </article>})}
            <div className="source-note"><ShieldCheck size={16} /><span>只读取公开信息源；位置与偏好默认留在车端。</span></div>
            <div className="persona-grid">
              {agents.map(agent => <article className="persona-card" key={agent.id} style={{ '--agent': agent.color, '--agent-soft': agent.soft } as React.CSSProperties}>
                <header><i>{agent.avatar}</i><div><small>{agent.age} · {agent.voiceStyle}</small><b>{agent.name} · {agent.trait}</b></div></header>
                <p>{agent.personality}</p>
                <dl>
                  <div><dt>喜欢</dt><dd>{agent.likes.join(' / ')}</dd></div>
                  <div><dt>怪癖</dt><dd>{agent.quirk}</dd></div>
                  <div><dt>成长</dt><dd>{agent.origin}</dd></div>
                  <div><dt>关系</dt><dd>{agent.relation}</dd></div>
                  <div><dt>矛盾</dt><dd>{agent.conflict}</dd></div>
                </dl>
              </article>)}
            </div>
          </div>}

          {panel === 'harness' && <div className="harness-panel">
            <div className="panel-title"><div><small>PROTOTYPE CONTROL</small><h2>Agent Harness v0.1</h2></div><span className="live-dot">运行中</span></div>
            <div className="harness-flow">
              {[
                [Clock3,'每日 18:00','兴趣检索触发'],
                [Compass,'4 个 Scout','独立来源与人格过滤'],
                [MessageCircleMore,'Roundtable','观点碰撞 · 最多 6 轮'],
                [ShieldCheck,'Guardrail','驾驶状态与隐私校验'],
              ].map(([Icon,title,sub], i) => <div className="flow-row" key={String(title)}><span>{i+1}</span><Icon size={17}/><div><b>{String(title)}</b><small>{String(sub)}</small></div><i className="flow-ok" /></div>)}
            </div>
            <div className="metric-grid"><div><span>87%</span><small>人格一致性</small></div><div><span>0</span><small>安全越界</small></div><div><span>4.2</span><small>平均对话轮次</small></div><div><span>68%</span><small>话题接受率</small></div></div>
            <div className="motion-lab">
              <header><div><small>MOTION LAB</small><b>{motionState.toUpperCase()} · {active.name}</b></div><span>{modelReadiness.ready}/{modelReadiness.total} GLB · {modelReadiness.fallback ? 'FALLBACK' : 'LIVE'}</span></header>
              {(['energy', 'valence', 'certainty'] as const).map(signal => <label key={signal}>
                <span>{signal}</span><b>{Math.round(semantic[signal] * 100)}</b>
                <input aria-label={signal} type="range" min="0" max="100" value={semantic[signal] * 100} onChange={event => setSemantic(current => ({ ...current, [signal]: Number(event.target.value) / 100 }))} />
              </label>)}
            </div>
            <div className="ata-sweep-card">
              <div>
                <small>ATA V3 MOTION SWEEP</small>
                <b>用优化后的阿拓跑完整动作链</b>
                <span>{atlasMotionSweep.map(state => motionDisplayName[state]).join(' / ')}</span>
              </div>
              <button onClick={runAtlasMotionSweep}><Activity size={15} />开始 sweep</button>
            </div>
            <div className="rig-delta">
              <header>
                <div><small>RIG DELTA</small><b>阿拓 v3 与其他角色优化差距</b></div>
                <span>QA BASELINE</span>
              </header>
              {rigDeltas.map(item => {
                const agent = agents.find(candidate => candidate.id === item.id)!
                return (
                  <article key={item.id} className={`rig-delta-row ${item.id === 'atlas' ? 'optimized' : ''}`} style={{ '--delta': agent.color } as React.CSSProperties}>
                    <div className="rig-score">
                      <b>{item.score}</b><span>{item.badge}</span>
                    </div>
                    <div className="rig-copy">
                      <div><strong>{agent.name}</strong><em>{item.version}</em></div>
                      <p>{item.geometry}</p>
                      <p>{item.expression}</p>
                      <p>{item.action}</p>
                      <small>{item.risk}</small>
                    </div>
                  </article>
                )
              })}
            </div>
            <div className="action-coverage">
              <header><small>ACTION COVERAGE</small><b>同一动作下的优化差异</b></header>
              {actionCoverage.map(item => (
                <div key={item.label}>
                  <span>{item.label}</span>
                  <b>{item.atlas}</b>
                  <em>{item.baseline}</em>
                </div>
              ))}
            </div>
            <label className={`model-gate ${modelReport ? (modelReport.valid ? 'valid' : 'invalid') : ''}`}>
              <input type="file" accept=".glb,model/gltf-binary" onChange={event => void handleModelFile(event.target.files?.[0])} />
              <span className="model-gate-icon">{modelReport ? (modelReport.valid ? <CheckCircle2 size={18}/> : <AlertTriangle size={18}/>) : <UploadCloud size={18}/>}</span>
              <div><small>ATLAS · GLB GATE</small><b>{modelFileName || '拖入或选择阿拓 GLB'}</b><em>{modelReport ? `${modelReport.resolved.length}/12 bones · ${modelReport.meshCount} meshes${modelReport.missing.length ? ` · 缺少 ${modelReport.missing.join(', ')}` : ''}` : '仅本地解析，不会上传文件'}</em></div>
            </label>
            <div className="trace-stream">
              <small>RECENT MOTION TRACE</small>
              {motionTraces.length === 0 && <span className="trace-empty">触发角色动作后显示运行轨迹</span>}
              {motionTraces.slice(0, 3).map(trace => <div key={trace.id}><i /><b>{agents.find(agent => agent.id === trace.agentId)?.name} · {trace.state}</b><span>{trace.source}</span></div>)}
            </div>
            <button className="trace-button" onClick={() => flash('本轮 trace 已标记，等待评审')}><CircleGauge size={17}/>标记本轮用于评审</button>
          </div>}
        </aside>
      </section>

      <footer className="dock">
        <div className="dock-cluster dock-left">
          <button className="dock-icon active"><Home size={22}/></button>
          <button className="dock-icon"><Users size={21}/></button>
          <span className="dock-temp">20.5</span>
        </div>
        <nav>
          <button className="active"><Navigation size={20}/><span>导航</span></button>
          <button><Map size={20}/><span>地图</span></button>
          <button onClick={() => setPanel('topics')}><Sparkles size={20}/><span>AI</span></button>
          <button onClick={() => { setPlaying(!playing); submitVoice('换一首适合夜路的歌') }}>{playing ? <Pause size={20}/> : <Play size={20}/>}<span>媒体</span></button>
          <button onClick={() => { setPanel('chat'); setDrawerOpen(true) }}><Users size={20}/><span>伙伴</span></button>
        </nav>
        <div className="dock-cluster dock-right">
          <span className="dock-temp">20.5</span>
          <button className="dock-icon"><Gauge size={22}/></button>
          <button className="dock-icon"><Coffee size={21}/></button>
        </div>
      </footer>
      {toast && <div className="toast"><Sparkles size={16}/>{toast}</div>}
    </main>
  )
}

export default App
