# C06-nav-v2-import-graph — 理解 V2 导入调用图 + 补齐缺失的节点类型注册

| 项 | 值 |
|----|-----|
| ID | C06 |
| 维度 | nav（代码库导航与理解） |
| 栈 | JS（建模 TS 架构，纯 JS 便于 node 直接执行） |
| 难度 | ★★★ |
| 预估 | 25-40 分钟 |
| 依赖 | Node ≥20 |

## 背景

本 `workspace/` 里有 3 个自包含的 JavaScript 文件，建模了 Precis 前端的 **V2 配置导入调用图**——这是真实代码 `frontend/src/stores/graphStore/setup/assembly.ts`（聚合各子模块到扁平对象，见主仓库 `AGENTS.md` 的"前端 GraphStore → `setup/assembly.ts` 将所有模块导出聚合到一个扁平对象中"）的精简复现。

三个文件构成一条调用链：

```
assembly.js  ──聚合──▶  v2Import.js  ──逐节点──▶  nodeFactory.js
（业务取 importConfig）   （config → nodes）        （按 type 建节点）
```

各文件职责：

- **`workspace/assembly.js`**：模块聚合入口。把 `v2Import` 与 `nodeFactory` 的导出聚合到一个扁平对象（模拟 `assembly.ts` 的"扁平聚合"模式），业务代码从这里取 `importConfig`。`_modules` 字段记录它聚合了哪些子模块。
- **`workspace/v2Import.js`**：V2 配置导入。遍历配置的 `nodes` 数组，对每个节点调 `nodeFactory.createNode(type, cfg)` 创建节点对象。**`createNode` 返回 `null` 的节点会被静默跳过**（收集进 `skipped`，不进 `created`）——这是潜在的"静默丢弃"bug 源（与 C16-dbg-setedges-drop 的 setEdges 静默丢边异曲同工）。
- **`workspace/nodeFactory.js`**：节点工厂。维护 `FACTORIES` 注册表（`type → (cfg) => node`），`createNode(type, cfg)` 查表执行；**未注册的 type 返回 `null`**。提供 `registerType(type, fn)` 用于注册新类型。

**先读全部 3 个文件**，沿着 `assembly → importConfig → createNode` 这条链走一遍，理解：

- 业务代码从 `assembly` 取 `importConfig`（聚合层让调用方无需直接 import `v2Import`）
- `importConfig` 对每个 `nodeCfg` 调 `createNode(nodeCfg.type, nodeCfg)`
- `createNode` 在 `FACTORIES` 里按 `type` 查工厂函数；查不到返回 `null`
- 返回 `null` 的节点被 `importConfig` 收进 `skipped`（**静默丢弃**，没有报错）

## 任务（导航理解 + 小修复）

### 第一步：理解（写 `workspace/answers.js`）

新建 `workspace/answers.js`，用注释回答 3 个问题（每行一个 `// Q?: 答案`）：

- **Q1**：`importConfig` 调用哪个函数来创建每个节点？
  - 答案格式：`// Q1: <函数名>`
- **Q2**：当一个节点的 `type` 不在 `FACTORIES` 注册表里时，会发生什么？
  - 答案格式：`// Q2: <一句话描述>`（含"返回 null / 被跳过 / 丢弃"等关键词）
- **Q3**：`assembly.js` 聚合了几个模块？
  - 答案格式：`// Q3: <数字>`

### 第二步：修复（编辑 `workspace/nodeFactory.js`）

**症状**：配置里用到了一种新节点类型 `transform`（如 `{ type: 'transform', id: 't1', op: 'filter' }`），但 `nodeFactory.js` 的 `FACTORIES` 里**没有注册 `transform`**。结果导入配置时，所有 `transform` 节点都被 `createNode` 返回 `null`、被 `importConfig` 静默跳过——配置看起来导入成功，但 `transform` 节点凭空消失了。

**你的任务**：在 `workspace/nodeFactory.js` 里注册 `transform` 类型。用现成的 `registerType` 函数注册：

```javascript
registerType('transform', (cfg) => ({ type: 'transform', id: cfg.id, op: cfg.op }))
```

注册后，导入含 `transform` 节点的配置应能正常创建它们（不再跳过）。

### 规格

- **`workspace/answers.js`**（新建）
  - 含 `// Q1: createNode`、`// Q2: ...null.../...跳过...`、`// Q3: 2` 三行注释
- **`workspace/nodeFactory.js`**（编辑）
  - 调用 `registerType('transform', (cfg) => ({ type: 'transform', id: cfg.id, op: cfg.op }))`
  - 不删除已有的 `schema` / `constraint` 工厂，不破坏 `createNode` / `listRegisteredTypes` 现有行为

### 约束（务必遵守）

- 只改 `workspace/` 内文件：新建 `workspace/answers.js`，编辑 `workspace/nodeFactory.js`。
- **不碰** `workspace/assembly.js`、`workspace/v2Import.js`（它们逻辑没问题，问题只在 `nodeFactory` 漏注册）。
- 不碰 `seed/`、`verify.mjs`、`task.md`、`SOLUTION.md`。
- 不碰 `workspace/` 以外的任何文件（即不要改主仓库代码）。

### 提示

- 沿调用链追踪：`assembly.importConfig` → `v2Import.importConfig(config)` → 循环里 `createNode(nodeCfg.type, nodeCfg)`。Q1 的答案就是这条链上"实际创建节点"的那一环。
- **Q3 注意**：`assembly.js` 顶部的 `_modules: ['v2Import', 'nodeFactory']` 就是它聚合的子模块清单——数这个数组的长度，不要数 `module.exports` 的 key 数（后者还含 `importConfig`、`listRegisteredTypes` 这些"从子模块透传出来的导出"，不算独立模块）。
- **关键决策点**：未注册类型返回 `null`、`importConfig` 把 `null` 静默收进 `skipped`——这是"静默丢弃"模式。修复方式是**在源头注册**（让 `createNode` 不再返回 `null`），而不是去改 `importConfig` 的跳过逻辑（那会破坏它对真正未知类型的防御）。注册 `transform` 后，端到端：`importConfig` → `createNode('transform', ...)` 命中工厂 → 节点进 `created`。
- `registerType` 已经现成，直接调它即可；也可以直接往 `FACTORIES` 字面量里加一行——两种写法 verify 都接受（verify 只看"transform 是否在 `listRegisteredTypes()` 里"和端到端导入结果）。

### 验证

在本题目录下运行：

```bash
node verify.mjs
```

退出码 0 = PASS，非 0 = FAIL。verify 会真的 `require` 三个模块并端到端跑 `importConfig`（不是静态文本检查），详见 verify 输出。

完成后按 [challenges/README.md](../README.md) 填 `workspace/RESULT.md`。
