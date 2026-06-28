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
  '角色被点击或语音唤醒时，旧动作计时器必须让位于新交互，不能把聆听状态意外覆盖',
  '手或手表射线命中手部后，轻点或累计 34px 的上下晃动应触发握手并给出明确反馈',
  'Agent 互聊时，发言者进入 speak，其余角色通过头部朝向、点头与身体重心进入 social',
] as const

export const motionHarness = {
  protocol: ['idle', 'wake', 'listen', 'think', 'speak', 'social', 'handshake', 'dance', 'music', 'spin', 'march'],
  interruptPriority: ['music', 'handshake', 'dance', 'spin', 'march', 'wake', 'listen', 'think', 'speak', 'social', 'idle'],
  semanticInputs: {
    energy: '控制手势频率、说话节拍和动作幅度，范围 0–1',
    valence: '控制开放/收敛姿态与身体朝向，范围 0–1',
    certainty: '控制点头强度、目光稳定度与动作收尾，范围 0–1',
  },
  rigContract: ['root', 'spine', 'head', 'leftEar', 'rightEar', 'leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow', 'leftHand', 'rightHand', 'mouth'],
  runtimeRules: [
    '动作由连续参数和角色 motion profile 合成，不以 GIF 或固定时间轴作为最终表现',
    '新的人机交互必须可以中断低优先级待机与社交动作',
    '视线目标由当前说话者和用户射线动态决定',
    '每次动作 trace 保留状态、语义参数、角色 profile、触发源和持续时间',
  ],
} as const
