# C24-refactor-split-god-store — 拆分 God store，提取 clipboardOps 工厂模块

| 项 | 值 |
|----|-----|
| ID | C24 |
| 维度 | refactor（重构与代码质量） |
| 栈 | TS（JS） |
| 难度 | ★★★ |
| 预估 | 25-40 分钟 |
| 依赖 | Node ≥20（仅用于跑 verify） |

## 背景

`workspace/` 里有一个 "God store" —— `godStore.js` 里的 `createGodStore(deps)` 把**三组互不相关的逻辑**全塞在一个工厂里：

- **节点操作**（`addNode` / `removeNode` / `getNode`）
- **剪贴板操作**（`copyNode` / `pasteNode`）—— 本题的提取目标
- **历史操作**（`snapshot` / `undo` / `redo`）

外加一个模块级 `clipboard` 状态变量和一份 `assembly.js` 装配入口（目前只 `createGodStore`）。

这模拟的是真实 Precis 的历史重构：AGENTS.md 里讲过 `graphStore` 曾是一个 God store，被拆成约 27 个 `createXxxModule` 工厂模块（见 AGENTS.md "god-split-plan.md"、`stores/graphStore/` 的工厂拆分模式）。每个工厂模块的约定是：

- 通过参数（`deps`）接收 `nodes` 等响应式引用（依赖注入），**不直接导入 store**；
- 工厂内部封装一组内聚的状态 + 操作；
- `assembly.ts` 把所有工厂的返回对象**扁平聚合**成一个 store。

本题的考察重点是剪贴板操作那一组：它和节点操作、历史操作**没有内聚关系**（剪贴板只读节点列表、维护自己的 `clipboard` 状态、写入时通过 `addNode` 加节点），是一组适合独立成工厂的内聚逻辑。

**先读 `workspace/godStore.js` 和 `workspace/assembly.js`**，理解 God store 的现状和装配方式。

## 任务（处方式 / PRESCRIPTIVE）

> 本题是**处方式拆分**（不是自由重构）：下面精确规定了要建哪个文件、抽哪些符号、`godStore` 怎么去掉、`assembly` 怎么聚合。这样 verify 才能做客观静态检查 + 行为回归。自由重构无法客观评分。

### 1. 新建 `workspace/clipboardOps.js`

导出一个 `createClipboardOps(deps)` 工厂函数：

- 接收 `deps`（含 `nodes`）。
- 维护一个**模块级** `let clipboard = null` 变量（持有最近一次复制的节点的深拷贝，或 `null`）。注意：这个变量定义在 `createClipboardOps` 工厂函数体**内部**（与原 `godStore` 里 `clipboard = { value: null }` 等价，跟随工厂闭包生命周期）。
- `copyNode(id)`：在 `deps.nodes` 中按 `id` 查找节点；找不到返回 `false`；找到则把它的**深拷贝**存入 `clipboard`，返回 `true`。
- `pasteNode(newId)`：若 `clipboard` 为 `null` 返回 `null`；否则构造 `{ id: newId, data: clipboard.data, type: clipboard.type }`，**push 到 `deps.nodes`**，返回新节点。
- `return { copyNode, pasteNode }`。

> **关键决策点**：`copyNode` 需要按 id 找节点——直接用 `deps.nodes.find(...)`，**不要**去调 `godStore` 的 `getNode`（那会把两个模块耦合起来）。工厂拿到 `deps.nodes` 就够用了。同理 `pasteNode` 直接 `deps.nodes.push(...)`，不要调 `godStore.addNode`。这模拟真实 Precis 工厂拆分里"工厂通过依赖注入的 `nodes` 引用直接操作，不互相调用"的约定。

### 2. 修改 `workspace/godStore.js`

- **删除**剪贴板操作（`copyNode` / `pasteNode` 两个函数定义）。
- **删除**模块级 `clipboard` 状态变量（`const clipboard = { value: null }`）。
- **删除**返回对象里的 `// clipboard ops` 注释行和 `copyNode, pasteNode,` 两项。
- **保留**节点操作（`addNode` / `removeNode` / `getNode`）原样不动。
- **保留**历史操作（`snapshot` / `undo` / `redo`）原样不动。
- 返回对象只剩 node ops + history ops。

> 静态检查要求：`godStore.js` 源码里**不再出现** `function copyNode`、`function pasteNode`，也**不再出现** `clipboard`（任何形式，含注释）。务必把相关注释一起删干净。

### 3. 修改 `workspace/assembly.js`

- `require('./clipboardOps')` 拿到 `createClipboardOps`。
- `assembleStore(deps)` 改为返回**两个工厂的扁平聚合**：
  ```javascript
  return { ...createGodStore(deps), ...createClipboardOps(deps) }
  ```
- 这样聚合出的 store 同时拥有 node ops（`addNode`/`removeNode`/`getNode`）、history ops（`snapshot`/`undo`/`redo`）、clipboard ops（`copyNode`/`pasteNode`），对外是**一个扁平对象**，API 形态与拆分前完全一致。

## 约束（务必遵守）

- 只能新建 `workspace/clipboardOps.js` 和编辑 `workspace/godStore.js`、`workspace/assembly.js`。
- 不碰 `seed/`、`verify.mjs`、`task.md`、`SOLUTION.md`。
- 不碰 `workspace/` 以外的任何文件（即不要改主仓库代码）。
- 保持纯 JS CommonJS（`module.exports` / `require`），不要改 ESM、不要引入编译依赖。
- 拆分后**行为必须完全不变**：`assembleStore({ nodes })` 返回的 store，对同一组操作产生与拆分前相同的结果（verify 会跑行为回归）。

## 提示

- **模块级状态跟随工厂迁移**：原 `godStore` 里的 `clipboard` 状态跟着 `copyNode`/`pasteNode` 一起搬到 `clipboardOps.js`。在工厂内部用 `let clipboard = null`（闭包变量），每个 `createClipboardOps(deps)` 实例都有自己的 `clipboard`。
- **依赖注入而非互相调用**：工厂拿 `deps.nodes` 直接操作（`.find()` / `.push()`），不要回调 `godStore` 的方法——这是真实 Precis 工厂拆分的核心约定（每个 `createXxxModule` 只依赖注入进来的 `nodes`/`edges` 引用，不 import store）。
- **assembly 用 spread 聚合**：`{ ...createGodStore(deps), ...createClipboardOps(deps) }` 把两个工厂的返回扁平合并。两个工厂的 key 没有重叠（godStore 出 node+history，clipboardOps 出 clipboard），spread 不会覆盖。
- **深拷贝**：`copyNode` 存的是 `JSON.parse(JSON.stringify(node))`（与原实现一致），这样后续修改原节点不会污染剪贴板里的副本。
- **`pasteNode` 的 newId**：调用方传入新 id（如 `'b'`），工厂不负责生成 id。

### 验证

在本题目录下运行：

```bash
node verify.mjs
```

退出码 0 = PASS，非 0 = FAIL。verify 同时做**静态检查**（正则扫源码确认 godStore 不再含剪贴板逻辑、clipboardOps 存在且导出工厂、assembly 聚合后 store 有全部方法）和**行为回归**（真实构造 store，跑 addNode → copyNode → pasteNode，验证节点数 / 返回值 / 缺失节点 / 空剪贴板等场景）。

完成后按 [challenges/README.md](../README.md) 填 `workspace/RESULT.md`。
