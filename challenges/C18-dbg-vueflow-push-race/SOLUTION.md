<!--
═══════════════════════════════════════════════════════════════
  ⚠️  做完题前别看这份文件  ⚠️
  这是给出题者自验和人工对照用的参考答案。
═══════════════════════════════════════════════════════════════
-->

# C18 SOLUTION — nodes.value.push 不触发 watcher 的同步竞态

参考实现见下方代码块。思路一句话：**赋值换引用，不要 mutation**。

## 关键决策

1. **bug 的本质是"值引用追踪"**：Vue Flow 的 pausable watcher 监听 `nodes` ref 时，比较的是 ref 的**值引用**（`ref.value !== lastSeenRef`）。`push` 在原数组上追加元素——数组对象身份不变，引用比较恒为 `false`，watcher 检测不到任何变化，于是不同步。修复的唯一正解是让 `ref.value` 指向一个**新的数组对象**。

2. **`ref.value = [...ref.value, node]` 是 AGENTS.md 正解**：展开运算符 `[...ref.value, node]` 先把当前数组内容展开、再追加新 node，**创建出一个全新的数组对象**；赋值让 `ref.value` 指向它。两步合一，既保留了原有节点、又换了引用、又追加了新节点。这正是 AGENTS.md "Vue Flow DAG 操作规范 / 核心原则：增量走 API，全量走数组替换" 的规范化写法。

3. **为什么不能"顺手修 watcher"让 push 也触发**：真实 Vue Flow 的 watcher 用 `===` 引用比较是有意为之——它配合 Vue 的响应式系统（ref 的 setter 只在赋值时触发），形成"赋值即同步"的清晰契约。如果改成深比较或脏检查，性能、循环触发、时序都会出问题。正确做法是**顺应契约**（赋值），而不是**改契约**（让 mutation 也能触发）。所以 verify 检查 4 明确要求 `addNodeBuggy` 仍不同步——这是防"绕过考点"的硬约束。

4. **为什么"先复制再 push"（Option C）也能过但不如 Option A**：`ref.value = [...ref.value]; ref.value.push(node)` 也能换引用，verify 接受。但它多了一步 mutation，可读性差、容易在后续维护中退化回纯 push（删了那行复制就回到 bug）。Option A 的 `[...ref.value, node]` 一行表达"新数组 = 旧内容 + 新元素"，意图最清晰。

5. **混合场景的"顺便可见"是预期行为**：先 `addNodeBuggy({id:'buggy'})`（push 进原数组）、再 `addNodeCorrect({id:'good'})`——后者展开的是**当前** `ref.value`（已含 buggy），所以新数组里两个都在。flush 后两个都进 `internalState`。这不是 bug：correct 把"当前逻辑状态"完整快照给了 watcher。verify 检查 5 只要求 `good` 可见（不强求 buggy 不可见），就是这个原因。

6. **"节点替换 vs 边替换"的区分（防过度外推）**：AGENTS.md 特别提醒——`nodes.value = [...]`（节点全量替换）走 `setNodes` → `createGraphNodes`，**不会**调用 `createGraphEdges`、不会重新验证边、不会丢弃边（那是 `edges.value = [...]` 的陷阱，见 C16 题）。本题只考节点层面的 push vs 赋值，不要把 C16 的"边被静默丢弃"陷阱外推到节点。节点全量替换的代价只是"冗余的 `createGraphNodes` 重建（性能浪费）+ 不必要的 `setNodes` 副作用"，而非数据损坏。

## 参考实现（Option A — AGENTS.md 正解）

```javascript
function createNodeStore() {
  const ref = { value: [] }
  let internalState = []
  let lastSeenRef = ref.value

  function sync() {
    internalState = [...ref.value]
  }

  function _flush() {
    if (ref.value !== lastSeenRef) {
      sync()
      lastSeenRef = ref.value
    }
  }

  return {
    ref,
    _flush,
    _getInternalState: () => [...internalState],
    addNodeBuggy(node) {
      // BUG: push 不换引用 → _flush 检测不到 → 不同步（保持原样，勿改）
      ref.value.push(node)
    },
    addNodeCorrect(node) {
      // 修复：展开成新数组再赋值，新引用触发 _flush 的引用比较
      ref.value = [...ref.value, node]
    },
  }
}

module.exports = { createNodeStore }
```

## 备选方案（verify 同样接受）

**Option B — concat（等价换引用）**：

```javascript
addNodeCorrect(node) {
  ref.value = ref.value.concat([node])
}
```

`concat` 返回新数组（不 mutate 原数组），赋值换引用，语义与 Option A 完全一致。

**Option C — 先复制再 push（能过但不如 A 优雅）**：

```javascript
addNodeCorrect(node) {
  ref.value = [...ref.value]  // 先复制换引用
  ref.value.push(node)        // 再 mutation（此时已是新引用，不影响检测）
}
```

> Option C 多一步 mutation、意图不如 A 清晰，但 verify 的检查 7（引用确实变了）能过，因为最终 `ref.value` 是个新对象。

## 常见错误模式

| 错误 | 后果 |
|------|------|
| `addNodeCorrect` 里也用 `ref.value.push(node)` | 检查 3、5、6、7 全部失败：节点不进 internalState，引用也没变（和 buggy 一样） |
| 改 `_flush` / `sync` 逻辑让 push 也能检测（如改成深比较、或每次 flush 都无条件 sync） | 检查 4 失败：`addNodeBuggy` 不再"不同步"，暴露绕过考点的改动 |
| 在 `addNodeCorrect` 里直接操作 `internalState`（如 `internalState.push(node)`）绕过 watcher | 检查 7 失败：`ref.value` 引用没变；且这违背"走 watcher 同步"的契约（真实 Vue Flow 里 internalState 是私有的，业务层碰不到） |
| `ref.value = ref.value; ref.value.push(node)`（赋同一个引用再 push） | 检查 7 失败：`before === after`（赋值是自赋，引用没变）；后续 push 也不换引用 |
| 忘了保留原有节点（如 `ref.value = [node]` 覆盖） | 检查 6（连续添加 5 个）失败：每次都覆盖，最终只剩最后一个 |
| 顺序搞反（`ref.value = [node, ...ref.value]`） | 检查 3 失败：`internal[0].id === 'n1'` 不成立（n1 跑到末尾了） |
| 改了 `createNodeStore` 的返回结构（如把 `addNodeCorrect` 改名、或改成 class） | 检查 2/3 失败：`store.addNodeCorrect` 不是函数 |
| 破坏 `module.exports = { createNodeStore }`（如改成 default export） | 检查 1/2 失败：`mod.createNodeStore` 不是函数 |
| 在模块顶层 `console.log("PASS")` 试图伪造通过 | 触发防作弊，整体 FAIL（verify 重定向 require 期间的 stdout 并扫描 `\bPASS\b`/`\bFAIL\b`/`[✓]`/`[✗]` 关键字） |

## 出题者自验步骤

1. `cd challenges/ && ./reset.sh`（生成干净 workspace/，此时 `addNodeCorrect` 是空函数体——seed 状态）。
2. 把参考实现（Option A 代码块）写进 `workspace/nodeStore.js`（覆盖 seed 副本；注意只填 `addNodeCorrect` 函数体，其余保持 seed 原样）。
3. `cd C18-dbg-vueflow-push-race && node verify.mjs` → 必须 PASS（退出码 0，7 项检查全 ✓）。
4. 若 FAIL，对照 verify 输出的 `[✗]` 行与上方"常见错误模式"修正。
5. 验证后 `cd .. && ./reset.sh` 复位——干净 seed 应让检查 3、5、6、7 FAIL（`addNodeCorrect` 空实现，节点不进 internalState、引用也没变），整体 FAIL。
   - 具体地：seed 下 `addNodeCorrect` 是空函数，调用后 `ref.value` 不变、`internalState` 为空 → 检查 3（length===2）✗、检查 5（找不到 'good'）✗、检查 6（length===5）✗、检查 7（`before === after`）✗。
   - 检查 4（addNodeBuggy 仍不同步）在 seed 下是 ✓（buggy 本来就不同步），但整体仍 FAIL。
6. 再次 `./reset.sh` 复位到干净状态入库（workspace/ 是 gitignore 的运行时副本，不入库；入库的是 seed/ + task.md + verify.mjs + SOLUTION.md）。
