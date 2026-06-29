export type DoubaoAgentId = 'atlas' | 'nova' | 'muse' | 'milo'

export type DoubaoChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type DoubaoCharacterRequest = {
  agentId: DoubaoAgentId
  userText: string
  history?: DoubaoChatMessage[]
  scene?: string
  temperature?: number
  maxTokens?: number
}

export type DoubaoCharacterResponse = {
  agentId: DoubaoAgentId
  text: string
  model: string
  references?: Array<{ title?: string; url?: string }>
  usage?: unknown
}

export async function chatWithDoubaoCharacter(
  payload: DoubaoCharacterRequest,
  signal?: AbortSignal,
): Promise<DoubaoCharacterResponse> {
  const response = await fetch('/api/doubao/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  })

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const message = data?.message || data?.error || `Doubao request failed: ${response.status}`
    throw new Error(message)
  }
  return data as DoubaoCharacterResponse
}
