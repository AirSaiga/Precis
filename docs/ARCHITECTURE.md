# 架构实现细节参考

> **⚠️ 本文档描述具体实现细节(文件清单、行数、调用图、ID 方案等),会随重构漂移。**
> 遇到与代码不一致时,**以代码为准**。稳定的架构原则、约定与陷阱见 [`AGENTS.md`](../AGENTS.md)。
>
> 本文档不替代阅读代码,仅作为快速定位的索引。如需精确信息,请直接打开对应源文件。
> 本文档已纳入版本控制(.gitignore 例外规则),重构涉及结构变化时请随手同步更新。

---

## 单一事实源指针

以下数据/映射在代码中有**唯一权威定义位置**,本文件他处的表格仅为参考副本:

| 内容 | 真实位置 |
|------|---------|
| 约束三层命名映射(ConstraintKind ↔ ConstraintNodeType ↔ V2Type) | `frontend/src/services/constraints/constraintMeta.ts` 的 `CONSTRAINT_TYPES`,派生 `typeToMeta`/`kindToMeta` 索引。注:`validationRegistryCore.ts` 已拆分为 5 子模块并退化为 barrel re-export,不再直接定义 `CONSTRAINT_TYPES` |
| Schema ID 生成方案 | `frontend/src/services/persistence/builders/schemaBuilder.ts`(`schemaId = node.id`);节点 ID 来自 `modules/factories/createBaseNodeFactory.ts`(uuid v4 或显式传入) |
| 约束校验执行入口 | `frontend/src/services/constraints/validationRegistryCore.ts` 的 `validateConstraintNode`(实际实现在拆分后的 `validationExecutors.ts`) |
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

> ⚠️ **已知限制**:分块模式下,跨表约束(如 ForeignKey)与跨块唯一性(Unique)存在正确性缺陷。

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

### modules/ 工厂清单(约 26 个 `createXxxModule`)

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
| 视图筛选 | `createViewFilterModule` | `modules/viewFilter.ts`(视图模式三态 + 节点类型分组显隐;只管理自己隐藏的节点,与坞聚合隐藏互不侵犯;localStorage 按项目配置路径分桶持久化,不进 project.view.json) |

**约定**(稳定原则,见 AGENTS.md):
- 每个工厂通过参数接收 `nodes`/`edges` 等响应式引用(依赖注入),不直接 import store
- `assembly.ts` 聚合所有模块到扁平对象
- `updateNodeData()` 是修改节点数据的唯一入口

---

## 约束三层命名映射(参考副本)

> ⚠️ **单一事实源是 `constraintMeta.ts` 的 `CONSTRAINT_TYPES`,下表仅为参考**。新增约束类型时改代码,不要改本表。(`validationRegistryCore.ts` 已退化为 barrel re-export,不再定义此常量)

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

`templateInstance` 节点是可展开的约束模板容器。展开流程分两个文件：纯规划与节点数据构建在 `modules/templateExpandPlanning.ts`,工厂闭包(展开状态/布局/物化/折叠)在 `modules/templateExpand.ts`:

```
expandOnCanvas(instanceNodeId)                    [templateExpand.ts]
  ├── 1. collectExpandItems → 调用后端 expandV2Template() API   [templateExpandPlanning.ts]
  ├── 2. buildDagPlan → 构建 DAG 节点+边,插入 transformOutput/manualData  [templateExpandPlanning.ts]
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
| `appApi` | `appApi.ts` | 版本、后端端口/状态、最近项目持久化、后端重启、界面语言同步、后端 API token 获取 |
| `dialogApi` | `dialogApi.ts` | 文件/目录选择 |
| `fileApi` | `fileApi.ts` | 文件读写、上传、扫描目录 |
| `shellApi` | `shellApi.ts` | 用系统程序/编辑器打开文件、打开外部链接 |
| `updateApi` | `updateApi.ts` | 自动更新检查/下载/安装 |
| `feedbackApi` | `feedbackApi.ts` | 崩溃反馈持久化/导出 |

详细设计见 `frontend/src/core/capabilities/README.md`。

---

## E2E 测试清单

> ⚠️ `e2e/flows/` 目录,独立 `package.json` 与 `playwright.config.ts`。spec 数量会增长,以 `ls e2e/flows/*.spec.ts` 实测为准。

按主题分组(当前 38 个 spec):

| 主题 | spec 文件 |
|------|----------|
| AI Chat | `ai-chat-agent.spec.ts`、`ai-chat-confirm.spec.ts`、`ai-chat-respond.spec.ts` |
| AI 配置生成 | `ai-config-generation.spec.ts`、`ai-config-migration.spec.ts` |
| AI 确定性守卫 | `ai-fake-provider.spec.ts`（fake provider 演练 agent 写盘/生成/迁移三链路 + v2 变更集信封断言 + GUI 保存 roundtrip，无真实 key 也可跑） |
| Schema 生命周期 | `schema-import-validate.spec.ts`、`schema-settings-crud.spec.ts` |
| JSON Schema | `json-schema-lifecycle.spec.ts`、`json-schema-nested-constraints.spec.ts` |
| 约束 CRUD/覆盖 | `constraint-crud.spec.ts`、`constraint-types-coverage.spec.ts` |
| 校验 | `validation.spec.ts`、`validation-content-mode.spec.ts` |
| 预览 | `preview.spec.ts`、`preview-path-mode.spec.ts` |
| 错误处理 | `error-navigation.spec.ts`、`error-recovery.spec.ts` |
| 资源树/同步 | `resource-sync.spec.ts`、`resource-tree-filter.spec.ts` |
| 模板/转换 | `template-expansion.spec.ts`、`transform-chain.spec.ts` |
| 项目管理 | `project-config.spec.ts`、`project-lifecycle-ui.spec.ts`、`project-management-switch.spec.ts` |
| 检查器/报告 | `inspector-batch.spec.ts`、`inspection-fix.spec.ts`、`report-history.spec.ts` |
| 画布交互/回归 | `ui-canvas-interactions.spec.ts`、`canvas-interaction-regression.spec.ts`、`typography-regression.spec.ts` |
| 模式切换/修复回归 | `mode-toggle.spec.ts`、`decision-fixes.spec.ts` |
| 设置/手动数据 | `settings-and-manual-data.spec.ts` |
| 全生命周期/roundtrip | `full-lifecycle.spec.ts`、`roundtrip.spec.ts` |
| 健康检查/CORS | `health.spec.ts` |
| 正则校验 | `regex-validation.spec.ts` |

---

## AI 聊天画布同步（v2 变更集对账，文件唯一事实源 D1）

> 自 `AGENTS.md` 搬入（原文）。红线摘要仍留在 AGENTS.md；本节是完整约定。

AI 聊天（agent 模式）的画布同步走**变更集对账**架构：后端写盘后发 `frontend_instruction` 变更集**信封**（六字段：`instructionId`/`actionType`/`op`/`kind`/`entityId`/`filePath`，**不携带实体数据**，契约见 `docs/contracts/frontend-instructions-v2.md`），前端 `services/canvasReconcile/` 把信封入**全局串行对账队列**，统一动作为"从磁盘重读重建画布"（`importV2ResourceToCanvas`，幂等；remove 走 `graphStore.deleteNode` 级联清理）。旧的"镜像 handler 双写"链路（指令内嵌实体数据、前端按 actionType 各自建节点）已删除——uuid 脱钩、竞态、参数丢失三类 bug 均源于该双写。

**链路**：后端提示词 → LLM action → 写盘 → `frontend_instructions.py` 生成信封 → SSE 流式逐条 emit（画布实时生长）+ completed 快照兜底 → 前端解析信封（`parseChangeSetEnvelope` 运行时校验）→ 对账队列（`planFromChangeSet` 按 instructionId **末见**去重、同实体 add+update 折叠、**保序不重排**）→ 执行结果聚合为 `canvasSync` 摘要（聊天 UI 呈现 + 失败 toast）→ 队列排空后刷新 workspaces 快照。

**rebuild 的 add/update 语义（refreshExisting）**：`importV2ResourceToCanvas` 对已存在节点默认幂等早退（不重读）；对账 rebuild 在**节点已存在**时传 `refreshExisting: true` 走原地刷新——磁盘为准重读并经 `updateNodeData` 整体替换节点 data（Schema 含内嵌约束三态对账：新增物化/参数刷新/幽灵移除；regex↔regexExtract、约束类型变更等 node type 级变化按删旧建新处理），不删节点、不丢布局、不弹确认窗。contract 的"add: 已存在则幂等刷新"由此落地——**改导入器已存在分支的早退行为时必须对照 refreshExisting 路径**（测试：`tests/services/canvasReconcile/refreshExisting.integration.test.ts`，真实 v2Import 工厂 + mock vueFlowApi 边界）。

**幂等与去重（两层）**：执行幂等由 `refreshExisting` 磁盘重读保证（completed 快照是权威全量列表，整批重放终态恒等于磁盘，自愈流式丢帧）；队列 pending-id coalescing 只对"仍在排队/执行中"且**同批次内该实体仅一条操作**的条目去重（多操作批次豁免，保住删后重建时序）。

**AI 删除与撤销栈**：对账 remove 走 `graphStore.deleteNode(id, { recordHistory: false })`——磁盘已删的实体不入撤销栈，防 Ctrl+Z 复活后被全量保存写回磁盘（静默回滚 AI 的删除）。手动删除仍默认入栈。

**改动时的触点清单**：

| 改动 | AI 链路必查触点 |
|------|----------------|
| 新增约束类型 | 后端 registry 白名单+别名+`CONSTRAINT_PARAM_SCHEMAS` 参数文档（chat 提示词约束参数段与 MCP describe_constraints 均从它派生，漏写守卫测试即红）→ `npm run codegen` → 前端五处注册（见 AGENTS.md 约束节点自注册节）。前端无需为画布同步改代码（磁盘重读自动覆盖），但保存链路读取侧（`persistence/builders/**`）须支持该类型 |
| 信封新增 kind（如 manualData/template 转正） | `canvasReconcile/envelope.ts` 的 KINDS 集合 + `executor.ts` 的 IMPORTABLE_KINDS（当前这两个 kind 的 rebuild 会记 failed，契约漂移可见）→ `importV2ResourceToCanvas` 增加导入工厂分支 → `tests/services/canvasReconcile/` 补用例 |
| 修改 `importV2ResourceToCanvas` 行为/选项 | executor 的 rebuild 选项组合（与 `hydrateResourcesFromConfig` 范本一致：`recordHistory: false` + `skipRelatedConstraints: true` + `refreshExisting: 按节点是否已存在`）双侧对照；`refreshExisting` 的原地刷新实现分散在 schema.ts（`refreshSchemaNode`）/regex.ts/constraint.ts/importTransform 的已存在分支，改一处须四kind 同步 |
| 修改对账队列/计划器语义 | `tests/services/canvasReconcile/`（plan 纯逻辑全分支 / 队列串行顺序 / remove 级联 / 失败收集）与 `tests/services/aiChatInstructionService.test.ts`（mock 边界：graphStore + vueFlowApi；**vueFlowApi mock 必须导出 `VueFlowApiNotInitializedError`**，缺导出会让 instanceof 守卫静默失效） |
| 修改 SSE 信封契约 | 以 `docs/contracts/frontend-instructions-v2.md` 为权威先改契约文档，前后端同步（同仓库同发布硬切换） |

**op 顺序语义**：`planFromChangeSet` 保持输入（到达）时间序，不做"add 先于 remove"的全局重排——磁盘是唯一事实源，同实体 remove→add（删后重建）保序执行才得到正确终态；跨实体无正确性依赖（rebuild 自带依赖处理、remove 自带级联清理）。同实体 add+update 折叠为一次磁盘重读（落在最后一次出现位置）。

**确定性守卫（已就位）**：后端 `providers/fake.py` 提供 `ProviderType.FAKE` 确定性剧本（为 users.nickname 添加 chinese_mixed Charset 约束），E2E `e2e/flows/ai-fake-provider.spec.ts` 借它无 key 守卫 AI 三链路（agent 聊天两阶段确认写盘 + **v2 信封断言（entityId ≡ 磁盘文件 id）** / 配置生成 / 配置迁移）与 **GUI 保存 roundtrip**（AI 建约束 → 画布节点 id == 磁盘实体 id → 保存 → 重载无重复节点）；三个真实 Provider spec 保留不变。改 fake 剧本或三链路提示词特征字样（`build_prompt` 的 "## 输出要求"/"regex_nodes"、迁移消息的 "迁移"）时须同步该 spec 与 `backend/tests/unit/test_fake_provider.py`。

---

## Vue Flow 机制详解

> 自 `AGENTS.md` 搬入（原文）。禁止操作表与时序红线仍留在 AGENTS.md；本节是机制背景。

**数组替换 vs API 的机制差异**：`addEdges`/`removeEdges` 走 `applyChanges` 增量 splice，**触发 hooks**，仅验证新操作的边；`edges.value = [...]` 走 `setEdges` 全量替换，**不触发 hooks**，所有边重新验证——且 `createGraphEdges` 对每条边 `findNode(edge.source)` 找不到就 `continue` **静默丢弃**（即使节点在 `edges.value` 里，只要 Vue Flow 内部 `state.nodes` 没有，边就消失）。

> **⚠️ 边陷阱勿外推到节点**：上述"静默丢弃"**仅适用于 `edges.value = [...]`（边的全量替换）**。节点全量替换 `nodes.value = [...]` 走 `createGraphNodes`，不会重验边、不会丢边，也不会重复建节点（`parseNode` 对同 id 做 `Object.assign` 去重，`addNodes` 的 add 分支也有 `findIndex(id)` 去重）。节点全量替换的真正代价只是冗余全量重建（性能）+ 不必要的 `setNodes` 副作用，非数据损坏。判断 Vue Flow 风险时务必区分操作的是节点数组还是边数组。

### 幂等创建节点（ensureXxx 模式）

`ensureSchemaNodeFromV2` 这类"先 `nodes.value.find` 判存在、不存在则创建"的幂等函数，要保证第二次调用能 `find` 到刚创建的节点：

```ts
const existing = nodes.value.find((n) => n.id === id)
if (existing) return existing
// ... 构造 node ...
addNodes(node)
await nextTick()          // ← 等 v-model model→store 回写，本 tick 后续 find 即可命中
return node
```

不要用"addNodes 后手动追加数组"来同步（见 AGENTS.md 禁止操作表）。

### undo/redo 的状态恢复

`history.ts` 使用 `shallowRef` + `toRaw()` + 不可变栈操作，恢复时直接替换 `nodes.value` 和 `edges.value`（不触发 hooks），恢复后调用 `reconcileAll()` 重建连接状态。

---

## 测试编写细则

> 自 `AGENTS.md` 搬入（原文）。核心原则与缺陷处理分级仍留在 AGENTS.md；本节是具体编写规则。

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

## 深拷贝规范（按数据类型选择，不一刀切）

> 自 `AGENTS.md` 搬入（原文）。

- 含非 JSON 类型（Date/Map/Set/RegExp 等）必须 `structuredClone()`——`JSON.parse(JSON.stringify(...))` 会静默丢类型（Date→string、RegExp→空对象、Map/Set→空）
- 纯 JSON 配置数据（manifest / 数据源 / 快捷键等 YAML round-trip 数据）可用 JSON 方式——数据本身 JSON 安全，小对象性能更好
- Vue reactive proxy 不可直接 `structuredClone`（抛 "could not be cloned"）；`toRaw()` 只解顶层 proxy，嵌套仍是 proxy，深拷贝需递归解包或改 JSON 方式
- 不确定时优先 `structuredClone()` 兜底；history 模块用 `shallowRef` + `toRaw()` + 不可变数组操作避免 reactive 污染

---

## Electron IPC 文件路径安全（XSS → 文件读写的纵深防御）

> 自 `AGENTS.md` 搬入（原文）。红线摘要仍留在 AGENTS.md；本节是完整约定。

文件相关 IPC（`read-file`/`write-file`/`open-file`/`scan-directory`）由 renderer 经 `window.electronAPI.*` 调用，**一旦发生任意 XSS 即成为攻击面**，路径校验是纵深防御关键一层：

- **禁止用 `resolved !== path.normalize(input)` 这类"比较 resolve 结果"的写法判穿越**——绝对路径含 `..` 时 `path.resolve` 与 `path.normalize` 输出相同，比较恒真，校验形同虚设。正确做法是**根目录包含校验**：`path.resolve(input)` 后判断是否落在白名单根（`app.getPath('userData')`、当前项目 configDir 等）之下（`resolved === root || resolved.startsWith(root + path.sep)`）
- **`write-file` 等可写操作必须比可读更严**（写入还能 `mkdirSync({recursive:true})` 创造路径），建议落到白名单根下
- **`open-file`（`shell.openPath`）必须限定扩展名**（数据文件 `.csv/.xlsx/.json/.yaml/...`），拒绝可执行/脚本（`.exe/.bat/.ps1/.scr/.cmd` 等）——否则配合写原语可形成 RCE 链
- **`scan-directory` 必须限定根目录**、不跟随顶层符号链接（`fs.lstatSync`）、设递归深度上限
- renderer 可传任意字符串的文件路径都视为不可信；路径优先取自原生 `dialog.showOpenDialog` 返回值，而非 renderer 自由构造的字符串

---

## i18n key 完整性守卫细则

> 自 `AGENTS.md` 搬入（原文）。守卫红线仍留在 AGENTS.md；本节是操作细节。

- 脚本 `frontend/scripts/audit-i18n.mjs`（frontend 目录 `npm run audit:i18n`）；allowlist `frontend/i18n-audit-exceptions.json`，含 `dynamicPrefixes`（``t(`ns.${var}`)`` 动态前缀豁免）与 `baseline*`（治理前存量快照）
- **守卫语义**：仅"超出 baseline 的新增违规"（`[new]`）判失败；存量 `[baseline]` 不阻断，修复后从 baseline 移除即收紧
- 动态 key（``t(`inspection.severity.${sev}`)``）需把前缀登记进 `dynamicPrefixes`，否则该命名空间叶子 key 会被误判缺失/未用
- 刷新快照：`npm run audit:i18n -- --update-baseline` 把 missing/onlyZh/onlyEn/unused 四类基线写回 allowlist（仅当新增项确属合理存量时使用，并确认 baseline 数未增长）

---

## AI 动作类型契约（Codegen）细则

> 自 `AGENTS.md` 搬入（原文）。

- 生成物 `frontend/src/types/generated/actions.ts`（`ActionType` 联合类型 + 4 个分类 Set + 只读/写盘 Set + **约束类型映射** `CONSTRAINT_TYPE_MAP`/`CONSTRAINT_TYPE_ALIASES`/`CANONICAL_CONSTRAINT_TYPES`）——**禁止手改**
- 脚本 `frontend/scripts/codegen.mjs`（frontend 目录 `npm run codegen`）；CI 后端 job 末尾跑 codegen 并 `git diff` 校验生成物与提交一致
- **修改 `registry.py` 的 `ACTIONS`/`CONSTRAINT_TYPES`/`CONSTRAINT_TYPE_ALIASES` 后必须跑 `npm run codegen` 重新生成并提交 `actions.ts`**，否则 CI 失败。前端业务代码从 `@/types/generated/actions` import，**禁止硬编码动作类型集合与约束类型映射**（`services/aiChatInstructions/connectionOps.ts` 的 `CONSTRAINT_TYPE_MAP` 即是 re-export 生成物，勿回退为手写表）

---

## AI Provider 预设（国内大模型）细则

> 自 `AGENTS.md` 搬入（原文）。

AI Provider 预设的**单一事实源**是 `backend/app/shared/services/llm/config/presets.py`——前端设置页"添加 AI 模型"预设下拉、CLI `provider add` 菜单、TUI 均经 `GET /providers/presets` 消费，前端零硬编码。新增/更新国内大模型支持只改该文件数据（`type` 仅 `openai`/`ollama`，国内厂商一律 `openai`，base_url 须为 OpenAI 兼容端点且版本路径带全、无尾斜杠）。**更新时务必搜索核对模型型号是否最新**（厂商迭代快：GLM-5.1→5.3、MiniMax M2→M3 均数月内换代）。各家 base_url/模型 ID/鉴权陷阱（MiniMax 双 i 域名、GLM 旧模型名自动路由等）、收录范围决策与新增/更新 SOP 见 `backend/app/shared/services/llm/config/AI_PROVIDER_PRESETS.md`——**改预设必须同步该文档的表格与核对日期**；`TestPresetCatalog` 单测守卫国内主流厂商覆盖与字段不变量。

---

## npm workspaces 与依赖钉版细则

> 自 `AGENTS.md` 搬入（原文）。红线摘要仍留在 AGENTS.md；本节是完整说明。

`frontend` / `electron` / `e2e` 是根 package.json 的 workspaces，依赖统一 hoist 到根 `node_modules`，子包 lockfile 已合并为根单一 `package-lock.json`——**不要在子目录单独 `npm install`/`npm ci`**（会整树重装），安装/CI 一律在根目录执行一次。`overrides` 只在根 package.json 生效（子包中的 overrides 会被 npm 忽略并告警），安全补丁与版本钉版统一加在根。其中 `vue` 被钉在 `3.5.22`：更新版本（≥3.5.23）的类型与 graphStore 深层泛型叠加触发 `TS2589`（type instantiation excessively deep），升级 vue 前须先解决该类型深度问题；`vue-tsc` 被钉在 `3.1.1`：3.3.x 在 `composite` 构建下会把 `.js` 产物直接 emit 进 `src/`（污染源码树、被 eslint 扫到、可能 shadow `.ts` 导入），升级 vue-tsc 前须确认不再 emit。electron 镜像配置在根 `.npmrc`（workspace 安装不读 `electron/.npmrc`）。electron-builder 两个 hoist 适配（`electron/package.json` 的 build 字段，勿随意移除）：`electronVersion` 显式固定（版本探测只查 `electron/node_modules`，hoist 后读不到；**升级 electron 依赖时必须同步该字段**）；`npmRebuild: false`（否则 electron-builder 发现 `electron/node_modules` 不存在会在 electron 目录执行 `npm install --production`，workspaces 下这会**清掉整棵依赖树的全部 devDependencies**；sharp 等 N-API 预编译二进制无需 rebuild）。
