<!--
═══════════════════════════════════════════════════════════════
  ⚠️  做完题前别看这份文件  ⚠️
  这是给出题者自验和人工对照用的参考答案。
═══════════════════════════════════════════════════════════════
-->

# C12 SOLUTION — 加新工厂模块 clipboardOps（graphStore 工厂聚合）

参考实现 = 新建 `workspace/clipboardOps.js`（镜像 nodeOps/historyOps 的 `createXxxOps(deps)` 工厂）+ 编辑 `workspace/assembly.js`（require + 调用 + spread）。下方按文件给出完整内容与 diff。

## 关键决策

1. **依赖注入铁律 —— 工厂只通过 `deps` 拿 `nodes`，绝不 `require('./assembly')` 或直接拿 store。**
   - 这是 graphStore 工厂模式的根本约定（AGENTS.md 原文："每个模块工厂通过参数接收 nodes, edges 等响应式引用（依赖注入），不直接导入 store"）。
   - 若 clipboardOps 反向 require assembly（拿 store.nodes）：(a) 制造 `assembly ↔ clipboardOps` 的循环依赖；(b) 单元测试时无法注入 mock nodes，工厂不可孤立测试；(c) 破坏"assembly 是唯一接线点"的架构。
   - 正确写法：`const { nodes } = deps`，`copyNode` 读 `deps.nodes`（这里直接用解构出的 `nodes`）、`pasteNode` 写 `nodes.push(...)`。和 nodeOps/historyOps 一致。

2. **`clipboard` 是 `createClipboardOps` 函数体内的闭包 `let`，不是文件顶层的模块级 `let`。**
   - 这是本题最易踩的坑（也是 ★★★ 的难点所在）。task.md 说"module-level variable (let)"指的是**工厂体内、方法外**的层级（和 historyOps 的 `past`/`future` 栈同构），**不是**文件顶层的 `let`。
   - 判据：verify 的 `_checkPasteEmpty` 会**再调一次 `_makeStore()`** 造一个新 store，并断言新 store 的 `pasteNode('x') === null`（注释："新 store，clipboard 为空"）。这要求**每次 `assembleStore` → `createClipboardOps` 都拿到一个全新的 `clipboard = null`**。
   - 若把 `let clipboard = null` 写在文件顶层（函数外）：`_checkBehavior` 先 `copyNode('n1')` 把 clipboard 染成 n1 的拷贝；`_checkPasteEmpty` 新建 store 时函数不会重跑、顶层变量仍是 n1 的拷贝 → `pasteNode('x')` 返回 `{id:'x', data:{value:42},...}` ≠ null → verify「空剪贴板 paste 返回 null」**FAIL**。
   - 闭包写法（`let clipboard = null` 在 `createClipboardOps` 内、`copyNode`/`pasteNode` 外）：每次调工厂都重新初始化为 null，factory 实例之间互不污染 → 通过。
   - 顺带：`clipboard` 也要放进 `return` 对象（task 规格要求 `{ copyNode, pasteNode, clipboard }`），暴露的是返回时刻的快照引用，外部改它不影响内部 `let`。

3. **`copyNode` 存的是深拷贝**（`JSON.parse(JSON.stringify(node))`）。
   - 和 historyOps 的 `snapshot` 同款写法。若存原节点引用：后续改了原节点（或 undo 还原了 nodes 数组），clipboard 里的拷贝会被带歪，再 paste 出来的是被污染的数据。深拷贝隔离副本，copy 时刻定格。

4. **`pasteNode` 用 `newId` + clipboard 的 `data`/`type` 重建节点，不直接复用 clipboard 整体对象。**
   - 规格明确新节点结构是 `{ id: newId, data: clipboard.data, type: clipboard.type }`：id 必须换成新 id（否则两个节点同 id），data/type 复用剪贴板内容。
   - 注意：这里 `data` 是引用共享（指向 clipboard.data，而 clipboard.data 又指向深拷贝里的 data），对 verify 足够（它只读 `pasted.data.value`）。生产里若要彻底隔离可再深拷一层，但本题不在判定范围。

5. **spread 接入不覆盖原有方法。**
   - `return { ...nodeOps, ...historyOps, ...clipboardOps }`：三组方法名（`addNodeWithId/removeNode/getNode`、`snapshot/undo/redo`、`copyNode/pasteNode`）无交集，spread 互不覆盖。verify 专门检查 `addNodeWithId`（nodeOps 完好）和 `undo`（historyOps 完好）仍在，确保接入是 additive 而非替换。

## 参考实现

### `workspace/clipboardOps.js`（新建 —— 完整文件）

镜像 nodeOps/historyOps 的工厂模式：`createClipboardOps(deps)` + 闭包内 `let clipboard` + `module.exports`。

```javascript
/**
 * 剪贴板操作工厂模块（C12 —— 新增工厂，镜像 nodeOps / historyOps 模式）。
 *
 * 把"复制 / 粘贴节点"封装成一个 createClipboardOps 工厂：
 *   - 通过 deps 注入 nodes（不直接导入 store —— DI 铁律）
 *   - clipboard 是工厂闭包内的私有状态，跨 copy/paste 调用共享，
 *     但每个工厂实例（每次 assembleStore）各有一份，互不污染
 *   - assembly.js 把返回值 spread 进扁平 store 对象
 *
 * AGENTS.md："每个模块工厂通过参数接收 nodes 等响应式引用（依赖注入），不直接导入 store"。
 */

/**
 * 创建剪贴板操作模块。
 * @param {{nodes: Array}} deps - 注入的依赖（共享节点数组）
 */
function createClipboardOps(deps) {
  const { nodes } = deps

  // 工厂闭包内的私有状态：最后一次复制的节点深拷贝。
  // 关键：写在函数体内、方法外 —— 每个 factory 实例各一份（同 historyOps 的 past/future）。
  // 不要写成文件顶层 let，否则跨 store 实例泄漏（见 SOLUTION 关键决策 2）。
  let clipboard = null

  function copyNode(id) {
    const node = nodes.find((n) => n.id === id)
    if (!node) return false
    // 深拷贝定格，避免原节点后续被改把 clipboard 带歪（同 historyOps.snapshot 写法）
    clipboard = JSON.parse(JSON.stringify(node))
    return true
  }

  function pasteNode(newId) {
    if (clipboard == null) return null
    const newNode = { id: newId, data: clipboard.data, type: clipboard.type }
    nodes.push(newNode)
    return newNode
  }

  return { copyNode, pasteNode, clipboard }
}

module.exports = { createClipboardOps }
```

### `workspace/assembly.js`（编辑 —— require + 调用 + spread）

```diff
 const { createNodeOps } = require('./nodeOps')
 const { createHistoryOps } = require('./historyOps')
+const { createClipboardOps } = require('./clipboardOps')

 function assembleStore(deps) {
   // 调用各工厂，注入 deps
   const nodeOps = createNodeOps(deps)
   const historyOps = createHistoryOps(deps)
+  const clipboardOps = createClipboardOps(deps)

   // 聚合到扁平对象
   return {
     ...nodeOps,
     ...historyOps,
+    ...clipboardOps,
   }
 }
```

**verify 自查**：assembly.js 可加载 ✓；clipboardOps.js 存在 + 导出 `createClipboardOps` 函数 ✓；store 含 copyNode / pasteNode ✓；store 仍含 addNodeWithId（nodeOps 完好）+ undo（historyOps 完好）✓；copy+paste 行为正确（n1→n2，data.value=42，nodes.length=2）✓；copy 不存在节点返回 false ✓；空剪贴板 paste 返回 null ✓（依赖闭包级 clipboard，新 store 重新初始化）→ PASS（10/10）。

## 常见错误模式

| 错误 | 后果 |
|------|------|
| `let clipboard = null` 写在**文件顶层**（函数外） | verify「空剪贴板 paste 返回 null」FAIL —— `_checkPasteEmpty` 新建 store 时 clipboard 仍持有上一次 copy 的内容，paste 不返回 null |
| clipboard 写成工厂内某方法的局部变量（每次 copy/paste 都重新声明） | copy 存的值 paste 读不到（永远 null）→ copy+paste 行为测试 FAIL |
| 在 clipboardOps.js 里 `require('./assembly')` 或直接拿 store | 违反 DI 铁律；制造循环依赖；若实现成读 store.nodes 则功能上可能仍 work，但违背架构（题目约束禁止）；典型表现是工厂形参不用 `deps` |
| `copyNode` 存原节点引用（不深拷贝） | 本题 verify 的 `_checkBehavior` 顺序下恰好能过（copy 后没人改原节点），但生产里 undo/后续编辑会污染剪贴板；属隐患而非直接 FAIL |
| `pasteNode` 直接 `return { ...clipboard, id: newId }` 或复用 clipboard 整体 | 一般仍过 verify（只要 id 是 newId、data.value 是 42）；但偏离规格明确的 `{ id, data, type }` 结构，且会把 copy 来源的 id 字段意外带进新节点对象的其它键 —— 不推荐 |
| `assembly.js` 改成 `return { ...clipboardOps }`（漏 spread 原有） | verify「addNodeWithId」「undo」FAIL —— 破坏了 additive 接入 |
| 改了 `nodeOps.js` / `historyOps.js` | 违反约束（题目明确这两个是只读模板）；本题 verify 不检查它们内容，但出题约束禁止改 |
| 忘记把 `clipboard` 放进 `return` | 本题 verify 不直接断言 `store.clipboard`（只测 copyNode/pasteNode 行为），所以不 FAIL；但偏离 task 规格 `{ copyNode, pasteNode, clipboard }`，建议照规格暴露 |
| `module.exports = createClipboardOps`（导出函数而非 `{ createClipboardOps }`） | verify「导出 createClipboardOps 函数」FAIL —— 要求 `clipMod.createClipboardOps` 是函数，即命名导出 |

## 出题者自验步骤

1. `cd challenges/ && ./reset.sh`（生成干净 workspace/ = seed 副本：只有 nodeOps.js + historyOps.js + assembly.js，无 clipboardOps.js、assembly 未接 clipboard）。
2. 按上方参考实现：新建 `workspace/clipboardOps.js`，编辑 `workspace/assembly.js` 加 require + 调用 + spread。
3. `cd C12-inc-add-store-module && node verify.mjs` → 必须 PASS（退出码 0，首行 `PASS`，10 项检查全 `[✓]`）。
4. 若 FAIL，对照 verify 输出的 `[✗]` 行修正（最常见：clipboard 写成文件顶层 let 导致「空剪贴板 paste 返回 null」挂、漏 spread 破坏原有方法、`module.exports` 写错）。
5. `cd .. && ./reset.sh` 复位（workspace 回到 seed）。
6. `cd C12-inc-add-store-module && node verify.mjs` → 应 FAIL（首行 `FAIL`，多个 `[✗]`：clipboardOps.js 不存在导致「clipboardOps.js 存在」「导出 createClipboardOps」「copyNode」「pasteNode」「copy+paste 行为」「copy 不存在节点」「空剪贴板 paste」全挂；但「assembly.js 可加载」`[✓]`（seed assembly 本身能跑，只是没 clipboard 方法）、「addNodeWithId」「undo」`[✓]`（nodeOps/historyOps 完好））。
7. 最后 `cd .. && ./reset.sh` 复位，保持交付态干净。
