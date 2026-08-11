# C18 — 修复 addNodeBuggy 加的节点"消失"

| 项 | 值 |
|------|-----|
| ID | C18 |
| 维度 | dbg（调试与 bug 修复） |
| 栈 | TS（JS，CommonJS） |
| 难度 | ★★★ |
| 预估 | 20-35 分钟 |
| 依赖 | Node ≥20 |

## 背景

`workspace/nodeStore.js` 里有一个 `createNodeStore()` 工厂，是真实 Vue Flow 节点同步契约的合成复现（用纯 JS 写成，便于 `node` 直接 `require`）。store 维护一个逻辑节点列表 `ref.value` 和一个内部渲染状态 `internalState`，通过 `_flush()` 把前者同步到后者（模拟 Vue Flow watcher 的一次"检查 + 回写"）。

返回的 store 上有两个加节点方法：`addNodeBuggy`（有缺陷）和 `addNodeCorrect`（当前空实现）。

## 症状

`addNodeBuggy(node)` 加完节点后，跑一次 `_flush()`，节点**不会**出现在 `_getInternalState()` 里 —— 它"消失"了（内部状态看不到它）。而正确的行为是：加完后跑 `_flush()`，节点应该出现在内部状态里。

实现 `addNodeCorrect(node)`，使调用它之后跑一次 `_flush()`，节点**能**出现在 `_getInternalState()` 里（且在数组末尾，按添加顺序）。**先读 `workspace/nodeStore.js`**，搞清楚 `_flush` / `sync` 如何判定"ref.value 变了、需要同步"，再决定 `addNodeCorrect` 该怎么写。

## 规格

- **函数名/签名**：`addNodeCorrect(node)`（保持不变，仍是 store 返回对象上的方法）
- **文件**：`workspace/nodeStore.js`（只改这一个文件）
- **行为契约**：
  - 调用 `addNodeCorrect(node)` 后跑 `store._flush()`，`store._getInternalState()` 必须包含该 node（按添加顺序在末尾）
  - 连续多次调用添加的节点，flush 后全部可见，顺序与添加顺序一致
  - `addNodeBuggy` **必须仍然坏**（不许改 `_flush` / `sync` / `_getInternalState` 等 watcher 逻辑来"顺便修好" buggy 那条路径）
- **约束**：保持 `module.exports = { createNodeStore }` 的命名导出结构。

## 约束

- 只改 `workspace/nodeStore.js`。
- 不碰 `seed/`、`verify.mjs`、`task.md`、`SOLUTION.md`、`workspace/watcher.js`。
- 不碰 `workspace/` 以外的任何文件（即不要改主仓库代码）。
- 不引入外部依赖（只用 Node 标准库 / 纯 JS）。
- **不要改 `addNodeBuggy`、`_flush`、`sync`、`_getInternalState`、`createNodeStore` 的返回结构** —— 只填 `addNodeCorrect` 的函数体。

## 验证

在本题目录下运行：

```bash
node verify.mjs
```

退出码 0 = PASS，非 0 = FAIL。检查项涵盖：模块可加载、`addNodeCorrect` 加节点后 flush 能同步、`addNodeBuggy` 仍不同步（防绕过）、连续多次添加全部可见。

完成后按 [challenges/README.md](../README.md) 填 `workspace/RESULT.md`。
