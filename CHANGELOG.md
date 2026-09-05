# 变更日志 / Changelog

> ⚠️ 本项目处于 Alpha 阶段，核心功能已成型但仍可能有不兼容变更。以下记录仅供参考。
>
> This project is in Alpha stage. Core features are implemented but breaking changes may still occur. The following records are for reference only.

## [Unreleased]

### 2026-09

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
