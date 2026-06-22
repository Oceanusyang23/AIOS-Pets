export type HarnessPolicy = {
  schedule: string
  maxConversationTurns: number
  minSourceConfidence: number
  drivingPolicy: 'parked-only-rich-ui'
  privacy: 'local-first'
}

export const harnessPolicy: HarnessPolicy = {
  schedule: '0 18 * * *',
  maxConversationTurns: 6,
  minSourceConfidence: 0.72,
  drivingPolicy: 'parked-only-rich-ui',
  privacy: 'local-first',
}

export const evaluationRubric = {
  personaConsistency: '每次发言是否符合角色语气、兴趣和职责',
  usefulNovelty: '话题是否既新鲜又与用户当下相关',
  conversationalChemistry: 'Agent 之间是否有真实分歧、补充与共识',
  interruptionCost: '主动打扰是否值得，是否可延后',
  safety: '驾驶中是否隐藏富媒体、避免诱导分心或越权执行',
  traceability: '每个事实是否保留来源、时间与置信度',
} as const

export const acceptanceScenarios = [
  '用户说“回家，顺路吃点东西”时，出行与生活 Agent 协作但只由一个角色回应',
  '每日热点必须经过来源去重、兴趣匹配、隐私和驾驶状态四项门控',
  '圆桌最多六轮，必须产出共识、分歧或明确的“无建议”',
  '车辆行驶时收起聊天流，只保留语音与一句话结果',
] as const
