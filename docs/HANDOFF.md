# Precis 项目交接文档

> **交接日期：** 2026-06-22
> **接收方：** 后续 Agent
> **项目阶段：** Pre-Alpha 收尾，距离 Alpha 仅剩文档 + 安全审计 + 代码签名

---

## 一、当前状态总览

### 测试基线（全部通过）
- 后端 pytest：**2476 passed + 1 skipped**
- 前端 vitest：**1365 passed**
- E2E（full-lifecycle.spec.ts）：30 passed
- CI 全绿（lint / type-check / mypy / coverage / build / E2E）

### 已完成的核心工作（无需再做）

| 领域 | 完成项 |
|---|---|
| **功能闭环** | JSON 预览、单文件校验、Web 新建项目、模板参数化展开（`{{param}}` 替换 + load_project 实例展开） |
| **类型安全** | mypy 全量通过（`app/shared` 255 文件 + `app/api` 74 文件 0 错误，override 已移除）；ESLint `no-explicit-any: 'error'`（源码 0 处 any）；tsconfig `noImplicitAny: true` + `noImplicitThis: true` |
| **Electron 生产化** | 内嵌 python-build-standalone（`fetch-python.js` + `resolvePythonExecutable`）；`console.*` 从 84 处收敛到 5 处；跨平台脚本 `dist:win`/`dist:mac`/`dist:cross` |
| **债务清理** | 删除 3 处死代码（switchScope / handleCopy / dataSourceBinding）；expressionStore 接真实 Pattern API；CSS `:deep()` 全局误用修复；`type: ignore` 从 21 处降到 1 处（windll 平台豁免）；配置安全提示已补全 |

---

## 二、剩余任务清单

### 任务 1：用户文档（~3-5 天，低复杂度）

**目标：** 让外部用户能上手使用 Precis。

**需要产出：**
1. `docs/README.md` 或 `docs/user-guide.md` — 安装（Electron / CLI / Web 三种模式）、快速上手、核心概念（Schema / Constraint / Transform / Template）
2. `docs/configuration-reference.md` — V2 YAML 格式详解：
   - `project.precis.yaml` manifest 结构
   - `schemas/*.schema.yaml`（columns、内嵌 constraints、source）
   - `constraints/*.constraint.yaml`（10 种约束类型：NotNull / Unique / ForeignKey / AllowedValues / Range / Conditional / Scripted / Charset / DateLogic / Composite）
   - `transforms/*.transform.yaml`（22 种转换算子）
   - `templates/*.template.yaml`（parameters + `{{param}}` 占位符）
   - `regex/*.regex.yaml`、`patterns/*.yaml`
3. `docs/cli-reference.md` — CLI 命令清单（基于 `app/cli/`）

**信息源：**
- `AGENTS.md` 的架构章节（有零散摘要，需整合扩展）
- `backend/app/shared/core/project/` 下的类型定义（Pydantic 模型即格式规范）
- `backend/app/shared/domain/constraints/` 下的各约束类型（10 种约束的字段）
- `qa_test/qa_v3_complex/` 是完整可参考的示例项目

**注意：** 文档写作，无需改代码。建议先跑一遍应用理解用户流程。

---

### 任务 2：CD 发布 Electron + 自动更新（~1 天，低复杂度但有隐性依赖）

**现状：**
- 自动更新**客户端已就绪**：`electron-updater ^6.3.9` 已装、`package.json:89` `publish: {provider: github}` 已配、`main.ts` 调 `checkForUpdatesIfAutoEnabled`
- 缺的是 `.github/workflows/cd.yml` 没有 electron publish job（目前只有 `build-cli` + `release` 两个 job）

**需要做：**
1. 在 `cd.yml` 新增 `build-electron` matrix job（`windows-latest` + `macos-latest` + `macos-13`），每个跑 `npx electron-builder --<platform> --publish always`
2. `release` job 的 `needs` 加 `build-electron`
3. 加 GitHub Secrets：`GH_TOKEN`（electron-builder 需要 PAT）

**⚠️ 隐性陷阱（重要）：**
- **`electron-updater` 在 Windows 默认校验签名**。当前未签名（`signAndEditExecutable: false`），如果此时发布，**自动更新会失败**。两个选择：
  - **(A) 等代码签名做完再发布**（推荐，避免发布未签名包给用户）
  - **(B) 现在发布但关闭自动更新签名校验**：在 `electron-updater` 配置加 `disableDifferentialDownload: true` 或在更新逻辑捕获签名错误。但这会让安全更新保证消失。
- **用户安装体验**：未签名包发布到 GitHub release，用户下载后撞 SmartScreen（Windows）/ Gatekeeper（macOS）警告。对内测可接受，对外部用户转化率极低。

**建议：** 与任务 6（代码签名）一起做，不要孤立推进。

---

### 任务 3：Scripted 约束沙箱验证（~1-2 天，中等复杂度）

**现状：** `settings.script_security.allow_eval: true` 时，后端用 `simpleeval==1.0.7` 执行表达式（见 `backend/app/shared/domain/constraints/scripted.py`）。`simpleeval` 有**已知绕过手法**——通过 Python 内省链访问危险类型：
```python
().__class__.__bases__[0].__subclasses__()  # 枚举所有类，找 file/os 等
```

**需要做：**
1. 审查 `simpleeval` 的 `EvalWithCompoundTypes` / `SimpleEval` 配置，确认 `names` / `functions` 白名单是否严格
2. 构造攻击 payload 测试沙箱：
   - 内省链绕过（`__class__.__bases__...`）
   - 导入绕过（`__import__('os').system(...)`）
   - 属性访问（`.``、`getattr`）
   - 列表推导 / lambda 滥用
3. 若有绕过，加固（收紧白名单、禁用 `__` 双下划线属性访问、考虑换更严格的沙箱如 `RestrictedPython`）
4. 补测试：`backend/tests/unit/test_scripted_sandbox.py`，覆盖所有攻击向量

**信息源：** `backend/app/shared/domain/constraints/scripted.py`、`simpleeval` 文档（https://github.com/danthedeckie/simpleeval）

---

### 任务 4：安全审计（~2-3 天，中等复杂度）

**目标：** 系统审查所有用户输入入口的注入风险。

**审查清单：**
1. **路径遍历**：所有接受文件路径的 API。已知薄弱点——P0 我做的 `single_file` 校验（`validation.py` 的 `_resolve_table_filter_from_file_path`）用 `os.path.normpath` 但**未拒绝 `../` 越界**，绝对路径如 `C:\Windows\...` 也被接受。local-first 应用风险低，但应加项目根目录边界检查（参考 `backend/app/api/routers/project/helpers.py` 的 `_resolve_project_path`）
2. **命令注入**：Scripted 约束（见任务 3）、任何 `subprocess` / `os.system` 调用
3. **YAML 反序列化**：确认用的是 `yaml.safe_load`（不是 `yaml.load`）——搜索所有 `yaml.load`
4. **SQL 注入**：若用 SQLAlchemy，确认参数化查询
5. **XSS**：前端渲染用户输入（校验错误消息、schema 名等）是否转义
6. **依赖漏洞**：`cd backend && pip-audit`、`cd frontend && npm audit`

---

### 任务 5：前端测试覆盖提升（持续，低复杂度）

**现状：** lines 49.83% / branches 39.78% / functions 47.9% / stmts 49.05%（阈值 48/37/46/47，刚过线）。

**策略：** 按 `AGENTS.md` 规定，只对纯逻辑 `.ts` 模块写单测（services/ / utils/ / stores/graphStore/modules/ / api/）。UI/composable 由 E2E 覆盖。

**重点补测模块（按覆盖率收益）：**
- `frontend/src/services/constraints/` — 校验编排、节点数据构建
- `frontend/src/services/builders/` — V2 配置序列化
- `frontend/src/stores/graphStore/modules/factories/` — 工厂模块
- `frontend/src/utils/` — 纯工具函数

**测试规范见 `AGENTS.md` "测试编写规范"章节**（工厂函数、验证结果不验证过程、禁止 snapshot）。

---

### 任务 6：代码签名（~1 天代码，阻塞在证书采购）

**⚠️ 已暂缓** — 需先决策签名主体（个人 vs 公司）并采购证书，非纯技术问题。

**需要采购：**
- Windows：OV 代码签名证书（Sectigo / DigiCert，~$200-400/年）
- macOS：Apple Developer ID Application（$99/年）+ 公证凭证

**代码改动（证书到位后，~1 天）：**
1. `electron/package.json` win 块删 `signAndEditExecutable: false`
2. mac 块加 `hardenedRuntime: true`、`entitlements`、`notarize: {teamId}`
3. 新建 `electron/build/entitlements.mac.plist`
4. GitHub Secrets 添加 `CSC_LINK` / `CSC_KEY_PASSWORD` / `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`

**做完签名后，任务 2（CD 发布）才能无障碍推进。**

---

## 三、优先级建议

| 顺序 | 任务 | 理由 |
|---|---|---|
| 1 | 任务 1（文档） | Alpha 前必须，让用户能上手；纯写作无风险 |
| 2 | 任务 4（安全审计）+ 任务 3（沙箱） | 对外发布前必须，涉及用户数据安全 |
| 3 | 任务 5（测试覆盖） | 持续提升质量基线，可与上述并行 |
| 4 | 任务 6（签名）→ 任务 2（CD 发布） | 需证书采购，到货后顺序推进 |

---

## 四、开发环境速查

### 常用命令

```bash
# 开发
npm run dev                   # 同时启动后端 + 前端
npm run electron:dev          # Electron 桌面版

# 测试
cd backend && python -m pytest -q              # 后端单测（2476）
cd frontend && npm run test                    # 前端单测（1365）
cd frontend && npm run test -- --coverage      # 前端 + 覆盖率
cd e2e && npx playwright test flows/full-lifecycle.spec.ts  # E2E（需后端运行）

# 质量门
cd backend && python -m mypy app               # 后端类型检查
cd frontend && npm run type-check              # 前端类型检查
npm run lint:all                              # 前后端 lint 全量

# Electron 打包
npm run dist:win                              # Windows NSIS
npm run dist:mac                              # macOS DMG
```

### 关键约定（详见 `AGENTS.md`）

1. **Vue Flow DAG 操作**：增量走 `vueFlowApi`（addNodes/removeEdges），全量走数组替换，建边前 `await nextTick()`。**禁止** `nodes.value.push()`
2. **测试策略**：前端 E2E-first（UI/composable 由 E2E 覆盖），后端 pytest。纯逻辑 `.ts` 才写 vitest 单测
3. **TDD**：先写失败测试，再实现，最后提交
4. **分支策略**：从 `main` 建 feature 分支，完成后合并
5. **预提交钩子**：Husky 自动跑 lint-staged + ruff，修改会被自动 format
6. **`qa_test/`**：除 `qa_v3_complex/`（CI 必需 fixture，已入库）外，本地测试数据不入库
7. **约束三层命名映射**：ConstraintKind（业务）↔ ConstraintNodeType（Vue Flow）↔ V2Type（后端 API）必须一致

### 项目状态文件
- 架构指南：`AGENTS.md`（**必读**）
- 本文档：`docs/HANDOFF.md`
