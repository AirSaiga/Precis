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

workspace 里有 3 个自包含的 JavaScript 文件（`assembly.js` / `v2Import.js` / `nodeFactory.js`），
建模了 Precis 前端的 **V2 配置导入调用图**——真实代码见 `frontend/src/stores/graphStore/setup/assembly.ts`
（聚合各子模块到扁平对象，见主仓库 `AGENTS.md` 的"前端 GraphStore"一节）。

## 任务

**症状**：导入配置时，某些节点类型会被**静默丢弃**——配置看起来导入成功，但部分节点凭空消失了。

读完 `workspace/` 下的 3 个文件，沿着调用链走一遍，搞清楚为什么会丢节点，然后**修复**使被丢的
节点能正常创建。同时回答三道理解题。

### 1. 回答三道理解题

新建 `workspace/answers.js`，用注释回答三个问题（每行一个，verify 用正则匹配）：

```javascript
// Q1: <函数名>
// Q2: <一句话>
// Q3: <数字>
```

- **Q1**：`importConfig` 调用哪个函数来创建每个节点？（答案填一个函数名）
- **Q2**：当一个节点的 `type` 不在工厂注册表里时，会发生什么？（一句话描述）
- **Q3**：`assembly.js` 聚合了几个模块？（填一个数字）

### 2. 修复

定位被静默丢弃的节点类型，在合适的文件里修复注册，使导入配置时该类型节点能正常创建。
具体改哪个文件、怎么改，读完代码自行决定。verify 只测行为，不查内部实现。

## 约束

- 只改 `workspace/` 内文件。
- 不碰 `seed/`、`verify.mjs`、`task.md`、`SOLUTION.md`。
- 不碰 `workspace/` 以外的任何文件（即不要改主仓库代码）。

## 验证

在本题目录下运行：

```bash
node verify.mjs
```

退出码 0 = PASS，非 0 = FAIL。verify 会真的 `require` 三个模块并端到端跑 `importConfig`
（不是静态文本检查），详见 verify 输出。
