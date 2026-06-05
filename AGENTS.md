# AGENTS.md

This file provides guidance to Qoder (qoder.com) when working with code in this repository.

> **项目状态**: 早期开发阶段（Pre-Alpha）。修改代码时应格外谨慎：优先做最小改动，避免大规模重构。

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
npm run backend:build         # 构建后端（PyInstaller）
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
# 前端单元测试（295 用例，覆盖率仅统计 .ts 源文件；阈值 lines:5% branches:4% functions:6%）
cd frontend && npm run test          # vitest 运行全部测试
cd frontend && npm run test:watch    # vitest watch 模式

# 后端单元测试（1360 用例，覆盖率阈值 56%）
cd backend && python -m pytest       # pytest 运行全部测试

# E2E 测试（12 用例，Playwright）
cd e2e && npx playwright test        # 运行 E2E 测试（需后端运行）

# CLI 校验
npm run cli:validate                 # CLI 校验测试套件
```

---

## Tech Stack

| 层级 | 技术 |
|------|------|
| 前端 | Vue 3 + TypeScript + Vite + Pinia + Vue Router + Vue I18n + Vue Flow |
| 后端 | Python + FastAPI + Uvicorn + Pydantic + Pandas |
| 桌面端 | Electron Forge + TypeScript（sandbox: true） |
| E2E 测试 | Playwright + Chromium |
| 前端代码质量 | ESLint + Prettier + lint-staged + Husky |
| 后端代码质量 | Ruff（lint + format + import 排序） |

**运行环境要求**: Node.js `^20.19.0 || >=22.12.0`，Python `>=3.12`

---

## Architecture

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

### 后端校验引擎（两阶段流水线 + 大文件分块支持）

```
ValidationExecutor (services/validation/executor.py)
  │
  ├── 阶段 1: 数据加载与预处理
  │     ├── DataSourceResolver → 解析文件路径
  │     ├── DataLoader → 加载 Excel/CSV/JSON
  │     │     └── 大文件（>500MB）自动切换 ChunkedDataLoader
  │     ├── MemoryMonitor → 内存监控与分块策略
  │     ├── process_dataframe → 类型转换、格式检查
  │     ├── extractors → 派生列提取（regex）
  │     └── Transform DAG → 拓扑排序执行 transform 链
  │
  └── 阶段 2: 约束校验
        └── 逐约束调用 validate()，聚合错误
              （validators/ 下每种类型一个：not_null.py, unique.py, foreign_key.py ...）
```

**分块加载**: `chunked_loader.py` + `memory_monitor.py` — 文件超过 500MB 阈值时自动按 chunk 加载校验，避免内存溢出。

### 前端 GraphStore（God Store + 工厂模块 + 拆分 setup）

graphStore 是画布的核心状态管理，采用 **Pinia Setup Store + 工厂模块拆分**模式。

**核心文件**: `frontend/src/stores/graphStore/setup/`（从原 `setup.ts` 拆分）

| 文件 | 职责 | 行数 |
|------|------|------|
| `setup/state.ts` | 状态声明 + updateNodeData | ~110 |
| `setup/computed.ts` | 计算属性 | ~70 |
| `setup/assembly.ts` | 模块工厂组装 | ~590 |
| `setup/index.ts` | 入口，组合以上三者 | ~10 |

**核心状态**: `nodes: Ref<CustomNode[]>`, `edges: Ref<Edge[]>`, `selectedNodeId`

**模块拆分**（~20 个 `createXxxModule()` 工厂函数，通过闭包参数注入依赖）：

| 模块分类 | 模块工厂 | 文件 |
|---------|---------|------|
| **V2 导入** | `createV2ImportModule` | `modules/v2Import.ts` |
| **持久化** | `createV2PersistenceModule` | `modules/v2/persistence/` |
| **连接操作** | `createConnectionOpsModule` | `modules/connectionOps.ts` |
| **关系同步** | `createConnectionStateSyncModule` | `modules/connectionStateSync.ts` |
| **节点工厂** | `createSchemaFactoryModule`, `createConstraintFactoryModule`, `createRegexFactoryModule`, `createTransformFactoryModule` 等 | `modules/factories/` |
| **模板展开** | `createTemplateExpandModule` | `modules/templateExpand.ts` |
| **剪贴板** | `createClipboardModule` | `modules/clipboard.ts` |
| **历史** | `createHistoryModule` | `modules/history.ts` |

**关键约定**：
- 每个模块工厂通过参数接收 `nodes`, `edges` 等响应式引用（依赖注入），不直接导入 store
- `assembly.ts` 将所有模块导出聚合到一个扁平对象中
- `updateNodeData()` 是修改节点数据的唯一途径：`nodes.value = updateNodeDataInArray(nodes.value, nodeId, newData)`

### 前端事件总线

应用级事件通过 `core/eventBus.ts`（基于 mitt）通信，定义了 `AppEvents` 接口（20+ 事件类型）。

**注意**: DOM 物理事件（mousemove/mouseup 拖拽、keydown 快捷键）保留 `window.addEventListener`，不迁移到事件总线。

### 前端 Store 接口解耦

`types/storeInterfaces.ts` 定义了 `GraphStoreLike` 和 `ProjectStoreLike` 最小公共接口，用于跨 store 类型引用，避免直接导入。

### 前端节点类型系统

画布节点类型定义在 `frontend/src/types/graph.ts` 和 `frontend/src/types/nodes.ts`。

`CustomNode = Node<CustomNodeData>`，其中 `CustomNodeData` 是 discriminated union，按 `type` 字段区分：

| 类别 | 节点类型 | 说明 |
|------|---------|------|
| 项目 | `projectRoot` | 项目根节点，项目加载时创建 |
| Schema | `schema`, `jsonSchema` | 表结构定义 |
| 数据源 | `sourcePreview`, `jsonSourcePreview` | 数据文件预览 |
| 转换 | `transform`, `transformOutput` | 数据转换 |
| 手动数据 | `manualData` | 内联编辑数据 |
| 正则 | `regex` | 正则校验 |
| 模板实例 | `templateInstance` | 可展开的约束模板容器 |
| 约束 (10种) | `notNullConstraint`, `uniqueConstraint`, `foreignKeyConstraint`, `allowedValuesConstraint`, `rangeConstraint`, `conditionalConstraint`, `scriptedConstraint`, `charsetConstraint`, `dateLogicConstraint`, `compositeConstraint` | 各类约束规则 |

**约束三层命名映射**（新增约束类型时三处必须一致）：

| ConstraintKind（业务） | ConstraintNodeType（Vue Flow） | V2Type（后端 API） |
|----------------------|-------------------------------|-------------------|
| `notNull` | `notNullConstraint` | `NotNull` |
| `unique` | `uniqueConstraint` | `Unique` |
| `foreignKey` | `foreignKeyConstraint` | `ForeignKey` |
| `allowedValues` | `allowedValuesConstraint` | `AllowedValues` |
| `range` | `rangeConstraint` | `Range` |
| `conditional` | `conditionalConstraint` | `Conditional` |
| `scripted` | `scriptedConstraint` | `Scripted` |
| `charset` | `charsetConstraint` | `Charset` |
| `dateLogic` | `dateLogicConstraint` | `DateLogic` |
| `composite` | `compositeConstraint` | `Composite` |

### 前端 V2 导入流水线

从资源树拖拽资源到画布时的核心数据流：

```
importV2ResourceToCanvas(kind, resourceId, position)
  │
  ├── 'schema' → importSchema()
  │     ├── API: getV2Schema()
  │     ├── ensureSchemaNode() → 创建 Schema 节点
  │     ├── materializeV2EmbeddedConstraints() → 创建内嵌约束节点
  │     │     └── 对每个内嵌约束调用 buildNodeData(kind, buildInput)
  │     └── await nextTick() → reconcileAll()
  │
  ├── 'constraint' → importConstraint()
  │     ├── API: getV2Constraint()
  │     ├── ensureSchemaNode() → 确保目标 Schema 存在
  │     ├── buildNodeData(kind, buildInput)
  │     └── await nextTick() → reconcileAll()
  │
  ├── 'regex' → importRegex()
  └── 'transform' → importTransform()
```

**涉及文件**: `modules/v2/import/` 目录下的 `importV2ResourceToCanvas.ts`, `schema.ts`, `constraint.ts`, `regex.ts`, `edges.ts`；`modules/v2/shared/embeddedConstraints.ts`

### 前端持久化流水线

**保存**（`modules/v2/persistence/save.ts`）：
```
saveProject()
  ├── buildV2FullConfig() → 从画布节点构建完整 V2 配置
  ├── putV2FullConfig() → 写入 manifest + 所有 YAML 文件
  ├── putV2ProjectView() → 保存节点位置到 project.view.json
  └── 更新所有节点 saveState='saved'

saveSchemaNode(nodeId) / saveConstraintNode(nodeId) / saveRegexNode(nodeId)
  └── 各自构建对应 YAML 文件并调用 API 写入
```

**加载**（`modules/v2/persistence/load.ts`）：
```
loadProjectFromV2Config()
  ├── getV2FullConfig() → 加载完整配置
  ├── 创建 projectRoot 节点
  ├── 恢复 templateInstance 节点
  ├── 从 project.view.json 恢复位置
  └── 注意：Schema/Constraint/Regex 节点不自动加载，用户从资源树按需拖入
```

**构建器**（`services/builders/`）：`buildV2FullConfig()`, `buildV2SchemaFile()`, `buildV2ConstraintFile()` 等负责从画布状态序列化为后端 YAML 格式。

### 前端约束系统（双注册表模式）

约束系统有两个并行的自注册注册表：

| 注册表 | 文件 | 用途 |
|--------|------|------|
| **NodeDataBuilder** | `services/constraints/nodeDataBuilder/registry.ts` | 构建约束节点数据（import/embedded/connect 三种模式） |
| **ValidationRegistry** | `services/constraints/validationRegistryCore.ts` | 执行约束校验 |

**自注册机制**：每个 builder/handler 文件在模块级别调用 `registerBuilder()` 或 `register()`，通过 barrel 文件的 side-effect import 触发注册。

**校验编排三层**（`services/constraints/orchestration/`）：
- `constraintValidator.ts` — 单约束校验（调用后端 API）
- `globalValidation.ts` — 全 Schema 校验（收集连接的约束 → 批量校验 → 应用结果）
- `validationCollector.ts` — 从 edges 收集约束关系（sourceHandle 格式：`source-right-{columnId}`）

**目标引用重验**：`revalidateConstraintsReferencingSchema()` — 当外键目标 Schema 的数据源就绪后，自动重验引用该 Schema 的约束。

### 前端模板展开系统

`templateInstance` 节点是可展开的约束模板容器。展开流程在 `modules/templateExpand.ts` 中实现：

```
expandOnCanvas(instanceNodeId)
  ├── 1. collectExpandItems → 调用后端 expandV2Template() API
  ├── 2. buildDagPlan → 构建 DAG 节点+边，插入 transformOutput/manualData
  ├── 3. computeLayout → 拓扑排序 + 计算位置
  ├── 4. materializeNodes → 创建子节点（parentNode=instanceNodeId, extent='parent'）
  └── 5. materializeEdges → 创建内部边 + 回写 inputFromNode
```

容器管理：`collapseExpansion()` 隐藏子节点（hidden=true）、`reExpand()` 重新显示、`clearExpansion()` 删除子节点。

### 前端连接/边验证系统

```
用户拖拽连线
  → validateConnection() [connectionPolicyService]
    → useConnectionValidator().validateConnection()
      → 查找 connectionRules.ts 中的匹配规则
      → 检查 handle 兼容性和度数限制（传入当前 edges）
  → createConnection() [connectionOps]
    → syncOnConnect() [connectionStateSync] → 更新 parent/children/outputPortConnected

边被移除（统一路径）
  → removeEdges(edgeId)        ← UI 删除（DeletableEdge）或 程序化删除（store.deleteConnection）
    → onEdgesChange [useCanvasConnectionWatcher]  ← 唯一清理入口
      → handleEdgeRemoved() → syncOnDisconnect() + executeDisconnectCleanup()
```

**关键文件**：
- 规则定义: `services/rules/connectionRules.ts`（~25 条规则）
- 规则类型: `services/rules/connectionRuleTypes.ts`（ConnectionRule 等类型定义）
- 策略服务: `services/canvas/connectionPolicyService.ts`
- 连接监听: `composables/canvas/useCanvasConnectionWatcher.ts`

### 前端 API 层

所有 V2 API 调用在 `frontend/src/api/projectV2Api.ts`，使用 Axios（`core/services/httpClient.ts`）。

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

`e2e/` 目录包含 Playwright E2E 测试（12 用例），独立 `package.json` 和 `playwright.config.ts`。

| 测试文件 | 覆盖内容 |
|---------|---------|
| `flows/health.spec.ts` | 后端健康检查、CORS |
| `flows/validation.spec.ts` | NotNull/Unique 校验、异常处理 |
| `flows/project-config.spec.ts` | manifest/schema/数据文件加载 |
| `flows/preview.spec.ts` | CSV 预览、空文件处理 |

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

删除节点时必须同时清理其关联边。当前 `store.deleteNode` 直接替换 `nodes.value` 和 `edges.value`，**绕过了 `onEdgesChange`**，导致 `handleEdgeRemoved` / `syncOnDisconnect` 不执行。

**正确做法**：删除节点前，先逐条删除其关联边（通过 `store.deleteConnection`），再删除节点本身。或在节点删除后调用 `reconcileAll()` 重建状态。

#### undo/redo 的状态恢复

`history.ts` 使用 `shallowRef` + `toRaw()` + 不可变栈操作，恢复时直接替换 `nodes.value` 和 `edges.value`，不触发任何 hooks。恢复后会调用 `reconcileAll()` 重建连接状态。

#### 深拷贝规范

- **使用 `structuredClone()`** 进行深拷贝，禁止 `JSON.parse(JSON.stringify(...))`
- **Vue reactive proxy 不可直接 `structuredClone`** — 必须先 `toRaw()` 解包
- **history 模块** 使用 `shallowRef` + `toRaw()` + 不可变数组操作避免 reactive 污染

### 画布连接规则

任何进入 `store.edges` 的连接都必须先在 `services/rules/connectionRules.ts` 中定义对应规则。规则粒度必须精确到 handle。适用于手工拖拽、自动生成、导入恢复和展示边。

### 约束节点自注册

新增约束类型时，需同时在以下位置注册：
1. **NodeDataBuilder**（`services/constraints/nodeDataBuilder/`）— 用于构建节点数据
2. **ValidationRegistry**（`services/constraints/`）— 用于执行校验
3. **约束三层命名映射** — ConstraintKind / ConstraintNodeType / V2Type 必须一致（映射定义在 `validationRegistryCore.ts` 的 `CONSTRAINT_TYPES`）
4. **前端类型** — `frontend/src/types/nodes.ts` 添加对应的 `*NodeData` 接口

所有注册表通过 barrel 文件的 side-effect import 触发自注册。

### CustomNodeData 到 Record<string, unknown> 的安全转换

约束节点数据经常需要作为 `Record<string, unknown>` 传递给通用函数。安全方式：
- 读取时：`const data = node.data as Record<string, unknown>`
- 写入回写时：必须通过 `updateNodeData(nodeId, patches)` 而非直接修改 `node.data`

### 数据源绑定策略模式

JSON Preview 节点流程重构后，数据源绑定采用策略模式：

**策略三层架构**：
```
ColumnGenerationStrategy（列生成策略）
  ├── TabularColumnGenerator — Excel/CSV 列生成
  └── JsonColumnGenerator — JSON 对象树列生成

PreviewDataFetcher（预览数据获取）
  ├── NodePreviewFetcher — 从 preview 节点直接获取
  ├── FilePreviewFetcher — 从文件路径调用 API 获取
  └── CompositePreviewFetcher — 组合优先策略

DataSourceBindingStrategy（数据源绑定策略）
  ├── TabularDataStrategy — schema 节点绑定
  └── JsonDataStrategy — jsonSchema 节点绑定

DataSourceBindingOrchestrator（流程编排器）
  └── 协调上述三层完成完整绑定流程
```

**关键文件**：
- `utils/nodes/columnGeneration/types.ts` — 策略接口
- `utils/nodes/columnGeneration/TabularColumnGenerator.ts` — Tabular 实现
- `utils/nodes/columnGeneration/JsonColumnGenerator.ts` — JSON 实现
- `utils/nodes/preview/PreviewDataFetcher.ts` — 预览数据获取抽象
- `utils/nodes/dataSourceBinding/strategies/DataSourceBindingStrategy.ts` — 绑定策略接口
- `utils/nodes/dataSourceBinding/strategies/TabularDataStrategy.ts` — Tabular 绑定
- `utils/nodes/dataSourceBinding/strategies/JsonDataStrategy.ts` — JSON 绑定
- `utils/nodes/dataSourceBinding/DataSourceBindingOrchestrator.ts` — 流程编排

---

## features/ 目录规范

`features/` 放垂直切片功能模块，每个 feature 包含 `components/`, `composables/`, `types/`, `index.ts` 等跨层文件。

**判断标准**：跨层 + 独立内聚 + 用户可感知。不满足条件的内容放 `components/`, `composables/`, `stores/`, `types/` 等对应目录。

**已有模块**: `keyboard/`, `regex/`, `node-layout-organizer/`

---

## V2 Configuration File Standards

> 完整格式规范见 [`docs/v2-config-format.md`](docs/v2-config-format.md)，包含所有文件类型的字段定义、ID 编码规则和 10 种约束类型的 refs/params 结构。

项目配置使用 V2 YAML 格式，入口文件为 `project.precis.yaml`。

| 文件类型 | 命名 | ID 规则 |
|---------|------|--------|
| 项目清单 | `project.precis.yaml` | `project.id` 为项目标识符 |
| Schema | `schemas/*.schema.yaml` | `sc_` 前缀 + XOR + Base64URL 编码（由文件路径 + sheet 名派生） |
| Constraint | `constraints/*.constraint.yaml` | 直接使用 `node.id`（UUID） |
| Regex | `regex/*.regex.yaml` | 直接使用 `node.id` |
| Transform | `transforms/*.transform.yaml` | 直接使用 `node.id` |
| Template | `templates/*.template.yaml` | 直接使用 `node.id` |

**约束类型**（10 种）: NotNull, Unique, AllowedValues, Range, ForeignKey, Conditional, Scripted, Charset, DateLogic, Composite

**数据类型**: string, integer, decimal, boolean, datetime, date, time

---

## Pre-commit Hooks

Husky pre-commit 钩子自动执行（`.husky/pre-commit`）：
1. `cd frontend && npx lint-staged` — ESLint --fix + Prettier --write（仅暂存文件）
2. `cd backend && python -m ruff check --fix .` — 后端全量 lint 修复
3. `cd backend && python -m ruff format .` — 后端全量格式化
4. `git add` 被 ruff 修改的文件
