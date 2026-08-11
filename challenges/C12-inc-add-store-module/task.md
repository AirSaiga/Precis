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

workspace 里有 3 个自包含的 JS 文件，模拟真实 Precis 的 **graphStore 工厂聚合模式**（AGENTS.md「前端 GraphStore」一节）：每个 `createXxxOps(deps)` 工厂函数通过参数接收注入的依赖（`nodes` 等响应式引用），返回一组操作方法；`assembly.js` 的 `assembleStore(deps)` 把所有工厂调一遍，把返回值 spread 进一个扁平的 store 对象。

现有 3 个文件：

- `workspace/nodeOps.js` —— `createNodeOps`，本题的模板。
- `workspace/historyOps.js` —— `createHistoryOps`，另一个参考工厂（演示工厂内的闭包私有状态）。
- `workspace/assembly.js` —— `assembleStore`，当前聚合了 nodeOps + historyOps。

**先读这三个文件**，仔细理解工厂模式的约定：依赖怎么注入、闭包状态怎么放、assembly 怎么聚合。

## 任务

照 `nodeOps` / `historyOps` 的模式，新增一个**剪贴板工厂模块 `clipboardOps`**（复制 / 粘贴节点），并接入 `assembly`。

- **新建 `workspace/clipboardOps.js`**：导出 `createClipboardOps(deps)` 工厂，返回含 `copyNode` 和 `pasteNode` 方法的对象。
- **接入 `workspace/assembly.js`**：把新工厂 require 进来、在 `assembleStore` 里调用、把返回值 spread 进 store。

其余设计（`copyNode` / `pasteNode` 的具体行为、剪贴板状态怎么管理、拷贝用深还是浅、边界情况怎么处理）**自行决定**——仔细想清楚工厂实例之间的状态隔离。verify 只测行为，不查内部实现。

## 约束

- 只在 `workspace/` 里改 / 增文件：新建 `workspace/clipboardOps.js`，编辑 `workspace/assembly.js`。
- 不碰 `seed/`、`verify.mjs`、`task.md`、`SOLUTION.md`。
- **不要改 `workspace/nodeOps.js` / `workspace/historyOps.js`**（它们是只读参考模板）。
- 不碰 `workspace/` 以外的任何文件。

## 验证

```bash
node verify.mjs
```

退出码 0 = PASS，非 0 = FAIL。verify 会真实加载你的模块、调用方法、测 copy/paste 行为与边界情况（含一些不那么明显的情况）。

完成后按 [challenges/README.md](../README.md) 填 `workspace/RESULT.md`。
