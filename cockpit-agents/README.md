# AI Center — Multi-Agent Cockpit Prototype

一个 2048×1152 车机概念的可交互 React 原型，包含四个具有独立人格与兴趣的 Agent、语音入口、每日热点雷达、Agent 圆桌，以及用于持续迭代的 harness 控制面板。

角色舞台使用 Three.js WebGL 实时渲染。四个角色共享 Root / Spine / Head / Ear / Shoulder / Elbow / Hand 骨骼协议，但拥有不同的动作节奏、幅度、开放度与身体重心。Idle、Wake、Listen、Think、Speak、Social、Handshake 均由状态与连续语义参数实时合成。

正式角色通过 `model-registry.ts` 注册 GLB 地址，由 `rig-loader.ts` 加载并执行十二骨骼门禁校验。模型缺少任何必要骨骼时不会进入运行时，界面会继续使用程序化 fallback。运行 `pnpm test` 可回归动作优先级、语义信号和模型契约。

## Run

```bash
pnpm dev
```

打开 Vite 输出的本地地址。点击角色切换单聊对象；点击麦克风可调用浏览器语音识别，不支持时可使用示例指令；“开启今日圆桌”会运行一段确定性的多 Agent 对话。

将指针移到角色手部会显示手势提示。轻点手部，或像手/手表射线一样上下晃动超过阈值，会触发可中断的握手动作。舞台顶部的状态栏可用于逐项预览动作状态。

默认舞台现采用 Figma 高保真概念图的 2.5D 分层合成，避免程序化低模损失角色毛发、服装与配饰细节。阿拓已拆分身体、头部、手机与手部动作层作为首个视觉标准样本；“2.5D 视觉 / 骨骼实验”按钮可在高保真方案与原始实时 rig sandbox 之间切换。

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
