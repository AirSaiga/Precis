# JSON Schema 节点重构设计

- **日期**: 2026-06-29
- **状态**: 设计已确认,待实现
- **作者**: ZCode 协作设计
- **关联**: 基于上一轮「JSON Schema 节点功能完整性分析」的深度调查结论

---

## 1. 背景与动机

Precis 项目的 JSON Schema 节点(用于定义 JSON 数据源的表结构 + 约束)目前存在**功能不完整**问题。深度分析发现,其底层基础设施(连接规则、校验编排、后端 API、数据引擎)对 jsonSchema 基本支持,但在三个层面有缺陷:

1. **数据源绑定高级流程**:相对普通 Schema(table)缺失 V2 配置恢复、资源同步、全局校验联动三大能力。
2. **约束创建入口**:`handleColumnOutputConnect` / `createTableRelation` / `watchConnectionChanges` 是死代码(已实现未接线),外键拖拽建连和连接动画完全不工作。
3. **后端嵌套约束**:挂在 JSON 嵌套子列(children)上的约束,因后端列映射不递归 children 而失效——「前端写得进 YAML,后端读不出来」。

此外存在代码健康问题:两个连接处理器(schema / jsonSchema)约 1030 行中有 ~60% 重复;`AGENTS.md` 第 730-761 行描述的「数据源绑定策略模式」架构在代码中**根本不存在**(文档失真);deprecated 列生成文件仍被引用。

### 1.1 已确认的设计决策(头脑风暴结论)

| 决策点 | 选择 |
|--------|------|
| JSON 数据形态 | 中度嵌套(2-3 层),树形为核心,约束施加到任意深层叶子 |
| 约束定位机制 | columnId 稳定引用 + 后端递归 children 映射 + 列级 jsonPath 进校验上下文 |
| 约束创建入口 | 拖线为主(对齐 table 完整能力)+ 菜单快捷(保持内嵌标记模式) |
| 绑定恢复能力 | 完整恢复(对齐 table:V2 配置恢复 + 资源同步 + 校验联动) |
| 代码架构 | 抽公共层 + 特化(Profile 配置驱动) |
| 清理范围 | 全部清理(deprecated 文件、YAML 字段统一、文档修正) |

### 1.2 数据形态边界(明确 YAGNI)

- **支持**:2-3 层嵌套对象树,约束施加到任意深层叶子字段(如 `$.user.address.city`)。
- **不支持**(本次明确排除):数组元素遍历校验、跨层条件约束等高级场景。这些属于未来「复杂文档」特性。

---

## 2. 架构总览

核心是**「Profile 配置驱动的公共连接处理器」**:把 schema / jsonSchema 两条连接流水线的公共骨架抽到 `useSchemaConnectionBase`,差异点通过声明式 `SchemaConnectionProfile` 配置注入。

```
前端
├── composables/nodes/shared/
│   ├── useSchemaConnectionBase.ts       【新增】公共连接骨架
│   ├── schemaConnectionProfile.ts       【新增】Profile 类型 + 默认配置工厂
│   └── useNodeSourceManager.ts          【已存在】源管理公共层,继续共用
├── composables/nodes/schema/
│   └── useSchemaConnectionHandler.ts    【瘦身 685→~120 行】构造 schema profile + 调 base
├── composables/nodes/json/
│   ├── useJsonSchemaConnectionHandler.ts【瘦身 345→~100 行】构造 jsonSchema profile + 调 base
│   └── useJsonSchemaInteractions.ts     【微调】死代码已在 return,本节只改调用方接线
├── utils/nodes/
│   ├── schema/findMatchingSchema.ts     【新增】table schema 匹配(从 handler 抽出)
│   └── json/findMatchingJsonSchema.ts   【新增】json schema 匹配(递归 children + recordPath 键)
└── services/
    ├── schemaResourceSync.ts            【已存在】table 资源同步
    └── jsonSchemaResourceSync.ts        【新增】json 资源同步(对称实现)

后端
├── app/shared/core/project/schema/types_parts/
│   └── column_utils.py                  【新增】iter_all_columns / build_column_id_to_name_map(递归)
├── app/shared/core/project/constraint/
│   └── factory.py                       【改】列映射改用递归工具
└── app/shared/core/project/loader/loader_parts/
    └── embedded_constraints.py          【改】4 处 name→id 解析改用递归遍历
```

### 2.1 SchemaConnectionProfile 接口

差异点收敛为声明式配置(数据而非控制流),共 8 个注入点:

```ts
interface SchemaConnectionProfile<S, J> {
  // —— 源节点识别 ——
  sourceNodeType: 'sourcePreview' | 'jsonSourcePreview'
  // —— 元数据构建 ——
  buildMetadata(sourceNode, schemaNode): Partial<J>   // sheetName vs jsonPath/recordPath/format
  smartTableName(sourceData): string                   // 表名生成策略
  // —— 列生成 ——
  generateColumns(schemaNodeId, sourceData, originalCols): void
  // —— V2 配置恢复 ——
  tryLoadConfig(params): Promise<boolean>              // 调用对应 findMatchingSchema + 列转换
  // —— 重复检测键 ——
  duplicateKey(sourceData): { path: string; extra?: string }  // (path, sheet) vs (path, recordPath)
}
```

base 处理器统一编排顺序(对齐 table 现有 `useSchemaConnectionHandler` 的 6 步):
1. 断开旧连接(一个 schema 只连一个数据源)
2. 更新元数据(`profile.buildMetadata`)
3. 成功 toast + 标记源端口已连接
4. `profile.tryLoadConfig`(失败回退 `showSmartFillDialog` 智能填充)
5. 触发校验(`triggerValidationForNode`)+ `revalidateConstraintsReferencingSchema`
6. emit 数据变更事件

两个 handler 各自只负责 `createSchemaProfile()` / `createJsonSchemaProfile()` 并返回 base 的方法。jsonSchema 由此**自动获得** V2 恢复、资源同步、校验联动(此前缺失的三大能力),无需单独实现三套逻辑。

---

## 3. 详细设计

### 3.1 Section 1:公共层抽取(架构层)

**目标**:消除两个连接处理器 ~60% 的重复,差异收敛为 Profile 配置。

**改动**:

1. 新增 `composables/nodes/shared/schemaConnectionProfile.ts`:
   - 定义 `SchemaConnectionProfile<S, J>` 接口。
   - 导出 `createSchemaProfile()` 和 `createJsonSchemaProfile()` 工厂函数。

2. 新增 `composables/nodes/shared/useSchemaConnectionBase.ts`:
   - 实现 `useSchemaConnectionBase(profile)` 接收 profile,返回 `handleSourceConnection`、`showSmartFillDialog`、`generateColumnsFromSource`。
   - 编排逻辑搬自 `useSchemaConnectionHandler` 的 `handleSourceToSchemaConnection`(L254-448)和 `showSmartFillDialog`(L460-578),差异点全部替换为 `profile.*` 调用。

3. 抽出 schema 匹配函数到独立文件:
   - `utils/nodes/schema/findMatchingSchema.ts`(从 `useSchemaConnectionHandler.ts:46-92` 抽出,table 版,按 path + sheet 匹配)。
   - `utils/nodes/json/findMatchingJsonSchema.ts`(json 版,按 path + recordPath 匹配,校验 `source.options.format`)。

4. 瘦身两个 handler:
   - `useSchemaConnectionHandler.ts`:685 行 → ~120 行,只构造 schema profile + 调 base + 保留 `useVirtualAnchorEdges`(table 特有)。
   - `useJsonSchemaConnectionHandler.ts`:345 行 → ~100 行,只构造 jsonSchema profile + 调 base。

**保持不变**:`useConnections.ts`(画布级连接分发,已正确路由两类节点)、`useNodeSourceManager.ts`(源管理公共层)、`connectionRules.ts`(已声明 jsonSchema 可连约束)。

### 3.2 Section 2:后端嵌套约束修复(P0)

**目标**:让挂在 JSON 嵌套子列上的约束真正生效。根因是两处后端文件构建列映射时只遍历顶层 `schema.columns`,不递归 `children`。

**根因引用(已验证)**:
- `backend/app/shared/core/project/constraint/factory.py:84-86`
- `backend/app/shared/core/project/loader/loader_parts/embedded_constraints.py:141-143, 149, 158, 170-171`

**改动**:

1. 新增 `backend/app/shared/core/project/schema/types_parts/column_utils.py`:
   ```python
   def iter_all_columns(columns: list[ColumnSpec]) -> Iterator[ColumnSpec]:
       """递归遍历列(含嵌套 children),深度优先。"""
       for col in columns or []:
           yield col
           if col.children:
               yield from iter_all_columns(col.children)

   def build_column_id_to_name_map(columns: list[ColumnSpec]) -> dict[str, str]:
       """递归构建 column_id -> column_name 映射。"""
       return {c.id: c.name for c in iter_all_columns(columns) if c.id is not None}
   ```

2. `factory.py:84-86` 改用递归映射:
   ```python
   column_name_by_table_id = {
       sid: build_column_id_to_name_map(s.columns) for sid, s in schema_files.items()
   }
   ```
   这使所有约束类型(NotNull/Unique/AllowedValues/Range/FK/Conditional/Charset/DateLogic/Composite)的列引用解析都能命中嵌套子列。

3. `embedded_constraints.py` 的 4 处 `next((c.id for c in schema.columns if c.name == ...), ...)` 改为遍历 `iter_all_columns(schema.columns)`,使内嵌约束的 name→id 解析能命中子列。

**前端配合**:列级 jsonPath 进入校验上下文。
- `frontend/src/services/constraints/validationContext.ts:51`:
   ```ts
   // 旧: jsonPath: (schemaData.jsonPath as string) || undefined,
   jsonPath: (column.jsonPath as string) || (schemaData.jsonPath as string) || undefined,
   ```
   嵌套叶子字段(如 `$.user.address.city`)优先用列级 jsonPath。后端约束运行时仍用 columnName 定位(已通过递归映射修复),jsonPath 作为数据取值的精确路径补充。

**测试**:
- 后端 pytest `test_constraint_factory_nested_children`:构造含嵌套列的 schema + 挂在深层子列的 notNull/unique/fk 约束,断言 `create_constraint` 不再返回"列不存在"错误,约束被正确纳入。
- 后端 pytest `test_embedded_constraints_nested`:内嵌约束 name→id 解析能命中子列。
- 遵循 AGENTS.md:fixture 优先、mock 边界不 mock 内部、命名描述行为。

### 3.3 Section 3:前端约束创建入口(P1)

**目标**:接线死代码,让 JsonSchema 能像 table 一样创建约束。

**重要校准(基于代码核实)**:菜单 toggle notNull/unique 在 **table 和 jsonSchema 行为一致**——都只在列上设标记,经 `buildColumnConstraints`(schemaBuilder.ts:163,递归 children)在保存时转为 YAML 内嵌约束,加载时后端重建。**菜单标记本身不是缺陷**,它走的是内嵌约束持久化链路,不是死代码。真正缺失的是拖线路径死代码。

**改动 1:接线拖线死代码(真实缺失)**

`frontend/src/components/nodes/json/JsonSchemaNode.vue`:
```ts
// 旧(L325): const { handleKeydown, watchSourceConnection, cleanup } = useJsonSchemaInteractions(...)
const {
  handleKeydown, watchSourceConnection, cleanup,
  handleColumnOutputConnect,   // 新增:约束拖线建连
  createTableRelation,         // 新增:外键拖到目标列建关系
  watchConnectionChanges,      // 新增:连接吸附动画
} = useJsonSchemaInteractions(props, emit)
```
并在 `onMounted` 调用 `watchConnectionChanges()`,`defineExpose` 补 `handleColumnOutputConnect` / `createTableRelation`(对齐 `SchemaNode.vue:501-508, 1033-1034`)。

底层 `useConnections.ts:633`、`useConstraintConnection.ts`(已支持 jsonSchema 递归查列)、`connectionRules.ts`(已声明 jsonSchema 可连约束)无需改动。

**改动 2:菜单行为——保持现状(明确不做)**

不把 jsonSchema 菜单改成"创建独立约束节点",因为这会破坏现有的 `buildColumnConstraints` 内嵌约束持久化链路,且与 table 行为不一致。菜单保持 toggle 内嵌标记模式。

**测试**:本节是 composable/.vue 层,由 E2E 覆盖(AGENTS.md 规范:composable 不写单测)。E2E:从 JsonSchema 嵌套叶子列拖线到 notNullConstraint 节点 → 断言约束节点创建 + 边连接 + 校验触发。

### 3.4 Section 4:数据源绑定高级流程补全(P2)

**目标**:为 jsonSchema 补齐 table 已有的三大能力。这是 Section 1 公共层抽取的主要受益点——三块逻辑只在 base 处理器一处实现。

**(1) V2 配置恢复**

jsonSchema profile 的 `tryLoadConfig` 实现为 `tryLoadJsonSchemaConfig`,逻辑参照 table 的 `tryLoadExistingSchemaConfig`(`useSchemaConnectionHandler.ts:94-220`),差异:
- 用 `findMatchingJsonSchema`(Section 3.1):匹配键是 `localPath` + `recordPath`(而非 sheet),校验 `source.options.format` 与 `format` 一致。
- 列转换用递归 children 版本(复用 `import/schema.ts` 已有的 `convertColumnsFromConfig` 递归逻辑)。
- 物化内嵌约束复用 `materializeV2EmbeddedConstraints`(已支持 jsonSchema 列查找,依赖 `findJsonSchemaColumnById`)。
- 处理 ID 不一致、检测重复数据源、rebuild 索引(table 同款逻辑,通过 profile 复用)。

**(2) V2 资源同步**

新增 `services/jsonSchemaResourceSync.ts`,参照 `services/schemaResourceSync.ts`(70-155 行)实现 `syncJsonSchemaResources`:连接成功后从 V2 配置拉取独立约束节点、正则节点、内嵌约束,创建到画布。jsonSchema profile 的 `useNodeSourceManager` options 增加 `onSourceConnected: () => syncJsonSchemaResources(...)`。

**(3) 全局校验联动**

base 处理器连接成功后统一调用(对齐 table `useSchemaConnectionHandler.ts:411-431`):
- `triggerValidationForNode(schemaNodeId, ...)` — 触发该节点约束的全局校验。
- `revalidateConstraintsReferencingSchema({...})` — 重验引用该 schema 的约束。

jsonSchema 不再只 emit `validate-json-schema` 组件级事件(移除 `useJsonSchemaConnectionHandler.ts:332-335` 的 `setTimeout` + `eventBus.emit`),改接入全局校验编排。

**复用与去重**:`findMatchingSchema`(table)/ `findMatchingJsonSchema`(json)抽到独立文件,base 通过 profile 选用;`materializeV2EmbeddedConstraints`、`triggerValidationForNode`、`revalidateConstraintsReferencingSchema` 直接复用。

**测试**:本节是 composable 编排逻辑,由 E2E 覆盖。E2E:打开含 JSON schema + 嵌套约束的已保存项目 → 连接数据源 → 断言列定义、约束节点、正则节点被恢复,约束校验状态刷新。

### 3.5 Section 5:轻微级清理 + 文档修正

**5.1 列生成文件迁移(deprecated 清理)**

- `JsonColumnGenerator`(策略类,纯逻辑:从 JSON 记录树生成列定义 + 类型推断)真正被复用。
- 旧 `utils/nodes/json/columnGeneration.ts` 的 `generateJsonColumnsFromSource`(编排:合并旧列、保留约束/ID)保留为编排入口,内部改为委托 `JsonColumnGenerator`,去掉 `@deprecated` 标记(它不是废弃,是策略编排层)。
- 调用方不变。

**5.2 useJsonSchemaSaving YAML 字段统一**

`useJsonSchemaSaving.ts:146-308` 的 `convertToYaml`/`importFromYaml` 字段名统一为后端 V2 格式:
- `jsonPath:` → `json_path:`,放 `source.options.json_path`
- `format:` → `source.options.format`
- `recordPath:` → `record_path:`,放 `source.options.record_path`
- 复用 `schemaBuilder.ts` 的 `buildJSONOptions()`,避免重复格式定义。

注:这套逻辑不参与 V2 后端持久化(真正保存走 `saveSchemaNode`),只用于"导出 YAML 下载/从文本导入"。统一后导出的 YAML 才能被后端正确回读。

**5.3 buildJSONOptions 字段补全(校准范围,有意保留缺口)**

`buildJSONOptions`(schemaBuilder.ts:120-144)当前写 `format/json_path/record_path/sep`。

校准结论:`meta_prefix`/`dtype`(后端 JSONOptions 支持)在节点 data(`JsonSchemaNodeData`)和 UI 中**都不存在**,`flatten` 甚至不在前端 `JSONOptionsV2` 类型里。补全这三个字段需要"data 字段 + UI + builder"三处联动,且这些是 pandas read_json 高级参数,中度嵌套场景几乎用不到。

遵循 YAGNI:**本次不补**。补了也是死代码(无 data/UI 承载)。在设计文档与代码注释中明确记录这一有意保留的缺口,留作未来「高级 JSON 解析选项」特性。本次只确认 `format/json_path/record_path/sep` 透传无遗漏。

**5.4 AGENTS.md 文档修正**

AGENTS.md 第 730-761 行描述的「数据源绑定策略模式」架构(`dataSourceBinding/` 目录及 `DataSourceBindingStrategy/TabularDataStrategy/JsonDataStrategy/DataSourceBindingOrchestrator`)在代码中**不存在**(Glob + Grep 双重验证)。修正为真实架构:
- 删除虚构的 `dataSourceBinding/` 目录及 4 个策略类描述。
- 替换为 `useSchemaConnectionBase` + `SchemaConnectionProfile` 的真实描述。
- 保留 `columnGeneration/` 和 `preview/` 描述(真实存在)。

**测试**:
- 5.1:JSON 列生成现有单测更新引用,验证"从 rawData 生成 + 保留旧列约束"行为不变。
- 5.2/5.3:无新单测(builder 透传逻辑),由现有持久化 E2E roundtrip 覆盖。
- 5.4:文档改动,无测试。

---

## 4. 验证矩阵

| 级别 | 问题 | 修复位置 | 验证方式 |
|------|------|----------|----------|
| P0 | 后端嵌套子列约束失效 | `factory.py` + `embedded_constraints.py` + `column_utils.py` | 后端 pytest |
| P0 | 列级 jsonPath 丢失 | `validationContext.ts:51` | E2E(嵌套字段校验) |
| P1 | 约束拖线死代码 | `JsonSchemaNode.vue` 接线 | E2E(拖线建连) |
| P2 | V2 配置恢复缺失 | `tryLoadJsonSchemaConfig` + base | E2E(项目重开恢复) |
| P2 | V2 资源同步缺失 | `syncJsonSchemaResources` | E2E(约束/正则节点恢复) |
| P2 | 全局校验联动缺失 | base 处理器统一调用 | E2E(校验状态刷新) |
| 架构 | 连接处理器重复 | `useSchemaConnectionBase` + Profile | 现有连接 E2E 回归 |
| 清理 | deprecated 列生成 | `generateJsonColumnsFromSource` 委托 | 列生成单测回归 |
| 清理 | YAML 字段不统一 | `useJsonSchemaSaving` 字段名 | 持久化 E2E roundtrip |
| 文档 | AGENTS.md 失真 | 第 730-761 行重写 | 人工审阅 |

---

## 5. 风险与回退

**风险 1:公共层抽取影响 table 现有行为**
- 缓解:base 处理器的编排逻辑逐行搬自 table 现有实现,差异点全部参数化为 profile。table 的现有 E2E(连接、智能填充、校验)作为回归网。若 table 行为回归,profile 边界划分有问题,可快速定位。

**风险 2:后端递归 children 改动影响平面 schema**
- 缓解:`iter_all_columns` 对无 children 的平面列等价于原逻辑(只 yield 顶层),行为不变。平面 schema 的现有 pytest 作为回归网。

**风险 3:范围较大,引入回归**
- 缓解:按 Section 顺序分阶段实施(P0 后端独立可先验证 → P1 接线 → P2 补全 → 架构抽取放最后或最先,视依赖)。每个 Section 完成后跑相关测试再进入下一个。

---

## 6. 明确不做(YAGNI 边界)

- **数组元素遍历校验**:本次不支持,属未来「复杂文档」特性。
- **跨层条件约束**:本次不支持。
- **菜单创建独立约束节点**:保持内嵌标记模式,与 table 一致。
- **`meta_prefix`/`dtype`/`flatten` 配置 UI**:节点 data 和 UI 无承载,补了是死代码,留作未来特性。
- **`useJsonSchemaSaving` 改造为参与 V2 后端持久化**:它只负责本地 YAML 导出/导入,与 `saveSchemaNode` 主链路保持分离。
