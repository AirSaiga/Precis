# C16 — 修复 createGraphEdges 静默丢边

| 项 | 值 |
|------|-----|
| ID | C16 |
| 维度 | dbg（调试与 bug 修复） |
| 栈 | TS（JS，CommonJS） |
| 难度 | ★☆☆ |
| 预估 | 10-15 分钟 |
| 依赖 | Node ≥20 |

## 背景

`workspace/edgeSync.js` 里有一个 `createGraphEdges(edges, findNode)` 函数，把"逻辑边"列表（`{id, source, target}`）转换成"渲染边"列表（带 `sourceNode`/`targetNode` 实例）。它是真实 Vue Flow 边同步逻辑的合成复现（用纯 JS 写成，便于 `node` 直接 `require`）。

## 症状

在某些条件下，`createGraphEdges` 会**静默丢失**部分输入边 —— 返回的数组比输入少，但**不报告、不抛错**，调用方没有任何途径知道有边被丢了、是哪几条、为什么。正常边（能解析的）的处理不受影响。

修复 `createGraphEdges`，让被丢的边以某种方式**被调用方感知**，同时正常边必须照常处理。

## 规格

- **函数名**：`createGraphEdges`（保持不变，仍为命名导出）
- **文件**：`workspace/edgeSync.js`
- **行为**：
  - 正常边（能解析的）→ 照常生成渲染边，加入返回结果
  - 被丢的边 → **必须让调用方感知**。可接受的方式（任选其一，verify 全部兼容）：
    - 抛 `Error`，信息里能定位到是哪条边 / 什么原因（如提到边 id 或相关节点 id）
    - 返回值改为 `{ edges: [...], warnings: [...] }`，`warnings` 非空，能让人回溯是哪条边、为什么被丢
    - 其它任何"调用方明确知情"的方案，只要 verify 能从返回值或抛出的异常中读到被丢边的信息即可
  - 混合场景（输入既有正常边也有被丢的边）：verify 接受"抛错"或"正常边处理 + 被丢边进 warnings"两种行为
- **约束**：`createGraphEdges` 必须仍是模块的命名导出（`module.exports = { createGraphEdges }` 结构不能破坏）。返回类型可从数组改成对象。

## 约束

- 只改 `workspace/edgeSync.js`。
- 不碰 `seed/`、`verify.mjs`、`task.md`、`SOLUTION.md`。
- 不碰 `workspace/` 以外的任何文件（即不要改主仓库代码）。
- 不引入外部依赖（只用 Node 标准库 / 纯 JS）。

## 验证

在本题目录下运行：

```bash
node verify.mjs
```

退出码 0 = PASS，非 0 = FAIL。5 项检查详见 verify 输出。

完成后按 [challenges/README.md](../README.md) 填 `workspace/RESULT.md`。
