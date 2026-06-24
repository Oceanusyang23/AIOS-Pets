# GitHub 提交自动通知飞书 AIOS-Pets 群

这个项目使用 GitHub Actions 在每次 `push` 后自动向飞书 `AIOS-Pets` 群发送更新通知。

## 工作流文件

`.github/workflows/notify-feishu.yml`

触发条件：

- 任意分支或 tag 的 `push`
- 手动 `workflow_dispatch`

通知内容：

- 仓库名
- 分支 / 引用类型
- 最新 commit short SHA
- commit 标题与摘要
- 作者与推送人
- 提交链接、compare 链接、Actions 链接

## 必需配置

GitHub Actions 不能直接使用本机的 `lark-cli` 登录态，所以 workflow 使用飞书 OpenAPI：先通过 `FEISHU_APP_ID` / `FEISHU_APP_SECRET` 获取 `tenant_access_token`，再以机器人身份向 `AIOS-Pets` 群发送 `post` 消息。

在 GitHub 仓库中设置：

```text
Settings → Secrets and variables → Actions → New repository secret
```

必需 Secret：

```text
FEISHU_APP_ID
FEISHU_APP_SECRET
```

可选 Secret：

```text
FEISHU_AIOS_PETS_CHAT_ID
```

如果不配置 `FEISHU_AIOS_PETS_CHAT_ID`，workflow 默认发送到当前 `AIOS-Pets` 群：

```text
oc_5e5cd2c549b5e4325ffcb4e0cbb5fcd1
```

## 安全策略

- App Secret 不写入仓库，只从 GitHub Secret 读取。
- 如果 `FEISHU_APP_ID` / `FEISHU_APP_SECRET` 没配置，workflow 会输出提示并安全跳过，不会让 push 失败。
- 通知消息使用 Feishu `post` 格式，适合展示链接和提交摘要。

## 验证方法

配置 Secret 后，可以用两种方式验证：

1. 在 GitHub Actions 页面手动运行 `Notify AIOS-Pets Feishu`。
2. 推送任意 commit 到 GitHub，确认 `AIOS-Pets` 群收到通知。

如果没有收到通知，先检查：

- GitHub Secret 是否包含 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET`
- 飞书机器人是否仍在 `AIOS-Pets` 群内
- 飞书应用是否具备机器人发消息权限，例如 `im:message:send_as_bot`
- GitHub Actions 日志里是否有 Feishu API 返回的错误信息
