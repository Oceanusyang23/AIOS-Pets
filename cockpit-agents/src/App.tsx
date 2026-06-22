import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, Bell, CarFront, ChevronRight, CircleGauge, Clock3,
  Coffee, Compass, Gauge, Home, Map, MessageCircleMore, Mic,
  Music2, Navigation, Pause, Play, Radio, Search, Settings2,
  ShieldCheck, SlidersHorizontal, Sparkles, Users, Volume2, X,
} from 'lucide-react'
import { PetStage, type MotionState } from './webgl/PetStage'
import './App.css'

type AgentId = 'atlas' | 'muse' | 'milo' | 'nova'
type Message = { agent: AgentId; text: string; time?: string; kind?: 'topic' | 'chat' }

type SpeechResult = { [index: number]: { transcript: string } }
type SpeechEvent = { results: ArrayLike<SpeechResult> }
type SpeechRecognizer = {
  lang: string
  interimResults: boolean
  onresult: (event: SpeechEvent) => void
  onend: () => void
  onerror: () => void
  start: () => void
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
  const [activeId, setActiveId] = useState<AgentId>('muse')
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [panel, setPanel] = useState<'chat' | 'harness' | 'topics'>('chat')
  const [syncing, setSyncing] = useState(false)
  const [motionState, setMotionState] = useState<MotionState>('idle')
  const [semantic, setSemantic] = useState({ energy: .55, valence: .64, certainty: .8 })
  const [playing, setPlaying] = useState(true)
  const [toast, setToast] = useState('')
  const timers = useRef<number[]>([])
  const motionTimer = useRef<number | null>(null)
  const active = useMemo(() => agents.find(a => a.id === activeId)!, [activeId])

  useEffect(() => () => {
    timers.current.forEach(window.clearTimeout)
    if (motionTimer.current) window.clearTimeout(motionTimer.current)
  }, [])

  const flash = (text: string) => {
    setToast(text)
    window.setTimeout(() => setToast(''), 2400)
  }

  const transitionMotion = (state: MotionState, duration?: number, next: MotionState = 'idle') => {
    if (motionTimer.current) window.clearTimeout(motionTimer.current)
    setMotionState(state)
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
    transitionMotion('wake', 720, 'listen')
  }

  const answer = (text: string) => {
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
    setSemantic({
      energy: Math.min(.92, .38 + text.length / 55),
      valence: lower.includes('别') || lower.includes('拥堵') ? .35 : .72,
      certainty: lower.includes('可能') ? .48 : .86,
    })
    setActiveId(target)
    transitionMotion('speak', 2600)
    setMessages(prev => [...prev, { agent: target, text: response, time: '刚刚' }])
    setTranscript('')
  }

  const submitVoice = (prompt?: string) => {
    const text = prompt || transcript || quickPrompts[0]
    setTranscript(text)
    setListening(false)
    transitionMotion('think')
    window.setTimeout(() => answer(text), 820)
  }

  const toggleListening = () => {
    if (listening) { submitVoice(); return }
    setListening(true)
    setMotionState('listen')
    setTranscript('正在聆听…')
    const speechWindow = window as Window & {
      SpeechRecognition?: SpeechRecognizerConstructor
      webkitSpeechRecognition?: SpeechRecognizerConstructor
    }
    const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition
    if (Recognition) {
      const recognition = new Recognition()
      recognition.lang = 'zh-CN'
      recognition.interimResults = true
      recognition.onresult = (event: SpeechEvent) => {
        const text = Array.from(event.results, result => result[0].transcript).join('')
        setTranscript(text)
      }
      recognition.onend = () => { setListening(false); if (!transcript) setMotionState('idle') }
      recognition.onerror = () => { setListening(false); setTranscript(''); flash('未获得麦克风输入，可点下方示例体验') }
      recognition.start()
    }
  }

  const runDailySync = () => {
    if (syncing) return
    setPanel('chat'); setSyncing(true); setMotionState('social'); setMessages([])
    syncMessages.forEach((message, index) => {
      const timer = window.setTimeout(() => {
        setActiveId(message.agent)
        setMessages(prev => [...prev, { ...message, time: '刚刚' }])
        if (index === syncMessages.length - 1) {
          setSyncing(false)
          transitionMotion('speak', 1800)
        }
      }, 500 + index * 900)
      timers.current.push(timer)
    })
  }

  return (
    <main className="cockpit-shell">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <header className="topbar">
        <div className="brand"><span className="brand-mark"><Sparkles size={17} /></span><div><b>AI Center</b><span>四位伙伴，与你共同生活</span></div></div>
        <div className="drive-state"><ShieldCheck size={15} /><span>P 档 · 已安全驻车</span><i /></div>
        <div className="top-actions">
          <button aria-label="搜索"><Search size={18} /></button>
          <button aria-label="通知" className="notification"><Bell size={18} /><i /></button>
          <span className="weather">20:26 <small>23° 上海</small></span>
          <button aria-label="设置"><Settings2 size={18} /></button>
        </div>
      </header>

      <section className="content-grid">
        <aside className="left-rail">
          <nav>
            <button className="active" aria-label="主页"><Home size={20} /></button>
            <button aria-label="导航"><Navigation size={20} /></button>
            <button aria-label="音乐"><Music2 size={20} /></button>
            <button aria-label="车辆"><CarFront size={20} /></button>
          </nav>
          <div className="rail-bottom"><span>20.5°</span><button><SlidersHorizontal size={19} /></button></div>
        </aside>

        <section className="stage">
          <div className="stage-heading">
            <div><span className="eyebrow"><i /> LIVE COMPANIONS</span><h1>晚上好，Frank</h1><p>{active.intro}</p></div>
            <button className="sync-button" onClick={runDailySync}><Users size={17} />{syncing ? '圆桌进行中…' : '开启今日圆桌'}<ChevronRight size={16} /></button>
          </div>

          <PetStage
            agents={agents}
            activeId={activeId}
            state={motionState}
            syncing={syncing}
            semantic={semantic}
            onSelect={selectAgent}
            onHandshake={(id) => {
              setActiveId(id)
              transitionMotion('handshake', 1900)
              flash(`${agents.find(agent => agent.id === id)?.name} 握住了你的手`)
            }}
            onStatePreview={(state) => transitionMotion(state, state === 'idle' ? undefined : 2300)}
          />

          <div className={`voice-console ${listening ? 'listening' : ''}`}>
            <div className="voice-copy"><small>{listening ? 'LISTENING' : `正在与 ${active.name} 对话`}</small><b>{transcript || `“${active.name}，我想……”`}</b></div>
            <div className="waveform">{[5,9,14,8,18,12,6,15,9,5,12,7].map((h, i) => <i key={i} style={{ height: h }} />)}</div>
            <button className="mic-button" onClick={toggleListening} aria-label="语音交互">{listening ? <Pause size={22} /> : <Mic size={22} />}</button>
          </div>
          <div className="quick-prompts">{quickPrompts.map(prompt => <button key={prompt} onClick={() => submitVoice(prompt)}>{prompt}</button>)}</div>
        </section>

        <aside className="right-panel">
          <div className="panel-tabs">
            <button className={panel === 'chat' ? 'active' : ''} onClick={() => setPanel('chat')}><MessageCircleMore size={16} />圆桌</button>
            <button className={panel === 'topics' ? 'active' : ''} onClick={() => setPanel('topics')}><Radio size={16} />热点</button>
            <button className={panel === 'harness' ? 'active' : ''} onClick={() => setPanel('harness')}><Activity size={16} />Harness</button>
          </div>

          {panel === 'chat' && <div className="chat-panel">
            <div className="panel-title"><div><small>AGENT ROOM · TODAY</small><h2>他们聊了些什么</h2></div><button onClick={() => setMessages([])}><X size={16} /></button></div>
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
            <div className="harness-controls"><label>主动程度 <b>克制</b><input type="range" min="0" max="100" defaultValue="38" /></label><label>观点分歧 <b>适中</b><input type="range" min="0" max="100" defaultValue="57" /></label></div>
            <button className="trace-button" onClick={() => flash('本轮 trace 已标记，等待评审')}><CircleGauge size={17}/>标记本轮用于评审</button>
          </div>}
        </aside>
      </section>

      <footer className="dock">
        <div className="music-widget"><button onClick={() => setPlaying(!playing)}>{playing ? <Pause size={15}/> : <Play size={15}/>}</button><div className="album-art">月</div><div><b>Moonlit Walk</b><span>Mondo Loops · 缪思推荐</span></div><Volume2 size={15}/></div>
        <nav><button className="active"><Home size={19}/><span>桌面</span></button><button><Map size={19}/><span>地图</span></button><button><Music2 size={19}/><span>音乐</span></button><button onClick={() => setPanel('chat')}><Users size={19}/><span>伙伴</span></button><button><Gauge size={19}/><span>车辆</span></button></nav>
        <div className="trip-widget"><Navigation size={17}/><div><small>回家</small><b>32 分钟 · 18 km</b></div><ChevronRight size={17}/></div>
      </footer>
      {toast && <div className="toast"><Sparkles size={16}/>{toast}</div>}
    </main>
  )
}

export default App
