# AI Provider 预设维护指南（国内大模型）

> **定位**：本文档是 `presets.py` 预设清单的配套维护手册——收录各厂商的 base_url、模型 ID、鉴权要点与更新 SOP，
> 供后续**持续更新支持国内大模型**时照单执行。
> 放置于源码同目录（而非 `docs/`，该目录不入库），随 git 跟踪、随代码评审同步维护。

## 1. 单一事实源与消费链路

| 环节 | 位置 | 说明 |
|------|------|------|
| **预设定义（唯一事实源）** | `backend/app/shared/services/llm/config/presets.py` | `PROVIDER_PRESETS` 字典，**只改这里** |
| API 端点 | `backend/app/api/routers/ai/providers.py` → `GET /api/latest/ai/providers/presets` | 返回 `get_preset_list()`，无独立配置 |
| 前端设置页 | `frontend/src/components/settings/AIAssistantSettingsPanel.vue` | "添加 AI 模型"表单的**服务商预设下拉**与模型下拉均由此驱动，前端**零硬编码** |
| 后端 CLI | `backend/app/cli/shell/commands/provider.py` | `provider add` 交互菜单自动读取 |
| TUI | `tui-rust/src/api/types.rs`（`ProviderPreset`） | 经同一 API 拉取，字段增删向后兼容 |

因此：**新增/更新国内大模型支持 = 只改 `presets.py` 数据 + 同步本文档**，前端/CLI/TUI 无需任何代码改动。

## 2. 当前预置清单（核对日期：2026-09-07）

排序约定即字典顺序（= UI 下拉展示顺序）：国内主流在前、本地服务（Ollama）在末尾。
范围约定：当前收录 DeepSeek、通义千问、智谱 GLM、Kimi、MiniMax、Xiaomi MiMo 六家国内厂商 + 本地 Ollama；
豆包/文心/混元/星火/阶跃/硅基流动等其余厂商经产品决策**暂不收录**（2026-09-07 用户拍板），如需恢复按 §5 SOP 调研后加入。

| 预设 ID | 显示名 | base_url（OpenAI 兼容） | 默认模型 | 预置模型列表 |
|---------|--------|--------------------------|----------|--------------|
| `deepseek` | DeepSeek | `https://api.deepseek.com` | `deepseek-v4-pro` | `deepseek-v4-pro`（滚动更新，现行为 0813 版）、`deepseek-v4-flash` |
| `qwen` | 通义千问 Qwen | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen3.8-max` | `qwen3.8-max`（旗舰）、`qwen3.7-plus`、`qwen3.8-flash`（1M 上下文） |
| `glm` | 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-5.3` | `glm-5.3`（当前主力）、`glm-5.3-flash`、`glm-5.2`（1M 上下文长任务旗舰） |
| `kimi` | 月之暗面 Kimi | `https://api.moonshot.cn/v1` | `kimi-k3` | `kimi-k3`（2026-08-12 发布，2.8T/1M 上下文）、`kimi-k2.7-code`（编程）、`kimi-k2.6`（256K 多模态通用）、`kimi-latest`（滚动别名） |
| `minimax` | MiniMax | `https://api.minimaxi.com/v1` | `MiniMax-M3` | `MiniMax-M3`（Frontier Coding/多模态 1M 上下文）、`MiniMax-M2.5`（Agent 生产级）、`MiniMax-M2.7-highspeed`（高速版） |
| `mimo` | Xiaomi MiMo | `https://api.xiaomimimo.com/v1` | `mimo-v2.5` | `mimo-v2.5`（全模态感知）、`mimo-v2.5-pro`（旗舰推理） |
| `ollama` | Ollama Local | `http://localhost:11434` | `llama3.2` | 空（运行时向本地服务探测） |

### API Key 获取入口

DeepSeek <https://platform.deepseek.com> ｜ 百炼 <https://bailian.console.aliyun.com> ｜ 智谱 <https://bigmodel.cn> ｜ Kimi 开放平台 <https://platform.kimi.com> ｜ MiniMax <https://platform.minimaxi.com> ｜ 小米 MiMo <https://mimo.mi.com>

## 3. 各厂商接入要点与陷阱（核对/排障先看这里）

1. **base_url 拼接规则（全局）**：后端用 openai SDK（`AsyncOpenAI(base_url=...)`），SDK 会在 base_url 后拼接
   `/chat/completions`。含版本路径的厂商**必须带全**（`/v1`、`/compatible-mode/v1`、`/api/paas/v4`），
   且**不得以 `/` 结尾**（有单测守卫 `test_openai_presets_base_url_is_https_without_trailing_slash`）。
2. **DeepSeek**：裸域与 `/v1` 均可用，预设取裸域（存量测试断言了这一形态，勿顺手改掉）。
   `deepseek-v4-pro` 是滚动模型名（内部版本如 0813，官方保证模型名不变），无需拼接日期后缀。
3. **通义千问（百炼）**：兼容模式路径是 `/compatible-mode/v1`，不是 DashScope 原生 `/api/v1`。
   国际站为 `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`，密钥与国内不通用（预设取国内站，下同）。
4. **智谱 GLM**：按量付费端点为 `/api/paas/v4`；GLM Coding Plan（编程套餐）走 `/api/coding/paas/v4`——两者按账户订阅类型选择，
   填错会 404/余额不符。**旧模型名自动路由**：调 `glm-5.2`/`glm-5.1` 会自动切到 `glm-5.3`、`glm-5-turbo`/`glm-4.7` 切到
   `glm-5.3-flash`——预设仍应跟随官方主力写最新名，不要依赖路由兜底。不要凭直觉补 `/v1`。
5. **Kimi（Moonshot）**：K3 于 2026-08-12 发布（2.8T 参数、1M 上下文、开源），是当前旗舰；文档平台已迁至
   <https://platform.kimi.com>（原 platform.moonshot.ai），OpenAI 兼容端点 `api.moonshot.cn/v1` 不变。
   `kimi-latest` 是滚动别名（始终指向最新），作保底候选。国际站为 `https://api.moonshot.ai/v1`。
6. **MiniMax**：国内站域名是 `api.minimaxi.com`（**双 i**），国际站是 `api.minimax.io`，两边密钥不通用、混用必 404。
   对话模型按 M3（最新）→ M2.5 → M2.7-highspeed 选用；**`MiniMax-H3` 是视频生成模型，勿选入对话预设**；
   `MiniMax-M2.1` 已于 2026-07-09 下架，旧条目里残留的 M2/M2.1 应清理。
7. **Xiaomi MiMo**：开发者平台 <https://mimo.mi.com>（产品页 mimo.xiaomi.com）；系列模型 MIT 开源。
   另支持 OpenAI Responses API 兼容接口（2026-06-23 起，适配 Codex 类工具），本项目走 Chat Completions 兼容端点即可。
8. **上下文窗口**：预设不携带 `context_window`，运行时按"显式配置 → 子类探测（仅 Ollama）→ 全局回退 200k"解析
   （`providers/base.py` 的 `DEFAULT_FALLBACK_CONTEXT_WINDOW`）。若厂商模型上下文显著小于 200k，用户可在设置页编辑表单手动指定。

## 4. 字段规范

| 字段 | 规范 |
|------|------|
| `id` | 小写短横线（`deepseek`/`minimax`），**一经发布不得改名**——CLI 与文档会引用；Ollama 例外沿用历史值 `ollama`（其 `id` 字段为 `ollama-local`） |
| `name` | 显示名，写入用户配置作为默认 Provider 名；中文品牌优先（如 `通义千问 Qwen`），与存量条目风格保持一致 |
| `type` | 仅 `openai`（一切 OpenAI 兼容云端服务）或 `ollama`（本地原生 API）。国内厂商一律 `openai` |
| `base_url` | OpenAI 兼容端点，https、无尾斜杠、版本路径带全（见 §3.1） |
| `default_model` | 当前推荐的旗舰/主力模型，**必须**包含在 `models` 中（有单测守卫） |
| `models` | 3~4 个为宜：旗舰 + 高性价比/专用 + 稳定别名（如有）。这是前端添加表单模型下拉的**唯一候选**，宁短勿错 |

## 5. 新增 / 更新 Provider 的 SOP

1. **调研**（以官方文档为准，勿采信第三方转述的路径/模型名；**务必搜索确认型号是否最新**——GLM-5.1→5.3、
   MiniMax M2→M3 这类迭代很快，旧型号即便仍可用也已非推荐旗舰）：
   - 确认 OpenAI 兼容 base_url（注意版本路径与国际/国内站差异）；
   - 确认当前旗舰与常用模型 ID、鉴权方式（是否 `APIKey:APISecret` 之类特殊格式）；
   - 确认候选模型是否为**对话**模型（如 MiniMax H3 系视频生成，混入会误导用户）。
2. **改 `presets.py`**：按 §2 的排序约定插入条目（新厂商按国内常见度决定位置；本地服务恒在末尾）。
3. **同步本文档**：更新 §2 表格与文首核对日期；新厂商在 §3 补接入要点；API Key 入口补进 §2 链接行。
4. **更新测试**（如适用）：新厂商加入后，把预设 ID 补进
   `backend/tests/unit/test_provider_crud.py` 的 `TestPresetCatalog.test_domestic_mainstream_providers_covered`
   的 `expected` 集合；字段不变量测试（https/无尾斜杠/默认模型在列）自动覆盖。
5. **跑门禁**：
   ```bash
   cd backend
   python -m ruff check . && python -m ruff format --check .
   python -m pytest tests/unit/test_provider_crud.py -q   # 快速验证；提交前跑全量 pytest
   ```
6. **CHANGELOG 登记**：根目录 `CHANGELOG.md` 的 `### YYYY-MM` 段落顶部补双语条目（沿仓库既有格式）。
7. **GUI 实证**（建议）：`npm run dev` → 设置 → AI 模型配置 → 添加 AI 模型 → 选新预设 → 填 Key → 测试连接，
   确认下拉顺序、模型候选与连通性。

## 6. 模型时效性维护约定

厂商模型滚动升级是常态（GLM 半年三代、MiniMax M2.1 发布三个月即下架），约定三类触发时机：

| 触发 | 动作 |
|------|------|
| **季度巡检**（每 3 个月） | 逐条核对 §2 表格：调 `GET {base_url}/models` 或查官方模型列表页；失效模型移出 `models`，`default_model` 失效必须换新旗舰 |
| **用户反馈**（测试连接 404 / model not found） | 优先排查该厂商条目，按 §3 陷阱清单定位；确认后更新预设并同步本文档 |
| **官方下线/升级公告** | 随公告更新；注意存量用户已配置的 Provider 存于其 `ai_providers.yaml`，**不受预设变更影响**，重大下线在 CHANGELOG 提示 |

各厂商核对入口（官方模型列表 / API 文档）：

- DeepSeek 更新日志 <https://api-docs.deepseek.com/zh-cn/updates/>（模型列表 API <https://api-docs.deepseek.com/zh-cn/api/list-models/>）
- 百炼模型列表 <https://help.aliyun.com/zh/model-studio/models>（功能更新日志 <https://help.aliyun.com/zh/model-studio/model-release-notes>）
- 智谱模型文档 <https://docs.bigmodel.cn/cn/guide/models/text/glm-5.1>（发布记录 <https://docs.bigmodel.cn/cn/update/new-releases>）
- Kimi 开放平台 <https://platform.kimi.com/docs/guide/kimi-k3-quickstart>（K2.6 定价 <https://platform.kimi.com/docs/pricing/chat-k26>）
- MiniMax 开放平台 <https://platform.minimaxi.com/>（文档中心首页即列最新模型阵容）
- 小米 MiMo 模型列表 <https://mimo.mi.com/docs/zh-CN/quick-start/summary/model>（更新日志 <https://mimo.mi.com/docs/zh-CN/updates/feature>）

> **核对方法提醒**（沿仓库惯例）：临时脚本验证后即删，不留杂物；`GET {base_url}/models` 各兼容端点均支持。
