# 阿拓 Rig / Skin Harness v1

日期：2026-06-25

## 本轮目标

以阿拓作为 4 个 Agent 角色的骨骼与蒙皮打磨样板，先解决当前最明显的头部转动变形问题，并为后续细腻表情动画建立可验证的资产标准。

## 输入资产

- 线上原型使用：`public/models/atlas-rigged.glb`
- 本轮输出：`public/models/atlas-rigged-clean.glb`
- 原型引用：`src/webgl/model-registry.ts`

## 关键发现

当前阿拓资产不是专业角色动画生产结构，而是“单一大网格 + 自动骨骼蒙皮”的形态：

- 主体网格：`node_0`，约 50k vertices / 50k faces。
- 骨骼：32 根，包含 `Hips / Spine / Chest / UpperChest / Neck / Head / LeftEye / RightEye / Jaw / limbs`。
- 表情：没有真实 facial shape key。
- 眼睛 / 鼻子 / 嘴部：没有作为可独立控制的拆件存在，主要烘在同一个纹理/网格里。
- 隐藏 Icosphere：源资产里存在多个隐藏、无材质辅助网格，会干扰 Blender 场景判断与 bbox 排查。

最大问题是面部权重错误：

| 骨骼 | 异常 |
| --- | --- |
| `RightEye` | 成为 19,031 个顶点的主影响骨骼，覆盖头顶/耳朵/脸部大面积区域 |
| `LeftEye` | 影响 14,858 个顶点，但不是主影响骨骼 |
| `Jaw` | 影响 1,287 个顶点 |

这会导致 Three.js 驱动 `Eye/Jaw` 做 gaze / expression 时，整块头部网格被眼骨或下颌骨拉扯，表现为头部转动变形、脸部塌陷、表情僵硬。

## 本轮修复

输出文件：`public/models/atlas-rigged-clean.glb`

处理内容：

1. 删除隐藏 Icosphere 辅助对象，不把它们作为运行时角色网格。
2. 将 `LeftEye / RightEye / Jaw / *_end` 对主网格的错误权重转移到 `Head`。
3. 重新归一化所有顶点权重，保持每个顶点最多 4 个骨骼影响。
4. 保留原骨骼命名，避免破坏现有 Three.js 动画绑定。
5. 保留 `LeftEye / RightEye / Jaw` 作为语义控制通道，但当前 clean v1 中它们不再直接变形主身体网格。
6. 添加 placeholder morph target 命名：
   - `face_blink_soft_L`
   - `face_blink_soft_R`
   - `face_smile_soft`
   - `face_focus_squint`

注意：这些 morph target 是接口占位，不是最终表情动画。真实表情需要下一步拆件或重新拓扑。

## Facial v2 迭代

输出文件：`public/models/atlas-rigged-facial-v2.glb`

在 clean v1 的基础上，新增真实可变形的 morph target，用作 WebGL 语义表情 harness：

- `face_blink_soft_L`
- `face_blink_soft_R`
- `face_blink_both`
- `face_focus_squint`
- `face_smile_soft`
- `face_mouth_open_soft`
- `face_listen_curious`

这些 morph target 是基于当前单一网格的空间启发式变形：

- `y < -0.12` 判定为脸部前侧；
- `z 0.75~0.95` 判定为眼周 / 上脸；
- `z 0.62~0.75` 判定为嘴鼻 / 下脸；
- 眨眼 / 眯眼：轻微压缩眼周面片；
- 微笑：嘴角上提、脸颊轻微前推；
- 张嘴：嘴部中心下移并轻微前推；
- 好奇聆听：左右眼周和嘴角做轻微非对称变化。

这不是最终电影级 facial rig，但它让原型具备了可持续调参的表情通道。后续如果模型拆出真实眼球、眼皮、鼻子、嘴部，可以保留这些 morph 名称作为运行时 API，不破坏 WebGL 状态机。

## WebGL 驱动

`PetStage.tsx` 会自动收集 GLB 里的 facial morph target，并按状态驱动：

- `idle`：自然随机眨眼；
- `listen`：好奇表情 + 轻微眯眼；
- `think`：更明显的 focus squint；
- `speak`：嘴部开合 + 微笑；
- `dance / wave / handshake`：更高 valence 的微笑和嘴部变化。

QA 命令：

```bash
pnpm rig:qa:ata
```

该命令直接读取 GLB 二进制，检查：

- mesh 数量；
- skin 数量；
- required bones；
- morph target 数量；
- `LeftEye / RightEye / Jaw / *_end` 是否重新成为大量顶点的主影响骨骼。

## Parts v3：安全拆件策略

输出文件：`public/models/atlas-rigged-parts-v3.glb`

v3 开始做“拆件优化”，但不直接把原始头部挖洞切开。原因是源模型本身不是干净的封闭流形：Blender 检查到大量 boundary / non-manifold edges。直接硬切眼睛、鼻子、嘴巴，很容易出现破面、漏光、法线错乱、UV 断裂和动画时边界穿帮。

因此 v3 采用更安全的 overlay patch 策略：

- 保留 `Ata_Body_Skinned` 作为完整底层；
- 从面部区域复制出可独立控制的 patch；
- patch 沿原顶点法线轻微外偏 4.5~5.5mm，避免 z-fighting；
- patch 不挖洞，因此 patch 边界开口不会暴露内部空洞；
- patch 复制原 UV、材质、skin weights 与 facial morph targets；
- WebGL morph 驱动会同时作用于 body 和 patch，增强表情可见度。

v3 运行时 mesh：

| Mesh | 角色 | 顶点 | 面 | 偏移 |
| --- | --- | ---: | ---: | ---: |
| `Ata_Body_Skinned` | 完整底层身体/头部 | 50,394 | 50,000 | 0 |
| `Ata_EyePatch_L` | 左眼周覆盖片 | 3,132 | 1,044 | 0.0045m |
| `Ata_EyePatch_R` | 右眼周覆盖片 | 3,261 | 1,087 | 0.0045m |
| `Ata_MuzzlePatch` | 鼻嘴覆盖片 | 4,992 | 1,664 | 0.0055m |
| `Ata_CheekPatch` | 脸颊覆盖片 | 2,523 | 841 | 0.0050m |

v3 QA 结果：

- meshCount：5
- skinCount：1
- total vertices：64,302
- zeroWeightVertices：0
- 每个 mesh 都有 7 个 facial morph targets
- `LeftEye / RightEye / Jaw / *_end` dominant vertices：0

### 拆件防破面 / 防漏光检查

当前 QA 规则：

1. **不挖洞**：底层头部保持完整，patch 只是外层覆盖。
2. **边界允许但不暴露**：patch 的 boundary edges 是预期结果，不作为漏光失败；因为底层 body 仍在。
3. **轻微外偏**：patch 与底层保持 4.5~5.5mm 外偏，减少 z-fighting。
4. **权重完整**：所有 patch 顶点必须有 skin weights。
5. **表情同步**：所有 patch 必须拥有同一套 facial morph targets。
6. **禁止 Eye/Jaw 误绑**：Eye / Jaw 控制骨不能成为任何 patch 或 body 顶点的主影响骨骼。
7. **材质一致**：patch 复用 body 材质与 UV，避免色差边。

### 下一步更专业的拆件

v3 仍然是“安全实验拆件”，不是最终生产级拆件。真正的高质量版本应改为：

- 眼球独立 mesh，刚性绑定 `Eye_L / Eye_R`；
- 上下眼皮独立 mesh 或 eyelid shape keys；
- 鼻子、牙齿、帽子等硬件独立刚性绑定；
- 嘴部 / muzzle 做局部拓扑，不再用纹理贴片假变形；
- patch 边缘隐藏在毛发/脸颊自然褶皱里，或做厚度/裙边封口。

## 验证结果

清理前：

- `RightEye` dominant vertices：19,031
- `LeftEye` weighted vertices：14,858
- `Jaw` weighted vertices：1,287

清理后：

- `RightEye / LeftEye / Jaw / *_end` dominant vertices：0
- `Head` dominant vertices：26,521
- 主网格顶点：50,394
- Skin：1
- GLB JSON mesh：1

## 对当前原型的意义

clean v1 主要解决“头部转动时被眼骨/嘴骨拖坏”的结构性问题。它不会立刻让眼睛、鼻子、嘴巴拥有细腻表情，因为原始模型没有可独立控制的脸部拆件。

后续 WebGL 动作应遵循：

- `Head / Neck / UpperChest` 可以继续驱动头部、视线方向和姿态。
- `LeftEye / RightEye / Jaw` 暂时只作为语义通道，不应期待明显视觉表情。
- 如果要做眨眼、眯眼、微笑、鼻子挤压，需要制作真实 facial rig。

## 下一轮专业资产标准

为了达到更真实的角色动画，阿拓下一版模型建议按以下结构重做或拆分：

### Mesh 拆件

- `Ata_Body`
- `Ata_Head_Fur`
- `Ata_LeftEye`
- `Ata_RightEye`
- `Ata_LeftEyelid_Upper`
- `Ata_RightEyelid_Upper`
- `Ata_LeftEyelid_Lower`
- `Ata_RightEyelid_Lower`
- `Ata_Nose`
- `Ata_Muzzle`
- `Ata_Mouth`
- `Ata_Teeth`
- `Ata_Hat`
- `Ata_Backpack`
- `Ata_Clothes`
- `Ata_Shoes`

### Facial bones / controls

- `Head`
- `Jaw`
- `EyeAim_L`
- `EyeAim_R`
- `EyelidUpper_L`
- `EyelidUpper_R`
- `EyelidLower_L`
- `EyelidLower_R`
- `Brow_L`
- `Brow_R`
- `Muzzle`
- `Nose`

### Shape keys

最小可用表情集：

- `blink_L`
- `blink_R`
- `blink_both`
- `smile`
- `smirk_L`
- `smirk_R`
- `mouth_open`
- `mouth_oo`
- `mouth_ee`
- `squint`
- `brow_up`
- `brow_down`
- `cheek_puff`

### 蒙皮原则

- 眼球必须刚性绑定到眼球/眼控骨，不参与头皮或耳朵权重。
- 鼻子、牙齿、帽子硬件类对象优先刚性绑定，不做软蒙皮。
- 头部毛发可绑定 `Head`，耳朵可绑定独立耳骨或 `Head`，但不能混到 `Eye`。
- 颈部需要 `Head / Neck / UpperChest` 平滑过渡，避免头转时脖子断裂。
- 手臂、腿部、脚趾保持最多 4 bone influences，运行时 WebGL 更稳定。

## Harness 验收动作

阿拓每次 rig 迭代后至少检查：

1. 头左右转 35°：脸不能塌、耳朵不能被眼骨拖动。
2. 抬头/低头 20°：帽檐、脸、脖子不能穿插严重。
3. 眨眼：眼皮闭合但眼球不缩放。
4. 微笑：嘴角和脸颊动，鼻子不漂移。
5. 挥手：肩肘腕顺序正确，袖口不破。
6. 高抬腿跑：大腿、小腿、脚掌连贯，鞋底不翻折。
7. 握手：手臂跟随鼠标上下运动时，肩部不塌陷。
