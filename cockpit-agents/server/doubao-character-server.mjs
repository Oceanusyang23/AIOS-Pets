import 'dotenv/config'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { ArkAPIError, ArkRequestError, ArkRuntimeClient } from '@volcengine/ark-runtime'

const PORT = Number(process.env.DOUBAO_SERVER_PORT || 8787)
const DIST_DIR = join(process.cwd(), 'dist')
const MODEL = process.env.ARK_MODEL || process.env.DOUBAO_MODEL || 'doubao-seed-evolving'
const BOT_ID = process.env.ARK_BOT_ID || process.env.DOUBAO_BOT_ID || ''
const API_KEY = process.env.ARK_API_KEY || process.env.DOUBAO_API_KEY || ''

const characterProfiles = {
  atlas: {
    name: '阿拓',
    role: '出行管家',
    voice: '清亮少年感，轻快、笃定、带一点冒险感',
    persona: '认真、可靠、爱规划路线。紧张时会把路线说成冒险副本，被夸会害羞。',
  },
  nova: {
    name: '诺瓦',
    role: '车辆守护者',
    voice: '年轻中性声，短句、干净、略带电子感，不低沉',
    persona: '外冷内热，理性克制，重视安全和车况。嘴上酷，行动上很照顾朋友。',
  },
  muse: {
    name: '缪思',
    role: '音乐策展人',
    voice: '少女感，轻甜但不嗲，语调有音乐性和跳跃感',
    persona: '情绪敏感、脑洞大，喜欢把路噪、雨声和心情混成歌单。',
  },
  milo: {
    name: '米洛',
    role: '生活探索家',
    voice: '少年小奶音，暖、圆、带一点撒娇式兴奋',
    persona: '乐天派、吃货、慢半拍，总能把紧张气氛变成先吃一口。',
  },
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
}

function jsonResponse(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', chunk => {
      raw += chunk
      if (raw.length > 96_000) {
        reject(new Error('Request body too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      if (!raw.trim()) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

function buildMessages({ agentId = 'atlas', userText = '', history = [], scene = 'car desktop prototype' }) {
  const profile = characterProfiles[agentId] || characterProfiles.atlas
  const safeHistory = Array.isArray(history) ? history.slice(-10) : []
  return [
    {
      role: 'system',
      content: [
        `你是 AIOS-Pets 车机桌面里的角色 ${profile.name}，身份是${profile.role}。`,
        `性格：${profile.persona}`,
        `声音/语气：${profile.voice}`,
        '你和阿拓、诺瓦、缪思、米洛像朋友一样相处：会拌嘴、会支持、会主动接梗，但不要模仿任何具体剧集台词。',
        '回复要短、自然、年轻可爱，优先 1-3 句；如果涉及驾驶安全，先给安全提醒。',
        '如果用户要求动作，返回中可自然描述动作意图，但不要输出代码。',
        `当前场景：${scene}`,
      ].join('\n'),
    },
    ...safeHistory.map(item => ({
      role: item.role === 'assistant' ? 'assistant' : 'user',
      content: String(item.content || '').slice(0, 1200),
    })),
    { role: 'user', content: String(userText).slice(0, 2400) },
  ]
}

async function handleDoubaoChat(req, res) {
  if (!API_KEY) {
    return jsonResponse(res, 500, {
      error: 'missing_api_key',
      message: '请在 .env 中配置 ARK_API_KEY（或 DOUBAO_API_KEY）。',
    })
  }

  try {
    const body = await readJsonBody(req)
    const client = ArkRuntimeClient.withApiKey(API_KEY)
    const messages = buildMessages(body)
    const request = {
      model: BOT_ID || MODEL,
      messages,
      temperature: typeof body.temperature === 'number' ? body.temperature : 0.82,
      max_tokens: typeof body.maxTokens === 'number' ? body.maxTokens : 420,
    }
    const response = BOT_ID
      ? await client.createBotChatCompletion({ ...request, bot_id: BOT_ID })
      : await client.createChatCompletion(request)
    const text = response.choices?.[0]?.message?.content || ''

    return jsonResponse(res, 200, {
      agentId: body.agentId || 'atlas',
      text,
      model: BOT_ID || MODEL,
      references: response.references || [],
      usage: response.usage || response.bot_usage || null,
    })
  } catch (error) {
    if (error instanceof ArkAPIError) {
      return jsonResponse(res, error.httpStatusCode || 502, {
        error: 'ark_api_error',
        message: error.message,
        requestId: error.requestId,
      })
    }
    if (error instanceof ArkRequestError) {
      return jsonResponse(res, 502, { error: 'ark_request_error', message: error.message })
    }
    return jsonResponse(res, 400, {
      error: 'doubao_request_failed',
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const pathname = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '')
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^[/\\]/, '')
  const filePath = join(DIST_DIR, requested)
  const safePath = filePath.startsWith(DIST_DIR) ? filePath : join(DIST_DIR, 'index.html')
  try {
    const data = await readFile(safePath)
    res.writeHead(200, {
      'content-type': mimeTypes[extname(safePath)] || 'application/octet-stream',
      'cache-control': safePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
    })
    res.end(data)
  } catch {
    const index = await readFile(join(DIST_DIR, 'index.html'))
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' })
    res.end(index)
  }
}

createServer(async (req, res) => {
  if (req.url?.startsWith('/api/doubao/chat')) {
    if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'method_not_allowed' })
    return handleDoubaoChat(req, res)
  }
  return serveStatic(req, res)
}).listen(PORT, () => {
  console.log(`AIOS-Pets server listening on http://127.0.0.1:${PORT}`)
  console.log(`Doubao mode: ${BOT_ID ? `bot ${BOT_ID}` : `model ${MODEL}`}`)
})
