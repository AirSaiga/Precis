# C12-inc-add-store-module — 加新工厂模块 clipboardOps（graphStore 工厂聚合）

| 项 | 值 |
|----|-----|
| ID | C12 |
| 维度 | inc（跨文件跨层增量开发） |
| 栈 | TS（本题用纯 JS 模拟 TS 的 Pinia setup store 工厂模式） |
| 难度 | ★★★ |
| 预估 | 25-40 分钟 |
| 依赖 | Node ≥20 |

## 背景

`workspace/` 里有 3 个自包含的 JS 文件，模拟真实 Precis 的 **graphStore 工厂聚合模式**（AGENTS.md「前端 GraphStore」一节："stores/graphStore/setup/assembly.ts 将所有模块导出聚合到一个扁平对象中"，约 27 个 `createXxxModule` 工厂）。

模式是这样的：

- 每个 `createXxxOps(deps)` **工厂函数**通过参数接收注入的依赖（`nodes`、`edges` 等响应式引用），返回一组操作方法。
- `assembly.js` 的 `assembleStore(deps)` 把所有工厂调一遍，把返回值 `...spread` 进**一个扁平的 store 对象**。

现有 3 个文件：

- `workspace/nodeOps.js` —— **`createNodeOps`**，本题的模板（先读它）。
- `workspace/historyOps.js` —— **`createHistoryOps`**，另一个参考工厂。
- `workspace/assembly.js` —— **`assembleStore`**，当前聚合了 nodeOps + historyOps。

**先读 `workspace/nodeOps.js`**，注意三个要点：

1. 工厂形如 `function createNodeOps(deps) { const { nodes, addNode } = deps ... return { ... } }`。
2. 工厂**通过 `deps` 参数拿 `nodes`**，**不直接 `require` store** —— 这是依赖注入铁律（AGENTS.md："每个模块工厂通过参数接收 nodes, edges 等响应式引用（依赖注入），不直接导入 store"）。
3. 文件末尾 `module.exports = { createNodeOps }`。

再读 `workspace/historyOps.js`：它演示了**工厂内部的闭包私有状态**（`past` / `future` 栈在工厂调用时创建，跨该工厂实例的方法调用共享，但对外不可见）。

最后读 `workspace/assembly.js`：`assembleStore(deps)` 调用每个工厂、`return { ...nodeOps, ...historyOps }`。

## 任务

照 `nodeOps` / `historyOps` 的模式，**新增一个剪贴板工厂模块 `clipboardOps`**，并接入 `assembly`。

### 规格

1. **创建 `workspace/clipboardOps.js`**，导出 `createClipboardOps(deps)`：
   - 接收 `deps`（其中有 `nodes` —— 共享的节点数组）。
   - 返回 `{ copyNode, pasteNode, clipboard }`，其中：
     - **`clipboard` 是模块级（工厂调用内的闭包）变量**（`let`），保存最后一次复制的节点深拷贝，初始为 `null`。
     - **`copyNode(id)`**：在 `deps.nodes` 里按 id 找节点；找到则把**深拷贝**存进 `clipboard`，返回 `true`；找不到返回 `false`。
     - **`pasteNode(newId)`**：若 `clipboard` 为 `null` 返回 `null`；否则造一个新节点 `{ id: newId, data: clipboard.data, type: clipboard.type }`，push 进 `deps.nodes`，返回这个新节点。
   - 文件末尾 `module.exports = { createClipboardOps }`。

2. **接入 `workspace/assembly.js`**：
   - `require('./clipboardOps')` 拿到 `createClipboardOps`。
   - 在 `assembleStore` 里调 `createClipboardOps(deps)`。
   - 把返回值 `...spread` 进最终返回的 store 对象（与 nodeOps / historyOps 并列）。

### 约束（务必遵守）

- 只在 `workspace/` 里改 / 增文件：新建 `workspace/clipboardOps.js`，编辑 `workspace/assembly.js`。
- 不碰 `seed/`、`verify.mjs`、`task.md`、`SOLUTION.md`。
- **不要改 `workspace/nodeOps.js` / `workspace/historyOps.js`**（它们是只读参考模板）。
- 不碰 `workspace/` 以外的任何文件（即不要改主仓库代码）。

### 提示

- **照葫芦画瓢**：把 `nodeOps.js` 整段复制成 `clipboardOps.js`，改工厂名、改注入依赖、改返回的方法。
- **关键决策点 —— 依赖注入**：工厂接收 `deps`（含 `nodes`），**不要**在 `clipboardOps.js` 里 `require('./assembly')` 或直接拿 store。这是 graphStore 工厂模式的铁律（AGENTS.md："不直接导入 store"）。`copyNode` 里读 `deps.nodes`、`pasteNode` 里写 `deps.nodes.push(...)`。
- **clipboard 用闭包内的 `let`**（在 `createClipboardOps` 函数体内、方法外声明），它在该工厂实例的方法之间共享、并随 `assembleStore` 的调用一同存活——就像 `historyOps` 里的 `past`/`future` 栈那样。**不要**把它挂到返回对象的属性上让外部可写（虽然 verify 会读 `store.clipboard`，把它放进返回对象即可暴露只读引用）。
- **copy 要存深拷贝**：`JSON.parse(JSON.stringify(node))`，避免后续改了原节点把 clipboard 里的也带歪（和 `historyOps.snapshot` 同款写法）。
- **spread 不覆盖**：在 `assembly.js` 里 `return { ...nodeOps, ...historyOps, ...clipboardOps }`，三者方法名不冲突，原有 `addNodeWithId` / `undo` 等保持完好。

### 验证

在本题目录下运行：

```bash
node verify.mjs
```

退出码 0 = PASS，非 0 = FAIL。约 10 项检查（含模块加载、导出、聚合、copy/paste 行为、空剪贴板边界、原有方法未被破坏）详见 verify 输出。

完成后按 [challenges/README.md](../README.md) 填 `workspace/RESULT.md`。
