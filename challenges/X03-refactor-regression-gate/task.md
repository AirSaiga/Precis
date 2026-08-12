# X03-refactor-regression-gate — 提取 connectionTypeRules 模块（回归门重构）

| 项 | 值 |
|----|-----|
| ID | X03 |
| 维度 | refactor（重构与代码质量） |
| 栈 | TS（真实 Precis 前端仓库） |
| 难度 | ★★★☆ |
| 预估 | 30-50 分钟 |
| 依赖 | 主仓库已装好依赖（`frontend/node_modules` 存在，Node ≥20） |

## 背景

`frontend/src/stores/graphStore/modules/connectionStateSync.ts` 是 graphStore 工厂模块之一，
负责统一维护节点的 `children` / `parent` / `outputPortConnected` 关系字段
（`syncOnConnect` / `syncOnDisconnect` / `reconcileAll` 三个公开方法）。

但该文件里除了模块工厂，还内嵌着一整组**与工厂无关的"节点类型分类规则"**：
4 个类型集合常量 + 5 个类型谓词 / 边过滤函数。这组规则是"哪些节点类型能持有 children、
哪些能持有 parent、哪些是数据源、哪些是 schema、哪些边应跳过"的**单一事实源**，
与"如何把这些规则应用到 nodes/edges 上"（模块工厂）是两个不同内聚层次的职责，
本该住在自己的模块里。

本任务是**纯结构重构**：把这一组类型分类规则提取成独立模块。判定标准除了结构本身，
还包括一条**回归门**——重构后该目录下所有既有测试必须保持全绿（测的是
"不碰坏任何东西"的纪律性）。

## 任务

### 规格

- **新建文件**：`frontend/src/stores/graphStore/modules/connectionTypeRules.ts`
- **修改文件**：`frontend/src/stores/graphStore/modules/connectionStateSync.ts`
  （删掉被提取符号的定义、改为 import 使用）
- **其它文件一律不许动**（包括 `assembly.ts`、任何测试文件、任何配置文件）。

### 必须提取的 9 个符号（精确清单）

从 `connectionStateSync.ts` 把以下 9 个顶层符号**原样搬到**新文件，
并全部改为**导出**（`export const` / `export function`）：

| 符号 | 形态 |
|------|------|
| `CHILDREN_CAPABLE_TYPES` | `export const`（`Set<string>`） |
| `DATA_SOURCE_TYPES` | `export const`（`Set<string>`） |
| `SCHEMA_TYPES` | `export const`（`Set<string>`） |
| `SKIP_EDGE_KINDS` | `export const`（`Set<string>`） |
| `isChildrenCapableType` | `export function`，签名 `(type: string \| undefined): boolean` |
| `isParentCapableType` | `export function`，签名 `(type: string \| undefined): boolean` |
| `isDataSourceType` | `export function`，签名 `(type: string \| undefined): boolean` |
| `isSchemaType` | `export function`，签名 `(type: string \| undefined): boolean` |
| `shouldSkipEdge` | `export function`，签名 `(edge: Edge): boolean` |

### 提取后的依赖方向

- `connectionTypeRules.ts` 自身需要的 import：
  - `isConstraintNodeType` — 来自 `@/services/constraints/constraintMeta`（叶子模块，不要从
    barrel `validationRegistry` 引）
  - `isRegexNodeType` — 来自 `@/utils/nodes/regex`
  - `Edge` 类型 — 来自 `@vue-flow/core`（`import type`）
- `connectionStateSync.ts` 改为从 `./connectionTypeRules` import 这 9 个符号；
  它原来对 `isConstraintNodeType` / `isRegexNodeType` 的 import 若不再被直接引用，应一并移除。
- **禁止反向依赖**：`connectionTypeRules.ts` 不得 import `connectionStateSync`，
  不得 import `@/stores/graphStore` 下的任何东西（verify 会查）。

### 行为完全不变（硬约束）

- 9 个符号的**实现逐字不变**（Set 成员、函数体、注释风格随意，但逻辑一字不改）。
- `connectionStateSync.ts` 中**未在清单内的所有代码**——`ConnectionStateSyncContext` 接口、
  `createConnectionStateSyncModule` 工厂、`applyConnectState` / `syncOnConnect` /
  `syncOnDisconnect` / `reconcileAll` 的实现与返回对象——**原样保留**，不允许顺手"改进"。
- 重构后 `createConnectionStateSyncModule` 的对外行为必须逐字节等价
  （verify 会跑 golden-master 行为测试）。

### 回归门（硬约束）

重构完成后，`frontend/tests/stores/graphStore/` 目录下的**全部既有测试**（34 个文件、
336 个用例，含 `connectionStateSync.test.ts` 的 17 个用例与 `assembly.test.ts`）
**必须保持全绿**。任何既有用例变红即判 FAIL——包括你"顺手修复"的既有行为。

## 验证

在题目录下运行：

```bash
node verify.mjs
```

退出码 0 = PASS，非 0 = FAIL（stdout 首行即 PASS / FAIL）。verify 分三道门：

1. **结构检查**：新文件存在且导出全部 9 个符号；旧文件不再含这 9 个符号的**定义**
   （按定义形态匹配，不是子串）；旧文件从 `./connectionTypeRules` import 它们；
   新文件无反向依赖。
2. **行为等价**：注入一份 golden-master 测试（临时复制进 `frontend/tests/`，跑完即删），
   直接对提取出的 5 个函数跑全类型真值表，并对 `createConnectionStateSyncModule`
   跑固定图场景的精确 patch 序列断言。
3. **回归门**：完整跑 `frontend/tests/stores/graphStore/` 全部既有测试，必须全绿。

> 提示：worktree / 副本里跑 verify 需要 `frontend/node_modules`（verify 会检查并给出指引，
> Windows 下可用 `cmd /c mklink /J <副本>\frontend\node_modules <主仓库>\frontend\node_modules`）。

完成后按 [challenges/README.md](../README.md) 填结果记录。
