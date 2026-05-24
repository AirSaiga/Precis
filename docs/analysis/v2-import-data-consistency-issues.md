# V2 导入（资源树 → 画布）数据一致性问题分析

## 概述

本文档分析从本地配置文件（V2 项目配置）通过资源树导入到画布时，节点创建与连接建立产生的数据同步和状态不一致问题。

---

## 问题 1: Charset / DateLogic / Composite 缺少显式导入处理

**文件**: `frontend/src/stores/graphStore/modules/v2/import/constraint.ts:387-407`

**现状**: `constraint.ts` 有 7 种约束类型的显式 `if` 分支（AllowedValues、Range、ForeignKey、NotNull、Unique、Conditional、Scripted），但 Charset、DateLogic、Composite 这 3 种没有，会落入兜底逻辑：

```typescript
// 行 387-395：兜底处理 — 原始展开，无结构化处理
data: {
  ...(c as unknown as Record<string, unknown>),
  saveState: 'saved',
}
```

**影响**:
- `sourceRef` 等关键字段可能缺失（除非后端返回的原始数据中恰好包含 `sourceRef` 字段名）
- `charsetMode`、`logicMode` 等类型特有字段不会被正确设置
- 与手动创建这些约束节点的数据结构不一致

---

## 问题 2: Conditional 约束导入只创建 THEN 列的边

**文件**: `frontend/src/stores/graphStore/modules/v2/import/constraint.ts:347`

**现状**:
```typescript
if (tableId && thenColId) ensureSchemaToConstraintEdge(tableId, resourceId, thenColId)
```

所有 `if` 条件引用的列（`ifConditions[].ref`）没有对应的边。

**影响**:
- **画布视觉不一致**: 手动创建的 Conditional 约束会为每个 IF 条件创建独立的 IF 边（虚线绿色），导入的只有 THEN 边
- **`reconcileAll()` 只会为 THEN 列建立 parent/children 关系**，IF 条件列不会被追踪
- 断开重连时 IF 条件的 `edgeId` 引用缺失，清理逻辑可能不完整
- Conditional 节点的 `targetHandle` 只标记了 THEN 端口，IF 端口没有对应边

---

## 问题 3: 内嵌约束物化时 FK/Conditional/Scripted/Charset/DateLogic 缺少显式处理

**文件**: `frontend/src/stores/graphStore/modules/v2/shared/embeddedConstraints.ts:166-176`

**现状**: 只有 `AllowedValues`、`NotNull`、`Unique`、`Range` 有显式处理。其余类型走兜底：

```typescript
addNode({
  id,
  type: nodeType,
  position: basePos,
  data: {
    embedded: true,
    configName: item.description || id,
    saveState: 'saved',
  }  // 缺少 sourceRef、table、column 等关键字段
})
```

也没有 `addConstraintEdge` 调用。

**影响**: 从 Schema 文件中的内嵌 FK/Conditional/Scripted/Charset/DateLogic 约束导入后，节点只有最小数据，无法正常工作。

---

## 问题 4: `importV2ResourceToCanvas` 幂等返回时不触发 `reconcileAll`

**文件**: `frontend/src/stores/graphStore/modules/v2/import/importV2ResourceToCanvas.ts:96-103`

**现状**: 当节点已存在时直接返回，不会调用 `reconcileAll()`：

```typescript
const existing = nodes.value.find((n) => n.id === resourceId)
if (existing) {
  if (moveIfExists) existing.position = { ...position }
  selectedNodeId.value = existing.id
  if (normalizedKind !== 'schema') return existing.id  // ← 直接返回，不走 reconcileAll
}
```

**影响**: 如果先导入了 Schema（此时 `reconcileAll` 正确执行），然后导入依赖该 Schema 的约束（约束节点创建后也调用 `reconcileAll`），但如果批量导入中约束节点已存在（因为内嵌物化已创建），就不会触发 `reconcileAll`，可能导致 parent/children 不完整。

---

## 问题 5: 已弃用的 `constraintContextAware` 仍被实例化

**文件**: `frontend/src/stores/graphStore/modules/v2/import/constraintContextAware.ts`

**现状**: 文件头标注 `@deprecated`，但在 `v2Import.ts` 中仍被实例化并暴露到 graphStore。

**影响**: 如果有代码路径通过 `importV2ConstraintContextAware` 导入，会使用不同的 Schema 确保器（`ensureSchemaNodeFromV2` 而非 `ensureSchemaNode`），可能导致不一致的 Schema 节点数据。

---

## 问题 6: Schema 导入时内嵌约束物化后不触发 `reconcileAll`

**文件**: `frontend/src/stores/graphStore/modules/v2/import/schema.ts:113-121`

**分析**: `importSchema` 内部调用 `materializeEmbeddedConstraints` 创建内嵌约束节点和边，然后返回。`reconcileAll` 在外层 `importV2ResourceToCanvas.ts:113` 调用。

**结论**: 调用时序正确 — `reconcileAll` 在内嵌约束创建之后执行。**此处无问题。**

---

## 问题 7: FK 展示边的 `data.kind` 标记不一致

**文件对比**:
- `constraint.ts:216` 导入 FK 时: `data: { kind: 'fkConstraint', ... }`
- `useConnections.ts` 手动连接 FK 时: `data: { kind: 'fkTargetDisplay', ... }`
- `connectionStateSync.ts:38`: `SKIP_EDGE_KINDS = new Set(['fkTargetDisplay', 'fkConstraint'])`

**现状**: 两种 kind 值都在跳过列表中，当前无功能影响。但命名不统一可能导致后续维护混淆。

---

## 问题优先级排序

| # | 问题 | 严重程度 | 影响范围 |
|---|------|---------|---------|
| **1** | Charset/DateLogic/Composite 缺少显式导入处理 | **高** | 这三种约束从资源树导入后功能异常 |
| **2** | Conditional 导入只创建 THEN 边 | **高** | IF 条件列在画布上无视觉连线，parent/children 不完整 |
| **3** | 内嵌约束物化缺少 FK/Conditional/Scripted 等类型 | **高** | Schema 内嵌的非基础约束无法正常工作 |
| **4** | 幂等返回时不触发 reconcileAll | **中** | 批量导入时可能遗漏 parent/children |
| **5** | constraintContextAware 未移除 | **低** | 潜在的不一致路径 |
| **7** | FK 展示边 data.kind 命名不统一 | **低** | 当前无功能影响，维护混淆风险 |
