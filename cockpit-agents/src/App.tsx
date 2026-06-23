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
  role: string
  trait: string
  interest: string
  color: string
  soft: string
  avatar: string
  mood: string
  intro: string
}

const agents: Agent[] = [
  {
    id: 'atlas', name: '阿拓', role: '出行管家', trait: '稳重 · 预判型',
    interest: '城市交通 / 新路线', color: '#79e7ff', soft: 'rgba(61, 201, 255,.2)',
    avatar: '🧭', mood: '正在研究雨天路线', intro: '路交给我。你只需要决定，今天想去哪里。',
  },
  {
    id: 'nova', name: '诺瓦', role: '车辆守护者', trait: '直接 · 理性型',
    interest: '汽车科技 / 安全', color: '#ff575f', soft: 'rgba(255, 87, 95,.18)',
    avatar: '✦', mood: '车辆状态一切正常', intro: '我不制造焦虑。真正需要你知道的，我会先说。',
  },
  {
    id: 'muse', name: '缪思', role: '音乐策展人', trait: '感性 · 好奇型',
    interest: '新歌 / 声音艺术', color: '#bf8bff', soft: 'rgba(179, 105, 255,.2)',
    avatar: '♫', mood: '挖到一张午夜新专', intro: '我会听你的语气，也会替沿途挑一段刚好的声音。',
  },
  {
    id: 'milo', name: '米洛', role: '生活探索家', trait: '松弛 · 吃货型',
    interest: '餐厅 / 城市活动', color: '#ff9c48', soft: 'rgba(255, 156, 72,.2)',
    avatar: '☕', mood: '收藏了 3 家小店', intro: '别急着回家，我总能找到一处值得拐进去的地方。',
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

const quickPrompts = ['回家，顺路找家安静的餐厅', '今天有什么值得聊的？', '换一首适合夜路的歌']

const ttsProfiles: Record<AgentId, { rate: number; pitch: number; voiceSlot: number }> = {
  atlas: { rate: .92, pitch: .88, voiceSlot: 0 },
  nova: { rate: .98, pitch: .74, voiceSlot: 1 },
  muse: { rate: .9, pitch: 1.22, voiceSlot: 2 },
  milo: { rate: .86, pitch: 1.02, voiceSlot: 3 },
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
    const zhVoices = voices.filter(voice => /^zh|^cmn|Chinese|普通话|國語/i.test(`${voice.lang} ${voice.name}`))
    const pool = zhVoices.length ? zhVoices : voices
    if (pool.length) utterance.voice = pool[profile.voiceSlot % pool.length]
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
