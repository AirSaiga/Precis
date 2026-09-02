# AGENTS.md

This file provides guidance to Qoder (qoder.com) when working with code in this repository.

> **项目状态**: Alpha 阶段。核心功能已实现，API 与配置格式可能调整。修改代码时需保证正确性并维护测试；应结合具体业务场景，必要时进行合理重构以保持代码健康。
>
> **本文档定位**：只收录**稳定的架构原则、约定、命令与陷阱**（重构不会使其失效的内容，也不重复记录代码/配置中可查的数值）。文件清单、行数表、调用图、ID 方案等易漂移实现细节见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)（以代码为准，可能漂移）。

---

## Build & Run Commands

```bash
npm run install:all                     # 全部依赖（root + frontend + electron）
cd backend && pip install -e ".[dev]"   # 后端开发依赖（ruff/pytest/mypy）
cd e2e && npm ci                        # E2E 依赖

npm run dev                             # 后端 + 前端（concurrently）
npm run electron:dev                    # Electron 桌面版（自动管理后端进程）
npm run backend:dev                     # 仅后端 FastAPI（端口 OS 动态分配）
cd frontend && npm run dev              # 仅前端 Vite dev server

npm run build:all                       # 后端（可编辑安装）+ 前端 + Electron 打包
npm run frontend:build                  # 前端构建（含 type-check）
npm run backend:build                   # 后端可编辑包安装

npm run lint:all                        # 前端 lint + 后端 ruff check
npm run format:all                      # 前端 format + 后端 ruff format + fix
npm run cli:validate                    # CLI 校验测试套件
```

分项检查与测试：

```bash
# 前端
cd frontend && npm run lint | type-check | format | test | test:watch
# 后端
cd backend && python -m ruff check [--fix] . | python -m ruff format . | python -m pytest
# E2E（Playwright + Chromium，需后端运行）
cd e2e && npx playwright test
```

> **端口策略**：后端端口默认由 OS 动态分配（`start_server.py --port 0`），实际端口写入 `backend/.backend-port`，Vite 代理（`dynamic-backend-proxy.ts` 插件）与 Electron 主进程自动读取该文件发现端口，无需手动配置。如需固定端口，在 `.env` 设置 `VITE_BACKEND_PORT`。

---

## Tech Stack

| 层级 | 技术 |
|------|------|
| 前端 | Vue 3 + TypeScript + Vite + Pinia + Vue Router + Vue I18n + Vue Flow |
| 后端 | Python + FastAPI + Uvicorn + Pydantic + Pandas |
| 桌面端 | Electron + electron-builder + TypeScript（sandbox: true） |
| TUI（终端 UI） | Rust + ratatui + crossterm + tokio + reqwest（`tui-rust/`，HTTP 调 Python 后端，独立于 Electron/前端） |
| E2E 测试 | Playwright + Chromium |
| 代码质量 | 前端 ESLint + Prettier + lint-staged + Husky；后端 Ruff（lint + format + import 排序） |

**运行环境要求**: Node.js `^20.19.0 || >=22.12.0`，Python `>=3.12,<3.14`，Rust（stable，仅构建 TUI 时需要）

---

## Architecture

> 本节只讲**稳定的架构原则与不变约定**。具体目录结构、文件清单、调用图见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

### 后端三层分离（backend/app/shared/）

```
shared/
├── core/       # 框架级基础设施 — 文件 I/O、配置解析、数据加载
├── domain/     # 纯业务领域逻辑 — 数据类型、约束、表达式求值（无 I/O 依赖）
└── services/   # 应用服务 — 编排 core 和 domain 实现用例（校验、AI、预览）
```

- `domain/` 不得导入 `core/` 或 `services/`，保持纯净
- API 路由在 `backend/app/api/routers/`，请求/响应模型在 `backend/app/api/models/`，路由注册入口 `backend/app/api/main.py`
- 校验引擎两阶段流水线（数据加载与预处理 → 约束校验），大文件分块加载（>500MB 阈值）

### 前端 GraphStore（God Store + 工厂模块 + 拆分 setup）

graphStore 是画布的核心状态管理，**Pinia Setup Store + 工厂模块拆分**模式。核心约定：

- 模块工厂通过参数接收 `nodes`, `edges` 等响应式引用（依赖注入），**不直接导入 store**
- `setup/assembly.ts` 将所有模块导出聚合为一个扁平对象
- `updateNodeData()` 是修改节点数据的唯一途径：`nodes.value = updateNodeDataInArray(nodes.value, nodeId, newData)`
- `createXxxModule` 工厂按 V2 导入 / 持久化 / 连接 / 节点工厂 / 模板展开 / 剪贴板 / 历史 等职责拆分（完整清单见 ARCHITECTURE.md）

### 前端能力抽象层（Electron/Web 解耦）

所有与环境（Electron / Web）相关的底层能力，统一封装在 `frontend/src/core/capabilities/`：

- 业务组件/组合式函数**禁止**直接访问 `window.electronAPI` 或调用 `isElectron()`
- UI 层通过能力探测属性（如 `shellApi.canOpenLocalFile`）控制按钮显隐/禁用
- 能力层内部保留 Electron 适配器走 `window.electronAPI` IPC；preload / 主进程代码不变
- 详细设计与能力清单见 `frontend/src/core/capabilities/README.md` 与 ARCHITECTURE.md

### 前端事件总线

应用级事件通过 `core/eventBus.ts`（mitt，`AppEvents` 接口）通信。DOM 物理事件（mousemove/mouseup 拖拽、keydown 快捷键）保留 `window.addEventListener`，不迁移到事件总线。

### 前端 Store 接口解耦

`types/storeInterfaces.ts` 定义 `GraphStoreLike` 和 `ProjectStoreLike` 最小公共接口，用于跨 store 类型引用，避免直接导入。

### 前端节点类型系统

画布节点类型定义在 `frontend/src/types/graph.ts` 和 `frontend/src/types/nodes.ts`。`CustomNode = Node<CustomNodeData>`，`CustomNodeData` 是按 `type` 字段区分的 discriminated union。节点类别：项目（`projectRoot`）、Schema（`schema`/`jsonSchema`）、数据源（`sourcePreview`/`jsonSourcePreview`）、转换（`transform`/`transformOutput`）、手动数据（`manualData`）、正则（`regex`）、模板实例（`templateInstance`）、约束（10 种 `*Constraint` 节点）。

**约束三层命名映射**（新增约束类型时三处必须一致）：ConstraintKind / ConstraintNodeType / V2Type 的映射**单一事实源**是 `services/constraints/constraintMeta.ts` 的 `CONSTRAINT_TYPES`。

### 前端约束系统（双注册表模式）

| 注册表 | 文件 | 用途 |
|--------|------|------|
| **NodeDataBuilder** | `services/constraints/nodeDataBuilder/registry.ts` | 构建约束节点数据（import/embedded/connect 三种模式） |
| **ValidationRegistry** | `services/constraints/validationRegistryCore.ts`（barrel，已拆分 `constraintMeta.ts`/`handlerRegistry.ts`/`validationExecutors.ts` 等子模块） | 执行约束校验 |

**自注册机制**：每个 builder/handler 文件在模块级调用 `registerBuilder()` 或 `register()`，经 barrel 文件的 side-effect import 触发注册。

**校验编排入口** `services/constraints/orchestration/globalValidation.ts`：全表 `validateAllConstraints`、非阻塞 `triggerValidationForNode`、单约束即时 `dispatchValidation`；实际执行委托 `validationRegistryCore.ts` 的 `validateConstraintNode`；`validationCollector.ts` 负责数据源信息收集。

### 前端 API 层

V2 API 调用层在 `frontend/src/api/projectV2Api/`（目录，barrel 入口 `index.ts`），Axios（`core/services/httpClient.ts`）。所有请求通过 `X-Project-Config-Path` header 标识当前项目；`ProjectNotFoundError` 用于区分"项目未找到"和服务器错误。

### 前端应用启动流程

`composables/useAppBootstrap.ts` 编排：`bootstrapProjectPaths()`（从 Electron IPC 或 localStorage 恢复配置路径 → `getV2FullConfig()` 验证 → 创建 projectRoot 节点）→ `workspaceStore.initialize()` → `canvasStore.initialize()`（多标签画布）→ `dragStore.initializeDragState()`（资源树→画布拖拽）→ 启动键盘快捷键系统。

**资源树**由三个 Pinia store 协作：`resourceTreeStore`（资源映射与分组）、`resourceFolderStore`（展开折叠状态）、`resourceSearchStore`（搜索过滤）。

### Electron 集成

主进程 `electron/src/main.ts` 负责：

1. 动态分配端口启动 Python 后端子进程（`uvicorn`）；打包模式生成一次性随机 token 经 `PRECIS_API_TOKEN` 注入后端、经 IPC 仅下发本应用渲染进程，请求携带 `X-Precis-Auth` 头才放行 `Origin: null` 跨域（见后端 `api/middleware/token_auth.py`）
2. 健康检查（TCP + HTTP 轮询）
3. 创建 BrowserWindow 加载前端（sandbox: true, nodeIntegration: false, contextIsolation: true）
4. `preload.ts` 暴露 `window.electronAPI.*`（文件系统、对话框、配置等 IPC）
5. 生产模式自定义 `app://` 协议，不使用 `webSecurity: false`
6. 开发/生产判定：未打包且存在 `frontend/dist/index.html` 视为生产模式（自启后端 + 加载静态产物）；`PRECIS_FORCE_DEV=1`（`start-dev.bat`/`start-electron.bat` 注入）强制开发模式（等外部后端 + Vite dev server）；开发模式路径解析相对 `electron/dist` 上溯两级到项目根（`utils/paths.ts`）

### E2E 测试

`e2e/` Playwright E2E，独立 `package.json` 与 `playwright.config.ts`。spec 清单见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

---

## Testing Strategy

前端 **E2E-first**，后端 pytest 单元测试。

| 层 | 工具 | 覆盖范围 |
|----|------|---------|
| 前端单元测试 | vitest | 仅纯逻辑 `.ts` 模块（无 Vue/Pinia/Vue Flow 依赖） |
| 前端 E2E 测试 | Playwright | 所有 UI 交互、composables、`.vue` 组件、跨层集成流程 |
| 后端单元测试 | pytest | 全部后端代码，`--cov-fail-under` 门控 |

**vitest 应测**（纯逻辑）：`services/rules/`（连接规则）、`services/constraints/`（注册表/校验编排/节点数据构建/导出适配）、`services/builders/`（V2 序列化）、`services/canvas/`（连接策略）、`stores/graphStore/modules/`（工厂闭包，参数注入依赖）、`utils/`、`api/`（mock HTTP）、`core/`（httpClient、logger 等）。

**vitest 不测**（E2E 覆盖）：`composables/`（依赖 Pinia/Vue 响应式/Vue Flow hooks 运行时环境）、`.vue` 组件、`features/`（components + composables + types 整体由 E2E 验证）。

**覆盖率**：vitest 覆盖率（`vite.config.ts`）仅统计 `src/**/*.ts`，显式排除 `composables/**`、`features/**`、`components/**`、`**/index.ts`、`types/**`、`*.d.ts`、测试文件与 `main.ts`（`.vue` 由 E2E 覆盖）；阈值以 `vite.config.ts` 为准，应反映纯逻辑模块实际覆盖水平，不因排除 UI 层而失真。

**E2E 职责**：E2E 是前端功能正确性的**主验证手段**——用户操作完整路径（导入 → 编辑 → 校验 → 保存 roundtrip）、composable 与组件集成、前端 ↔ 后端 API 交互、Electron 特有行为。新增功能优先补 E2E；纯逻辑提取为独立函数后才考虑补单测。

**后端**：pytest + 覆盖率报告，新增后端功能必须附带单元测试。

---

## 测试编写规范

核心原则：**测行为，不测实现**——验证输入→输出映射、状态变化、副作用；不验证内部是否调用私有方法、不 mock 非必要的内部依赖。

### 前端单元测试规范（vitest）

1. **工厂模块测试**只 mock 被测模块的边界（如 `vueFlowApi` 是外部边界），依赖注入参数用最小真实数据；**禁止** mock 被测模块内部调用的其他工厂：

   ```typescript
   // ✅ mock 边界 + 注入真实最小依赖
   vi.mock('@/services/canvas/vueFlowApi', () => ({ addNodes: vi.fn(), addEdges: vi.fn() }))
   const nodes = ref<CustomNode[]>([])
   const module = createXxxModule({ nodes, selectedNodeId: ref(null) })
   ```

2. **测试数据工厂**：mock 数据必须经 `make*` 工厂函数（如 `makeNode`、`makeEdge`）生成，禁止内联硬编码完整对象。
3. **断言验证最终状态**（`expect(nodes.value).toHaveLength(2)`），不断言内部调用细节；例外：mock 外部边界时可验证调用次数/参数，但不断言 UUID 等随机值。
4. **测试隔离**：每个 `describe` 的 `beforeEach` 重新初始化所有状态，禁止跨 describe 共享可变状态。
5. **禁止 snapshot 测试**：用精确字段断言替代 `toMatchSnapshot()`。
6. **文件组织**：测试路径**镜像源文件路径**（`src/services/rules/` → `tests/services/rules/`）。

### 后端测试规范（pytest）

- **fixture 优先**：可复用数据用 `@pytest.fixture`，不逐函数重复构造
- **mock 边界不 mock 内部**：`monkeypatch.setattr(os.path, "exists", ...)` 好；patch 模块内部 `_internal_helper` 坏
- **命名描述行为**：`test_save_manifest_excludes_none_values` 好于 `test_function_calls_write_yaml`

### 重构时的测试维护规则

| 场景 | 做法 |
|------|------|
| 修改函数签名（增减参数） | 更新测试中的工厂函数和调用参数，不删除测试 |
| 重命名函数/变量 | 全局替换即可，不影响测试逻辑 |
| 重构内部实现（不改外部行为） | 测试不应需要修改；如果需要，说明测试耦合了实现 |
| 新增约束类型 | 注册表完整性测试自动覆盖（如 `CONSTRAINT_TYPES.length`） |
| 修改节点 data 结构 | 更新 `makeNode` 等工厂函数，不逐个修改测试用例 |
| 修改 API 请求/响应格式 | 更新 API 层测试的 fixture，不修改业务逻辑测试 |

---

## Coding Standards

### Python 后端

- **Ruff 配置**: `backend/pyproject.toml` — `line-length = 120`, `quote-style = "double"`, 规则 `E/F/I/N/W/UP`（忽略 `E501`, `E402`, `N815`）
- **导入顺序**: 标准库 → 第三方库 → 项目内部（`from __future__ import annotations` 放最前）
- **命名**: 类 PascalCase，函数/方法 snake_case，常量 UPPER_SNAKE_CASE
- **类型注解必须使用**（延迟注解支持）；**中文注释**，复杂逻辑必须加行内注释

### TypeScript/Vue 前端

- **组件语法**: `<script setup lang="ts">` + Composition API
- **导入顺序**: 外部组件 → 类型 → 组合式函数/工具
- **命名**: 组件 PascalCase，组合式函数 `use*`，Store `use*Store`，常量 UPPER_SNAKE_CASE
- **Props 必须定义类型**（`interface Props` + `defineProps<Props>()`）；非 feature 专属共享类型放 `src/types/`
- **空值安全**: `strictNullChecks: true`，可能为 null/undefined 的值必须加空值守卫

### i18n 国际化

vue-i18n Composition API 模式（`legacy: false`），默认 `zh-CN`，回退 `en-US`。翻译文件按功能和节点类型拆分在 `frontend/src/i18n/locales/{zh-CN,en-US}/`。使用 `const { t } = useI18n()`。

---

## Critical Patterns & Pitfalls

### Vue Flow DAG 操作规范

Vue Flow 通过 `v-model:nodes` / `v-model:edges` 双向同步（prop 下传 + emit 回写），内部维护状态副本。**绕过 Vue Flow API 直接操作数组会导致内部状态与 store 不同步**（节点/边消失、事件丢失、竞态）。核心原则：**增量走 API，全量走数组替换**——所有 DAG 增删统一经 `services/canvas/vueFlowApi.ts` 注入层调用原生 API（该模块在 `NodeCanvas.vue` setup 中经 `initVueFlowApi(useVueFlow())` 注入，之后可在 Pinia store、composable 等任何地方使用）。

| 场景 | 正确方式 | 说明 |
|------|---------|------|
| 创建节点/边 | `addNodes([node])` / `addEdges(edge)` | 增量 push，触发 hooks，Vue Flow 正确 enrichment |
| 删除边/节点 | `removeEdges(edgeId)` / `removeNodes(nodeId)` | 触发 `onEdgesChange` → 清理链；removeNodes 自动删关联边 |
| 修改节点数据 | `updateNodeData(nodeId, patches)` | 统一入口，保持 saveState 同步 |
| 清空/重置/加载项目/undo-redo | `nodes.value = [...]` / `edges.value = [...]` | 全量替换走 `setNodes`/`setEdges`，不需 hooks；恢复/加载后须调 `reconcileAll()` |

**数组替换 vs API 的机制差异**：`addEdges`/`removeEdges` 走 `applyChanges` 增量 splice，**触发 hooks**，仅验证新操作的边；`edges.value = [...]` 走 `setEdges` 全量替换，**不触发 hooks**，所有边重新验证——且 `createGraphEdges` 对每条边 `findNode(edge.source)` 找不到就 `continue` **静默丢弃**（即使节点在 `edges.value` 里，只要 Vue Flow 内部 `state.nodes` 没有，边就消失）。

> **⚠️ 边陷阱勿外推到节点**：上述"静默丢弃"**仅适用于 `edges.value = [...]`（边的全量替换）**。节点全量替换 `nodes.value = [...]` 走 `createGraphNodes`，不会重验边、不会丢边，也不会重复建节点（`parseNode` 对同 id 做 `Object.assign` 去重，`addNodes` 的 add 分支也有 `findIndex(id)` 去重）。节点全量替换的真正代价只是冗余全量重建（性能）+ 不必要的 `setNodes` 副作用，非数据损坏。判断 Vue Flow 风险时务必区分操作的是节点数组还是边数组。

**禁止操作**：

| 操作 | 原因 |
|------|------|
| `nodes.value.push(...)` / `edges.value.push(...)` | pausable watcher 追踪 ref 值引用，push 不触发，Vue Flow 内部完全不知情 |
| `edges.value = edges.value.filter(...)` 删边 | 绕过 `onEdgesChange`，`handleEdgeRemoved` / `syncOnDisconnect` / `executeDisconnectCleanup` 均不执行 |
| 直接修改 `node.data` 属性 | 绕过 `updateNodeData` 统一入口，saveState 不同步 |
| 直接修改 `node.position` / `node.hidden` 等节点级属性 | 绕过 `vueFlowApi.updateNode()`，Vue Flow 内部 `state.nodes` 不同步——store ref 变了但渲染/DOM 不变。必须用 `updateNode(id, { position })` 或经 `updateNodeData(id, { hidden })`（后者在 `state.ts` 被路由为 node 级 patch） |
| `addNodes(node)` 后立刻 `nodes.value = [...nodes.value, node]`"手动同步" | 冗余的全量 `setNodes` 重建；本 tick 内需要可见性的正确解法是 `await nextTick()` 再读（见下文幂等创建） |
| 同一边混合 API 与数组操作 | 如 `removeEdges` + filter 会导致 `onEdgesChange` 触发两次 |

#### 幂等创建节点（ensureXxx 模式）

`ensureSchemaNodeFromV2` 这类"先 `nodes.value.find` 判存在、不存在则创建"的幂等函数，要保证第二次调用能 `find` 到刚创建的节点：

```ts
const existing = nodes.value.find((n) => n.id === id)
if (existing) return existing
// ... 构造 node ...
addNodes(node)
await nextTick()          // ← 等 v-model model→store 回写，本 tick 后续 find 即可命中
return node
```

不要用"addNodes 后手动追加数组"来同步（见禁止操作表）。

#### 时序要求

- **创建节点后、创建边之前必须 `await nextTick()`** — 节点需渲染后才有 handleBounds（边路径计算依赖）
- **`reconcileAll()` 必须在 `nextTick` 之后调用** — 它从 edges 重建所有 parent/children/outputPortConnected 状态
- **`removeEdges` 同步触发 `onEdgesChange`** — 清理立即执行，"删旧边 → 设新数据"的顺序是安全的
- **store→model 同步有 nextTick 延迟** — Vue Flow 内部状态变更经 pausable watcher 在 `nextTick` 后才回写 v-model ref

#### 事件选择

- 用 `onEdgesChange` / `onNodesChange` 监听变化，不要 `watch(store.edges)` — v-model 双向绑定使 `watch` 频繁触发且难区分变化来源
- `onEdgesChange` 的 `remove` 事件由 `removeEdges` 同步触发；数组替换不会触发

#### 删除节点时的关联边清理

删除节点必须先清理关联边再删节点，保证清理链路（`handleEdgeRemoved` → `syncOnDisconnect` + `executeDisconnectCleanup`）被执行。`nodeOps.ts` 的 `deleteNode` 已采用正确实现：`collectCascadeNodeIds`（级联收集）→ 逐条 `removeEdges` → `removeNodes` → `nextTick(reconcileAll + onNodesRemoved)`。新增删除路径务必沿用此模式，**不要回退到直接替换 `nodes.value`/`edges.value` 数组**（绕过 `onEdgesChange`，清理不执行）。

**级联范围契约**：删除 Schema 节点时，`sourceRef` 引用该 schema 的约束节点随画布级联移除——仅移除画布节点，约束文件与 manifest 引用不动（重新导入即恢复）；无 `sourceRef` 的表级约束节点保留，其指向被删 schema 的连接边清零。

#### undo/redo 的状态恢复

`history.ts` 使用 `shallowRef` + `toRaw()` + 不可变栈操作，恢复时直接替换 `nodes.value` 和 `edges.value`（不触发 hooks），恢复后调用 `reconcileAll()` 重建连接状态。

### 键盘快捷键与 IME 组合输入

默认 locale `zh-CN`，用户普遍用拼音/日文/韩文 IME。**任何全局键盘监听都必须在合成状态下放行**，否则 IME 选词过程中派发的 `keydown`（尤其 `Backspace`/`Enter`/单字符键）会误触快捷键，造成误删节点、误发消息等数据丢失。

快捷键监听入口（`features/keyboard/listeners/keyboardListener.ts`）的 `handleKeydown` 必须在**所有匹配逻辑之前**加守卫：

```ts
// IME 合成中（拼音/日文/韩文选词阶段）一律放行，避免误触单键/Backspace 快捷键
if (event.isComposing || event.keyCode === 229) {
  return
}
```

> `isIgnoredElement`（判 input/textarea/contenteditable 聚焦）**不能**替代 IME 守卫——焦点在画布等非输入元素、但 IME 仍处于合成状态时（刚切到画布、选词未提交），输入守卫不会拦截。两个守卫缺一不可。

新增任何全局快捷键时，若涉及单字符键或 `Backspace`/`Delete`/`Enter`，务必确认监听器入口已含上述守卫。

### 画布选择模型一致性

应用维护两套选择状态：`selectedNodeId`（单选焦点，inspector 跟随）与 `selectedNodeIds`（多选集合），必须保持一致，否则 inspector/键盘/右键菜单读到的选择会打架：

- **点击空白画布必须清空选择**：`NodeCanvas.vue` 的 `<VueFlow>` 必须绑定 `@pane-click` → `store.clearSelection()`（同时清空两者）。缺失会导致"以为取消选中，实际 inspector 仍锁定旧节点，键盘 Delete 误删"
- **单击节点**同时更新 `selectedNodeId` 并重置 `selectedNodeIds = [id]`，不要绕过 `selection.ts` 的 `setSelection` 只改其一
- **`removeFromSelection`** 后若该节点恰好是 `selectedNodeId`，需一并清空单选焦点
- **删除节点**（`deleteNode`/`deleteNodes`）已在执行前清空选择，新增删除路径沿用

### Electron IPC 文件路径安全（XSS → 文件读写的纵深防御）

文件相关 IPC（`read-file`/`write-file`/`open-file`/`scan-directory`）由 renderer 经 `window.electronAPI.*` 调用，**一旦发生任意 XSS 即成为攻击面**，路径校验是纵深防御关键一层：

- **禁止用 `resolved !== path.normalize(input)` 这类"比较 resolve 结果"的写法判穿越**——绝对路径含 `..` 时 `path.resolve` 与 `path.normalize` 输出相同，比较恒真，校验形同虚设。正确做法是**根目录包含校验**：`path.resolve(input)` 后判断是否落在白名单根（`app.getPath('userData')`、当前项目 configDir 等）之下（`resolved === root || resolved.startsWith(root + path.sep)`）
- **`write-file` 等可写操作必须比可读更严**（写入还能 `mkdirSync({recursive:true})` 创造路径），建议落到白名单根下
- **`open-file`（`shell.openPath`）必须限定扩展名**（数据文件 `.csv/.xlsx/.json/.yaml/...`），拒绝可执行/脚本（`.exe/.bat/.ps1/.scr/.cmd` 等）——否则配合写原语可形成 RCE 链
- **`scan-directory` 必须限定根目录**、不跟随顶层符号链接（`fs.lstatSync`）、设递归深度上限
- renderer 可传任意字符串的文件路径都视为不可信；路径优先取自原生 `dialog.showOpenDialog` 返回值，而非 renderer 自由构造的字符串

### 事件监听器与 watcher 的清理（资源泄漏纪律）

每个 `eventBus.on` / `window.addEventListener` / `useEventBus` 订阅都必须有对应的 `off` / `removeEventListener`，且**必须在组件/组合式函数销毁时无条件清理**——不能只在"正常完成回调"里清理（异步未完成就被卸载时回调永不触发 → 泄漏）。

- **错误模式**：`eventBus.on('x-complete', handler)` 仅依赖事件到达后 `off`——组件在事件前卸载则监听器永久驻留 mitt bus，闭包阻止 GC，重启循环还可能对已销毁节点执行回调
- **正确模式**：`onUnmounted`（或 `onBeforeUnmount`/`onScopeDispose`）里**无条件** `off`；或用带自动清理的封装（`useEventBus` 返回值的 `stop()`）；`try/finally` 也行，前提是清理与卸载解耦
- **watcher**：组件级 `watch`/`watchEffect` 自动随组件销毁；`effectScope` 手动创建或 setup 外（store/Pinia plugin）创建的必须手动 `stop()`
- 全局 window 监听（如 `useGlobalErrorHandler`）在 HMR 下会重复注册，需幂等注册或返回 handle 供重载时移除

**深拷贝规范**（按数据类型选择，不一刀切）：

- 含非 JSON 类型（Date/Map/Set/RegExp 等）必须 `structuredClone()`——`JSON.parse(JSON.stringify(...))` 会静默丢类型（Date→string、RegExp→空对象、Map/Set→空）
- 纯 JSON 配置数据（manifest / 数据源 / 快捷键等 YAML round-trip 数据）可用 JSON 方式——数据本身 JSON 安全，小对象性能更好
- Vue reactive proxy 不可直接 `structuredClone`（抛 "could not be cloned"）；`toRaw()` 只解顶层 proxy，嵌套仍是 proxy，深拷贝需递归解包或改 JSON 方式
- 不确定时优先 `structuredClone()` 兜底；history 模块用 `shallowRef` + `toRaw()` + 不可变数组操作避免 reactive 污染

### FastAPI `app.routes` 版本差异

FastAPI 0.138+ 中 `app.include_router()` 的路由器不再把每条 `APIRoute` 平铺到 `app.routes`，而是封装为内部 `_IncludedRouter` 对象（实际子路由经 `original_router.routes` 访问）。生产 HTTP 路由仍正常，但测试/工具代码若直接遍历 `app.routes` 期望拿到每条子路由，会漏掉 `include_router` 引入的路由造成误判。**建议**：验证路由挂载优先用 `TestClient` 做真实 HTTP 请求；必须遍历 `app.routes` 时需递归处理 `original_router`。

### 画布连接规则

任何进入 `store.edges` 的连接都必须先在 `services/rules/connectionRules.ts` 中定义对应规则，规则粒度精确到 handle。适用于手工拖拽、自动生成、导入恢复和展示边。

### AI 动作类型契约（Codegen）

AI 动作类型（actionType，如 `ADD_SCHEMA`/`VALIDATE_PROJECT`）的**单一事实源**是后端 `backend/app/shared/services/llm/actions/registry.py`。前端类型与分类集合由 codegen 生成：

- 生成物 `frontend/src/types/generated/actions.ts`（`ActionType` 联合类型 + 4 个分类 Set + 只读/写盘 Set）——**禁止手改**
- 脚本 `frontend/scripts/codegen.mjs`（frontend 目录 `npm run codegen`）；CI 后端 job 末尾跑 codegen 并 `git diff` 校验生成物与提交一致
- **修改 `registry.py` 的 `ACTIONS` 后必须跑 `npm run codegen` 重新生成并提交 `actions.ts`**，否则 CI 失败。前端业务代码从 `@/types/generated/actions` import，**禁止硬编码动作类型集合**

### 约束节点自注册

新增约束类型需同步注册五处：

1. **NodeDataBuilder**（`services/constraints/nodeDataBuilder/`）— 构建节点数据（import/embedded/connect 三模式）
2. **ValidationRegistry**（`services/constraints/`）— 执行校验
3. **约束三层命名映射** — ConstraintKind / ConstraintNodeType / V2Type 一致（单一事实源 `constraintMeta.ts` 的 `CONSTRAINT_TYPES`）
4. **前端类型** — `frontend/src/types/nodes.ts` 添加 `*NodeData` 接口
5. **约束类型名 i18n** — `frontend/src/i18n/locales/{zh-CN,en-US}/constraints.ts` 的 `constraintTypes.<kind>.{name,description}` 补双侧条目（key 为 camelCase 的 ConstraintKind）。菜单/节点库/布局器统一从此命名空间取显示名，不在组件里硬编码；`ConstraintNodeRegistration` 接口已不含 `displayName`/`description`

所有注册表经 barrel 文件的 side-effect import 触发自注册。

### CustomNodeData 到 Record<string, unknown> 的安全转换

读取时 `const data = node.data as Record<string, unknown>`；写回必须通过 `updateNodeData(nodeId, patches)`，不得直接修改 `node.data`。

### 类型安全纪律（`as unknown as` 渐进治理）

前端 `as unknown as` 双重断言是绕过 `CustomNodeData` discriminated union 的"逃生舱"，存量由 ESLint `no-restricted-syntax` warn 追踪，`lint:check` 以 `--max-warnings` 阈值管控增量（数值随清理同步收紧，以 `frontend/package.json` 为准，勿在文档记录具体数字）。

- **新增代码禁止引入**：新增一个双重断言会超阈值导致 CI 失败
- **优先替代方案**：按 `node.type` 的类型守卫（`if (node.type === 'schema') { const d = node.data as SchemaNodeData }`）或正确的类型标注
- **渐进清理**：重构某模块时顺手清理，并在 `package.json` 的 `lint:check` 同步降低阈值，直至归零
- **测试文件豁免**：`tests/**` 已关闭此规则（mock 数据用双重断言合理）

### i18n key 完整性守卫

新增/修改 `t('key')` 引用或语言包 key 时，zh-CN 与 en-US **双侧都必须有定义**，否则 `audit:i18n` 守卫失败（已接入 `lint` / `lint:check` / 前端 CI）。

- 脚本 `frontend/scripts/audit-i18n.mjs`（frontend 目录 `npm run audit:i18n`）；allowlist `frontend/i18n-audit-exceptions.json`，含 `dynamicPrefixes`（`t(\`ns.${var}\`)` 动态前缀豁免）与 `baseline*`（治理前存量快照）
- **守卫语义**：仅"超出 baseline 的新增违规"（`[new]`）判失败；存量 `[baseline]` 不阻断，修复后从 baseline 移除即收紧
- 动态 key（`t(\`inspection.severity.${sev}\`)`）需把前缀登记进 `dynamicPrefixes`，否则该命名空间叶子 key 会被误判缺失/未用
- 刷新快照：`npm run audit:i18n -- --update-baseline` 把 missing/onlyZh/onlyEn/unused 四类基线写回 allowlist（仅当新增项确属合理存量时使用，并确认 baseline 数未增长）

### i18n 渲染模式（renderText）

服务层/校验器返回的本地化消息统一用 `LocalizedMessage`（`services/i18n/localizedMessage.ts`），UI 层用 `core/i18n/renderText.ts` 的 `renderText(t, key, fallback, params)` 解析：有 key 走 `t(key, params)`，否则回退 fallback。禁止在服务/校验层直接 `new Error('中文')` 后让 UI 原样展示——应返回 `LocalizedMessage` 由 UI 层按当前语言渲染。

---

## features/ 目录规范

`features/` 放垂直切片功能模块（`components/` + `composables/` + `types/` + `index.ts` 等跨层文件）。判断标准：**跨层 + 独立内聚 + 用户可感知**；不满足的放 `components/`、`composables/`、`stores/`、`types/` 等对应目录。已有模块：`ai-config-generator/`、`keyboard/`、`regex/`、`node-layout-organizer/`。

---

## V2 Configuration File Standards

项目配置使用 V2 YAML 格式，入口文件 `project.precis.yaml`。ID 规则：各实体文件均直接使用画布节点 ID（UUID v4 或显式传入），不派生路径、不使用 `sc_` 前缀；旧 `sc_`+XOR+Base64URL 方案已废弃，仅在 `config_inspector._is_machine_id` 中被识别用于友好化显示。

| 文件类型 | 命名 | ID |
|---------|------|-----|
| 项目清单 | `project.precis.yaml` | `project.id` 为项目标识符 |
| Schema | `schemas/*.schema.yaml` | 画布节点 ID |
| Constraint | `constraints/*.constraint.yaml` | `node.id` |
| Regex | `regex/*.regex.yaml` | `node.id` |
| Transform | `transforms/*.transform.yaml` | `node.id` |
| Template | `templates/*.template.yaml` | `node.id` |

**约束类型**（10 种）: NotNull, Unique, AllowedValues, Range, ForeignKey, Conditional, Scripted, Charset, DateLogic, Composite

**数据类型**: string, integer, float, decimal, boolean, date

> 完整格式规范见后端 `backend/app/shared/` 中的 Schema/Constraint 类型定义。

---

## 版本发布与自动更新

**版本单一事实源**：根 `package.json` 的 `version`；electron/frontend 的 package.json、`backend/pyproject.toml`、`tui-rust/Cargo.toml + Cargo.lock` 是同步副本，**禁止手工单改任何一处**——一律通过 `npm run release`（仓库根，`scripts/release.mjs`）同步。npm version 连带更新的三份 `package-lock.json` 随发布提交一并入库（`releaseCommitFiles()`）——勿从提交清单移除，漏提交残留脏工作树会挡下一次发布的干净树检查（v0.1.1 实证）。

**发布流程**：`npm run release -- <版本|patch|minor|major> [--prerelease alpha.1] [--dry-run] [--no-push]`。脚本校验（main 分支 + 干净树 + 版本不倒退）→ 同步六处 manifest → CHANGELOG 切版（`[Unreleased]` 的 `### YYYY-MM` 内容落为 `## [X.Y.Z] - 日期` 分节）→ commit + annotated tag + push 触发 CD。

**CD 关键不变量**（`.github/workflows/cd.yml`，改流水线时勿破坏）：

- tag 版本与六处 manifest 必须全等（`verify-manifests` job 用 `release.mjs check` 守卫）；`workflow_dispatch` 路径用 `release.mjs sync` 对齐，不覆写仓库文件
- Release 必须**非 draft** 才算发布完成——draft Release 对 electron-updater 不可见，客户端永远检测不到更新
- 产物自检闸门（`scripts/verify-release-assets.mjs`）：latest.yml 引用的每个资产必须存在且 size/sha512 实测一致（历史出过清单连字符 vs 产物空格命名漂移致客户端更新 404）
- 安装包产物名由 `electron/package.json` 的 `build.artifactName` 显式固定（无空格）

**客户端更新链路约定**（`electron/src/update.ts` 等）：

- 自定义 generic 更新源必须在启动时重放 `setFeedURL`（持久化配置），不能只在保存时设置
- 更新源仅允许 https（http 仅限 `127.0.0.1`/`localhost` 本地演练）；`saveConfig` 与启动重放两路共用 `validateUpdateSourceUrl` 白名单闸门，非法源拒绝保存/应用并回退 GitHub 源——渲染层无法毒化 `update-config.json` 引向恶意源（换源劫持 → RCE 链），勿放宽
- `quitAndInstall` 前必须先同步终止 Python 子进程树（extraResources 整目录被 NSIS 覆盖，文件占用会安装失败）
- 主进程单实例锁（`requestSingleInstanceLock`）勿移除
- 打包环境后端版本经 `PRECIS_APP_VERSION` 环境变量注入（打包不安装 precis 包元数据，importlib.metadata 拿不到），`/api/latest/version` 以此为第一优先级
- macOS 未签名不支持 electron-updater 自动更新（Squirrel.Mac 要求签名）；Windows 未签名可自动更新（sha512 清单校验保证完整性）

**本地"模拟生产"演练**：`cd electron && npm run update:drill -- lite|full` 生成 `local-updates/` 真实更新源（lite 复用真实产物仅抬升清单版本；full 构建两个真实版本），`npm run serve:updates` 起本地 generic 源，应用设置中切自定义源演练。禁止用假包/dummy sha512 模拟更新（下载校验必失败）。

**发布脚本与 CD 辅助脚本的测试**：`scripts/tests/`（node --test，根 `npm run test:scripts`，CI 有 `release-scripts` job）；纯函数从 `.mjs` 导出，脚本入口都有"直接执行才跑 main"守卫，新增脚本沿用该模式。

**发布控制台 GUI**：`npm run release:gui`（`scripts/release-gui.mjs` + `release-gui.html`，零依赖 Node 内置 HTTP + 单页 HTML，日志经 SSE 推送；双击入口仓库根 `release-gui.bat` → `scripts/windows/release-gui.bat`，mac 对称 `scripts/mac/release-gui.sh`）。安全约束改 GUI 时不得放宽：只绑 127.0.0.1；客户端只能触发固定动作枚举；任何用户输入（版本号/tag/端口）必须先过 `validateVersionish`/`validateTag`/`validatePort` 白名单正则才允许拼进 shell 命令；POST 状态变更接口校验来源（`isLocalBrowserRequest`：外源 Origin 与 DNS rebinding Host 一律 403——只绑 127.0.0.1 挡不住浏览器跨站无预检 POST）；收到退出信号先显式终止任务子进程与本地更新源（Unix 上 detached 任务在独立进程组，不随主进程死）。

---

## Pre-commit Hooks

Husky pre-commit 钩子（`.husky/pre-commit`）自动执行：`cd frontend && npx lint-staged`（ESLint --fix + Prettier --write，仅暂存文件）→ `cd backend && python -m ruff check --fix .` → `python -m ruff format .` → `git add` 被 ruff 修改的文件。
