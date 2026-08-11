# C16-dbg-setedges-drop — 修复 createGraphEdges 静默丢边

| 项 | 值 |
|----|-----|
| ID | C16 |
| 维度 | dbg（调试与 bug 修复） |
| 栈 | TS（JS，CommonJS） |
| 难度 | ★☆☆ |
| 预估 | 10-15 分钟 |
| 依赖 | Node ≥20 |

## 背景

`workspace/edgeSync.js` 里有一个 `createGraphEdges(edges, findNode)` 函数，它是真实 Vue Flow 边同步逻辑的**合成复现**（真实源码不在本仓库，本题为便于 `node` 直接 `require` 而用纯 JS 写成）。这个函数把"逻辑边"列表（`{id, source, target}`）转换成"渲染边"列表（带 `sourceNode`/`targetNode` 实例）。

**这是 Precis 代码库里一个真实陷阱的简化版**，见主仓库 `AGENTS.md` 的"Vue Flow DAG 操作规范 / setEdges 的致命问题"一节：`createGraphEdges` 对每条边调用 `findNode(edge.source)`，找不到则 `continue` **静默丢弃**。在本 workspace 里，bug 的表现完全一致——`findNode` 返回 `null` 的边会被无声跳过，调用方拿到的数组比输入少，却没有任何信号知道少了什么。

**先读 `workspace/edgeSync.js`**，理解：

- 函数签名 `createGraphEdges(edges, findNode)`：`edges` 是 `{id, source, target}` 数组，`findNode(id)` 返回节点对象或 `null`
- 缺陷位于循环内的 `if (!sourceNode || !targetNode) { continue }`——这里**只是跳过**，不报告、不抛错、不返回任何信号
- 当前返回值是一个**普通数组**；如果你的修复改成 `{ edges, warnings }` 这种对象，调用方必须能区分两种结构（verify 会同时接受两种返回形态）

## 任务

修复 `createGraphEdges`，让**缺失节点的边不再被静默丢弃**——调用方必须能感知到这些边（要么抛错让调用方知道"有问题"，要么在返回值里明确列出哪些边丢了）。同时**正常边（节点都存在）必须照常处理，不受影响**。

### 规格

- **函数名**：`createGraphEdges`（保持不变，仍为命名导出）
- **文件**：`workspace/edgeSync.js`
- **行为**：
  - 输入边的 `source` 与 `target` 节点都存在 → 照常生成渲染边，加入返回结果
  - 输入边的 `source` 或 `target` 节点缺失（`findNode` 返回 `null`） → **必须让调用方感知**，可接受的修复方式（任选其一，verify 全部兼容）：
    - **Option A（抛错）**：抛出 `Error`，错误信息里提到缺失的边 id 或缺失的节点 id（例如 `Edge "e2" references missing node "missing"`）。抛错后调用方能 catch 拿到信息。
    - **Option B（warnings）**：返回值改为 `{ edges: [...], warnings: [...] }`，`warnings` 是一个**非空**数组，至少能让人回溯是哪条边丢了哪个节点（例如 `{ edgeId, missing: [...] }`）。
    - **Option C**：其它任何"调用方明确知情"的方案（如同时返回 dropped 列表、callback 回调等），只要 verify 能从返回值或抛出的异常中读到缺失信息即可。
  - **混合场景**：输入既有正常边也有缺失边时，verify 接受"抛错（提到缺失边）"或"正常边被处理 + 缺失边进 warnings"两种行为。
- **约束**：`createGraphEdges` 必须仍是模块的命名导出（`module.exports = { createGraphEdges }` 的结构不能破坏）。

### 约束（务必遵守）

- 只改 `workspace/edgeSync.js`。
- 不碰 `seed/`、`verify.mjs`、`task.md`、`SOLUTION.md`。
- 不碰 `workspace/` 以外的任何文件（即不要改主仓库代码）。
- 不引入外部依赖（只用 Node 标准库 / 纯 JS）。

### 提示

- bug 就在循环内那句裸 `continue`——它什么信号都没留下。
- 想清楚调用方需要的是什么：**收到的边比预期少却没有提示**才是失败模式。要么让调用方**当场知道出了问题**（throw），要么让调用方**事后能查到丢了什么**（warnings/dropped）。
- **关键决策点**：verify 会**同时**检查两件事——(1) 正常边照常处理；(2) 缺失边被显式感知。选定一个方案后要保持内部一致：要么全程抛错（那"混合场景"也会抛），要么全程走 warnings（那混合场景就是"正常边处理 + 缺失边进 warnings"）。不要让代码在不同分支里自相矛盾。
- 你的返回类型可能会从数组变成对象——没问题，只要 `createGraphEdges` 仍可调用且仍具名导出即可。

### 验证

在本题目录下运行：

```bash
node verify.mjs
```

退出码 0 = PASS，非 0 = FAIL。5 项检查详见 verify 输出。

完成后按 [challenges/README.md](../README.md) 填 `workspace/RESULT.md`。
