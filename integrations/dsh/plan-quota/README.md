# @local/plan-quota

DSH 本地插件（自研，零外部依赖安装）：**独立套餐额度看板**（侧边栏"套餐额度"图标 + 主面板，形态同 token-dashboard），展示 Kimi For Coding / GLM Coding Plan 的 5h 窗口与周窗口剩余额度、重置倒计时、订阅名（GLM），可选显示 DeepSeek 余额。

## 结构

| 文件 | 作用 |
|---|---|
| `host.js` | host 半：`ctx.credentials` 解析凭据 → 定时查询厂商接口 → `ctx.webServer` 暴露 `GET /api/plan-quota.json` |
| `client.js` | browser 半：`main` 键控面板（key `plan-quota`）+ `sidebar.panellist` 图标；面板打开时 30s 轮询 + 手动刷新按钮，中英双语跟随界面语言 |
| `cordis.patch.yml` | bundle patch：`- insert: [{id: plan-quota, name: "@local/plan-quota"}]` |
| `test-vendors.mjs` | 厂商端点冒烟测试（只打印额度摘要，不输出密钥） |

## 凭据（自动探测，无需配置）

按顺序解析 `~/.dsh/.credentials.yaml` / 环境变量，未配置的套餐不显示：

- Kimi：`KIMI_CODING_API_KEY` → `KIMI_API_KEY`
- GLM：`ZAI_CODING_CN_API_KEY` → `ZAI_CODING_API_KEY` → `ZAI_API_KEY` → `ZHIPU_API_KEY`
- DeepSeek：`DEEPSEEK_API_KEY`（默认关闭，属按量余额而非套餐）

## 配置（desktop profile cordis.patch.yml 中按 id 覆盖，均有默认值）

```yaml
- id: plan-quota
  config:
    interval: 300        # 刷新间隔（秒）
    deepseek: false      # 显示 DeepSeek 余额
    kimiBase: https://api.kimi.com
    zaiBase: https://open.bigmodel.cn
    zaiIntl: false       # true = z.ai 国际站（Bearer 认证）
```

## 数据接口

`GET /api/plan-quota.json`（同源）→ `{ updatedAt, providers: [{id, base, ok, usage, usageColor, detail: {session, weekly, resetsAt, weeklyResetsAt, plan?, balance?}, at, error?}] }`（`resetsAt`/`weeklyResetsAt` 分别为 5h 窗口与周窗口的重置时间）；`?refresh=1` 强制即时刷新。

## 已知边界

- 智谱 monitor/subscription 端点属控制台接口（未在官方开放文档发布），格式变动时该卡片显示"查询失败"并保留上次数据。
- Kimi 额度端点为 `api.kimi.com/coding/v1/usages`（Coding Plan API Key 专用）。
- 面板依赖页面同源 fetch（浏览器访问 DSH Web URL 时生效；Electron 内嵌 dsh-app:// 窗口内不保证）。
