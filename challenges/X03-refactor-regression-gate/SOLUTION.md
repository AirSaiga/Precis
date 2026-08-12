# X03 参考实现与讲评

## 参考实现要点

### 新文件 `frontend/src/stores/graphStore/modules/connectionTypeRules.ts`

```ts
/**
 * @file connectionTypeRules.ts
 * @description 节点类型分类规则 — children/parent/outputPortConnected 维护的类型谓词单一事实源
 */

import type { Edge } from '@vue-flow/core'
import { isConstraintNodeType } from '@/services/constraints/constraintMeta'
import { isRegexNodeType } from '@/utils/nodes/regex'

/** 拥有 children 字段的源节点类型 */
export const CHILDREN_CAPABLE_TYPES = new Set([
  'sourcePreview',
  'jsonSourcePreview',
  'schema',
  'jsonSchema',
  'manualData',
  'transformOutput',
])

/** 数据源类型（需要维护 outputPortConnected） */
export const DATA_SOURCE_TYPES = new Set(['sourcePreview', 'jsonSourcePreview'])

/** 数据源连接的下游目标类型 */
export const SCHEMA_TYPES = new Set(['schema', 'jsonSchema'])

/** 需要跳过的边类型标识 */
export const SKIP_EDGE_KINDS = new Set(['fkDisplay'])

export function isChildrenCapableType(type: string | undefined): boolean {
  return !!type && CHILDREN_CAPABLE_TYPES.has(type)
}

export function isParentCapableType(type: string | undefined): boolean {
  return isRegexNodeType(type) || isConstraintNodeType(type)
}

export function isDataSourceType(type: string | undefined): boolean {
  return !!type && DATA_SOURCE_TYPES.has(type)
}

export function isSchemaType(type: string | undefined): boolean {
  return !!type && SCHEMA_TYPES.has(type)
}

export function shouldSkipEdge(edge: Edge): boolean {
  const data = (edge as unknown as { data?: Record<string, unknown> }).data
  if (!data) return false
  if (data.transient === true) return true
  if (data.kind && SKIP_EDGE_KINDS.has(data.kind as string)) return true
  return false
}
```

### 旧文件 `connectionStateSync.ts` 的改动

1. 删掉上述 4 个常量 + 5 个函数的定义（连同"节点类型分类""辅助函数"两节注释头）。
2. 删掉原来的两行 import：
   ```ts
   import { isConstraintNodeType } from '@/services/constraints/validationRegistry'
   import { isRegexNodeType } from '@/utils/nodes/regex'
   ```
   （它们只剩 `isParentCapableType` 一个使用点，已随函数搬走。）
3. 新增一行 import：
   ```ts
   import {
     CHILDREN_CAPABLE_TYPES,
     DATA_SOURCE_TYPES,
     SCHEMA_TYPES,
     SKIP_EDGE_KINDS,
     isChildrenCapableType,
     isParentCapableType,
     isDataSourceType,
     isSchemaType,
     shouldSkipEdge,
   } from './connectionTypeRules'
   ```
   （只 import 实际用到的即可；verify 要求 9 个都被 import——本模块确实全部用到。）
4. 其余一切（`ConnectionStateSyncContext`、`createConnectionStateSyncModule`、
   `applyConnectState` / `syncOnConnect` / `syncOnDisconnect` / `reconcileAll`、返回对象）
   **一个字符都不动**。

## 为什么这样拆

- **两个内聚层次**：`connectionTypeRules` 回答"哪些类型算数据源 / schema / 可持子 / 可持父 /
  哪类边跳过"——这是纯规则、纯函数、无状态、无 Vue 依赖；`connectionStateSync` 回答
  "怎么把这些规则应用到 nodes/edges 上"——这是有状态的模块工厂（依赖注入 Ref）。规则层
  独立成文件后可以被其它模块（如断开清理、导入恢复）直接复用，且单测不再需要构造整个工厂。
- **叶子依赖防循环**：新文件只依赖 `constraintMeta`（纯元数据表，零运行时 import）和
  `utils/nodes/regex`（零 import）两个叶子模块，依赖方向单向
  `connectionStateSync → connectionTypeRules → (constraintMeta, utils/nodes/regex)`，无环。
- **barrel 降级为叶子**：原文件从 `validationRegistry`（barrel，带 side-effect 注册）引
  `isConstraintNodeType`，搬到规则层后改从 `constraintMeta` 直接引，减少规则层的隐式副作用面。

## 常见错误表

| 错误 | 后果 | verify 如何抓 |
|------|------|---------------|
| 只复制不删除（新文件有了，旧文件里 9 个符号定义还在） | 两份事实源，日后改一处漏一处 | 结构门："旧文件不再定义 9 个被提取符号"按行首 `const/function` 声明形态匹配，残留定义即 [✗] |
| 旧文件忘改 import（函数体里裸用未导入符号） | vitest 直接 ReferenceError/TS 报错 | 行为门 + 回归门全红 |
| 新文件从 barrel `validationRegistry` 引 `isConstraintNodeType` | 规则层被拖进 side-effect 注册链，违背处方 | 结构门："引自 constraintMeta" [✗] |
| 反向依赖：新文件 import `connectionStateSync` 或 graphStore | 循环依赖 `connectionStateSync ⇄ connectionTypeRules` | 结构门："无反向依赖" [✗] |
| 顺手"改进"：给 Set 加新成员 / 改 `shouldSkipEdge` 判空逻辑 / 调 `reconcileAll` 的 patch 合并顺序 | 行为微变 | 行为门 golden-master：真值表覆盖全部节点类型（含 `undefined`/`''`），patch 序列断言精确到条数与内容 |
| 顺手改 `syncOnDisconnect` 里 outputPortConnected 注释或逻辑 | 既有用例红 | 回归门：`connectionStateSync.test.ts` 17 用例 |
| 动了 `assembly.ts` 或测试文件来"配合"重构 | 越界改动 | 回归门 + git diff 人工可见 |
| `SKIP_EDGE_KINDS` 忘了搬或忘导出 | 旧文件编译失败 | 结构门缺符号 + 行为门红 |

## 自验步骤

```bash
# 1. 快检新文件导出
grep -c "^export" frontend/src/stores/graphStore/modules/connectionTypeRules.ts   # 应 ≥ 9

# 2. 快检旧文件不再定义
grep -nE "^(export )?(const|function) (CHILDREN_CAPABLE_TYPES|isChildrenCapableType|shouldSkipEdge)" \
  frontend/src/stores/graphStore/modules/connectionStateSync.ts                    # 应无输出

# 3. 直接相关测试
cd frontend && npx vitest run tests/stores/graphStore/connectionStateSync.test.ts

# 4. 回归门（与 verify 同范围）
cd frontend && npx vitest run tests/stores/graphStore/

# 5. 完整判定
node challenges/X03-refactor-regression-gate/verify.mjs
```
