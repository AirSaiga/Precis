# AGENTS.md

This file provides guidance to Qoder (qoder.com) when working with code in this repository.

> **项目状态**: 超早期原型阶段（Pre-Alpha）。测试覆盖严重不足，代码随时可能大规模重构。修改代码时应格外谨慎：优先做最小改动，避免大规模重构。

## Build & Run Commands

### 安装依赖

```bash
npm run install:all           # 安装全部依赖（root + frontend + electron）
cd backend && pip install -e ".[dev]"  # 后端开发依赖（含 ruff、pytest、mypy）
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
cd frontend && npm run type-check    # vue-tsc 类型检查
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
cd frontend && npm run test          # vitest 运行全部测试
cd frontend && npm run test:watch    # vitest watch 模式
cd backend && python -m pytest       # pytest 运行全部测试
npm run cli:validate                 # CLI 校验测试套件
```

---

## Tech Stack

| 层级 | 技术 |
|------|------|
| 前端 | Vue 3 + TypeScript + Vite + Pinia + Vue Router + Vue I18n + Vue Flow |
| 后端 | Python + FastAPI + Uvicorn + Pydantic + Pandas |
| 桌面端 | Electron Forge + TypeScript |
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

### 前端 GraphStore（God Store + 工厂模块）

graphStore 是画布的核心状态管理，采用 **Pinia Setup Store + 工厂模块拆分**模式。

**核心文件**: `frontend/src/stores/graphStore/setup.ts`

**核心状态**: `nodes: Ref<CustomNode[]>`, `edges: Ref<Edge[]>`, `selectedNodeId`

**模块拆分**（~20 个 `createXxxModule()` 工厂函数，通过闭包参数注入依赖）：

| 模块分类 | 模块工厂 | 文件 |
|---------|---------|------|
| **V2 导入** | `createV2ImportModule` | `modules/v2Import.ts` |
| **持久化** | `createV2PersistenceModule` | `modules/v2/persistence/` |
| **连接操作** | `createConnectionOpsModule` | `modules/connectionOps.ts` |
| **关系同步** | `createConnectionStateSyncModule` | `modules/connectionStateSync.ts` |
| **节点工厂** | `createSchemaFactoryModule`, `createConstraintFactoryModule`, `createRegexFactoryModule`, `createTransformFactoryModule` 等 | `modules/factories/` |
| **剪贴板** | `createClipboardModule` | `modules/clipboard.ts` |
| **历史** | `createHistoryModule` | `modules/history.ts` |

**关键约定**：
- 每个模块工厂通过参数接收 `nodes`, `edges` 等响应式引用（依赖注入），不直接导入 store
- `setup.ts` 末尾将所有模块导出聚合到一个扁平对象中
- `updateNodeData()` 是修改节点数据的唯一途径：`nodes.value = updateNodeDataInArray(nodes.value, nodeId, newData)`

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

### 前端约束系统（双注册表模式）

约束系统有两个并行的自注册注册表：

| 注册表 | 文件 | 用途 |
|--------|------|------|
| **NodeDataBuilder** | `services/constraints/nodeDataBuilder/registry.ts` | 构建约束节点数据（import/embedded/connect 三种模式） |
| **ValidationRegistry** | `services/constraints/validationRegistryCore.ts` | 执行约束校验 |

**自注册机制**：每个 builder/handler 文件在模块级别调用 `registerBuilder()` 或 `register()`，通过 barrel 文件的 side-effect import 触发注册。

**支持的约束类型** (`ConstraintKind`)：`notNull`, `unique`, `foreignKey`, `allowedValues`, `range`, `conditional`, `scripted`, `charset`, `dateLogic`, `composite`

### 前端连接/边验证系统

```
用户拖拽连线
  → validateConnection() [connectionPolicyService]
    → useConnectionValidator().validateConnection()
      → 查找 connectionRules.ts 中的匹配规则
      → 检查 handle 兼容性和度数限制
  → createConnection() [connectionOps]
    → syncOnConnect() [connectionStateSync] → 更新 parent/children/outputPortConnected

边被移除
  → useCanvasConnectionWatcher (watch store.edges)
    → handleEdgeRemoved() → syncOnDisconnect()
```

**关键文件**：
- 规则定义: `services/rules/connectionRules.ts`（~25 条规则）
- 策略服务: `services/canvas/connectionPolicyService.ts`
- 连接监听: `composables/canvas/useCanvasConnectionWatcher.ts`

### Electron 集成

Electron 主进程 (`electron/src/main.ts`) 负责：
1. 动态分配端口 → 启动 Python 后端子进程（`uvicorn`）
2. 健康检查（TCP + HTTP 轮询）
3. 创建 BrowserWindow 加载前端
4. 通过 `preload.ts` 暴露 `window.electronAPI.*`（文件系统、对话框、配置等 IPC）

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

---

## Critical Patterns & Pitfalls

### Vue Flow v-model 双向绑定的数组操作

Vue Flow 通过 `v-model:nodes="store.nodes"` 实现双向同步（prop 下传 + emit 回写），内部维护状态副本。不当操作会导致竞态，造成节点/边消失。

**规则**：
1. **v-model 数组的修改必须批量替换** — 先收集补丁到 Map，最后做**一次** `nodes.value = newArray` 替换。禁止在循环中多次替换。
2. **添加节点与修改节点之间必须 `await nextTick()`** — 先 push 新节点，等 Vue 处理完后（`nextTick`）再执行 `reconcileAll()` 等关系重建操作。
3. **`edges.value.push()` 不触发 Vue Flow 同步** — 必须用 `edges.value = [...edges.value, newEdge]` 创建新数组引用。

### 画布连接规则

任何进入 `store.edges` 的连接都必须先在 `services/rules/connectionRules.ts` 中定义对应规则。规则粒度必须精确到 handle。适用于手工拖拽、自动生成、导入恢复和展示边。

### reconcileAll() 设计约束

`reconcileAll()`（`connectionStateSync.ts`）从 edges 重建所有 parent/children/outputPortConnected 状态。它必须：
- 收集所有补丁后通过**单次** `nodes.value` 替换应用（批量模式）
- 仅在 `nextTick` 之后调用（等 Vue Flow 处理完节点变更）

### 约束节点自注册

新增约束类型时，需同时在两个注册表中注册：
1. **NodeDataBuilder**（`services/constraints/nodeDataBuilder/`）— 用于构建节点数据
2. **ValidationRegistry**（`services/constraints/`）— 用于执行校验

两个注册表都通过 barrel 文件的 side-effect import 触发自注册。

---

## features/ 目录规范

`features/` 放垂直切片功能模块，每个 feature 包含 `components/`, `composables/`, `types/`, `index.ts` 等跨层文件。

**判断标准**：跨层 + 独立内聚 + 用户可感知。不满足条件的内容放 `components/`, `composables/`, `stores/`, `types/` 等对应目录。

**已有模块**: `keyboard/`, `regex/`, `node-layout-organizer/`

---

## V2 Configuration File Standards

项目配置使用 V2 YAML 格式，入口文件为 `project.precis.yaml`。

| 文件类型 | 命名 | 说明 |
|---------|------|------|
| 项目清单 | `project.precis.yaml` | 索引所有 Schema/Constraint/Regex 资源 |
| Schema | `*.schema.yaml` | 表结构定义（列、数据类型、内嵌约束） |
| Constraint | `*.constraint.yaml` | 独立约束（refs + params 分离设计） |
| Regex | `*.regex.yaml` | 正则节点（引用模式或直接模式） |

**约束类型**: NotNull, Unique, AllowedValues, Range, ForeignKey, Conditional, Scripted, Charset, DateLogic

**数据类型**: string, integer, decimal, boolean, datetime, date, time

---

## Pre-commit Hooks

Husky pre-commit 钩子自动执行（`.husky/pre-commit`）：
1. `cd frontend && npx lint-staged` — ESLint --fix + Prettier --write（仅暂存文件）
2. `cd backend && python -m ruff check --fix .` — 后端全量 lint 修复
3. `cd backend && python -m ruff format .` — 后端全量格式化
4. `git add` 被 ruff 修改的文件
