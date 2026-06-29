import 'dotenv/config'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ArkRuntimeClient } from '@volcengine/ark-runtime'

const agents = {
  atlas: {
    name: '阿拓',
    role: '出行管家',
    voice: '清亮少年感，轻快、笃定、带一点冒险感',
    persona: '认真、可靠、爱规划路线。紧张时会把路线说成冒险副本，被夸会害羞。',
    keywords: ['路线', '出发', '时间', '顺路', '安全'],
  },
  nova: {
    name: '诺瓦',
    role: '车辆守护者',
    voice: '年轻中性声，短句、干净、略带电子感，不低沉',
    persona: '外冷内热，理性克制，重视安全和车况。嘴上酷，行动上很照顾朋友。',
    keywords: ['车况', '安全', '电量', '检查', '稳定'],
  },
  muse: {
    name: '缪思',
    role: '音乐策展人',
    voice: '少女感，轻甜但不嗲，语调有音乐性和跳跃感',
    persona: '情绪敏感、脑洞大，喜欢把路噪、雨声和心情混成歌单。',
    keywords: ['歌', '节奏', '声音', '副歌', '氛围'],
  },
  milo: {
    name: '米洛',
    role: '生活探索家',
    voice: '少年小奶音，暖、圆、带一点撒娇式兴奋',
    persona: '乐天派、吃货、慢半拍，总能把紧张气氛变成先吃一口。',
    keywords: ['吃', '小店', '热汤', '顺路', '菜单'],
  },
}

const prompts = [
  '晚上 8 点了，我有点累，但又不想直接回家，你会怎么建议？',
  '刚才我们几个朋友有点拌嘴，你用自己的方式缓和一下气氛。',
  '用一句自然的车机语音回应我，别像客服，也别太成熟。',
]

function systemPrompt(agent) {
  return [
    `你是 AIOS-Pets 车机桌面中的 ${agent.name}，身份是${agent.role}。`,
    `性格：${agent.persona}`,
    `声音/语气：${agent.voice}`,
    '你和另外三个 Agent 像朋友一样相处：可以拌嘴、接梗、关心对方，但不要模仿任何具体影视剧台词。',
    '回复必须是中文，年轻、可爱、自然，优先 1-3 句。不要像中年客服，不要写长段说明。',
  ].join('\n')
}

function scoreChinesePersona(text, agent) {
  const lengthScore = text.length >= 12 && text.length <= 120 ? 1 : 0
  const chineseScore = /[\u4e00-\u9fa5]/.test(text) ? 1 : 0
  const keywordScore = agent.keywords.some(keyword => text.includes(keyword)) ? 1 : 0
  const stiffnessPenalty = /(您好|亲亲|为您服务|根据您的需求|感谢咨询|祝您生活愉快)/.test(text) ? -1 : 0
  const youthCueScore = /(呀|欸|嘿|啦|嘛|噢|哇|小|偷偷|先|一起|放心)/.test(text) ? 1 : 0
  return Math.max(0, lengthScore + chineseScore + keywordScore + youthCueScore + stiffnessPenalty)
}

async function callDoubao({ client, model, agentId, prompt }) {
  const agent = agents[agentId]
  const startedAt = performance.now()
  const response = await client.createChatCompletion({
    model,
    temperature: 0.82,
    max_tokens: 260,
    messages: [
      { role: 'system', content: systemPrompt(agent) },
      { role: 'user', content: prompt },
    ],
  })
  const latencyMs = Math.round(performance.now() - startedAt)
  const text = response.choices?.[0]?.message?.content?.trim() || ''
  return {
    provider: 'doubao',
    model,
    agentId,
    agentName: agent.name,
    prompt,
    latencyMs,
    charsPerSecond: Number((text.length / Math.max(latencyMs / 1000, .001)).toFixed(1)),
    personaScore: scoreChinesePersona(text, agent),
    text,
    usage: response.usage || null,
  }
}

async function callOpenAI({ model, agentId, prompt }) {
  if (!process.env.OPENAI_API_KEY) return null
  const agent = agents[agentId]
  const startedAt = performance.now()
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [
        { role: 'system', content: systemPrompt(agent) },
        { role: 'user', content: prompt },
      ],
      temperature: 0.82,
      max_output_tokens: 260,
    }),
  })
  const data = await response.json()
  if (!response.ok) {
    return {
      provider: 'openai',
      model,
      agentId,
      agentName: agent.name,
      prompt,
      error: data?.error?.message || `HTTP ${response.status}`,
    }
  }
  const latencyMs = Math.round(performance.now() - startedAt)
  const text = (data.output_text || '').trim()
  return {
    provider: 'openai',
    model,
    agentId,
    agentName: agent.name,
    prompt,
    latencyMs,
    charsPerSecond: Number((text.length / Math.max(latencyMs / 1000, .001)).toFixed(1)),
    personaScore: scoreChinesePersona(text, agent),
    text,
    usage: data.usage || null,
  }
}

async function main() {
  const apiKey = process.env.ARK_API_KEY || process.env.DOUBAO_API_KEY
  const model = process.env.ARK_MODEL || process.env.DOUBAO_MODEL || 'doubao-seed-evolving'
  const openAIModel = process.env.OPENAI_MODEL || 'gpt-4.1-mini'

  if (!apiKey) {
    console.error('Missing ARK_API_KEY. Create .env from .env.example and add your Volcengine Ark API key.')
    process.exitCode = 2
    return
  }

  const client = ArkRuntimeClient.withApiKey(apiKey)
  const results = []
  for (const agentId of Object.keys(agents)) {
    for (const prompt of prompts) {
      results.push(await callDoubao({ client, model, agentId, prompt }))
      const openAIResult = await callOpenAI({ model: openAIModel, agentId, prompt })
      if (openAIResult) results.push(openAIResult)
    }
  }

  const summary = Object.values(
    results.reduce((acc, item) => {
      const key = `${item.provider}:${item.model}`
      acc[key] ||= { provider: item.provider, model: item.model, count: 0, latencyMs: 0, charsPerSecond: 0, personaScore: 0, errors: 0 }
      acc[key].count += 1
      if (item.error) {
        acc[key].errors += 1
        return acc
      }
      acc[key].latencyMs += item.latencyMs
      acc[key].charsPerSecond += item.charsPerSecond
      acc[key].personaScore += item.personaScore
      return acc
    }, {}),
  ).map(item => ({
    ...item,
    avgLatencyMs: item.count ? Math.round(item.latencyMs / item.count) : 0,
    avgCharsPerSecond: item.count ? Number((item.charsPerSecond / item.count).toFixed(1)) : 0,
    avgPersonaScore: item.count ? Number((item.personaScore / item.count).toFixed(2)) : 0,
  }))

  const report = {
    createdAt: new Date().toISOString(),
    note: 'Text benchmark only. Emotional voice quality still needs TTS or realtime speech audio samples.',
    summary,
    results,
  }
  await mkdir('reports', { recursive: true })
  const file = join('reports', `doubao-agent-benchmark-${Date.now()}.json`)
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`)

  console.table(summary)
  console.log(`\nSaved detailed report: ${file}`)
  for (const item of results) {
    console.log(`\n[${item.provider}] ${item.agentName} · ${item.latencyMs ?? '-'}ms · score ${item.personaScore ?? '-'}\n${item.text || item.error}`)
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
