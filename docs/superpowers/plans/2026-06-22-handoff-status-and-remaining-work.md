# Precis 项目交付状态与剩余工作计划

> **交接文档** — 供后续 Agent 续作。本文档汇总已完成的工作与精确到文件/行数的剩余任务。
>
> **生成日期：** 2026-06-22
> **当前分支：** `main`（领先 `origin/main` 16 个提交，尚未 push）
> **测试基线：** 后端 2476 passed · 前端 1365 passed · E2E full-lifecycle 30 passed · lint 全绿

---

## 一、已完成的成果（P0 + P1）

### P0 Pre-Alpha 闭环（已合并 main）

| 提交 | 内容 | 关键文件 |
|---|---|---|
| `e017ead` | JSON 预览加载（复用 JSONSourceSpec） | `backend/app/shared/services/preview/loader.py`、`backend/app/api/services/preview_service.py` |
| `9cf7cfc` | 单文件全量校验 501→真实逻辑（file→schema 反查） | `backend/app/api/routers/project/validation.py` |
| `050852f` | DateLogic 前端补 validation_config | `frontend/src/composables/nodes/constraints/useDateLogic.ts` |
| `9b54308` | Web 端新建项目（POST /projects/create） | `backend/app/api/routers/projects/create.py` |
| `ef9c566` | embeddedConstraints 直接单测 | `frontend/tests/stores/graphStore/v2/shared/embeddedConstraints.test.ts` |
| `16a922c` | **模板参数化展开**（parameters 字段 + `{{param}}` 替换 + load_project 实例展开） | `backend/app/shared/core/project/template/expander.py`、`backend/app/shared/core/project/template/types.py`、`backend/app/shared/core/project/loader/loader_parts/main.py`、`backend/app/api/routers/project/template.py`、`backend/app/shared/core/project/manifest/types_parts/template.py` |

**附带：** `qa_test/qa_v3_complex/` fixture（17 schema/regex、2 template、UUID instances、引用完整性问题），使 `backend/tests/integration/test_qa_v3_complex.py` 27 passed + E2E 30 passed。**注意：该 fixture 被 `.gitignore` 忽略（line 173 `/qa_test/`，与 qa_simple 一致的仓库惯例），仅存于本地磁盘。**

### P1 Alpha 质量门控（已合并 main）

| 提交 | 内容 |
|---|---|
| `10c42e4` | 删除 `switchScope` 死代码（保留 `getSubGraphStats`） |
| `c76977d` | 删除 `handleCopy` 桩（节点复制已由 clipboard 模块覆盖） |
| `d53a48b` | 删除 `dataSourceBinding/` 死代码目录 + 桩测试（已完成重构的注释残留） |
| `84b346c` | `canvasTabStore` 的 `prompt()` 死分支删除 |
| `dc7f74d` | CSS `:deep()` 全局误用修复（仅 theme-liquid.css 2 处） |
| `860832a` | **expressionStore 接真实 Pattern API**（后端补 list/put/delete 端点 + 前端 diff 同步） |
| `2e05fae` | mypy 接入 CI（检查 cli/core/domain/services） |
| `ca79af8` | ESLint any 债务记录 |

### 重要修正（对比最初评估简报）

执行中发现原评估有 3 处偏差，后续 Agent 须知：

1. **mypy 债务被低估**：原简报说"忽略即可恢复"，实际 `app.shared`(264 处) + `app.api`(253 处) = **517 处真实类型错误**，需专项清理。
2. **ESLint any 规模**：~376 处 any（96 文件 `:any` + 31 文件 `as any`），分布 127 文件，需专项清理。
3. **CSS `:deep()` 是误报**：原简报说"9 文件 55 处滥用"，实际 8 个是 `<style scoped src>` 引入（`:deep()` 穿透 Vue Flow 子节点是正确用法），仅 `theme-liquid.css`（全局）的 2 处真误用——**已修复**。

---

## 二、剩余工作

### 批次 A：P1 收尾 — 类型严格化专项（~1 周）

这是两个关联紧密的债务清理，建议合并为一个专项批次，**分目录逐步推进**（不要一次性全开，会 CI 全红）。

#### A1. mypy 类型修复（517 处错误）

**目标：** 移除 `backend/pyproject.toml` 的两个 `ignore_errors` override，让 `app.shared`/`app/api` 通过 mypy。

**当前 override 位置：** `backend/pyproject.toml` line 169-179（已有注释说明债务）。

**分批策略：** 按子目录逐个修，每修一个跑 `python -m mypy <子目录> --config-file=/dev/null --ignore-missing-imports --explicit-package-bases` 确认。优先级（按错误密度推断）：
1. `app/shared/services/`（校验/AI/preview 服务）
2. `app/shared/core/`（数据源/manifest/模板加载）
3. `app/api/routers/`（各路由）
4. `app/api/services/`、`app/api/models/`

**常见错误类型（已抽样）：**
- `yaml` 无类型 stub → `pip install types-Pyaml`（dev deps）可消 ~14 处
- 可选 import 哨兵 `X = None` → 改 `Optional[type]` 或 `cast`
- Pydantic 构造 `# type: ignore[call-arg]` → 显式 kwargs 或启用 pydantic mypy 插件

**完成后：** 删除 pyproject.toml 的两个 override 块，CI 已有的 `mypy app` step 自动覆盖。

#### A2. ESLint any 清理（376 处）

**目标：** 将 `frontend/eslint.config.ts` 的 `'@typescript-eslint/no-explicit-any': 'off'` 改为 `'error'`。

**当前配置：** `frontend/eslint.config.ts` line 18-28（已有注释记录规模）。

**清理手法：**
- `: any` → 定义正确 interface 或用 `unknown` + 类型守卫
- `as any` → 用 `as ExpectedType` 或修复根因
- 确实无法避免的，加 `// eslint-disable-next-line @typescript-eslint/no-explicit-any` 注明原因

**按目录推进：** 研究显示高密度文件——`useNodeSourceManager.ts`(21)、`useSchemaSourceManager.ts`(10)、`bindDataSource.ts`(9 `as any`)、`constraintExportAdapter.ts`(8)、`columnGeneration.ts`(8)、`useForeignKeyConnection.ts`(8)。

#### A3. tsconfig noImplicitAny（依赖 A2）

**目标：** `frontend/tsconfig.app.json` line 25 `"noImplicitAny": false` → `true`，同时 line 30 `"noImplicitThis": false` → `true`。

**必须在 A2 完成后做**，否则 type-check 全红。修完后跑 `npm run type-check` 补注解新暴露的隐式 any 参数。

---

### 批次 B：P2 Beta 交付 — Electron 生产化（~4-5 天代码 + 证书采购）

计划详情见 `docs/superpowers/plans/2026-06-21-p2-beta-delivery.md`。以下为精简执行清单。

#### B1. Electron 内嵌 Python 运行时（方案 A1，~2 天）⭐ 最高优先级

**问题：** 当前 `electron/src/main.ts:410` 依赖系统 Python，用户必须手动装 Python 3.12+ 并 `pip install`。

**方案：** python-build-standalone（不用 PyInstaller——FastAPI import 面太大，hidden-import 脆弱）。

**改动：**
1. 新建 `electron/scripts/fetch-python.js` — 下载 python-build-standalone（win-x64/macos-arm64/macos-x64/linux-x64）到 `resources/python-runtime/`
2. `electron/package.json` `build.extraResources` 加 `runtime` 条目；scripts 加 `fetch-python` + `install:backend-deps`
3. `electron/src/main.ts:410` 改 `pythonExecutable` 解析：`app.isPackaged` 时指向 `process.resourcesPath/backend/runtime/bin/python`
4. `electron/scripts/build.ps1` 和 `build-mac.sh` 的 dist/release target 前加 fetch+install
5. 更新 `electron/README.md`（方案 B 弃用，方案 A 当前）

**依赖：** `backend/requirements.txt` 已有 pinned freeze。实测需确认 python-build-standalone 目录结构（Win: `python/python.exe`，Mac/Linux: `bin/python3`）。

#### B2. 代码签名（~1 天代码 + 外部证书采购）⚠️ 阻塞项

**当前禁用：** `electron/package.json:98` `signAndEditExecutable: false`；CI `ci.yml:299-300` `CSC_IDENTITY_AUTO_DISCOVERY: false` + `--config.mac.identity=null`。

**需要外部采购（组织流程，非代码）：**
- Windows OV code signing cert（.pfx）
- macOS Developer ID Application（.p12）+ App Store Connect notarization 凭证

**代码改动（证书到位后）：**
1. `electron/package.json` win 块删 `signAndEditExecutable: false`
2. mac 块加 `hardenedRuntime: true`、`entitlements: build/entitlements.mac.plist`、`notarize: {teamId}`
3. 新建 `electron/build/entitlements.mac.plist`（标准 Electron 公证 entitlements）
4. GitHub Secrets 添加：`CSC_LINK`/`CSC_KEY_PASSWORD`（Win）、`MAC_CSC_LINK`/`MAC_CSC_KEY_PASSWORD`/`APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID`、`GH_TOKEN`

#### B3. CD 发布 Electron + 自动更新（~1 天，依赖 B1+B2）

**关键事实：** 自动更新**客户端已就绪**——`electron-updater ^6.3.9` 已装、`package.json:85-89` `publish: {provider: github}` 已配、`main.ts:1492` 调 `checkForUpdatesIfAutoEnabled`。**只差 CD 执行 `--publish=always` 生成 `latest.yml` feed**。

**改动：** `.github/workflows/cd.yml` 新增 `build-electron` matrix job（win + macos-arm64 + macos-x64），每个跑 `npx electron-builder --<platform> --publish always`；`release.needs` 加 `build-electron`。

#### B4. 跨平台打包脚本（~0.5 天）

**问题：** `npm run dist` 只调 `build.ps1`（PowerShell）。`build-mac.sh` 存在但未挂 npm script。

**改动：** 根 `package.json` 加 `"dist:win"` 和 `"dist:mac": "bash scripts/build-mac.sh"`；`build-mac.sh` 若留在 `electron/scripts/` 需加 `cd "$(dirname "$0")/../.."` 前缀。

#### B5. 收敛 Electron 84 处 console.*（~0.5 天）

**分布：** `main.ts`(70) + `update.ts`(13) + `preload.ts`(1)，无 logger 模块。

**改动：** 复制 `frontend/src/core/utils/logger.ts` 到 `electron/src/logger.ts`，把 `import.meta.env.DEV` 换成 `app.isPackaged`（生产抑制 debug）。替换 60 个 `console.log`→`logger.debug/info`，24 个 `console.error`→`logger.error`。

#### B6. 收敛后端 21 处 type: ignore（~0.5 天，依赖 A1）

**分布：** 19 文件 21 处（`tests/unit/test_config_inspector.py` 8 处、`providers/openai.py` 3 处、其余各 1）。

**手法：** 装 `types-Pyaml` 消 yaml stub 类（~14 处）；可选 import 哨兵改 `Optional`；测试 Pydantic 构造改显式 kwargs。

#### B7. 配置安全提示（~0.5 天）

**缺提示的位置：**
- `config/ai_providers.example.yaml` — 用 `${ENV}` 间接引用但**无安全说明**（顶部加注释块）
- `backend/app/shared/core/reporter/reporter.py:221-240` — wecom/feishu/dingtalk 块**无提示**（email 块 line 205-206 已有 1 条通用告警，照此补齐 IM）
- `.env.example` — 仅注释掉的 key，加警告

---

## 三、执行建议

### 优先级矩阵

| 目标 | 做什么 | 阻塞项 |
|---|---|---|
| **尽快解决用户安装痛点** | B1（内嵌 Python） | 无，可立即开始 |
| **提升 CI 质量基线** | A1→A2→A3（类型专项） | 无 |
| **对外发布稳定桌面版** | B2→B3（签名+发布） | ⚠️ 需采购证书 |
| **生产化清理** | B5、B6、B7 | B6 依赖 A1 |

### 推荐执行顺序

1. **B1（内嵌 Python）** — 最高性价比，解决最大用户痛点，无外部依赖
2. **A1（mypy）→ A2（ESLint）→ A3（tsconfig）** — 类型严格化专项，让 CI 真正严格
3. **B4、B5、B7** — 独立清理项，无依赖
4. **B2（签名）→ B3（CD 发布）** — 证书采购到位后做
5. **B6（type:ignore）** — A1 完成后顺手做

### 关键注意事项给后续 Agent

1. **测试命令：** 后端 `cd backend && python -m pytest`；前端 `cd frontend && npm run test`；E2E 需先 `npm run backend:dev` 再 `cd e2e && npx playwright test`；lint `npm run lint:all`
2. **分支策略：** 从 main 建 feature 分支，完成后合并。当前 main 领先 origin 16 提交，需 `git push` 同步
3. **qa_test 不入库：** `.gitignore` line 173 忽略整个 `/qa_test/`。E2E + test_qa_v3_complex.py 依赖本地 fixture。CI 上要跑需另行生成 fixture 或开 gitignore 例外
4. **Vue Flow 规范：** 修改画布 DAG 必读 `AGENTS.md` 的"Vue Flow DAG 操作规范"——增量走 API（addNodes/removeEdges），全量走数组替换，`await nextTick()` 后才建边
5. **TDD：** 后端 pytest，前端纯逻辑模块 vitest，UI/composable 由 E2E 覆盖。详见 `AGENTS.md` Testing Strategy
6. **预提交钩子：** Husky 自动跑 lint-staged + ruff，修改会被自动 format
7. **原简报不可全信：** 本文档"重要修正"部分已标注 3 处偏差。若看到旧的评估简报提及 mypy"忽略即恢复"或 CSS"9 文件滥用"，以本文档为准

### 参考文档

- 完整 P2 计划：`docs/superpowers/plans/2026-06-21-p2-beta-delivery.md`（含代码示例与确切行号）
- P0/P1 计划：`docs/superpowers/plans/2026-06-21-p0-pre-alpha-closure.md`、`2026-06-21-p1-alpha-quality-gates.md`（已完成部分可作参考）
- 架构指南：`AGENTS.md`（必读）
