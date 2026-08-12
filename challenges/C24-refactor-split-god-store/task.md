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

`workspace/godStore.js` 是一个 "God store"——`createGodStore(deps)` 把**三组互不相关的逻辑**
全塞在一个工厂里：节点操作、剪贴板操作、历史操作。外加一份 `assembly.js` 装配入口（目前只
装配 `createGodStore`）。

这模拟真实 Precis 的历史重构：AGENTS.md 讲过 `graphStore` 曾是一个 God store，被拆成约 27 个
`createXxxModule` 工厂模块。每个工厂模块的约定是：

- 通过参数（`deps`）接收 `nodes` 等响应式引用（**依赖注入**），**不直接导入 store、不回调其它工厂**；
- 工厂内部封装一组内聚的状态 + 操作；
- `assembly.js` 把所有工厂的返回对象**扁平聚合**成一个 store。

## 任务

把 `godStore.js` 里**剪贴板操作那一组**（它和节点操作、历史操作没有内聚关系，是一组适合独立成
工厂的内聚逻辑——包含它自己的私有状态）提取成一个新的 `workspace/clipboardOps.js` 工厂模块。

- **新建** `workspace/clipboardOps.js`：导出一个 `createClipboardOps(deps)` 工厂函数，遵循上述
  工厂约定（依赖注入、工厂闭包持有私有状态、返回方法对象）。具体抽哪些符号、状态怎么迁，**自己从
  `godStore.js` 里识别那一组内聚的剪贴板逻辑决定**。
- **改 `godStore.js`**：移除剪贴板那一组（函数 + 私有状态 + 返回对象里的相关项 + 相关注释），
  只保留节点操作和历史操作。godStore 必须完全不再含任何剪贴板逻辑或痕迹（连注释里提到剪贴板
  也不行——verify 会扫源码文本）。
- **改 `assembly.js`**：装配时同时调用两个工厂，把它们扁平聚合成一个 store，对外 API 形态与拆分前
  完全一致（`store.addNode` / `store.copyNode` / `store.undo` 都在同一层）。

### 规格

- **新建文件**：`workspace/clipboardOps.js`。
- **修改文件**：`workspace/godStore.js`、`workspace/assembly.js`。
- **不可改的东西**：节点操作（`addNode`/`removeNode`/`getNode`）、历史操作（`snapshot`/`undo`/`redo`）
  的行为原样保留在 `godStore.js`。
- **行为必须完全不变**：`assembleStore({ nodes })` 返回的 store，对同一组操作产生与拆分前相同的
  结果（verify 会跑行为回归）。

### 约束（务必遵守）

- 只能新建 `workspace/clipboardOps.js` 和编辑 `workspace/godStore.js`、`workspace/assembly.js`。
- 不碰 `seed/`、`verify.mjs`、`task.md`、`SOLUTION.md`。
- 不碰 `workspace/` 以外的任何文件（即不要改主仓库代码）。
- 保持纯 JS CommonJS（`module.exports` / `require`），不要改 ESM、不要引入编译依赖。
- 工厂之间通过 `deps` 注入的引用直接操作，**不要互相回调方法**（剪贴板工厂拿 `deps.nodes` 就够用，
  不要去调 godStore 的方法——那会把两个工厂耦合）。

### 验证

在本题目录下运行：

```bash
node verify.mjs
```

退出码 0 = PASS，非 0 = FAIL。verify 同时做**静态检查**（godStore 不再含剪贴板逻辑——中英文注释都算、
clipboardOps 存在且导出工厂、assembly.js **实际调用了** `createClipboardOps(...)`、assembly 聚合后
store 有全部方法）和**行为回归**（真实构造 store，跑 addNode → copy → paste 等场景）。详见 verify 输出。

完成后按 [challenges/README.md](../README.md) 填 `workspace/RESULT.md`。
