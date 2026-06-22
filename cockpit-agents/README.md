# AI Center — Multi-Agent Cockpit Prototype

一个 2048×1152 车机概念的可交互 React 原型，包含四个具有独立人格与兴趣的 Agent、语音入口、每日热点雷达、Agent 圆桌，以及用于持续迭代的 harness 控制面板。

## Run

```bash
pnpm dev
```

打开 Vite 输出的本地地址。点击角色切换单聊对象；点击麦克风可调用浏览器语音识别，不支持时可使用示例指令；“开启今日圆桌”会运行一段确定性的多 Agent 对话。

合并到 GitHub `main` 后，仓库内的 Pages workflow 会自动构建并发布公网版本。首次使用时需在仓库 Settings → Pages 中选择 GitHub Actions 作为发布源。

## Prototype boundary

- 热点与回复当前为确定性的 mock，便于评审体验节奏。
- 真正联网时建议由四个独立 Scout 读取白名单公开源，再经过事实去重、兴趣匹配、驾驶状态和隐私门控。
- Harness 策略和验收场景在 `src/harness.ts`，可直接演进为服务端配置与回归测试。

## Iteration loop

1. 选择一个真实场景。
2. 保存本轮 trace（用户输入、检索候选、Agent 发言、最终动作）。
3. 按人格一致性、有效新鲜度、对话化学反应、打扰成本、安全、可追溯性评分。
4. 每轮只调整一类变量：人格 prompt、检索源、圆桌调度或呈现节奏。
5. 对固定验收场景回归后再进入下一轮。
