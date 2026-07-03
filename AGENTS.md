# AGENTS.md

This file provides guidance to Qoder (qoder.com) when working with code in this repository.

> **项目状态**: Alpha 阶段。核心功能已成型并配套完整测试（后端 2800+ / 前端 1500+ / E2E 24 个 spec 文件，CI 全绿），但仍在打磨稳定性，API 与配置格式可能调整。修改代码时需保证正确性并维护测试；应结合具体业务场景，必要时进行合理重构以保持代码健康。
>
> **本文档定位**：只收录**稳定的架构原则、约定、命令与陷阱**（重构不会使其失效的内容）。具体的文件清单、行数表、调用图、ID 方案等易漂移的实现细节，见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)（该文档以代码为准，可能漂移）。

---

## Build & Run Commands

### 安装依赖

```bash
npm run install:all           # 安装全部依赖（root + frontend + electron）
cd backend && pip install -e ".[dev]"  # 后端开发依赖（含 ruff、pytest、mypy）
cd e2e && npm ci              # E2E 测试依赖
```

### 开发运行

```bash
npm run dev                   # 同时启动后端 + 前端（concurrently）
npm run electron:dev          # 启动 Electron 桌面版（自动管理后端进程）
npm run backend:dev           # 仅启动后端 FastAPI（端口 18000）
cd frontend && npm run dev    # 仅启动前端 Vite dev server
```

### 构建

```bash
npm run build:all             # 构建前端 + 后端
npm run frontend:build        # 构建前端（包含 type-check）
npm run backend:build         # 安装后端可编辑包（pip install -e .）
```

### 代码检查与格式化

```bash
# 前端
cd frontend && npm run lint          # ESLint + style audit
cd frontend && npm run type-check    # vue-tsc 类型检查（strictNullChecks: true）
cd frontend && npm run format        # Prettier 格式化

# 后端
cd backend && python -m ruff check .           # Ruff lint（不自动修复）
cd backend && python -m ruff check --fix .     # Ruff lint 自动修复
cd backend && python -m ruff format .          # Ruff 格式化

# 一键全量
npm run lint:all              # 前端 lint + 后端 ruff check
npm run format:all            # 前端 format + 后端 ruff format + fix
```

### 测试

```bash
# 前端单元测试（仅纯逻辑模块，覆盖率仅统计指定的 .ts 源文件）
cd frontend && npm run test          # vitest 运行全部测试
cd frontend && npm run test:watch    # vitest watch 模式

# 后端单元测试
cd backend && python -m pytest       # pytest 运行全部测试

# E2E 测试（Playwright + Chromium，前端主测试手段）
cd e2e && npx playwright test        # 运行 E2E 测试（需后端运行）

# CLI 校验
npm run cli:validate                 # CLI 校验测试套件
```

> 详细测试策略见下方 [Testing Strategy](#testing-strategy) 章节。

---

## Tech Stack

| 层级 | 技术 |
|------|------|
| 前端 | Vue 3 + TypeScript + Vite + Pinia + Vue Router + Vue I18n + Vue Flow |
| 后端 | Python + FastAPI + Uvicorn + Pydantic + Pandas |
| 桌面端 | Electron + electron-builder + TypeScript（sandbox: true） |
| E2E 测试 | Playwright + Chromium |
| 前端代码质量 | ESLint + Prettier + lint-staged + Husky |
| 后端代码质量 | Ruff（lint + format + import 排序） |

**运行环境要求**: Node.js `^20.19.0 || >=22.12.0`，Python `>=3.12,<3.14`

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

**关键约定**：
- `domain/` 不得导入 `core/` 或 `services/`，保持纯净
- API 路由在 `backend/app/api/routers/`，请求/响应模型在 `backend/app/api/models/`
- 路由注册入口: `backend/app/api/main.py`
- 后端校验引擎采用两阶段流水线（数据加载与预处理 → 约束校验），大文件支持分块加载（>500MB 阈值）

### 前端 GraphStore（God Store + 工厂模块 + 拆分 setup）

graphStore 是画布的核心状态管理，采用 **Pinia Setup Store + 工厂模块拆分**模式。

**核心约定**：
- 每个模块工厂通过参数接收 `nodes`, `edges` 等响应式引用（依赖注入），**不直接导入 store**
- `setup/assembly.ts` 将所有模块导出聚合到一个扁平对象中
- `updateNodeData()` 是修改节点数据的唯一途径：`nodes.value = updateNodeDataInArray(nodes.value, nodeId, newData)`
- 工厂数量约 27 个 `createXxxModule`，按 V2 导入 / 持久化 / 连接 / 节点工厂 / 模板展开 / 剪贴板 / 历史 等职责拆分（完整清单见 ARCHITECTURE.md）

### 前端能力抽象层（Electron/Web 解耦）

所有与环境（Electron / Web）相关的底层能力，统一封装在 `frontend/src/core/capabilities/`。

**关键约定**：
- 业务组件/组合式函数**禁止**直接访问 `window.electronAPI` 或调用 `isElectron()`。
- UI 层通过能力探测属性（如 `shellApi.canOpenLocalFile`）控制按钮显隐/禁用。
- 能力层内部保留 Electron 适配器，继续使用 `window.electronAPI` IPC；preload / 主进程代码不变。
- 详细设计与能力清单见 `frontend/src/core/capabilities/README.md` 与 ARCHITECTURE.md。

### 前端事件总线

应用级事件通过 `core/eventBus.ts`（基于 mitt）通信，定义了 `AppEvents` 接口（20+ 事件类型）。

**注意**: DOM 物理事件（mousemove/mouseup 拖拽、keydown 快捷键）保留 `window.addEventListener`，不迁移到事件总线。

### 前端 Store 接口解耦

`types/storeInterfaces.ts` 定义了 `GraphStoreLike` 和 `ProjectStoreLike` 最小公共接口，用于跨 store 类型引用，避免直接导入。

### 前端节点类型系统

画布节点类型定义在 `frontend/src/types/graph.ts` 和 `frontend/src/types/nodes.ts`。

`CustomNode = Node<CustomNodeData>`，其中 `CustomNodeData` 是 discriminated union，按 `type` 字段区分。节点类别包括：项目（`projectRoot`）、Schema（`schema`/`jsonSchema`）、数据源（`sourcePreview`/`jsonSourcePreview`）、转换（`transform`/`transformOutput`）、手动数据（`manualData`）、正则（`regex`）、模板实例（`templateInstance`）、约束（10 种 `*Constraint` 节点）。

**约束三层命名映射**（新增约束类型时三处必须一致）：ConstraintKind / ConstraintNodeType / V2Type 的映射**单一事实源**是 `services/constraints/validationRegistryCore.ts` 的 `CONSTRAINT_TYPES`，参考副本与新增约束注册清单见 ARCHITECTURE.md。

### 前端约束系统（双注册表模式）

约束系统有两个并行的自注册注册表：

| 注册表 | 文件 | 用途 |
|--------|------|------|
| **NodeDataBuilder** | `services/constraints/nodeDataBuilder/registry.ts` | 构建约束节点数据（import/embedded/connect 三种模式） |
| **ValidationRegistry** | `services/constraints/validationRegistryCore.ts` | 执行约束校验 |

**自注册机制**：每个 builder/handler 文件在模块级别调用 `registerBuilder()` 或 `register()`，通过 barrel 文件的 side-effect import 触发注册。

**校验编排入口**在 `services/constraints/orchestration/globalValidation.ts`：全表 `validateAllConstraints`、非阻塞 `triggerValidationForNode`、单约束即时 `dispatchValidation`；实际校验执行委托给 `validationRegistryCore.ts` 的 `validateConstraintNode`。`validationCollector.ts` 负责数据源信息收集。

### 前端 API 层

V2 API 调用层在 `frontend/src/api/projectV2Api/`（已重构为目录，barrel 入口 `index.ts` 保持导入路径不变），使用 Axios（`core/services/httpClient.ts`）。

**关键约定**：所有请求通过 `X-Project-Config-Path` header 标识当前项目。`ProjectNotFoundError` 用于区分"项目未找到"和服务器错误。

### 前端应用启动流程

`composables/useAppBootstrap.ts` 编排启动：
1. `bootstrapProjectPaths()` — 从 Electron IPC 或 localStorage 恢复配置路径，调用 `getV2FullConfig()` 验证，创建 projectRoot 节点
2. `workspaceStore.initialize()` — 初始化数据源工作区
3. `canvasStore.initialize()` — 初始化多标签画布
4. `dragStore.initializeDragState()` — 设置资源树→画布拖拽状态
5. 启动键盘快捷键系统

**资源树**由三个 Pinia store 协作：`resourceTreeStore`（资源映射与分组）、`resourceFolderStore`（展开折叠状态）、`resourceSearchStore`（搜索过滤）。

### Electron 集成

Electron 主进程 (`electron/src/main.ts`) 负责：
1. 动态分配端口 → 启动 Python 后端子进程（`uvicorn`）
2. 健康检查（TCP + HTTP 轮询）
3. 创建 BrowserWindow 加载前端（sandbox: true, nodeIntegration: false, contextIsolation: true）
4. 通过 `preload.ts` 暴露 `window.electronAPI.*`（文件系统、对话框、配置等 IPC）
5. 生产模式使用自定义 `app://` 协议，不使用 `webSecurity: false`

### E2E 测试

`e2e/` 目录包含 Playwright E2E 测试，独立 `package.json` 和 `playwright.config.ts`。完整 spec 清单（按主题分组）见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

---

## Testing Strategy

前端采用 **E2E-first** 策略，后端保持 pytest 单元测试。

### 分层原则

| 层 | 工具 | 覆盖范围 |
|----|------|---------|
| 前端单元测试 | vitest | 仅纯逻辑 `.ts` 模块（无 Vue/Pinia/Vue Flow 依赖） |
| 前端 E2E 测试 | Playwright | 所有 UI 交互、composables、`.vue` 组件、跨层集成流程 |
| 后端单元测试 | pytest | 全部后端代码，`--cov-fail-under` 门控 |

### 前端单元测试范围（vitest）

**应该写单元测试的**（纯逻辑，无框架依赖或依赖易 mock）：

- `services/rules/` — 连接规则定义与验证
- `services/constraints/` — 约束注册表、校验编排、节点数据构建、导出适配
- `services/builders/` — V2 配置序列化
- `services/canvas/` — 连接策略服务
- `stores/graphStore/modules/` — 工厂模块（`createXxxModule` 闭包，通过参数注入依赖）
- `utils/` — 纯工具函数
- `api/` — API 调用层（mock HTTP）
- `core/` — 基础设施（httpClient、logger 等）

**不应写单元测试的**（由 E2E 覆盖）：

- `composables/` — 依赖 Pinia store、Vue 响应式、Vue Flow hooks 等运行时环境
- `.vue` 组件 — UI 渲染与交互
- `features/` — 跨层功能模块（components + composables + types 整体由 E2E 验证）

### 前端覆盖率配置

vitest 覆盖率（`vite.config.ts`）仅统计 `src/**/*.ts`，**显式排除**：`composables/**`、`features/**`、`components/**`、`**/index.ts`、`types/**`、`*.d.ts`、测试文件与 `main.ts`（`.vue` 由 E2E 覆盖）。阈值：lines 48 / branches 37 / functions 46 / statements 47。

阈值设定应反映纯逻辑模块的实际覆盖水平，不因排除 UI 层而失真。

### E2E 测试职责

E2E 是前端功能正确性的**主验证手段**，覆盖：

- 用户操作完整路径（导入 → 编辑 → 校验 → 保存 roundtrip）
- Composable 与组件的集成行为
- 前端 ↔ 后端 API 交互
- Electron 特有行为（如适用）

新增功能时，优先补充 E2E 用例；纯逻辑提取为独立函数后才考虑补充单元测试。

### 后端测试策略

保持不变：`pytest` + 覆盖率报告。新增后端功能必须附带单元测试。

---

## 测试编写规范

> 目的：确保测试验证**行为**而非**实现细节**，使功能修改和 bug 修复不会导致测试大面积失效。

### 核心原则：测行为，不测实现

```
✅ 好的测试：调用函数，验证输入→输出映射、状态变化、副作用
❌ 坏的测试：验证函数内部是否调用了某个私有方法、mock 了不必要的内部依赖
```

### 前端单元测试规范（vitest）

**1. 工厂模块测试**：只 mock 被测模块的边界（如 `vueFlowApi` 是外部边界），构造依赖注入参数用最小真实数据。**禁止** mock 被测模块内部调用的其他工厂。

```typescript
// ✅ mock 边界 + 注入真实最小依赖
vi.mock('@/services/canvas/vueFlowApi', () => ({ addNodes: vi.fn(), addEdges: vi.fn() }))
const nodes = ref<CustomNode[]>([])
const module = createXxxModule({ nodes, selectedNodeId: ref(null) })
```

**2. 测试数据工厂**：mock 数据必须通过 `make*` 工厂函数生成（如 `makeNode`、`makeEdge`），禁止内联硬编码完整对象。

**3. 断言验证结果**：验证最终状态（`expect(nodes.value).toHaveLength(2)`），不验证内部调用细节。例外：mock 外部边界时可验证调用次数/参数，但不断言 UUID 等随机值。

**4. 测试隔离**：每个 `describe` 的 `beforeEach` 必须重新初始化所有状态，禁止跨 describe 共享可变状态。

**5. 禁止 snapshot 测试**：用精确字段断言替代 `toMatchSnapshot()`（snapshot 阻碍重构且难判断断言意图）。

**6. 文件组织**：测试路径**镜像源文件路径**（如 `src/services/rules/` → `tests/services/rules/`）。

### 后端测试规范（pytest）

- **fixture 优先**：可复用数据用 `@pytest.fixture`，不在每个测试函数内重复构造。
- **mock 边界不 mock 内部**：`monkeypatch.setattr(os.path, "exists", ...)` 是好的；`monkeypatch.setattr(module, "_internal_helper", ...)` 是坏的。
- **命名描述行为**：`test_save_manifest_excludes_none_values` 好于 `test_function_calls_write_yaml`。

### 重构时的测试维护规则

| 场景 | 做法 |
|------|------|
| 修改函数签名（增减参数） | 更新测试中的工厂函数和调用参数，不删除测试 |
| 重命名函数/变量 | 全局替换即可，不影响测试逻辑 |
| 重构内部实现（不改变外部行为） | 测试不应需要修改。如果需要，说明测试耦合了实现 |
| 新增约束类型 | 在注册表完整性测试中自动覆盖（如 `CONSTRAINT_TYPES.length`） |
| 修改节点 data 结构 | 更新 `makeNode` 等工厂函数，不逐个修改测试用例 |
| 修改 API 请求/响应格式 | 更新 API 层测试的 fixture，不修改业务逻辑测试 |

---

## Coding Standards

### Python 后端

- **Ruff 配置**: `backend/pyproject.toml` — `line-length = 120`, `quote-style = "double"`, 规则 `E/F/I/N/W/UP`（忽略 `E501`, `E402`, `N815`）
- **导入顺序**: 标准库 → 第三方库 → 项目内部（`from __future__ import annotations` 放最前）
- **命名**: 类名 PascalCase，函数/方法 snake_case，常量 UPPER_SNAKE_CASE
- **类型注解**: 必须使用，用 `from __future__ import annotations` 支持延迟注解
- **注释**: 使用中文注释，复杂逻辑必须添加行内注释

### TypeScript/Vue 前端

- **组件语法**: `<script setup lang="ts">` + Composition API
- **导入顺序**: 外部组件 → 类型 → 组合式函数/工具
- **命名**: 组件 PascalCase，组合式函数 `use*`，Store `use*Store`，常量 UPPER_SNAKE_CASE
- **Props**: 必须定义类型（`interface Props` + `defineProps<Props>()`）
- **类型定义**: 非 feature 专属的共享类型放 `src/types/`
- **空值安全**: `strictNullChecks: true`，所有可能为 null/undefined 的值必须添加空值守卫

### i18n 国际化

vue-i18n Composition API 模式（`legacy: false`），默认 `zh-CN`，回退 `en-US`。翻译文件按功能和节点类型拆分在 `frontend/src/i18n/locales/{zh-CN,en-US}/` 下。使用 `const { t } = useI18n()` 获取翻译函数。

---

## Critical Patterns & Pitfalls

### Vue Flow DAG 操作规范

Vue Flow 通过 `v-model:nodes` / `v-model:edges` 实现双向同步（prop 下传 + emit 回写），内部维护状态副本。**绕过 Vue Flow API 直接操作数组会导致内部状态与 store 不同步**，引发节点/边消失、事件丢失、竞态等 Bug。

#### 核心原则：增量走 API，全量走数组替换

所有 DAG 增删操作统一通过 `services/canvas/vueFlowApi.ts` 注入层调用 Vue Flow 原生 API。该模块在 `NodeCanvas.vue` setup 中通过 `initVueFlowApi(useVueFlow())` 完成注入，之后可在 Pinia store、composable 等任何地方使用。

| 场景 | 正确方式 | 说明 |
|------|---------|------|
| **创建节点** | `addNodes([node])`（vueFlowApi） | 增量 push，触发 hooks，Vue Flow 正确 enrichment |
| **创建边** | `addEdges(edge)`（vueFlowApi） | 增量 push，触发 hooks，只验证新边 |
| **删除边** | `removeEdges(edgeId)`（vueFlowApi） | 触发 `onEdgesChange` → `handleEdgeRemoved` |
| **删除节点** | `removeNodes(nodeId)`（vueFlowApi） | 自动删除关联边并触发清理 |
| **修改节点数据** | `updateNodeData(nodeId, patches)` | 统一入口，保持 saveState 同步 |
| **清空/重置画布** | `nodes.value = []` / `edges.value = []` | 全量替换，走 `setNodes`/`setEdges`，不需要 hooks |
| **加载项目** | `nodes.value = loadedNodes` / `edges.value = loadedEdges` | 全量替换，同上 |
| **undo/redo** | `nodes.value = snapshot` / `edges.value = snapshot` | 全量替换，恢复后须调 `reconcileAll()` |

#### 两条路径的本质区别

| 操作路径 | 内部机制 | Hooks | 验证范围 | 风险 |
|---------|---------|-------|---------|------|
| `addEdges(edge)` / `removeEdges(id)` | `applyChanges` 增量 splice | **触发** | 仅新操作的边/节点 | ✅ 安全 |
| `edges.value = [...]` → model→store watcher | `setEdges` 全量替换 | **不触发** | **所有边**重新验证 | 源/目标节点缺失时边被静默丢弃 |
| `edges.value.push()` | 无 | 不触发 | — | **完全损坏**，Vue Flow 不检测 |

**`setEdges` 的致命问题**：`createGraphEdges` 对每条边调用 `findNode(edge.source)`，找不到则 `continue` 静默丢弃。即使节点在 `edges.value` 中存在（通过 push 添加），只要 Vue Flow 内部 `state.nodes` 中没有（push 不触发 model→store watcher），边就会被丢弃。

#### 禁止操作

| 操作 | 原因 |
|------|------|
| `nodes.value.push(newNode)` | Vue Flow 的 pausable watcher 追踪 ref 值引用，push 不触发。节点在 Vue Flow 内部完全不存在 |
| `edges.value.push(newEdge)` | 同上 |
| `edges.value = edges.value.filter(...)` 删除边 | 绕过 `onEdgesChange`，`handleEdgeRemoved` / `syncOnDisconnect` / `executeDisconnectCleanup` 均不执行 |
| 直接修改 `node.data` 属性 | 绕过 `updateNodeData` 统一入口，saveState 不同步 |
| 同一边混合使用 API 和数组操作 | `removeEdges` + `edges.value = filter` 导致 `onEdgesChange` 触发两次 |

#### 时序要求

- **创建节点后、创建边之前必须 `await nextTick()`** — `addNodes` 同步更新 Vue Flow 内部状态，但节点需要渲染后才有 handleBounds（边路径计算依赖）。`nextTick` 确保 Vue Flow 完成节点处理。
- **`reconcileAll()` 必须在 `nextTick` 之后调用** — 它从 edges 重建所有 parent/children/outputPortConnected 状态，必须在 Vue Flow 完成节点变更处理后执行。
- **`removeEdges` 同步触发 `onEdgesChange`** — 清理立即执行，"删除旧边 → 设置新数据"的顺序是安全的。
- **store→model 同步有 nextTick 延迟** — Vue Flow 内部状态变更后，通过 pausable watcher 在 `nextTick` 后才回写到 v-model ref。

#### 事件选择

- **用 `onEdgesChange` / `onNodesChange` 监听变化**，不要用 `watch(store.edges)` — v-model 双向绑定会让 `watch` 频繁触发且难以区分变化来源。
- **`onEdgesChange` 的 `remove` 事件**：由 `removeEdges` 同步触发。数组替换不会触发。

#### 删除节点时的关联边清理

删除节点必须先清理关联边再删节点，并保证清理链路（`handleEdgeRemoved` → `syncOnDisconnect` + `executeDisconnectCleanup`）被执行。当前 `nodeOps.ts` 的 `deleteNode` 已采用正确实现：按 `collectCascadeNodeIds`（级联收集）→ 逐条 `removeEdges` → `removeNodes` → `nextTick(reconcileAll + onNodesRemoved)` 顺序执行，先删边再删节点，并在下一 tick 协调状态。新增节点删除相关代码时务必沿用此模式，**不要回退到直接替换 `nodes.value`/`edges.value` 数组**（会绕过 `onEdgesChange` 导致清理不执行）。

#### undo/redo 的状态恢复

`history.ts` 使用 `shallowRef` + `toRaw()` + 不可变栈操作，恢复时直接替换 `nodes.value` 和 `edges.value`，不触发任何 hooks。恢复后会调用 `reconcileAll()` 重建连接状态。

#### 深拷贝规范

- **使用 `structuredClone()`** 进行深拷贝，禁止 `JSON.parse(JSON.stringify(...))`
- **Vue reactive proxy 不可直接 `structuredClone`** — 必须先 `toRaw()` 解包
- **history 模块** 使用 `shallowRef` + `toRaw()` + 不可变数组操作避免 reactive 污染

### FastAPI `app.routes` 版本差异

FastAPI 0.138+ 修改了 `app.include_router()` 的内部表示：被 include 的路由器不再把每条 `APIRoute` 平铺到 `app.routes` 列表中，而是封装为内部的 `_IncludedRouter` 对象，实际子路由通过其 `original_router.routes` 访问。

影响：
- **生产代码的 HTTP 路由仍然正常工作**，`TestClient` 可直接验证可达性。
- **测试或工具代码若直接遍历 `app.routes` 并期望拿到每条子路由**，在 FastAPI 0.138+ 下会漏掉 `include_router` 引入的路由，造成误判。

**建议**：验证路由是否挂载时，优先使用 `TestClient` 做真实 HTTP 请求；若必须遍历 `app.routes`，需递归处理 `original_router`。

### 画布连接规则

任何进入 `store.edges` 的连接都必须先在 `services/rules/connectionRules.ts` 中定义对应规则。规则粒度必须精确到 handle。适用于手工拖拽、自动生成、导入恢复和展示边。

### AI 动作类型契约（Codegen）

AI 动作类型（actionType，如 `ADD_SCHEMA`/`VALIDATE_PROJECT`，共 15 种）的**单一事实源**是后端 `backend/app/shared/services/llm/actions/registry.py`。前端类型与分类集合通过 codegen 从 registry 生成：

- 生成物：`frontend/src/types/generated/actions.ts`（`ActionType` 联合类型 + 4 个分类 Set + 只读/写盘 Set）——**禁止手改**
- 脚本：`frontend/scripts/codegen.mjs`，命令 `npm run codegen`（在 frontend 目录）
- CI 校验：后端 job 末尾会跑 codegen 并 `git diff` 校验生成物与提交一致，不一致则失败

**修改后端动作类型后**（在 `registry.py` 的 `ACTIONS` 加/改/删一行），必须跑 `npm run codegen` 重新生成并提交 `actions.ts`，否则 CI 失败。前端业务代码从 `@/types/generated/actions` import 常量与类型，**禁止在前端硬编码动作类型集合**。

### 约束节点自注册

新增约束类型时，需同时在以下位置注册：
1. **NodeDataBuilder**（`services/constraints/nodeDataBuilder/`）— 用于构建节点数据
2. **ValidationRegistry**（`services/constraints/`）— 用于执行校验
3. **约束三层命名映射** — ConstraintKind / ConstraintNodeType / V2Type 必须一致（**单一事实源**：`validationRegistryCore.ts` 的 `CONSTRAINT_TYPES`，参考副本见 ARCHITECTURE.md）
4. **前端类型** — `frontend/src/types/nodes.ts` 添加对应的 `*NodeData` 接口

所有注册表通过 barrel 文件的 side-effect import 触发自注册。

### CustomNodeData 到 Record<string, unknown> 的安全转换

约束节点数据经常需要作为 `Record<string, unknown>` 传递给通用函数。安全方式：
- 读取时：`const data = node.data as Record<string, unknown>`
- 写入回写时：必须通过 `updateNodeData(nodeId, patches)` 而非直接修改 `node.data`

---

## features/ 目录规范

`features/` 放垂直切片功能模块，每个 feature 包含 `components/`, `composables/`, `types/`, `index.ts` 等跨层文件。

**判断标准**：跨层 + 独立内聚 + 用户可感知。不满足条件的内容放 `components/`, `composables/`, `stores/`, `types/` 等对应目录。

**已有模块**: `ai-config-generator/`, `keyboard/`, `regex/`, `node-layout-organizer/`

---

## V2 Configuration File Standards

项目配置使用 V2 YAML 格式，入口文件为 `project.precis.yaml`。

| 文件类型 | 命名 | ID 规则 |
|---------|------|--------|
| 项目清单 | `project.precis.yaml` | `project.id` 为项目标识符 |
| Schema | `schemas/*.schema.yaml` | 直接使用画布节点 ID（UUID v4 或显式传入），不再派生路径、不使用 `sc_` 前缀。旧版 `sc_`+XOR+Base64URL 方案已废弃，仅在 `config_inspector._is_machine_id` 中被识别用于友好化显示 |
| Constraint | `constraints/*.constraint.yaml` | 直接使用 `node.id`（UUID） |
| Regex | `regex/*.regex.yaml` | 直接使用 `node.id` |
| Transform | `transforms/*.transform.yaml` | 直接使用 `node.id` |
| Template | `templates/*.template.yaml` | 直接使用 `node.id` |

**约束类型**（10 种）: NotNull, Unique, AllowedValues, Range, ForeignKey, Conditional, Scripted, Charset, DateLogic, Composite

**数据类型**: string, integer, float, decimal, boolean, date

> 完整格式规范见后端 `backend/app/shared/` 中的 Schema/Constraint 类型定义。

---

## Pre-commit Hooks

Husky pre-commit 钩子自动执行（`.husky/pre-commit`）：
1. `cd frontend && npx lint-staged` — ESLint --fix + Prettier --write（仅暂存文件）
2. `cd backend && python -m ruff check --fix .` — 后端全量 lint 修复
3. `cd backend && python -m ruff format .` — 后端全量格式化
4. `git add` 被 ruff 修改的文件
