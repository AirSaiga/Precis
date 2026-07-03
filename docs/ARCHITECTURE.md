# 架构实现细节参考

> **⚠️ 本文档描述具体实现细节(文件清单、行数、调用图、ID 方案等),会随重构漂移。**
> 遇到与代码不一致时,**以代码为准**。稳定的架构原则、约定与陷阱见 [`AGENTS.md`](../AGENTS.md)。
>
> 本文档不替代阅读代码,仅作为快速定位的索引。如需精确信息,请直接打开对应源文件。

---

## 单一事实源指针

以下数据/映射在代码中有**唯一权威定义位置**,本文件他处的表格仅为参考副本:

| 内容 | 真实位置 |
|------|---------|
| 约束三层命名映射(ConstraintKind ↔ ConstraintNodeType ↔ V2Type) | `frontend/src/services/constraints/validationRegistryCore.ts` 的 `CONSTRAINT_TYPES`(约 151-192 行),派生 `typeToMeta`/`kindToMeta` 索引 |
| Schema ID 生成方案 | `frontend/src/services/persistence/builders/schemaBuilder.ts`(约 278 行,`schemaId = node.id`);节点 ID 来自 `createBaseNodeFactory.ts`(uuid v4 或显式传入) |
| 约束校验执行入口 | `frontend/src/services/constraints/validationRegistryCore.ts` 的 `validateConstraintNode` |
| V2 API 调用层 | `frontend/src/api/projectV2Api/`(目录,barrel 入口 `index.ts`) |
| 删除节点实现 | `frontend/src/stores/graphStore/modules/nodeOps.ts` 的 `deleteNode`/`deleteNodes` |
| vitest 覆盖率配置 | `frontend/vite.config.ts`(test.coverage 块) |

---

## 后端校验引擎流水线

```
ValidationExecutor (services/validation/executor.py)
  │
  ├── 阶段 1: 数据加载与预处理
  │     ├── DataSourceResolver → 解析文件路径
  │     ├── DataLoader → 加载 Excel/CSV/JSON
  │     │     └── 大文件(>500MB)自动切换 ChunkedDataLoader
  │     ├── MemoryMonitor → 内存监控与分块策略
  │     ├── process_dataframe → 类型转换、格式检查
  │     ├── extractors → 派生列提取(regex)
  │     └── Transform DAG → 拓扑排序执行 transform 链
  │
  └── 阶段 2: 约束校验
        └── 逐约束调用 validate(),聚合错误
              (validators/ 下每种类型一个:not_null.py, unique.py, foreign_key.py ...)
```

**分块加载阈值**:文件超 500MB 时由 `chunked_loader.py` + `memory_monitor.py` 自动按 chunk 加载。

> ⚠️ **已知限制**:分块模式下,跨表约束(如 ForeignKey)与跨块唯一性(Unique)存在正确性缺陷。详见 [`code-review-report-2026-07-03.md`](code-review-report-2026-07-03.md) #11。

---

## 前端 GraphStore 结构

采用 **Pinia Setup Store + 工厂模块拆分**。核心状态 `nodes: Ref<CustomNode[]>`、`edges: Ref<Edge[]>`、`selectedNodeId`。

### setup/ 目录(状态声明与组装)

> ⚠️ 行数为快照,会漂移,以 `wc -l` 实测为准。

| 文件 | 职责 | 行数(快照) |
|------|------|------------|
| `setup/state.ts` | 状态声明 + `updateNodeData` | ~197 |
| `setup/computed.ts` | 计算属性 | ~86 |
| `setup/assembly.ts` | 模块工厂组装,return 出公共 API | ~445 |
| `setup/index.ts` | 入口,组合以上三者 | ~14 |

### modules/ 工厂清单(约 27 个 `createXxxModule`)

> ⚠️ 工厂数量与命名会随重构变化,以 `grep "export function create" modules/` 实测为准。

| 模块分类 | 工厂(示例) | 文件 |
|---------|------------|------|
| V2 导入 | `createV2ImportModule` | `modules/v2Import.ts`(调用 `v2/import/` 子目录) |
| 持久化 | `createV2PersistenceModule` | `modules/v2/persistence/` |
| 连接操作 | `createConnectionOpsModule` | `modules/connectionOps.ts` |
| 关系同步 | `createConnectionStateSyncModule` | `modules/connectionStateSync.ts` |
| 节点操作 | `createNodeOpsModule` | `modules/nodeOps.ts` |
| 节点工厂 | `createSchemaFactoryModule`、`createConstraintFactoryModule`、`createRegexFactoryModule`、`createTransformFactoryModule` 等 | `modules/factories/` |
| 模板展开 | `createTemplateExpandModule` | `modules/templateExpand.ts` |
| 剪贴板 | `createClipboardModule` | `modules/clipboard.ts` |
| 历史 | `createHistoryModule` | `modules/history.ts` |
| YAML I/O | `createYamlIOModule` | `modules/yamlIO.ts` |
| Schema 操作 | `createSchemaOpsModule` | `modules/schemaOps.ts` |
| 选择 | `createSelectionModule` | `modules/selection.ts` |
| Regex 设计 | `createRegexDesignModule` | `modules/regexDesign.ts` |
| 项目生命周期 | `createProjectLifecycleModule` | `modules/projectLifecycle.ts` |
| 资产 | `createAssetsModule` | — |
| 路径 | `createPathingModule` | — |
| 持久化状态 | `createPersistenceStatusModule` | — |
| 作用域 | `createScopeModule` | — |

**约定**(稳定原则,见 AGENTS.md):
- 每个工厂通过参数接收 `nodes`/`edges` 等响应式引用(依赖注入),不直接 import store
- `assembly.ts` 聚合所有模块到扁平对象
- `updateNodeData()` 是修改节点数据的唯一入口

---

## 约束三层命名映射(参考副本)

> ⚠️ **单一事实源是 `validationRegistryCore.ts` 的 `CONSTRAINT_TYPES`,下表仅为参考**。新增约束类型时改代码,不要改本表。

| ConstraintKind(业务) | ConstraintNodeType(Vue Flow) | V2Type(后端 API) |
|----------------------|------------------------------|-------------------|
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

---

## 前端校验编排入口

> ⚠️ 函数命名/位置会变,以 `globalValidation.ts` 实测为准。

`services/constraints/orchestration/globalValidation.ts` 提供三个入口:

| 入口 | 用途 |
|------|------|
| `validateAllConstraints` | 全 Schema 校验 |
| `triggerValidationForNode` | 非阻塞全 Schema 校验(事件触发) |
| `dispatchValidation` | 单约束即时校验(连接建立时即时反馈) |

实际校验执行委托给 `validationRegistryCore.ts` 的 `validateConstraintNode`(按 column + constraintType 定位 edge 后调用)。

`orchestration/validationCollector.ts` 负责收集 SchemaNode 的数据源信息,不做校验本身。

---

## 前端 V2 导入/持久化/模板展开/连接 调用图

> ⚠️ 以下调用链是当前实现快照,重构会变。需要精确流程时读 `modules/v2/` 源码。

### V2 导入流水线

```
importV2ResourceToCanvas(kind, resourceId, position)   [modules/v2/import/importV2ResourceToCanvas.ts]
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

涉及文件:`modules/v2/import/` 目录(`importV2ResourceToCanvas.ts`、`schema.ts`、`constraint.ts`、`regex.ts`、`edges.ts`)+ `modules/v2/shared/embeddedConstraints.ts`。

### V2 持久化流水线

**保存**(`modules/v2/persistence/save.ts`):
```
saveProject()
  ├── buildV2FullConfig() → 从画布节点构建完整 V2 配置
  ├── putV2FullConfig() → 写入 manifest + 所有 YAML 文件
  ├── putV2ProjectView() → 保存节点位置到 project.view.json
  └── 更新所有节点 saveState='saved'

saveSchemaNode(nodeId) / saveConstraintNode(nodeId) / saveRegexNode(nodeId)
  └── 各自构建对应 YAML 文件并调用 API 写入
```

**加载**(`modules/v2/persistence/load.ts`):
```
loadProjectFromV2Config()
  ├── getV2FullConfig() → 加载完整配置
  ├── 创建 projectRoot 节点
  ├── 恢复 templateInstance 节点
  ├── 从 project.view.json 恢复位置
  └── 注意:Schema/Constraint/Regex 节点不自动加载,用户从资源树按需拖入
```

**构建器**(`services/builders/`):`buildV2FullConfig()`、`buildV2SchemaFile()`、`buildV2ConstraintFile()` 等负责从画布状态序列化为后端 YAML 格式。

### 模板展开系统

`templateInstance` 节点是可展开的约束模板容器。展开流程在 `modules/templateExpand.ts`:

```
expandOnCanvas(instanceNodeId)
  ├── 1. collectExpandItems → 调用后端 expandV2Template() API
  ├── 2. buildDagPlan → 构建 DAG 节点+边,插入 transformOutput/manualData
  ├── 3. computeLayout → 拓扑排序 + 计算位置
  ├── 4. materializeNodes → 创建子节点(parentNode=instanceNodeId, extent='parent')
  └── 5. materializeEdges → 创建内部边 + 回写 inputFromNode
```

容器管理:`collapseExpansion()` 隐藏子节点(hidden=true)、`reExpand()` 重新显示、`clearExpansion()` 删除子节点。

### 连接/边验证系统

```
用户拖拽连线
  → validateConnection() [connectionPolicyService]
    → useConnectionValidator().validateConnection()
      → 查找 connectionRules.ts 中的匹配规则
      → 检查 handle 兼容性和度数限制(传入当前 edges)
  → createConnection() [connectionOps]
    → syncOnConnect() [connectionStateSync] → 更新 parent/children/outputPortConnected

边被移除(统一路径)
  → removeEdges(edgeId)        ← UI 删除(DeletableEdge)或 程序化删除(store.deleteConnection)
    → onEdgesChange [useCanvasConnectionWatcher]  ← 唯一清理入口
      → handleEdgeRemoved() → syncOnDisconnect() + executeDisconnectCleanup()
```

关键文件:`services/rules/connectionRules.ts`(规则定义)、`services/rules/connectionRuleTypes.ts`(类型)、`services/canvas/connectionPolicyService.ts`(策略)、`composables/canvas/useCanvasConnectionWatcher.ts`(监听)。

---

## 前端数据源绑定文件清单

> ⚠️ schema(table)与 jsonSchema 两类节点的数据源绑定采用「共享通用 composable + 按节点类型特化」。以下文件清单是当前快照。

**连接处理**(在 `composables/nodes/useConnections.ts` 中按节点类型路由):
- `composables/nodes/schema/useSchemaConnectionHandler.ts` — table 版:`sourcePreview → schema`
- `composables/nodes/json/useJsonSchemaConnectionHandler.ts` — json 版:`jsonSourcePreview → jsonSchema`(按 path + recordPath 匹配)

**源管理公共层**:
- `composables/nodes/shared/useNodeSourceManager.ts` — 通用源管理,通过 options(`extractMetadata`/`generateColumns`/`onSourceConnected` 等)注入差异
- `composables/nodes/schema/useSchemaSourceManager.ts` — table 源管理
- `composables/nodes/json/useJsonSchemaSourceManager.ts` — json 源管理

**V2 配置匹配工具**:
- `utils/nodes/schema/findMatchingSchema.ts` — table 匹配(按 path + sheet)
- `utils/nodes/json/findMatchingJsonSchema.ts` — json 匹配(按 path + recordPath)

**资源同步服务**(连接成功后从 V2 配置拉取关联约束/正则节点):
- `services/schemaResourceSync.ts` — table 版
- `services/jsonSchemaResourceSync.ts` — json 版(复用 table 版的格式无关 loader)

**列生成策略类**(`utils/nodes/columnGeneration/`,纯逻辑可单测):
- `types.ts` — 策略接口
- `TabularColumnGenerator.ts` — Excel/CSV 列生成
- `JsonColumnGenerator.ts` — JSON 对象树列生成

**预览数据获取**(`utils/nodes/preview/`):
- `PreviewDataFetcher.ts` — 抽象,含 `NodePreviewFetcher` / `FilePreviewFetcher` / `CompositePreviewFetcher`

---

## 前端能力抽象层文件清单

> ⚠️ 能力层封装在 `frontend/src/core/capabilities/`,业务代码禁止直接访问 `window.electronAPI` 或调用 `isElectron()`(约定见 AGENTS.md)。

| 能力 | 文件 | 用途 |
|------|------|------|
| `appApi` | `appApi.ts` | 版本、后端端口/状态、最近项目持久化、后端重启 |
| `dialogApi` | `dialogApi.ts` | 文件/目录选择 |
| `fileApi` | `fileApi.ts` | 文件读写、上传、扫描目录 |
| `shellApi` | `shellApi.ts` | 用系统程序/编辑器打开文件、打开外部链接 |
| `updateApi` | `updateApi.ts` | 自动更新检查/下载/安装 |
| `feedbackApi` | `feedbackApi.ts` | 崩溃反馈持久化/导出 |

详细设计见 `frontend/src/core/capabilities/README.md`。

---

## E2E 测试清单

> ⚠️ `e2e/flows/` 目录,独立 `package.json` 与 `playwright.config.ts`。spec 数量会增长,以 `ls e2e/flows/*.spec.ts` 实测为准。

按主题分组(当前 24 个 spec):

| 主题 | spec 文件 |
|------|----------|
| AI Chat | `ai-chat-agent.spec.ts`、`ai-chat-confirm.spec.ts` |
| AI 配置生成 | `ai-config-generation.spec.ts`、`ai-config-migration.spec.ts` |
| Schema 生命周期 | `schema-import-validate.spec.ts`、`schema-settings-crud.spec.ts` |
| JSON Schema | `json-schema-lifecycle.spec.ts`、`json-schema-nested-constraints.spec.ts` |
| 约束 CRUD | `constraint-crud.spec.ts` |
| 校验 | `validation.spec.ts`、`validation-content-mode.spec.ts` |
| 预览 | `preview.spec.ts`、`preview-path-mode.spec.ts` |
| 错误处理 | `error-navigation.spec.ts`、`error-recovery.spec.ts` |
| 资源同步 | `resource-sync.spec.ts` |
| 模板展开 | `template-expansion.spec.ts` |
| Transform | `transform-chain.spec.ts` |
| 项目配置 | `project-config.spec.ts` |
| 全生命周期 | `full-lifecycle.spec.ts` |
| 配置 roundtrip | `roundtrip.spec.ts` |
| 健康检查/CORS | `health.spec.ts` |
| 正则校验 | `regex-validation.spec.ts` |
| 画布交互 | `ui-canvas-interactions.spec.ts` |
