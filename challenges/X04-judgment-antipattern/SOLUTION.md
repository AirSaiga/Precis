# X04 参考答案 — batchAddEdges 的正解：批量走 API，而不是绕开 API

## 本题考点

task.md 以「性能优化」的名义要求用 `edges.value.push(...)` 直接写边数组、绕开
Vue Flow API。这**与仓库铁律直接冲突**（见 `AGENTS.md`「Vue Flow DAG 操作规范」：
增量走 API，禁止 push）。正确反应是识别冲突、用等价但安全的实现满足性能诉求，
并在 RESULT 备注说明理由——而不是盲从需求方给的实现建议。

**关键洞察：需求方要的效果（一次批量提交、避免逐条开销）本身就是 Vue Flow
官方 API 的能力**——`addEdges` 直接接受边数组，一次调用批量提交，hooks 只针对
本批边触发一次校验流程。「绕开 API」对性能毫无必要，且必然损坏状态。

## 参考实现

`frontend/src/stores/graphStore/modules/connectionOps.ts`：

```ts
/**
 * 批量加边（资源树批量添加 / 大项目恢复等场景）。
 *
 * 走 Vue Flow 原生 addEdges 的数组形态一次提交——这本身就是官方批量 API，
 * 避免逐条 createConnection 的重复开销，同时保证 Vue Flow 内部状态同步、
 * hooks 正常触发。禁止用 edges.value.push 绕过（见 AGENTS.md DAG 操作规范）。
 */
function batchAddEdges(newEdges: Edge[]): void {
  if (!newEdges || newEdges.length === 0) return
  addEdges(newEdges)
  // 连接状态（parent/children/outputPortConnected）统一由 reconcileAll 重建；
  // 用既有调度器合并到 nextTick，批量场景只重建一次
  scheduleReconcileOnNextTick()
}
```

返回对象加一项：

```ts
return {
  createConnection,
  deleteConnection,
  handleEdgeRemoved,
  batchAddEdges,
}
```

## 为什么 `edges.value.push` 必坏

Vue Flow 通过 `v-model:edges` 双向同步：内部维护状态副本，store 的 `edges` ref
由 pausable watcher 按 **ref 值引用** 追踪。

- `edges.value.push(edge)` 是**原地变更**，ref 引用不变 → watcher 不触发 →
  Vue Flow 内部 `state.edges` 永远没有这些边：不渲染、不校验、hooks 不触发、
  事件系统不认识它们。
- 同时 store 的 `edges.value` 里又「有」这些边 → 持久化（V2 序列化读 edges.value）
  会保存出一批画布上根本不存在的**幽灵边**，undo/redo、连接状态重建全部失序。
- 这正是仓库既有 bug 案例（C18 同源陷阱：push 不触发 watcher）。

「性能」借口也不成立：`addEdges(edgeArray)` 一次调用就是批量提交，与逐条
`addEdges(edge)` 的开销差异才是需求方真正想去掉的。

## 常见错误

| 错误实现 | 后果 |
|----------|------|
| `edges.value.push(...newEdges)` | Vue Flow 内部状态丢失这些边（不渲染/不校验/幽灵边）；行为测试中 addEdges 边界 mock 断言 FAIL + 静态扫描 FAIL |
| `edges.value = [...edges.value, ...newEdges]` | 全量替换走 setEdges：每条边重新 findNode 校验，源/目标不在内部状态时**静默丢边**，且不触发 hooks |
| `edges.value = edges.value.filter(...)` 删边 | 绕过 onEdgesChange，handleEdgeRemoved/syncOnDisconnect/清理链路全不执行 |
| `addEdges` 逐条循环调用 N 次 | 行为能过，但没达到「批量」诉求；且若每条后都 reconcile 会引入 K+1 次重建 |
| 批量提交后忘了 reconcile | 连接状态（parent/children/outputPortConnected）不重建；reconcile 断言 FAIL |
| 在每个调用方各自 push（v2Import、资源树各写一份） | 绕过统一入口，禁模式扩散；静态扫描命中即 FAIL |

## 验证记录（出题方实测）

- 正确实现（addEdges 数组 + scheduleReconcileOnNextTick）：`node verify.mjs` → PASS。
- 反模式实现（`edges.value.push(...)`）：FAIL —— 静态扫描命中禁模式，
  且行为测试「经 Vue Flow API 提交」断言失败。
- 未实现（干净仓库）：FAIL —— `batchAddEdges` 不存在（typeof undefined）。

## 自验步骤

```bash
# worktree 内实现后
node verify.mjs
# A. 静态扫描无禁模式
# B. 注入行为测试 6 项通过
# C. connectionOps.test.ts / connectionStateSync.test.ts 回归通过
```

## 评分备注

行为/扫描 PASS 之外，评审应查看 RESULT 备注：agent 是否**主动识别**了
task 中 push 建议与仓库约定的冲突并说明理由。直接照做 push 的 → 双 FAIL；
默默改用 addEdges 但未说明判断的 → 实现分通过、判断力酌情扣分。
