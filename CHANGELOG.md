# 变更日志 / Changelog

> ⚠️ 本项目处于 Alpha 阶段，核心功能已成型但仍可能有不兼容变更。以下记录仅供参考。
>
> This project is in Alpha stage. Core features are implemented but breaking changes may still occur. The following records are for reference only.

## [Unreleased]

### 2026-09

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
