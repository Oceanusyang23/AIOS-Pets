# 阿拓 3D Production Brief v0.1

## 1. 目标

制作第一只可进入车机实时运行环境的高质量角色模型，用于验证：

- 设计稿视觉能否被实时 3D 忠实继承。
- 语音、点击、手表射线和握手动作是否自然。
- 同一套骨骼能否承载 Idle、Wake、Listen、Think、Speak、Social、Handshake。
- 目标硬件是否能稳定保持 60 FPS。

阿拓是标准样本，不是一次性 Demo。通过验收后，其拓扑密度、材质规范、骨骼命名和面部系统将复制到其他三只角色。

## 2. 视觉基准

必须保留：

- 大耳朵、圆脸、柔软长毛和偏大的眼睛。
- 黑色导航帽、青绿色机能卫衣、胸前挂件、背包。
- 手机、滑板和滑板车作为可拆卸附件。
- 友善、机灵、略有冒险感，不幼稚，不做廉价玩具塑料感。
- 面部、毛发、布料和硬质附件具有明确材质层级。

禁止：

- 直接使用 AI 自动拓扑作为最终网格。
- 将毛发烘焙成模糊的纯色表面。
- 用同一种材质覆盖毛发、服装、皮肤和金属。
- 为了减面破坏眼睛、嘴角、手指与帽檐轮廓。

## 3. 模型预算

| 项目 | LOD0 | LOD1 | LOD2 |
|---|---:|---:|---:|
| 三角面 | 80k–150k | 40k–70k | 15k–30k |
| 主贴图 | 2K | 1K–2K | 1K |
| 同屏距离 | 特写/握手 | 桌面默认 | 远景/非激活 |

- GLB 压缩后目标：10–20 MB。
- 纹理使用 KTX2/BasisU；网格使用 Meshopt 或 Draco。
- 材质建议不超过 6 组，draw calls 目标不超过 12。
- 手机、滑板、滑板车必须可独立隐藏。

## 4. 材质与毛发

- 毛发：毛发卡、shell 或短绒法线方案；不得依赖离线 groom。
- 服装：Base Color、Normal、Roughness、AO；重点刻画缝线、印花和衣料厚度。
- 眼睛：独立眼球与角膜高光层，支持视线追踪。
- 牙齿、鼻子、手机屏幕和金属扣件使用独立材质参数。
- 所有纹理遵循 glTF 2.0 PBR Metallic-Roughness。

## 5. 骨骼契约

必须存在并保持以下名称：

```text
Root
Spine
Head
Ear_L
Ear_R
Shoulder_L
Shoulder_R
Elbow_L
Elbow_R
Hand_L
Hand_R
Mouth
```

建议扩展：Neck、Chest、Wrist_L/R、Finger、Eye_L/R、Jaw、Tail、Accessory anchors。

要求：

- Root 位于角色脚底中心，Y-up，面向 +Z。
- 关节局部轴保持一致，左右骨骼镜像规则统一。
- 手部可完成伸手、握手、指向手机和扶滑板动作。
- 耳朵必须独立可动，用于表达注意力和情绪。
- 所有附件使用骨骼或 Socket，不允许写死世界坐标。

## 6. 面部系统

最低 Blendshape：

```text
Blink_L / Blink_R
Eye_Wide_L / Eye_Wide_R
Brow_Up_L / Brow_Up_R
Brow_Down_L / Brow_Down_R
Smile
Smile_L / Smile_R
Mouth_Open
Mouth_Narrow
Mouth_Wide
Cheek_Up
Frown
```

眼球必须支持实时 LookAt；眨眼不能只使用贴图切换。

## 7. 动作验收

- Idle：30 秒内无明显循环接缝，含呼吸、耳朵、视线和重心微动作。
- Wake：300–800ms 内完成注意力聚焦。
- Listen：视线朝向用户，耳朵前倾，动作克制，不持续大幅点头。
- Think：允许看向侧上方并出现非同步微动作，避免“加载中机器人”。
- Speak：手势频率由 energy 驱动，头部稳定度由 certainty 驱动。
- Social：能注视当前说话的其他 Agent，并做适量回应。
- Handshake：手臂可伸向相机，手腕姿态自然，不穿模；动作可被用户手势触发和中断。

## 8. 技术验收

- 通过原型 Harness 的 12 骨骼门禁。
- GLB 无丢失纹理、负缩放、重复骨骼名或不可见大网格。
- 默认桌面四角色同屏维持 60 FPS；最低不低于 45 FPS。
- 单角色特写 GPU frame time 目标小于 12ms。
- 切换 LOD 不出现明显跳变。
- WebGL context 丢失后可恢复，模型加载失败时回退 2.5D。

## 9. 交付物

- `atlas_master.blend`
- `atlas_lod0.glb` / `atlas_lod1.glb` / `atlas_lod2.glb`
- 贴图源文件与 KTX2 输出
- 正面、侧面、背面 Turntable
- 骨骼与 Blendshape 对照表
- 模型版本、面数、材质数、文件大小记录
- 一段包含七个核心动作状态的测试录屏

## 10. Gate

只有同时满足以下条件才扩展到其他三只角色：

1. 视觉评审认为角色气质与设计稿一致。
2. 骨骼门禁 12/12 通过。
3. 握手动作没有明显穿模。
4. 目标硬件性能达标。
5. 资产制作成本和修改轮次可预测。
