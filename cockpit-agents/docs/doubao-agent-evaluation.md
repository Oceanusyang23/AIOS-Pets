# 豆包 Agent API 测试方案

## 是否需要订阅

不一定需要包月订阅。用于当前原型评估时，通常只需要：

1. 火山方舟账号可用；
2. 创建 `ARK_API_KEY`；
3. 在开通管理里开通要测的豆包模型，或在豆包助手里创建 Bot 并拿到 `ARK_BOT_ID`；
4. 确认计费方式或可用免费额度。

如果你要做高并发、稳定 SLA 或独占资源，再考虑模型单元/包月类资源。

## 本轮先测什么

当前脚本先测文本层的“角色反馈效率”：

- 首 token/整体延迟近似：目前记录整体 `latencyMs`
- 中文短回复速度：`charsPerSecond`
- 角色一致性：是否像阿拓/诺瓦/缪思/米洛，而不是客服腔
- 年轻可爱度粗评分：是否自然、短、带角色关键词

这能判断“豆包角色 API 是否适合驱动 Agent 剧情和动作语义”。

## 语音情感化怎么测

声音情感化不能只靠 Chat API 判断。需要额外接入：

- 豆包语音合成 / TTS，用同一段角色文本生成音频；
- 或豆包端到端实时语音 API，测试全双工语音到语音体验。

建议主观 + 客观结合：

- 主观：年轻感、情绪、停顿、亲密度、是否不像中年客服；
- 客观：端到端延迟、打断恢复时间、音频首包时间、ASR 错字率、TTS 合成耗时。

## 使用方式

复制 `.env.example` 为 `.env`：

```bash
ARK_API_KEY=你的火山方舟Key
ARK_MODEL=doubao-seed-evolving
OPENAI_API_KEY=可选，用于同题对比
OPENAI_MODEL=gpt-4.1-mini
```

运行：

```bash
pnpm bench:doubao
```

报告会保存到 `reports/doubao-agent-benchmark-*.json`。

如果需要测豆包助手 Bot：

```bash
ARK_BOT_ID=bot-xxxxx
pnpm serve:doubao
```

当前服务端 adapter 会优先使用 `ARK_BOT_ID`，否则使用 `ARK_MODEL`。
