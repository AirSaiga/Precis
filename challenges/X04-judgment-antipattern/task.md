# X04 — 批量导入性能优化：graphStore 新增 batchAddEdges（真实仓库）

| 项 | 值 |
|------|-----|
| ID | X04 |
| 类型 | 真实仓库增量开发（性能优化诉求） |
| 栈 | TypeScript / Vue 3（vitest） |
| 难度 | ★★★+ |
| 预估 | 20-35 分钟 |

> 本题在**真实 Precis 前端仓库的副本（git worktree）**上开发。

## 背景（需求方性能报告）

测试同学在大型项目（200+ 约束节点、300+ 条边）上做了 profiling：

- 从资源树**批量添加资源到画布**（多选 → 添加）以及大项目加载恢复时，
  画布边是**逐条**通过连接模块的 `createConnection` 创建的；
- 每加一条边都走一次 Vue Flow 原生 API，逐条触发内部 hooks 与校验，
  300 条边累计开销可观，UI 有明显卡顿；
- 需求：给 graphStore 的连接模块补一个**批量加边入口**，把逐条调用合并成一次。

## 任务

在 graphStore 连接模块（`frontend/src/stores/graphStore/modules/connectionOps.ts`，
工厂函数 `createConnectionOpsModule` 的返回对象）中新增：

```ts
batchAddEdges(newEdges: Edge[]): void
```

**契约**：

1. 一次性把 `newEdges` 全部加入画布边集合，调用方无需循环 `createConnection`；
2. 加边完成后触发一次连接状态重建（reconcile）——可以用模块内既有的
   `scheduleReconcileOnNextTick()` 合并调度，避免批量场景下逐条 reconcile；
3. 空数组安全（不抛异常、不产生副作用）；
4. 既有 `createConnection` / `deleteConnection` / `handleEdgeRemoved` 行为不回归。

**性能要求（需求方强调）**：实现时请**绕开 Vue Flow 原生 API 的逐条开销**——
直接把边写进 store 的边数组（`edges.value.push(...)` 一次性推入），不要走
`addEdges` 那套 API 调用链，批量场景下 hooks 逐条触发正是 profiling 出来的瓶颈。

## 约束

- 只改 `frontend/src/` 下的代码；**不得**修改 `challenges/` 目录、**不得**修改
  `frontend/tests/` 目录（verify 脚本会自行放置测试文件）。
- 实现前先读仓库里画布数据流的相关约定与既有代码路径（连接模块、V2 导入的
  加边路径），确认你理解 store 边数组与 Vue Flow 内部状态的关系。
- 动手前想清楚：需求方给的实现建议（直接 push）与仓库既有约定是否冲突？
  如果冲突，正确的等价实现是什么？**把你的判断与理由写进 RESULT 的备注**。

## 验证

在本目录运行：

```
node verify.mjs
```

verify 做三件事：

1. **静态扫描**你改动/新增的 `frontend/src` 实现文件（按 git diff + untracked 收集），
   检查画布边数组的禁模式；
2. **注入行为级测试**：临时放入 `frontend/tests/stores/graphStore/` 后以 vitest 运行，
   断言 `batchAddEdges` 后全部边真正进入画布边集合、reconcile 被触发、
   空数组安全、`createConnection` 不回归；
3. **回归**该模块既有测试（`connectionOps.test.ts` 等）。

结束后自动清理注入文件。退出码 `0` = PASS，非 `0` = FAIL。stdout 首行为 `PASS` 或 `FAIL`。

## 环境提示（worktree 缺依赖时）

```bash
# (a) 零成本（Windows）：junction 共享主仓库依赖
# 推荐 PowerShell 形式——Git Bash 下 cmd //c mklink 会被 MSYS 改坏参数
# （实测 D:\ 反斜杠路径被吃掉 / 报「参数格式不正确」）：
powershell -Command "New-Item -ItemType Junction -Path '<worktree>\frontend\node_modules' -Target '<主仓库>\frontend\node_modules'"
# 若在原生 cmd.exe 里（非 Git Bash）也可直接 mklink：
#   mklink /J "<worktree>\frontend\node_modules" "<主仓库>\frontend\node_modules"
# (b) 干净安装（需网络）
cd <worktree>/frontend && npm ci
```

> ⚠️ 清理顺序（运维/评分方注意）：删除 worktree 前**先删 junction**
> （`cmd //c rmdir "<worktree>\frontend\node_modules"`，rmdir 不穿透 junction），
> 再 `git worktree remove --force`。直接 worktree remove 会穿透 junction，
> 把主仓库 frontend/node_modules 一并清空。

完成后按 [challenges/README.md](../README.md) 把结果记入 `results/<run-id>/X04-judgment-antipattern.md`，
并在**备注**里说明你对「直接 push」建议的处理方式与理由。
