# 变更日志 / Changelog

> ⚠️ 本项目处于 Alpha 阶段，核心功能已成型但仍可能有不兼容变更。以下记录仅供参考。
>
> This project is in Alpha stage. Core features are implemented but breaking changes may still occur. The following records are for reference only.

## [Unreleased]

### 2026-09
- 依赖安全修复三批补录（均仅 `frontend/package-lock.json`、semver 兼容升级，官方 registry audit 复验 0 漏洞）：① browserslist ≤4.28.6（高危：无界内存增长）与 postcss-selector-parser 6.1.0-6.1.2（DoS）新披露漏洞，`npm audit fix` 升级（lockfile 27 处版本引用）；② `@humanfs/node` <0.16.8（GHSA-p498-v437-472g，moderate：humanfs 递归拷贝跟随符号链接可拷出源树外数据）升级至 0.16.8，连带 `@humanfs/core` 0.19.1→0.19.2 与新增拆分包 `@humanfs/types` 0.15.0；③ fflate ≤0.8.2（GHSA-px8p-9vwx-vf98，moderate：unzipSync 解析畸形 ZIP64 可无限循环）经 jspdf 依赖链升级至 0.8.3。三批 vitest/type-check/lint 复验绿。

  Backfill of three dependency security fixes (frontend/package-lock.json only, semver-compatible; re-verified with zero vulnerabilities against the official registry audit): (1) browserslist ≤4.28.6 (high: unbounded memory growth) and postcss-selector-parser 6.1.0-6.1.2 (DoS) upgraded via npm audit fix (27 lockfile version references); (2) @humanfs/node <0.16.8 (GHSA-p498-v437-472g, moderate: recursive copy follows symlinks and can copy data out of the source tree) bumped to 0.16.8, pulling @humanfs/core 0.19.1→0.19.2 and the new split package @humanfs/types 0.15.0; (3) fflate ≤0.8.2 (GHSA-px8p-9vwx-vf98, moderate: unzipSync can loop forever parsing malformed ZIP64) bumped to 0.8.3 through the jspdf dependency chain. vitest/type-check/lint re-verified green for all three.

- 全量校验 422 字段错配修复：前端 FileProcessingSettings 超前声明 null_value_strategy/date_format 两字段，后端全量校验请求模型（extra="forbid"）在设置加载回退默认值路径下必现 422 "Extra inputs are not permitted"（真实 uvicorn 复现实证）——修复为前端删除超前字段（types/settings.ts、types/projectV2.ts、projectValidationApi.ts 类型与默认值、ProjectSettingsPanel 本地 ref、三个 manifest 构建器共 8 处构造点），后端零改动；新增 tests/types/settings.test.ts 三组键集合契约守卫（validation/file_processing/script_security 默认值键集合=后端白名单，防止再次超前声明）；zh/en settings.ts 清理 file.nullStrategy/file.dateFormat 死 key 并同步 file.description 描述。门禁：type-check 0 错、vitest 全绿（+3 守卫）、lint 全链绿（i18n 基线收紧）。

- Fixed a full-validation 422 field mismatch: the frontend FileProcessingSettings pre-declared null_value_strategy and date_format, which the backend validation request model (extra="forbid") rejects with "Extra inputs are not permitted" whenever settings loading falls back to frontend defaults (reproduced against a live uvicorn server). Fix removes the premature fields on the frontend (types/settings.ts, types/projectV2.ts, projectValidationApi.ts, the ProjectSettingsPanel local ref, and three manifest builders — 8 construction sites total), with zero backend changes; new tests/types/settings.test.ts guards the key sets of all three settings groups against the backend whitelist to prevent future premature declarations; dead i18n keys file.nullStrategy/file.dateFormat removed from zh/en settings.ts and file.description updated. Gates: type-check clean, vitest green (+3 guard tests), full lint chain green (i18n baseline tightened).

- 全量校验正则双引擎方言矛盾深修：产品正则方言是 Python re（后端执行、可视化构建器按 (?P<name>) 生成），保存前置校验却用 JS RegExp 原样编译——自家构建器生成的合法正则保存被拦（JS 误杀 (?P<name>），JS 写法 (?<name>) 放行到运行时才报错，命名分组两写法双引擎互不兼容。修复：保存编排器新增 validateRegexSyntaxWithBackend（全量/增量两路径、写盘前按 pattern 去重并发调既有 /utils/test-regex 权威编译，失败 fail-closed BLOCKER 携带后端具体原因，网络异常 fail-open 跳过）；本地预检收窄为仅拦两引擎语法一致的普通 pattern（含 (? 构造一律交后端）；正则设计面板编辑期防抖即时后端校验+红框提示；参数命名弹窗加 Python 标识符守卫（杜绝 (?P<1> 纯数字组名源头）；FullValidationModal 补 AppIcon import；保存前置校验 24 条提示文案 zh/en 重写为"问题+影响+怎么办"。门禁：type-check 0 错、vitest 1882、lint 全链绿；真后端实证 (?P<email> 放行、(?P<1> 拦截带原因、(?<email> 保存期拦截双向闭环。

- Deep fix for the regex dual-engine dialect conflict in full validation: the product regex dialect is Python re (the execution engine; the visual builder also emits (?P<name>) groups), yet the pre-save validation compiled patterns with the JS RegExp engine as-is — valid regexes produced by our own builder were blocked on save (JS rejects (?P<name>), while JS-style (?<name>) passed validation only to blow up at execution time; named-group syntax is incompatible across the two engines either way. Fix: the save orchestrator now runs validateRegexSyntaxWithBackend on both full and incremental paths (patterns are deduplicated and compiled authoritatively via the existing /utils/test-regex endpoint before writing to disk; a failed compile is a fail-closed BLOCKER carrying the backend's specific reason, while transport errors fail open since saving requires the backend anyway); the local pre-check narrows to plain patterns whose syntax matches across both engines (any (? construct is deferred to the backend); the regex design panel now validates input against the backend with a 600ms debounce and an inline error hint; the parameter-naming modal enforces Python identifier rules (killing (?P<1>-style numeric group names at the source); FullValidationModal gained its missing AppIcon import; and all 24 pre-save validation messages were rewritten in zh/en as "problem + impact + what to do". Gates: type-check clean, vitest 1882, full lint chain green; verified against a live backend — (?P<email> now passes, (?P<1> is blocked with the reason, and (?<email> is caught at save time.

- 全库用户可见提示文案治理（两轮审计 A1-A11+P3+导师复核）：manifest 前端错误三重拼装收敛（HTTP 头名/(cause:)/axios 英文不再进用户消息，技术上下文入日志，getV2Manifest 保留 AxiosError 形状供 isProjectNotFound 判 404）；AI 路由 providers/chat/stream/jobs/migrate 英文 detail 全量中文化并新增 describe_ai_failure 按异常类名译网络/超时/鉴权/限流失败；AI 聊天动作预校验回复去 [OK]/[!] 机器标记、动作枚举按动词+类别派生中文名、Pydantic 英文消息映射中文（新单一事实源 shared/core/pydantic_messages.py）；新增 422 全局 RequestValidationError handler（结构保持 FastAPI 默认仅 msg 本地化）与 500 兜底中文；全量校验 warnings/加载错误/约束跳过提示改含文件名人话（message 为空回退 description/title，修复"只剩一句建议"孤行）；校验结果类型码经 i18n errorTypes 映射显示（DataLoad→数据加载等 9 码，未登记回退原文）；Regex/Transform 执行失败用节点名替代 UUID；新增 getApiErrorMessage 统一错误提取接入 AI 设置面板，sseClient 附带状态码修正 AI 聊天错误映射；其余 regex/constraint 路由实现词 detail、I/O 裸异常（io_error_messages）、JSON 预览、AI 生成 400、allow_unsafe_eval/target_value/遇错即停配置项名、自检 fixHint 空洞占位、builders/CLI 同族清理。门禁：后端 pytest 3437+ruff+mypy 绿（13 处旧文案断言同步更新）、前端 type-check/vitest 1882/lint 全链绿；TestClient 实测 422/404 新文案生效；teacher-glm 导师复核通过。

- Repo-wide user-facing copy governance (two audit rounds A1-A11+P3 plus a mentor re-review): the manifest frontend error composition no longer concatenates the HTTP header name, "(cause: ...)", or axios's default English into user messages (technical context goes to logs; getV2Manifest keeps its AxiosError shape for the isProjectNotFound 404 branch); all English details across the AI routers (providers/chat/stream/jobs/migrate) were localized, with a new describe_ai_failure that maps connection/timeout/auth/rate-limit failures by exception class; the AI chat pre-validation reply dropped its [OK]/[!] machine markers, derives Chinese action names from verb+category, and localizes common Pydantic messages via a new single-source module (shared/core/pydantic_messages.py); a global 422 RequestValidationError handler now localizes msg while keeping FastAPI's default response structure, and the 500 fallback is localized; full-validation warnings, loading errors, and constraint-skip notices now include file names and read as plain sentences (empty messages fall back to description/title, fixing suggestion-only orphan lines); validation result type codes render through an i18n errorTypes map (DataLoad→数据加载 and 8 more, unknown codes fall back to raw); Regex/Transform execution failures show node names instead of UUIDs; a new getApiErrorMessage helper unifies error extraction into the AI settings panel, and sseClient attaches status codes so the AI chat error mapping keeps working; plus regex/constraint router jargon details, raw I/O exceptions (io_error_messages), JSON preview, AI generation 400s, allow_unsafe_eval/target_value/stop-on-error config names, the hollow inspection fixHint placeholders, builders mixed-language strings, and CLI cleanups. Gates: backend pytest 3437 + ruff + mypy green (13 stale copy assertions updated to the new texts), frontend type-check clean / vitest 1882 / full lint chain green; TestClient verified the new 422/404 texts live; teacher-glm mentor re-review passed with all findings addressed.

- AI 模型配置支持国内主流大模型（2026-09 标准核对）：`backend/app/shared/services/llm/config/presets.py` 预设清单从 3 条扩至 7 条，新增通义千问 Qwen（百炼 compatible-mode）、智谱 GLM（/api/paas/v4）、月之暗面 Kimi、MiniMax（国内双 i 域名）四家，加上既有 DeepSeek/Xiaomi MiMo/Ollama 覆盖国内主流；模型 ID 均按 2026-09 官方文档核对取最新一代（GLM-5.3/GLM-5.3-flash/GLM-5.2——5.1 已列为历史模型、Kimi K3（2026-08-12 发布，2.8T/1M 上下文）+ k2.7-code/k2.6、MiniMax-M3/M2.5/M2.7-highspeed、qwen3.8-max/3.7-plus/3.8-flash、DeepSeek-V4-Pro/Flash）；豆包/文心 ERNIE/腾讯混元/讯飞星火/阶跃星辰/硅基流动六家经产品决策暂不收录（取舍与恢复方式记录于文档）。各家 base_url 均为官方 OpenAI 兼容端点、鉴权陷阱与逐厂商核对入口存档于新增维护文档 `backend/app/shared/services/llm/config/AI_PROVIDER_PRESETS.md`——含单一事实源说明、字段规范、新增/更新 SOP（含"更新前必须搜索核对型号是否最新"步骤）与季度巡检等时效维护约定，改预设必须同步该文档。前端设置页"添加 AI 模型"预设下拉、CLI `provider add` 菜单、TUI 均经 `GET /providers/presets` 消费，零代码改动自动生效；排序约定为国内主流在前、本地 Ollama 在末尾。新增 `TestPresetCatalog` 单测守卫：国内主流厂商覆盖集合、预设 ID 唯一、openai 型 base_url https 且无尾斜杠（openai SDK 拼接语义）、默认模型必须在 models 候选内。门禁：backend ruff check/format 绿、pytest 全量绿。
- AI model configuration now covers mainstream domestic Chinese LLM providers (verified against 2026-09 standards): the preset list in `backend/app/shared/services/llm/config/presets.py` grows from 3 to 7 entries, adding Alibaba Qwen (Bailian compatible-mode), Zhipu GLM (/api/paas/v4), Moonshot Kimi, and MiniMax (domestic double-i domain) on top of the existing DeepSeek/Xiaomi MiMo/Ollama; model IDs were verified against official 2026-09 docs and pinned to the current generations (GLM-5.3 / 5.3-flash / 5.2 — 5.1 is already classified historical; Kimi K3 released 2026-08-12, 2.8T params / 1M context, plus k2.7-code / k2.6; MiniMax-M3 / M2.5 / M2.7-highspeed; qwen3.8-max / 3.7-plus / 3.8-flash; DeepSeek-V4-Pro / Flash). Doubao, Baidu ERNIE, Tencent Hunyuan, iFlytek Spark, StepFun, and SiliconFlow are intentionally not included per a product call (the rationale and how to revisit are recorded in the doc). Each base_url is an official OpenAI-compatible endpoint; per-vendor auth pitfalls and verification entry points are archived in the new maintenance doc `backend/app/shared/services/llm/config/AI_PROVIDER_PRESETS.md`, which documents the single source of truth, field conventions, the add/update SOP (including a mandatory "search for the latest model IDs first" step), and staleness-maintenance rules such as quarterly reviews; preset changes must keep that doc in sync. The frontend settings page's preset dropdown, the CLI `provider add` menu, and the TUI all consume `GET /providers/presets`, so they pick these up with zero code changes; ordering puts domestic mainstream first and local Ollama last. New `TestPresetCatalog` unit tests guard: the domestic-mainstream coverage set, preset ID uniqueness, https-without-trailing-slash base_urls for openai-type presets (openai SDK join semantics), and default models being present in the `models` candidates. Gates: backend ruff check/format green, full pytest green.

- 全仓源码 Apache-2.0 license 头补齐（2026-09-06 前端规范审计 F2 拍板执行）：1768 个源码文件一次性补齐 `SPDX-License-Identifier: Apache-2.0` + `Copyright 2026 Precis Team` + Apache-2.0 提示行——范围 frontend（src/tests/scripts/根级 ts/index.html）、backend（.py）、electron/src（.ts）、tui-rust/src（.rs）、e2e（.ts），按扩展名五形态插入（ts/css 块注释、py `#`、rs `//`、vue/html `<!-- -->`；shebang/DOCTYPE 文件插其行后；CRLF 文件跟随行尾、入库经 gitattributes 统一 LF）。生成物 `actions.ts` 不手插而经 `codegen.mjs` 模板同步（重跑 codegen 实证一致，顺带 `@file`→`@fileoverview` 统一）；frontend `audit:headers` 检查窗口 20→40 行（license 块 17 行使既有 @fileoverview 下移，防压线误报）；新增根级守卫 `scripts/check-license-headers.mjs` 接入 `ci.yml` encoding-check job——此后新增源码文件缺 license 头直接 CI 失败。门禁全绿：frontend lint:check/type-check/vitest 1874、backend ruff check/format + pytest 3431、electron tsc、cargo check、license 守卫 1768/1768。
- Repo-wide Apache-2.0 license headers (F2 decision item from the 2026-09-06 frontend style audit, executed): 1768 source files gained a one-shot `SPDX-License-Identifier: Apache-2.0` + `Copyright 2026 Precis Team` + Apache-2.0 notice header — covering frontend (src/tests/scripts/root-level ts/index.html), backend (.py), electron/src (.ts), tui-rust/src (.rs), and e2e (.ts), inserted in five per-extension forms (block comments for ts/css, `#` for py, `//` for rs, `<!-- -->` for vue/html; after the shebang/DOCTYPE line where present; CRLF files keep their line endings, normalized to LF on commit via gitattributes). The generated `actions.ts` was not hand-patched but synced through the `codegen.mjs` template (regenerated and verified consistent, with `@file` unified to `@fileoverview`); the frontend `audit:headers` window widened from 20 to 40 lines (the 17-line license block pushes existing @fileoverview headers down, avoiding false positives); a new root guard `scripts/check-license-headers.mjs` is wired into the `ci.yml` encoding-check job — new source files without a license header now fail CI outright. Gates all green: frontend lint:check/type-check/vitest 1874, backend ruff check/format + pytest 3431, electron tsc, cargo check, license guard 1768/1768.

- 画布拖拽链路两项收尾优化（承接流畅度批次 S3 与 dragGroup 遗留项）：① **节点位移撤销判定增量化**——原 dragstop 判定"位置是否变化"需第二次全图 structuredClone + 两次全图 JSON.stringify（128 节点实测几十 ms 落手卡顿）；改为 dragstart 经 node-drag-start payload 记录被拖节点起始位置、dragstop 仅比对这批节点的终止位置（新增纯函数 `hasNodePositionMoved` + 5 单测；payload 缺失时兜底回退全图比较）。判定语义按导师审核意见收窄并订正表述：位置拖拽手势能触及的共享状态只有被拖节点 position 与 selected/dragging 标志（zIndex 提升是 CSS 级、从不落快照），旧全图比较反而会因 selected/dragging 标志变化对零位移点选拖拽误入噪声撤销栈——新判定消除之，入栈本体仍为全量快照、撤销恢复链路未动，undo 保真度与旧实现一致。② **dragGroup 增量落位**——分组拖动释放时原以全量数组替换触发 setNodes → createGraphNodes 整图重建级联，改逐节点 `updateNodeData(id, { position })`（与 applyPositions 同机制；调用方为 HTML5 dragend 单次触发、读 store 位置加总位移无逐帧时序风险）。门禁：type-check 0 错、vitest 148 文件 1874 用例全绿、E2E 6 spec 56 用例全绿。导师审核同时发现一项**存量功能性缺陷（另行归档）**：`useNodeOrganizer()` 为多实例 composable，整理入口（CanvasControls 实例）与 zone-group overlay/dragGroup 载体（NodeCanvas 实例）状态互不相通，zone-group 分组叠层自原型起生产不可达（dragGroup 当前为不可达路径），修复需产品决策（状态上提单例或确认废弃删除）。

- Canvas drag-path optimizations (S3 + dragGroup leftovers from the fluency batch): ① **incremental node-move undo gating** — the dragstop "did position change" check previously required a second full-graph structuredClone plus two full-graph JSON.stringify passes (~tens of ms of drop-jank at 128 nodes); dragstart now records the dragged nodes' starting positions from the node-drag-start payload and dragstop compares only those nodes' final positions (new pure function `hasNodePositionMoved` + 5 unit tests; falls back to the full-graph compare if the payload is missing). Per mentor review, the gate semantics were narrowed and the wording corrected: a position drag can only touch the dragged nodes' position plus selected/dragging flags (zIndex lift is CSS-level and never lands in snapshots) — the old full-graph compare would actually push noise undo steps for zero-movement click-drags due to those flags, so the new gate fixes that direction; the pushed snapshot remains the full pre-drag state and the restore path is untouched, so undo fidelity is unchanged. ② **dragGroup incremental positioning** — releasing a group drag used to replace the whole nodes array (setNodes → createGraphNodes rebuild cascade); it now issues per-node `updateNodeData(id, { position })` (same mechanism as applyPositions; single HTML5 dragend invocation reading store positions plus the total delta — no per-frame staleness). Gates: type-check clean, vitest 148 files / 1874 tests green, 56 E2E cases across 6 specs green. Mentor review also surfaced a **pre-existing functional defect (archived separately)**: `useNodeOrganizer()` is a multi-instance composable — the organize entry (CanvasControls instance) and the zone-group overlay/dragGroup host (NodeCanvas instance) never share state, so the zone-group overlay has been unreachable in production since the prototype (dragGroup is currently a dead path); fixing it needs a product call (hoist state to a singleton/store, or confirm deprecation and delete).


- 前端规范审计决策批（承接上条两批审计的 F3 决策项，用户拍板采纳方案 B）：**`@fileoverview` 文件头惯例成文 + 新文件强制门禁**。新脚本 `frontend/scripts/audit-file-headers.mjs`（`audit:headers`，已接入 `lint`/`lint:check` 链）：`src/` 下 `.ts` 前 20 行内须含 `@fileoverview`、`.vue` 首个非空行须为 `<!--` 头（存量 152/179 vue 已是该形态，按多数对齐），红绿两向差分验证（无头新文件即红、带头即绿，上线当天即抓到并行批次新文件 `nodePositionShell.ts` 用 `@file` 标签的形态偏离并已统一）；存量 490 个无头文件（ts 463 + vue 27）入 `frontend/file-header-audit-exceptions.json` 豁免清单渐进收紧（补头后手动移除条目；脚本对"清单内已带头"文件输出收紧提示），不做全量回填（避免 ~600 文件 blame 噪音）；`tests/` 豁免；AGENTS.md 成文规则（禁止只复读文件名的空洞头）；`scripts/` 3 个脚本的头注释统一为 `@fileoverview` 形态。仍待拍板：全仓 Apache-2.0 许可证文件头（现状 0/1028）。门禁：lint:check 全链（含新 audit:headers）绿、vitest 1856 绿；type-check 此刻红于 `useNodeTypeRegistry.ts:73`（并行 M1 组件重渲隔离在途改动，与本批无关）。
- Frontend code-style audit decision batch (following up on the F3 decision item of the two audit batches above; user adopted option B): **the `@fileoverview` file-header convention is codified with a mandatory gate for new files**. New script `frontend/scripts/audit-file-headers.mjs` (`audit:headers`, wired into `lint`/`lint:check`): under `src/`, `.ts` files must contain `@fileoverview` within the first 20 lines and `.vue` files must open with a `<!--` header block (152/179 existing vue files already use this form — majority-aligned); verified red/green in both directions (a header-less new file fails immediately, a headed one passes — on day one it caught the parallel batch's new `nodePositionShell.ts` using the `@file` tag, now unified); the 490 existing header-less files (463 ts + 27 vue) are exempted in `frontend/file-header-audit-exceptions.json` for gradual tightening (remove entries after adding headers; the script reports exempted files that already have headers), with no bulk backfill (avoiding ~600-file blame noise); `tests/` are exempt; AGENTS.md codifies the rule (hollow headers that merely repeat the file name are forbidden); the headers of the three `scripts/` files are unified to the `@fileoverview` form. Still pending a call: repo-wide Apache-2.0 license headers (currently 0/1028). Gates: lint:check full chain (incl. the new audit:headers) green, vitest 1856 green; type-check is red at this moment on `useNodeTypeRegistry.ts:73` (in-flight M1 component re-render isolation changes, unrelated to this batch).

- 画布流畅度 M1 优化（节点组件重渲隔离，承接 78e0f40e 两项优化后的剩余瓶颈）：新增 `NodePositionShell` 位置隔离壳并经 `useNodeTypeRegistry` 对**全部节点类型统一接线**——Vue Flow 的 NodeWrapper 每次渲染都向节点组件传 `position: node.computedPosition`（拖拽/整理落位期间每 tick 新对象）与新建容器的 `events` 对象，业务节点组件（Props 仅声明 id/data/selected）因 fallthrough attrs 引用变化被强制整树 VDOM diff（SchemaNode 等重组件含列行 v-for + 每列 Handle），是大画布整理落位 flush 与节点拖拽的主要渲染开销。壳 `inheritAttrs:false` 剥离 position（视觉位移由 NodeWrapper 自身 wrapper div 的 transform 承担，全仓节点组件无一消费该 prop——grep 证实组件内 position 引用均为 Handle 方位枚举或 store 数据），其余 attrs 逐 key 值稳定化（`events` 容器每帧新建但 handler 引用稳定，一层浅比较全等则沿用旧引用），内层组件仅在 data/selected 等真实变化时重渲；provide/inject（NodeId/Handle 尺寸上报）与 store→组件响应式旁路不受门控。导师逐行审核通过（Vue 3.5.22 runtime-core 的 attrs track/trigger 与 hasPropsChanged 浅比较链路、position 零消费方、dimensions 赋值新对象穿透等均在打包源码坐实）。实测（Playwright rAF/longtask，同法同环境）：72 节点画布整理冷态 longtask 605→365ms、热态 61ms 近无阻塞，缩放/节点拖拽/平移满帧 179-180fps；128 节点画布整理冷态 3600→2284ms（剩余=边组件首次渲染与路径计算，属正确行为）、热态 longtask 204ms、节点拖拽 41-48→58fps（剩余=关联边逐帧路径重算）、平移/缩放 147-180fps。附带发现：`<VueFlow>` 上的 `@schema-node-save` 绑定为死绑定（emit 无调用点，真实链路是 eventBus），壳前后语义一致，留待后续清理。门禁：type-check 0 错、vitest 147 文件 1867 用例全绿（含新增纯函数+挂载级防 Vue 升级回归测试）、E2E 83 用例全绿（画布交互/整理/roundtrip/全生命周期 + 约束 CRUD/约束类型覆盖/inspector 批量/JSON Schema 生命周期/正则校验）。
- Canvas fluency M1 optimization (node re-render isolation, following 78e0f40e's two optimizations; targets the remaining bottlenecks): a new `NodePositionShell` wraps **every** node type via `useNodeTypeRegistry` — Vue Flow's NodeWrapper passes `position: node.computedPosition` (a fresh object per tick during drag/organize) and a freshly-built `events` container to node components on every render, forcing business node components (Props: id/data/selected only) into full-subtree VDOM diffs via fallthrough attrs — the dominant render cost of organize flushes and node dragging on large canvases. The shell (`inheritAttrs:false`) strips position (visual placement lives on NodeWrapper's own transform; no node component consumes the prop — grep shows in-component `position` references are Handle orientation enums or store data) and value-stabilizes remaining attrs per key (the `events` container is rebuilt every frame but its handlers are stable — one-level shallow compare reuses the old container), so inner components re-render only on real changes (data/selected/dragging…). provide/inject (NodeId, Handle internals) and store→component reactive paths are untouched. Mentor-reviewed line-by-line against Vue 3.5.22 runtime-core (attrs track/trigger, hasPropsChanged shallow-compare skip) and vue-flow-core bundle (zero position consumers, dimensions assigned as new objects). Measured (Playwright rAF/longtask, same method/environment): 72-node canvas organize cold longtask 605→365ms, warm 61ms (near-zero), zoom/drag/pan at full 179-180fps; 128-node canvas organize cold 3600→2284ms (remainder = first-time edge rendering/path computation, correct behavior), warm longtask 204ms, node drag 41-48→58fps (remainder = per-frame connected-edge path recalc), pan/zoom 147-180fps. Noted: `@schema-node-save` on `<VueFlow>` is a dead binding (no emit call sites; the real path is eventBus) — pre-existing and shell-invariant, left for later cleanup. Gates: type-check clean, vitest 147 files / 1867 tests green (incl. new pure-function + mount-level guard tests against Vue upgrades), 83 E2E cases green (canvas interaction/organize/roundtrip/full lifecycle + constraint CRUD/constraint coverage/inspector batch/JSON Schema lifecycle/regex validation).

- 前端代码规范审计修复两批（2026-09-06 审计，1032 文件 100% 覆盖，报告 `docs/audit/2026-09-06-frontend-code-style-audit.md`）：① **机械批**——Prettier 违规清零（`index.html`/`scripts/audit-i18n.mjs`/`scripts/codegen.mjs` 三个已提交文件格式化 + `SchemaNode.vue` 剥离 13 处注释内行尾空白）；`eslint.config.ts` files 补 `mjs`（scripts/ 下 3 个脚本此前无 lint）；删 `frontend/.pytest_cache` 生成物。② **一致性批**——`workspaceStore` 的 `checkFileExists` 改从 `@/core/capabilities/fileApi` 导入（消除业务代码经 `core/utils/fileApi` 直连 Electron IPC 底座的唯一遗留路径）；AGENTS.md 导入顺序描述按实证修订（记录"空行分块、组内不强制"的事实惯例）并补 `composables/nodes/**` 非 `use*` handler 模块例外。决策项未动：全仓无 Apache-2.0 文件头、`@fileoverview` 覆盖 81/844，待拍板。门禁：lint:check / format:check / type-check / vitest 1856 全绿。

- Frontend code-style audit fixes in two batches (2026-09-06 audit, 100% coverage of 1032 files, report `docs/audit/2026-09-06-frontend-code-style-audit.md`): ① **mechanical batch** — Prettier violations cleared (three committed files reformatted: `index.html`/`scripts/audit-i18n.mjs`/`scripts/codegen.mjs`, plus 13 in-comment trailing-whitespace lines stripped from `SchemaNode.vue`); `eslint.config.ts` files pattern now covers `mjs` (the three scripts under scripts/ previously had no lint); removed the `frontend/.pytest_cache` generated directory. ② **consistency batch** — `workspaceStore` now imports `checkFileExists` from `@/core/capabilities/fileApi` (removing the sole remaining business-side path that bypassed the capability layer via `core/utils/fileApi` to the Electron IPC foundation); AGENTS.md import-order wording revised per audit evidence (records the de-facto "blank-line grouping, no intra-group ordering" convention) and adds the `composables/nodes/**` exception for non-`use*` handler modules. Decision items untouched: no Apache-2.0 file headers repo-wide and `@fileoverview` coverage at 81/844, pending a call. Gates: lint:check / format:check / type-check / vitest 1856 all green.

- 画布流畅度两项优化（2026-09-06 流畅度测量发现，128 节点画布实测基线：平移/节点拖拽 ~24-55fps、整理节点一次 ~2.8-3.5s longtask）：① **交互期暂停边的数据流动画**——`dashdraw` 是 SVG 无限动画（`.vue-flow__edge.animated path`），动画期间边层每帧被强制重栅格化、无法走纯合成器路径，是交互帧率的最大开销（CSS 注入差分实证：`animation:none` 后平移/拖拽从 ~55fps 升至满帧 ~180fps）。实现为原生 `mousedown`/`wheel`（capture）+ `mouseup` 判定交互窗口，仅交互进行中给 `.vue-flow` 根挂 `canvas-interacting` class 经 CSS `animation-play-state: paused` 暂停动画，静止时数据流动画照常——边对象上的 `animated` 属性与全部边创建逻辑零改动（"数据流边 vs FK 展示边"语义不受影响）；不用 Vue Flow `moveStart`/`moveEnd` 事件对（`moveEnd` 被 `viewChanged` 门控，无位移的空白点击不成对发射，会把状态卡死在 true——导师审核发现）。② **整理节点落位从全量数组替换改为增量 patch**——`applyPositions` 原以 `graphStore.nodes = nodes.map(...)` 整体替换触发 `setNodes → createGraphNodes` 整图重建级联，改为逐节点 `updateNodeData(id, { position })`（position 路由为 node 级 patch → Vue Flow `updateNode` 原地更新，store 侧由其内部 nextTick 回写，保存/undo/选中态语义不变）。实测：72 节点画布缩放/节点拖拽达满帧 180fps、平移最高 175fps（基线 37-98fps）；整理节点布局计算本身仅 ~10ms，首次整理的长阻塞主体是节点组件首次渲染（属后续组件重渲隔离优化范畴），二次起整理总耗时 ~590ms 且无 3 秒级 longtask。门禁：type-check 0 错、vitest 1856 绿、画布交互/整理/roundtrip 相关 E2E 56 用例全绿。

- Canvas fluency optimizations (found by the 2026-09-06 fluency measurement; 128-node canvas baseline: pan/node-drag ~24-55fps, one ~2.8-3.5s longtask per organize): ① **pause edge data-flow animation during interactions** — `dashdraw` is an infinite SVG animation (`.vue-flow__edge.animated path`); while it runs, the edge layer is forcibly re-rasterized every frame and cannot take the compositor-only path, making it the dominant interaction-frame cost (CSS-injection differential: `animation:none` lifted pan/drag from ~55fps to a full ~180fps). Implementation toggles a `canvas-interacting` class on the `.vue-flow` root via native `mousedown`/`wheel` (capture) + `mouseup`; CSS `animation-play-state: paused` applies only during interactions — the data-flow animation runs as before at rest, and the `animated` property on edges plus all edge-creation logic are untouched (the "data-flow edge vs FK display edge" semantics are preserved). Vue Flow's `moveStart`/`moveEnd` pair was deliberately avoided: `moveEnd` is gated by `viewChanged`, so a click without movement never fires it and the flag would stick at true (found in mentor review). ② **organizer position application switched from full array replacement to incremental patches** — `applyPositions` used to assign `graphStore.nodes = nodes.map(...)`, triggering a `setNodes → createGraphNodes` whole-graph rebuild cascade; it now calls `updateNodeData(id, { position })` per node (position routes as a node-level patch → Vue Flow `updateNode` in-place update, with the store synced by its internal nextTick; save/undo/selection semantics unchanged). Measured: on a 72-node canvas zoom/node-drag reach a full 180fps and pan up to 175fps (baseline 37-98fps); layout calculation itself is only ~10ms — the long first-organize block is dominated by first-time node-component rendering (a target for the follow-up re-render isolation work), while subsequent organizes take ~590ms total with no 3-second-scale longtask. Gates: type-check clean, vitest 1856 green, 56 canvas-interaction/organize/roundtrip E2E cases green.

- 启动脚本时间戳探测的监视集被 PowerShell 递归通配语义扩大（24h 扫描发现，上一批次启动脚本修复的跟进修正；四处：`start.bat` 前端/Electron 两探针、`start-dev.bat`、`start-electron.bat`）：`Get-ChildItem -Recurse -File 'frontend\src','frontend\index.html',…` 中**路径叶子为文件名**的参数被 Windows PowerShell 5.1 当作通配模式在整个 frontend/electron 树内递归匹配——node_modules/coverage/dist 下的全部同名文件（index.html/package.json/tsconfig.json/vite.config.ts）静默进入监视集（实证：单文件路径加 `-Recurse` 返回 140+ 文件，含 `node_modules\fflate\package.json` 等）。错向分析：真实监视源仍在候选集内且 STALE 判定为"任一候选新于戳"，故**只误报不漏报**（不会重新引入旧产物启动缺陷），但 npm install/本地跑 coverage 后首次 `start.bat` 必多做一次全量前端构建 + Electron 重编译，且每次启动都付 node_modules 递归枚举开销（实测单探针 3.91s）。四处探针统一改为：文件叶子经 `Get-Item` 取（无通配展开），仅目录经 `Get-ChildItem -Recurse -File` 递归，两结果合并后比较（实测探测降至 0.06s）。修复后全场景复验（start.bat 原句经 cmd 实跑）：touch node_modules 文件不再误报 STALE、touch 真实监视源（src 内文件）仍正确触发 STALE、基线保持 FRESH；mac 侧 `find` 对文件字面路径本就精确比较，无需改动。

  Launch-script timestamp probes had their watch set silently widened by PowerShell recursive-wildcard semantics (found by the 24h scan; a follow-up fix to the previous launcher-script batch; four sites: both probes in `start.bat`, plus `start-dev.bat` and `start-electron.bat`): arguments of `Get-ChildItem -Recurse -File 'frontend\src','frontend\index.html',…` whose **path leaf is a file name** are treated by Windows PowerShell 5.1 as wildcard patterns matched recursively across the whole frontend/electron tree — every same-named file under node_modules/coverage/dist (index.html/package.json/tsconfig.json/vite.config.ts) silently entered the watch set (verified: a single-file path with `-Recurse` returned 140+ files including `node_modules\fflate\package.json`). Error-direction analysis: the real watched sources stay in the candidate set and the STALE verdict is "any candidate newer than the stamp", so the defect **only produced false positives, never missed a rebuild** (the stale-artifact launcher defect was not reintroduced), but any npm install or local coverage run made the next `start.bat` do a needless full frontend build + Electron recompile, and every launch paid a recursive node_modules enumeration (measured 3.91s for one probe). All four probes now read file leaves via `Get-Item` (no wildcard expansion), pass only directories to `Get-ChildItem -Recurse -File`, and merge the two lists before comparing (probe measured at 0.06s). Re-verified end-to-end with the exact start.bat lines under cmd: touching a node_modules file no longer flips the verdict to STALE, touching a watched source under src still correctly does, and the baseline stays FRESH; the mac side uses `find` with exact file operands and needed no change.

- 启动/构建脚本"旧产物"与"负退出码漏检"两批修复（全量脚本排查）：① **旧产物启动**——标准启动（`start.bat`/`start.sh`）与四个开发启动（`start-dev.bat`/`start-electron.bat`/`start-dev.sh`/`start-electron.sh`）此前的构建判定都是"产物**存在**即跳过"（`if not exist`/`[ ! -f ]`），目录里有旧 dist 就直接加载/运行旧主进程，源码更新后启动的仍是旧版本（与 2026-09 打包链"旧产物入包"同类；实证：i18n 修复后经 start.bat 启动仍显示修复前的英文节点库）。六个脚本统一改为时间戳检测：dist 戳早于受监视源文件（frontend：`src/`、`index.html`、`vite.config.ts`、`package.json`；electron：`src/`、`package.json`、`tsconfig.json`）任一最新修改时间即重建，新鲜则跳过（保留启动速度）；Windows PowerShell 探测不可用时默认按需重建（fail-closed）；构建失败输出日志尾部（start.bat）并删除半成品戳文件后非零退出。② **npm 负退出码漏检**——npm 基础设施错误以负码退出（实测 ENOENT = **-4058**），而 `if errorlevel 1` 语义是"≥1"，负码全部漏检：`call npm` 失败后脚本照样继续走"成功"分支（实测 scratch 布局 npm ENOENT 后错误分支不触发、退出码 0）。5 个 bat 的构建步骤检查（start.bat ×2、start-dev/start-electron ×1、start-electron-smoke ×4 处既有检查——smoke 测试失败也会被误报成功）统一改为 `if not "%errorlevel%"=="0"` 判零（块内用延迟展开 `!errorlevel!`）；实证 -4058 旧检查漏检→新检查捕获、退出码 0 不误伤。连带加固：start.bat 错误分支退出改为"块内设标志 + 顶层 `exit /b`"（实证嵌套块内 `exit /b 1` 在部分组合形态下经 `cmd /c` 返回 0）。全场景实证：scratch 布局 npm 缺失/ENOENT 两路失败路径退出码 1 且戳文件删除、真实仓库产物新鲜时全部跳过、touch 源文件后真实重建且复跑转跳过；排查确认其余脚本安全（smoke 每次全量构建、打包链 build.ps1/build-mac.sh 每次全量、tui-rust cargo 正码、node/python 版本探测命中的是 9009/1 正码）

  Launcher/build script fixes in two batches after a full script sweep: (1) **stale artifacts** — the standard launcher (`start.bat`/`start.sh`) and the four dev launchers (`start-dev.bat`/`start-electron.bat`/`start-dev.sh`/`start-electron.sh`) all gated builds on "artifact **exists** → skip" (`if not exist` / `[ ! -f ]`), so any stale dist on disk was loaded / stale main process run as-is after source edits (the same defect class as the 2026-09 packaging stale-dist; reproduced: after the i18n fix, launching via start.bat still showed the pre-fix English node library). All six now use timestamp detection — rebuild when the dist stamp is older than any watched source file (frontend: `src/`, `index.html`, `vite.config.ts`, `package.json`; electron: `src/`, `package.json`, `tsconfig.json`), skip when fresh; the Windows PowerShell probe fails closed to "rebuild"; build failures print the log tail (start.bat), drop the partial stamp, and exit non-zero. (2) **npm negative exit codes** — npm infrastructure errors exit with negative codes (measured ENOENT = **-4058**) while `if errorlevel 1` means "≥1", so every negative code slipped through: after a failed `call npm` the script continued down the success path (reproduced on a scratch layout: ENOENT failure left the error branch unfired and exit code 0). Build-step checks in 5 bats (start.bat ×2, start-dev/start-electron ×1, plus 4 pre-existing checks in start-electron-smoke — a failing smoke test reported success) now compare explicitly against zero via `if not "%errorlevel%"=="0"` (delayed expansion `!errorlevel!` inside blocks); verified -4058 missed by the old check → caught by the new one, and 0 not false-flagged. Related hardening: start.bat error branches use a flag + top-level `exit /b` (an `exit /b 1` inside nested blocks was empirically observed returning 0 through `cmd /c`). Verified end-to-end: both npm-missing and ENOENT failure paths on a scratch layout exit 1 with stamps deleted; a fresh real repo skips everything; touching a source file triggers a real rebuild with the immediate rerun flipping to skip. The remaining scripts were audited safe (smoke always builds fully; packaging chains build.ps1/build-mac.sh always build; tui-rust cargo uses positive codes; node/python version probes hit positive 9009/1)

- 弹窗打开项目路径的实体水合门控对齐 bootstrap（24h 扫描发现，Playwright 差分实证后修复）：`ProjectManagementModal.vue` 的 `hydrateResourcesFromConfig` 此前无条件执行——经弹窗打开"有 config 实体但无 workspaces 快照"的项目（全新环境打开项目的唯一入口；`.precis` 未随目录迁移/克隆的仓库）会把全部实体一次性倾倒画布（实测 72 节点、43% 落视口外，与 b48264ae 修掉的 bootstrap 首开倾倒同源），且加载完成信号在水合前已被消费、无重发导致自动取景框不到补齐内容。现与 bootstrap 路径共用同一不变量：`lastLoadHadSavedWorkspaces` 才水合（首开无快照以 projectRoot 起步、资源树为实体索引），`hydrated > 0` 时重发 `markContentLoaded` 驱动取景。复验：无快照弹窗首开 6 节点/0 视口外（修复前 72/31）、bootstrap 路径行为不变、有快照丢实体场景水合照常补齐（门不误伤）；弹窗相关四 spec 全绿（lifecycle 6/6 + switch 3/3 + recovery 5/5 + settings-manual-data 7/7）

  Project-open modal hydration gate aligned with bootstrap (found by the 24h scan, fixed after a Playwright differential verification): `ProjectManagementModal.vue` ran `hydrateResourcesFromConfig` unconditionally — opening a project with config entities but no workspaces snapshot through the modal (the only entry on a fresh environment; a cloned repo or a project migrated without `.precis`) dumped every entity onto the canvas at once (measured 72 nodes with 43% outside the viewport, the same failure b48264ae fixed for the bootstrap path), and the content-loaded signal had been consumed before hydration with no re-fire, leaving the auto-fit viewport unable to cover the back-filled nodes. The modal now shares the bootstrap invariant: hydrate only when `lastLoadHadSavedWorkspaces` (a no-snapshot first open starts from projectRoot with the resource tree as the entity index), and re-fire `markContentLoaded` when `hydrated > 0`. Verified: no-snapshot modal first open shows 6 nodes / 0 offscreen (previously 72/31), the bootstrap path is unchanged, and the snapshot-exists-with-missing-entities scenario still back-fills (the gate does not over-block); all four modal-related specs green (lifecycle 6/6 + switch 3/3 + recovery 5/5 + settings-manual-data 7/7)

- 本地 Windows 打包链"旧产物入包"防线修复（release-gui"制作安装包"打出的 exe 内是 8 月 19 日的旧前端——已移除的 ProjectSelector 首屏复活，主进程也缺失此后全部改动）：`build.ps1` 此前只执行 electron-builder，从不重建 `frontend/dist` 与 `electron/dist`（macOS 侧 `build-mac.sh` 一直先构建前端与 tsc，唯 Windows 链缺步）；现 pack/dist/release 三目标统一先跑 `npm run build-only` + `npm run build:electron` 且构建失败即中止，`dist:win`（GUI"制作安装包"按钮与 electron `pack`/`dist`/`release` 同链）随之自愈。连带加固同链两处静默失败：打包链全部 npm 步骤纳入退出码检查并在结尾显式 `exit`（powershell -File 不透传原生命令失败退出码，实测 electron-builder 报错整链仍报成功）；仓库内 6 个无 BOM 且含中文的 PowerShell 脚本统一补 UTF-8 BOM（Windows PowerShell 5.1 对无 BOM 文件按 GBK 解码，中文串字节吞掉相邻引号后会静默吞掉后续语句，实测 tsc 步骤因此整体未执行）；CI 编码守卫（Script Encoding Check）同步从"一律禁 BOM"修订为内容感知——编码必须 UTF-8、含非 ASCII 字节的脚本必须带 BOM、纯 ASCII 不作要求（原一律禁 BOM 与上述 PS 5.1 实证结论冲突，会误杀正确的带 BOM 脚本）

  Windows local packaging chain fix for stale artifacts (the exe produced by the release-gui "build installer" button bundled an Aug-19 frontend — the removed ProjectSelector splash screen came back — and an Aug-19 main process missing every later change): `build.ps1` previously ran only electron-builder and never rebuilt `frontend/dist` or `electron/dist` (the macOS `build-mac.sh` always built the frontend and ran tsc first; only the Windows chain lacked the steps); the pack/dist/release targets now uniformly run `npm run build-only` + `npm run build:electron` first and abort on build failure, healing `dist:win` (the same chain behind the GUI button and electron `pack`/`dist`/`release`). Two silent-failure hardenings along the same chain: every npm step is now exit-code-checked and the script ends with an explicit `exit` (powershell -File does not propagate native command failures — a failing electron-builder still reported success in testing); six BOM-less PowerShell scripts containing Chinese were given UTF-8 BOMs (Windows PowerShell 5.1 decodes BOM-less files as GBK, where Chinese string bytes swallow adjacent quotes and silently swallow subsequent statements — the tsc step was empirically skipped this way); the CI encoding check was revised from "BOM always forbidden" to content-aware — encoding must be UTF-8, scripts with non-ASCII bytes must carry a BOM, pure ASCII is unrestricted (the blanket BOM ban conflicted with the PS 5.1 finding above and would reject the correct BOM-carrying scripts)

- CI 全量 E2E 崩批修复（水合时序治理，17 失败 + 7 flaky → 全绿；每项均经本地 Playwright 动态实证后修复）：① **全局事件监听注册滞后死区**——`registerGlobalListeners` 原在 `await bootstrap()` 之后注册，DEF-01 实体水合把 bootstrap 拉长数秒，窗口期内点击活动栏视图（viewchange）永久丢失（Nav 本地视图已切而 App 层收不到，侧栏永不切换），现提前到 bootstrap 之前注册；② **水合阻塞快捷键上线**——键盘系统初始化原在水合之后，水合期间 Ctrl+Z/X/V/C/D 全部无响应，水合移至 bootstrap 最后一步；③ **水合污染撤销栈与选中态**——逐实体导入各压一张撤销快照（用户开项目后 Ctrl+Z 撤掉的是水合节点）、transform 导入顺手抢选中（检查器自发跳到任意实体），新增 `recordHistory:false` 导入选项 + 水合循环逐次恢复选中；④ **首开无快照实体倾倒**——水合原无条件执行，无 `.precis` 快照的首开（如克隆项目）会把数十个 fallback 节点一次铺上画布：节点互压、fitView 被 2.5s 硬上限与 padding 语义截胡、内容整体越出视口（点击落到侧栏/状态栏之下），现收敛为 DEF-01 原场景"快照存在才补齐"（`loadTabs` 记录快照存在性），fallback 网格按 schema 物化带预留双尺寸单元，水合完成后重新发出加载完成信号驱动自动取景；⑤ E2E 稳健化——fixture 加水合稳定等待与画布悬浮件隐藏（Controls 与 MiniMap 同类干扰源）、`dragSchemaToCanvas`/批量添加先删后拖适配幂等导入、多选/条件约束计数改前置计数锁定

  CI full-E2E failure triage (hydration timing governance, 17 failures + 7 flaky → green; every fix dynamically verified locally via Playwright first): (1) the global-listener registration dead zone — `registerGlobalListeners` ran only after `await bootstrap()`, which hydration now stretches by seconds; clicks on activity-bar views inside that window were permanently lost (nav-local view switched while the App layer never received `viewchange`), listeners now register before bootstrap; (2) hydration starved the keyboard system — shortcut init ran after hydration so Ctrl+Z/X/V/C/D were dead throughout; hydration moved to the last bootstrap step; (3) hydration polluted undo history and selection — each import pushed an undo snapshot (Ctrl+Z after open undid hydration nodes instead of user actions) and the transform import stole selection (inspector jumped to a random entity); new `recordHistory:false` import option plus per-import selection restore; (4) first-open entity stampede — hydration ran unconditionally, so a first open without a `.precis` snapshot (e.g. a fresh clone) dumped dozens of fallback nodes onto the canvas: mutual overlap, fitView defeated by its 2.5s hard cap and padding semantics, content landing under the sidebar/status bar; now scoped to DEF-01's original scenario (a snapshot exists — recorded by `loadTabs`), the fallback grid reserves schema materialization bands with dual-size cells, and a content-loaded signal re-fires auto-framing after hydration; (5) E2E robustness — hydration-settle wait and canvas overlay hiding in fixtures (Controls joined MiniMap as geometric interference), `dragSchemaToCanvas`/batch-add delete-first to fit idempotent imports, multi-select/conditional counts locked via pre-counts

- 全量保存数据丢失防线批次（GUI 覆盖测试 + 24h 扫描发现，均先动态复现后修复）：① **保存跳过门与未保存标记漏判 manualData/template_instances**——"仅手动数据节点"画布 Ctrl+S 走早退门 no-op 仍弹"已保存"，数据永不落盘；② **画布是工作区而非全量资源集**——保存 payload 只含画布引用会清空磁盘上未入画布的 manifest 引用，SaveOrchestrator 保存前 GET 磁盘清单按 id 并集（画布优先），settings 以磁盘为准不被 payload 默认值回退；③ **读盘失败 fail-open**——并集读盘非 404 失败（超时/网络）时静默继续会以画布子集清空引用，现仅"清单不存在（404，首次保存）"放行、其余中止保存并向用户报错；④ **`project.description` 全量保存静默抹除**——后端 `_merge_manifest_references` 增嵌套字段粒度防线（payload 未显式提供即从磁盘透传，显式 null/新值遵从意图），前端 `ProjectInfoV2` 类型与并集同步补齐；⑤ **已保存手动数据节点再编辑不回 `draft`**——检查器 `emitUpdate` 附带回标，跳过门与未保存指示器恢复判定；⑥ dynamicBackendProxy 端口文件路径可注入（修单测污染真实 `.backend-port` 的环境悬案）；⑦ 项目信息面板"重置"被 watch 自回写污染失效；新增设置中心+手动数据 E2E spec（7 用例，含保存 roundtrip 与再编辑回归锁）与 4 个 store 单测

  Full-save data-loss defense batch (GUI coverage testing + 24h scan findings, each reproduced before fixing): (1) the save skip-gate and the unsaved indicator both missed manualData/template_instances, so a manual-data-only canvas Ctrl+S was a silent no-op that still toasted "saved"; (2) the canvas is a workspace, not the full resource set — save payloads built only from canvas refs wiped manifest references not currently on canvas; SaveOrchestrator now unions disk-manifest refs by id before PUT (canvas first) and keeps disk-authoritative settings; (3) the union read was fail-open — any non-404 failure (timeout/network) silently proceeded with the sparse payload and cleared disk refs; now only "manifest not found (404, first save)" is allowed through, everything else aborts the save with a visible error; (4) `project.description` was silently wiped by every full save — the backend merge now preserves it at nested-field granularity (explicit null/new value respected), with the frontend type and union passthrough aligned; (5) editing an already-saved manual-data node no longer re-marks `draft`, which re-armed the skip gate — the inspector's `emitUpdate` now includes the flag; (6) dynamicBackendProxy port-file path is now injectable (fixing unit tests polluting the real `.backend-port`); (7) project-info panel "reset" was defeated by a watch echo; added a settings + manual-data E2E spec (7 cases incl. save roundtrip and re-edit regression locks) and 4 store unit tests

- 全节点 GUI 黑盒测试 17 项缺陷修复（DEF-01~17，画布全节点类型逐一手动走查坐实）：资源回显链路根治（磁盘资源加载不自动水合画布，`hydrateResourcesFromConfig` 统一从磁盘配置回显）、检查器列名编辑静默丢失（列级三方合并）、保存入口语义统一（"保存更改"与 Ctrl+S 对无源 Schema/草稿节点行为一致）、类型下拉 `min-height:0` 修复与 popover 档位、leave-active 过渡吞点击推广修复 + `vueFlowApi` owner token 防误用、布局器双网格对齐合并与节点尺寸三级候选、正则节点与转换渲染器交互修复等；布局器/生成位置/尺寸助手测试大幅扩充（+250 行级）

  Seventeen defects (DEF-01~17) fixed after a manual black-box walkthrough of every canvas node type: resource re-materialization chain rooted (loading from disk now hydrates the canvas via `hydrateResourcesFromConfig`), silent loss of inspector column-name edits (three-way column merge), unified save-entry semantics between the "Save changes" button and Ctrl+S for source-less schemas and draft nodes, type-dropdown `min-height:0` fix with popover tiers, the leave-active transition swallowing-clicks fix generalized plus a `vueFlowApi` owner token, organizer dual-grid alignment merge with three-tier node-size candidates, regex-node and transform-renderer interaction fixes, and substantially expanded organizer/spawn-position/dimension-helper tests (+250 lines)

- 24h 风险扫描三项坐实缺陷修复（每项均先动态复现后修复）：① **Electron `write-file` 绕过受保护文件防线**（vitest 复现：可覆写 `userData/update-config.json` 实现换源劫持、覆写 `.precis/electron_launch.yaml` 毒化授权根信任源后 read-file 越权读任意目录）——write-file 现按 userData 相对路径设防（含 Windows 尾点/尾空格归一化防 `'update-config.json.'` 变体），ensure-dir 补上此前完全缺失的根目录包含校验；② **模板实例"幽灵复活"**（直调复现：删光画布实例→全量保存→重载引用复活）——新增幂等 `DELETE /manifest/template-instance/{id}` 端点、`DELETE /template/{id}` 级联清理指向它的实例引用（消除永久悬空的 `TemplateInstanceMissingTemplate`）、前端 nodeOps 单删/批删路径同步清引用（失败仅告警不阻断画布删除）；③ **`.xls` 宣告支持却必炸**（实测双路径全败）——pyproject 声明 `xlrd>=2.0.1`，ExcelLoader 按扩展名解析实际引擎（.xls→xlrd、.xlsx/.xlsm→openpyxl，冲突时纠正并提示）；附带修复更新设置面板忽略 `update:save-config` 拒绝返回导致的静默失败与 UI 失真（false 返回/异常现 toast 提示，i18n 双侧）

  Three verified defects from the 24h risk scan fixed (each reproduced before fixing): (1) Electron `write-file` bypassed the protected-file gate — it could overwrite `userData/update-config.json` (update-source hijack) and the authorized-roots trust source (poisoning then read-file anywhere); write-file now guards by userData-relative protected paths (with Windows trailing-dot/space normalization) and ensure-dir gains the previously missing root containment check; (2) template-instance "ghost resurrection" — deleting all instances then full-saving resurrected them from disk on reload; added an idempotent `DELETE /manifest/template-instance/{id}` endpoint, cascade instance-ref cleanup in `DELETE /template/{id}`, and frontend nodeOps syncs the ref on single/batch deletion (failure warns without blocking canvas deletion); (3) `.xls` was declared supported but always failed (both engine paths); declared `xlrd>=2.0.1` and ExcelLoader now resolves the engine by extension (.xls→xlrd, .xlsx/.xlsm→openpyxl) with a correction notice; also fixed the update settings panel silently ignoring a rejected `update:save-config` (now toasts on false/throw, i18n both sides)

### 说明 / Note

当前为活跃开发中的原型版本，接口、配置格式、命令行参数均可能在不通知的情况下变更。

Currently an actively developed prototype. Interfaces, config formats, and CLI parameters may change without notice.

### 2026-09

- 代码债务与长期治理批次：前端死代码净删约 3,900 行（barrel 死导出地雷、AIChatDrawer、旧注册表副本、416 行死模块等，每项删前引用复核）；i18n 审计工具补上从未实现的"未用 key"检测（新增即失败门禁）并删除双侧死 key 220 条、约 30 处硬编码文案入 key；`as unknown as` 双重断言 296→157（lint 阈值同步 300→152 精确锁定）；84 个组件 Props 统一 interface 书写；约 25 处注释/文档失实修正；后端死代码与散项修复（.xls 加载必炸、邮箱 465 SSL、reporter URL 脱敏、校验历史并发丢更新等 +45 测试）；TUI 图标字典统一与 clippy 清零；三处并发加固（Electron 重启互斥/设置面板竞态/长按监听清理）

  Debt and governance batch: ~3,900 lines of dead frontend code removed (with per-item reference re-verification); the never-implemented "unused key" detection added to the i18n audit tool with 220 dead keys removed and ~30 hardcoded UI strings internationalized; `as unknown as` double assertions cut 296→157 with the lint threshold tightened 300→152; Props declarations unified to the `interface Props` pattern across 84 components; ~25 stale comments corrected; backend dead code plus a dozen robustness fixes (+45 tests); TUI icon dictionary unification and clippy cleanup; three concurrency hardenings
### 2026-09

- 全库代码审计后集中修复 **70+ 项确认缺陷**（主源码 1,191 文件 100% 覆盖审计，全部 P0 与关键 P1 经运行时复现实证后修复；新增约 150 个单元测试）。要点：
  - **崩溃/冻结级**：脚本安全设置面板双向 watcher 死循环（生产版改开关即冻结，值相等守卫修复）；AI 生成表级约束 IndexError；CLI `config init pattern` 模板正则与 `str.format` 冲突必崩（改 replace 填充，产物并升级为合法 V2 清单）；子画布克隆响应式代理抛 DataCloneError
  - **校验正确性**：项目加载丢弃 schema 声明的 CSV 编码/分隔符（预览与校验解析不一致，大文件分块同病）；Excel 合并单元格填充漏算跳过行数/选错工作表；超大整数（>2^53）静默截断改为报错；transform `contains` 按字面量匹配且非法正则不再崩溃；日期/条件约束配置拼错由"静默通过"改为报配置错误；正则 flags 长格式误开忽略大小写；跨盘符路径报 500；告警通知按字节截断（中文超长不再被平台拒收）
  - **配置完整性**：全量保存清空 manifest 模板引用；数据源配置误写项目父目录致同目录多项目互覆；画布视图/工作区文件原子写；正则节点大小写语义保存后翻转；默认名 Schema 全量保存互覆文件（路径去重）；Regex 违规条目补 `error_type`
  - **AI 链路**：删除约束遇内联标记反向写回（真删）；AI 建正则目录漂移对齐 `regex/`；空脚本约束不再兜底恒真表达式；Windows 残留文件锁可接管；JSON 提取感知字符串字面量；Agent 末轮文本收敛不再误判失败；流式事件回放去重；Ollama 流式不受总时长限制；整体防僵死超时放宽
  - **前端**：AI 生成/迁移流式请求补项目头（功能恢复）；数字输入框按 Backspace 误删选中节点；快捷键自定义捕获失效；八处 `addNodes+spread` 反模式清零；删 Schema 级联删约束恢复生效；缩放快捷键接通真实画布；撤销后旧值回写；两处监听器泄漏；拼音选词回车误发消息；拖拽导入路径改用 `webUtils.getPathForFile`（Electron 32+ 移除 `File.path`）
  - **安全**：打包模式以一次性 API token（`X-Precis-Auth`）取代放行 `Origin: null`——沙箱 iframe 网页无法再跨域读本机 API；外部链接仅 http/https 交给系统；配置保存校验路径（授权根信任源防毒化）；`app://` 协议改用 `pathToFileURL` 杜绝双重编码穿越；目录扫描限深；更新源 https 校验且渲染层不可再覆写更新配置
  - **TUI/CLI**：URL 查询参数标准百分号编码（含 `&`/`#` 路径可用）；聊天历史去重；激活 Provider 失败回滚；版本号全部改从单一事实源读取（启动画面/欢迎屏/四个打包脚本）；`config set` 保注释 + 原子写 + 穿越防护；校验接口文档对齐"永远 200、看 body"契约
  - **仓库卫生**：`challenges/` 内部材料移出版本控制（本地保留）；e2e 补 README

  Batch fix of **70+ confirmed defects** after a full-repo audit (1,191 source files, 100% coverage; every P0 and key P1 reproduced at runtime before fixing; ~150 new unit tests). Highlights: settings-panel watcher infinite loop freezing production builds; preview-vs-validation parsing divergence for CSV options; Excel merged-cell offset skips; silent >2^53 integer truncation; manifest templates wiped on save; data-source config written to the project's parent directory; AI delete-constraint upsert regression; stale Windows file locks; token-based `Origin: null` replacement; `app://` double-decoding traversal; drag-drop paths via `webUtils.getPathForFile`; TUI percent-encoding and chat-history dedup; version strings sourced from the single source of truth.

- 全库代码审计（规范化/标准化/逻辑漏洞/开源标准四维度，主源码 1,191 文件 100% 逐文件覆盖）：发现 2 项 P0、63 项 P1、约 150 项 P2；关键发现全部经最小复现脚本实证。审计报告与"疑似设计如此"项的逐项处置记录见 `docs/audit/`（本地）

  Full-repo code audit across standards compliance, logic defects and open-source readiness (1,191 source files, 100% per-file coverage): 2 P0s, 63 P1s and ~150 P2s found; all key findings reproduced empirically before fixing. Audit report and per-item disposition of "suspected-by-design" findings live under `docs/audit/` (local)

- 后端代码规范全量治理（2026-09-06 规范检查发现，680 文件 100% 覆盖，报告 docs/audit/2026-09-06-backend-code-standards-review.md）：① **唯一真实违规修复**——domain 层 `condition_registry.py` 条件覆盖警告 `print`→`logger.warning`（domain 无 I/O 约定），capsys 断言测试同步改写 caplog；② **类型注解 100% 补齐**——mypy `--disallow-untyped-defs --disallow-incomplete-defs` 探针驱动的存量缺口全部修复（253 条：app/api 106、app/cli 45、app/shared 102），路由处理函数按 response_model/实际返回值补注解；函数体首次被类型检查激活暴露并修复 4 处潜在问题（openai/ollama provider 会话属性注解缺失、FileLock `__exit__` 标注 `Literal[False]` 使 mypy 可证明异常必传播、`full_config` 六个 `for ref` 循环变量跨类型复用、`chat_completions` 联合返回类型经 `response_model=None` 关闭响应模型推断）；③ **强制门禁开启**——`pyproject.toml [tool.mypy]` 启用 `disallow_untyped_defs` + `disallow_incomplete_defs`，此后新增无注解函数 CI 直接失败（tests 豁免：mypy 范围仅 app）；④ 12 个 app 文件补齐 module docstring（`config/__init__.py` 的 @fileoverview 块此前位于 `from __future__` 之后不构成真 docstring，复位为语句首；`projects.py` 8 条英文 class docstring 本地化）。门禁：ruff check/format 全绿、`mypy app` 401 文件 0 错、pytest 3431 绿（覆盖率 77.91%）。

  Backend code-standards remediation batch (found by the 2026-09-06 standards review; 680 files, 100% coverage; report at docs/audit/2026-09-06-backend-code-standards-review.md): ① the only real violation fixed — the domain-layer `condition_registry.py` duplicate-registration warning switched from `print` to `logger.warning` (domain purity: no console I/O), with the capsys test rewritten for caplog; ② type annotations completed to 100% — all 253 gaps reported by the mypy `--disallow-untyped-defs --disallow-incomplete-defs` probe were fixed (app/api 106, app/cli 45, app/shared 102), route handlers annotated from response_model/actual returns; newly type-checked function bodies surfaced and fixed 4 latent issues (missing provider session attribute annotations in openai/ollama, `FileLock.__exit__` typed `Literal[False]` so mypy can prove exceptions propagate, six `for ref` loop variables reused across ref types in `full_config`, and the `chat_completions` union return handled via `response_model=None`); ③ enforcement enabled — `disallow_untyped_defs` + `disallow_incomplete_defs` are now on in `pyproject.toml [tool.mypy]`, so new unannotated functions fail CI (tests exempt: mypy scope is app only); ④ 12 app files gained module docstrings (the `config/__init__.py` @fileoverview block sat after `from __future__` and was not a real docstring — moved to statement one; 8 English class docstrings in `projects.py` localized to Chinese). Gates: ruff check/format green, `mypy app` 401 files 0 errors, pytest 3431 green (coverage 77.91%).

### 2026-08

- 修复发布提交遗漏三份 `package-lock.json`——`npm version` 同步版本时连带更新各目录 lockfile 的版本字段，但发布提交清单只含六处 manifest，v0.1.1 发布后工作树因此残留未提交改动，下一次发布被"干净树"前置校验确定性阻塞（已复现）；提交清单抽为 `releaseCommitFiles()`（六处 manifest + 三份 lockfile + CHANGELOG）并补交 v0.1.1 遗漏的版本字段。`npm ci` 对该漂移容忍（沙箱 + v0.1.1 CD 构建全绿实证），影响是发布阻塞而非安装断裂`npm ci` 对该漂移容忍（沙箱 + v0.1.1 CD 构建全绿实证），影响是发布阻塞而非安装断裂

  Fixed the release commit omitting the three `package-lock.json` files — `npm version` rewrites each directory's lockfile version fields as a side effect, but the commit list only covered the six manifests, so after the v0.1.1 release the working tree kept uncommitted changes that deterministically blocked the next release at the clean-tree precheck (reproduced); the list is now `releaseCommitFiles()` (six manifests + three lockfiles + CHANGELOG) and the missing v0.1.1 lockfile bumps are committed. `npm ci` tolerates this drift (verified in a sandbox and by the fully green v0.1.1 CD builds), so the impact was release blocking, not broken installs

- 发布控制台安全与退出加固——POST 状态变更接口增加 Origin/Host 本机来源校验：恶意网页可借无预检跨站 POST（text/plain）直达本地端口真实启动打包/发布任务（已实证），外源 Origin 与 DNS rebinding Host 现一律 403，同源页面与 curl/测试客户端不受影响；收到 Ctrl+C/终止信号时先显式终止运行中的任务子进程与本地更新源（Unix 上 detached 任务在独立进程组，原先不随控制台退出，可能与提示相悖地在后台跑完一次发布）

  Release console security and shutdown hardening — POST state-changing endpoints now validate local Origin/Host: a malicious page could really start build/release tasks via a no-preflight cross-site POST (text/plain) straight to the local port (empirically confirmed); foreign Origins and DNS-rebinding Hosts are now rejected with 403, leaving same-origin pages and curl/test clients unaffected. On Ctrl+C/terminate the console now explicitly kills the running task subprocess tree and the local update server first (on Unix, detached tasks live in their own process group and previously outlived the console — potentially finishing a release in the background despite the banner claiming otherwise)

## [0.1.1] - 2026-08-30

### 2026-08

- 新增发布控制台 GUI（`npm run release:gui`，零依赖本地 Web 控制台，**根目录 `release-gui.bat` 双击即用**）：打包 / 发布（版本号自动推导 + dry-run 预览 + 正式发布确认）/ 更新演练（lite/full 一键生成 + 本地更新源启停）/ 线上状态（GitHub Release 列表 + manifest 一致性 + 产物 sha512 实测校验）全部按钮化，子进程日志 SSE 流式推送；仅绑定 127.0.0.1，动作固定枚举 + 输入白名单正则防命令注入

  Added a release console GUI (`npm run release:gui`, zero-dependency local web console, **double-click `release-gui.bat` in the repo root to launch**): one-click build / release (auto version suggestion + dry-run preview + confirm before publishing) / update drills (lite & full generation plus local update-server start/stop) / online status (GitHub Release list, manifest consistency, sha512 asset verification) — all button-driven with live SSE log streaming; binds to 127.0.0.1 only, with a fixed action enum and whitelist-regex input validation against command injection

- 版本发布与客户端自动更新标准化：新增 `npm run release` 一键发布（六处 manifest 版本同步 + CHANGELOG 切版 + tag 触发 CD，含 dry-run）；CD 改为版本一致性守卫 + Release 自动 publish（draft 对 electron-updater 不可见是客户端拉不到更新的根因）+ CHANGELOG 版本分节作为 release notes + 产物自检闸门（latest.yml 资产存在性/size/sha512 实测，堵住清单与产物命名漂移导致的更新 404）；安装包产物名显式固定为无空格的 `Precis-Setup-<version>.exe`；修复自定义更新源重启后失效（setFeedURL 不重放）；更新安装前先终止 Python 子进程树（防 NSIS 覆盖被占用文件）；主进程加单实例锁；更新状态主→渲染推送替代纯轮询；打包版后端 `/version` 改为 `PRECIS_APP_VERSION` 环境变量优先（修复错误兜底 1.0.0）；新增本地"模拟生产"更新演练工具（lite/full 两模式，替换生成 dummy 假包的旧脚本）

  Standardized version release and client auto-update: added `npm run release` one-command release (six-manifest version sync + CHANGELOG cut + tag-triggered CD, with dry-run); CD now gates on manifest/version equality, auto-publishes Releases (draft Releases are invisible to electron-updater — the root cause of clients never finding updates), uses the CHANGELOG version section as release notes, and adds an asset verification gate (existence/size/sha512 of every latest.yml entry, closing the manifest↔artifact naming drift that caused update 404s); installer artifact name pinned to space-free `Precis-Setup-<version>.exe`; fixed custom update source silently lost after restart (setFeedURL not replayed); update install now stops the Python process tree first (prevents NSIS failing on locked files); added single-instance lock; update state is now pushed main→renderer instead of pure polling; packaged backend `/version` prefers the `PRECIS_APP_VERSION` env var (fixing the wrong 1.0.0 fallback); added a local production-simulation update drill tool (lite/full modes, replacing the dummy-package script)

- 修复 TUI 英文环境下后台任务错误文案回退中文——thread_local 界面语言不随线程继承，tokio::spawn 的 HTTP 后台任务运行在 worker 线程上，其 `pick()` 恒取默认中文（英文用户错误 toast/气泡混排）；改为手动构建运行时，worker 线程启动时注入主线程探测到的语言（含回归测试）

  Fixed TUI background-task error messages falling back to Chinese under an English locale — the thread-local UI language is not inherited across threads, so tokio::spawn HTTP tasks on worker threads always picked the default Chinese (mixed-language toasts/bubbles for English users); the runtime is now built manually and injects the main-thread-detected language into every worker thread at start (with a regression test)

- 前端视觉/交互测试修复批次：工具箱创建节点改从视口中心落点并避让已有节点（磁贴主体点击即可创建，不再要求点图标）；节点整理器补全 manualData/transform/templateInstance 类型映射（此前这三类节点不被分类，整理时游离于布局之外）；检查器必填字段增加字段级校验提示，Web 模式能力门控与覆盖层体验小修

  Frontend visual/interaction test fix batch: toolbox-created nodes now spawn at the viewport center avoiding existing nodes (the magnet-tile body is clickable to create, no longer requiring the icon); the node organizer gained the missing manualData/transform/templateInstance type mappings (these node kinds previously went unclassified and drifted out of the layout); inspector required fields gained field-level validation hints, plus web-mode capability gating and overlay UX fixes

- 修复节点整理（自动布局）整体失效的根因缺陷——布局分类器的分类 Map 从未初始化，"Schema 中心化"策略实际从未生效，整理一直退化为按 UUID 随机序的缠绕网格（缺陷由 strictNullChecks 清理批次引入，此前仅在测试注释中被记录而未修复）

  Fixed the root-cause defect that left the node organizer effectively broken — the layout classifier's category maps were never initialized, so the schema-centric strategy never actually ran and organizing always degraded into a UUID-ordered tangled grid (introduced by a strictNullChecks cleanup batch; previously only noted in a test comment, never fixed)

- 节点整理布局优化——约束/正则按 Schema 字段顺序排列（与左侧字段编辑器上下呼应，列 ID 精确匹配、列名兜底）；右侧区块按 fitView 视口适配度自动分栏（1~4 列择优，消除"单列长柱 + 大面积留白"）；超长单节节内换子列且分组框不拆分；可用区估算与 fitView 不对称安全留白对齐

  Node-organizer layout improvements — constraints and regex nodes now follow the schema's field order (echoing the schema editor; matched by column ID with column-name fallback); right-hand blocks auto-balance into 1–4 columns chosen by fitView viewport fitness, eliminating the "single tall column + dead space" layout; oversized sections wrap into sub-columns without splitting their group frame; usable-area estimation now aligns with fitView's asymmetric safe padding

- TUI 动效粒子改为景深分层——字形/亮度/速度/摆幅统一由景深派生（近景大花亮而快、远景小点暗而慢），色相与主题渐变同源；渲染增加防粘连：同帧相邻粒子互相让位，双宽花形（CJK 字体）要求右邻格空白，消除"❄·"糊团与压字；飘雪字形弃用厚重 ❄，正式定为纤细雪晶 ❅（三档 ❅ * ·）

  TUI effect particles are now depth-layered — glyph/brightness/speed/sway all derive from a single depth value (near flakes big, bright and fast; far dots dim and slow), with hue matched to the theme gradient; rendering adds anti-fusion: same-frame adjacent particles yield to each other, and double-width flower glyphs (CJK fonts) require a blank right neighbor, eliminating fused "❄·" blobs and glyph-over-text overlaps; the heavy ❄ snowflake glyph is replaced by the slender crystal ❅ (three tiers: ❅ * ·)

- **移除项目选择首屏，画布成为唯一默认界面**——打开项目统一经管理弹窗
   
  **Removed the project-selector first screen; the canvas is now the sole default view** — opening projects goes through the management dialog

- 安全加固两批：Electron IPC 路径穿越防护与沙箱校验；preview 路径校验、AI 直写 fail-closed、CORS 收紧
   
  Two security hardening batches: Electron IPC path-traversal & sandbox checks; preview path validation, AI direct-write fail-closed, tightened CORS

- 后端写盘纪律统一：全仓原子写
   
  Unified backend write discipline: atomic writes across the codebase

- 修复自检报告"按文件"分组显示 `<unknown>`——引用缺失/数据源重复/Schema ID 重复的 LoadingError 补归属文件路径（manifest 路径优先，缺省按 V2 命名规范推导）
   
  Fixed inspection reports showing `<unknown>` in the by-file grouping — LoadingErrors for missing references / duplicate data sources / duplicate schema IDs now carry the owning file path (manifest path first, falling back to the V2 naming convention)

- 前端多批 UX 与正确性修复：15 项 P0/P1 缺陷、撤销覆盖扩展与草稿守卫、画布加载适配与主题批次、资源树批量操作等
   
  Multiple frontend UX/correctness fix batches: 15 P0/P1 defects, undo-coverage extension & draft guards, canvas load adaptation & theme batch, resource-tree batch operations, etc.

- TUI UX 评审修复批次与前端排版审计修复；full config 响应新增 templates 内容字典，修复模板显示名断链（节点标题/资源树此前只能显示模板 id）
   
  TUI UX review fix batch and frontend typography-audit fixes; the full-config response now includes a templates content dict, fixing broken template display names (node titles and the resource tree previously showed only template ids)

- 修复首次打开全新项目（尚无工作区持久化）时，画布 Tab 初始化误清空已加载节点的问题——bootstrap 与项目管理弹窗两条路径的默认工作区均改为收养当前画布而非重置（弹窗是移除首屏后打开项目的唯一入口；本地曾被 gitignored 运行时状态掩盖，CI E2E 揭示）
   
  Fixed: opening a brand-new project (no persisted workspaces) wiped just-loaded canvas nodes during tab initialization — the default workspace now adopts the current canvas instead of resetting, on both the bootstrap and management-dialog paths (the dialog is the sole project entry point since the first-screen removal; masked locally by gitignored runtime state; exposed by CI E2E)

### 2026-07

- 新增 Rust TUI 终端客户端（ratatui + crossterm + tokio）：双主题、动效、Provider/Chat/校验界面，独立于 Electron 与 Web 前端
   
  Added the Rust TUI terminal client (ratatui + crossterm + tokio): dual themes, animations, Provider/Chat/validation views, independent of Electron and the web frontend

- CLI / TUI 自包含分发打包：内置 Python 运行时，解压即用
   
  Self-contained CLI/TUI distribution packaging with a bundled Python runtime — extract and run

- 校验引擎正确性大修三波次：清理假通过与静默失败类缺陷
   
  Three waves of validation-engine correctness overhauls: eliminated false-pass and silent-failure defects

- `error_handling: stop` 遇错即停；Scripted / Conditional 约束超时可中断
   
  `error_handling: stop` halts on first error; Scripted/Conditional constraints are interruptible on timeout

- Excel 分块校验行号全局连续
   
  Globally continuous row numbers for chunked Excel validation

- 黄金集校验接入：`qa_test/golden` 17 组场景 + CI 校验脚本
   
  Golden-set validation: 17 scenario groups under `qa_test/golden` plus CI check scripts

### 早期变更（~2026-06）/ Earlier Changes (≤ 2026-06)

#### 约束系统 / Constraint System

- 新增 Charset（字符集）、DateLogic（日期逻辑）、Composite（复合）三种约束类型
   
  Added Charset, DateLogic, and Composite constraint types

- 约束节点自注册双注册表模式（NodeDataBuilder + ValidationRegistry）
   
  Dual-registry self-registration pattern for constraint nodes

- 约束规则集（ConstraintRuleSet）节点与分组管理
   
  ConstraintRuleSet nodes and grouping management

#### 转换引擎 / Transform Engine

- 实现 22 种转换类型，支持 DAG 拓扑排序链式执行
   
  Implemented 22 transform types with DAG topological execution

#### 可视化编辑器 / Visual Editor

- 资源树拖拽导入（Schema、Constraint、Regex、Transform）
   
  Resource tree drag-and-drop import

- 模板实例展开系统（Template Expansion）
   
  Template instance expansion system

- 剪贴板（复制/粘贴/重复）与撤销/重做
   
  Clipboard (copy/paste/duplicate) and undo/redo

- 连接规则验证系统（22 条规则）
   
  Connection validation system (22 rules)

- 校验历史面板
   
  Validation history panel

- AI 聊天与配置生成面板
   
  AI chat and config generation panel

- 应用设置工作台
   
  Application settings workspace

- 节点布局组织器（自动排列）
   
  Node layout organizer (auto-arrange)

#### 后端 / Backend

- 后端三层架构重构（core / domain / services）
   
  Backend three-layer architecture refactoring (core / domain / services)

- 校验引擎两阶段流水线（数据加载 → 约束校验）
   
  Validation engine two-stage pipeline (data loading → constraint validation)

- 校验历史持久化存储与查询 API
   
  Validation history persistence and query API

- 多类型内联数据源约束校验
   
  Multi-type inline data source constraint validation

- 配置差异比较服务
   
  Config diff comparison service

#### 基础设施 / Infrastructure

- 统一使用 Vue Flow API 进行 DAG 操作（替代直接数组操作）
   
  Unified Vue Flow API for DAG operations

- V2 持久化流水线（保存/加载完整项目配置）
   
  V2 persistence pipeline (save/load full project config)

- 添加单元测试覆盖（前端 Vitest + 后端 pytest）
   
  Added unit test coverage (Vitest + pytest)

- 排除存在供应链漏洞的 fastapi 版本
   
  Excluded fastapi version with supply chain vulnerability

### 已知问题 / Known Issues

- ⚠️ **测试覆盖基线已建立，但核心引擎与边界场景仍不足** — 前后端单元测试、E2E 测试及 CI 流水线已运行，核心校验引擎的边界 case 和异常路径仍需补充覆盖

  ⚠️ **Test coverage baseline established, but core engine and edge cases still insufficient** — Unit tests (frontend + backend), E2E tests, and CI pipelines are operational, but boundary cases and error paths in the core validation engine need more coverage

- ⚠️ **配置格式不稳定** — YAML 结构可能随版本调整

  ⚠️ **Config format unstable** — YAML structure may change with versions

## [0.1.0] - 2026-04-17

### 说明 / Note

首次代码提交，建立基础框架。此版本仅为内部技术验证，不具备生产可用性。

First code submission, establishing basic framework. This version is for internal technical validation only and is not production-ready.

### 内容 / Contents

- 初始化前端、后端、Electron 三个子项目
   
  Initialized frontend, backend, and Electron subprojects

- 配置 Husky + lint-staged + Ruff 代码格式化流水线
   
  Configured Husky + lint-staged + Ruff code formatting pipeline

- 添加基础 CI 工作流（lint、type-check）
   
  Added basic CI workflow (lint, type-check)

- 实现可视化画布（Vue Flow）基础节点与连线
   
  Implemented visual canvas (Vue Flow) basic nodes and connections

- 实现 V2 配置引擎（project.precis.yaml 驱动）
   
  Implemented V2 config engine (driven by project.precis.yaml)

- 添加基础约束类型：Unique、NotNull、AllowedValues、ForeignKey、Conditional、Range、Scripted
   
  Added basic constraint types: Unique, NotNull, AllowedValues, ForeignKey, Conditional, Range, Scripted

- 添加基础转换节点：StringSplit、RegexExtract、MathExpr、DateFormat 等
   
  Added basic transform nodes: StringSplit, RegexExtract, MathExpr, DateFormat, etc.

- 集成 AI 配置生成服务接口（OpenAI / Ollama）
   
  Integrated AI config generation service interfaces (OpenAI / Ollama)

- 添加国际化支持（zh-CN / en-US）
   
  Added internationalization support (zh-CN / en-US)
