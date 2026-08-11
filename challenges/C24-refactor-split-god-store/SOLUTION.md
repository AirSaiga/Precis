<!--
═══════════════════════════════════════════════════════════════
  ⚠️  做完题前别看这份文件  ⚠️
  这是给出题者自验和人工对照用的参考答案。
═══════════════════════════════════════════════════════════════
-->

# C24 SOLUTION — 拆分 God store，提取 clipboardOps 工厂模块

参考实现见下方三个代码块：`workspace/clipboardOps.js`（新建）、`workspace/godStore.js`（删除剪贴板逻辑）、`workspace/assembly.js`（spread 聚合两个工厂）。

## 关键决策

1. **为什么是处方式（PRESCRIPTIVE）拆分，而不是自由重构**：自由重构的输出形态因人而异（有人把状态外置成参数、有人改成 class、有人连节点操作也一起抽走、有人让 clipboardOps 反过来调 godStore），无法做客观静态检查。处方式拆分精确规定"建哪个文件、抽哪些符号、godStore 怎么去掉、assembly 怎么聚合"，verify 才能用正则 + 行为回归做客观判定。这也贴近真实 Precis 重构：`createXxxModule` 工厂的命名、依赖注入签名、扁平聚合方式都是项目既定约定（见 AGENTS.md graphStore 工厂拆分模式），重构者照约定走，不自创风格。

2. **为什么只抽剪贴板，不抽节点/历史操作**：剪贴板操作（`copyNode`/`pasteNode` + `clipboard` 状态）是一组**内聚**的逻辑——它维护自己的私有状态（`clipboard`），对外只暴露两个方法，与节点操作、历史操作没有交叉依赖（剪贴板只**读**节点列表、**写**时 push 节点）。节点操作（`addNode`/`removeNode`/`getNode`）是基础能力，被其他组复用（历史操作的 `undo`/`redo` 也直接操作 `nodes`），抽出去反而要反向依赖；历史操作（`snapshot`/`undo`/`redo` + `past`/`future` 栈）是另一组内聚逻辑，但本题刻意只动剪贴板那一组，验证 agent 不会过度抽取或欠抽取。真实 Precis 里 graphStore 也是按"内聚的状态+操作"边界逐组拆成 ~27 个工厂的，不是一刀切。

3. **模块级 `clipboard` 状态为什么跟着搬走**：`clipboard` 只被 `copyNode`/`pasteNode` 读写，是这组逻辑的**私有状态**。把它留在 godStore 会产生两个问题：(a) godStore 不再拥有读写它的方法，却持有它的状态，职责错乱；(b) 若 clipboardOps 通过闭包或参数访问它，两个模块就被隐式状态耦合。正确做法是状态跟随操作一起迁入 `clipboardOps.js`，工厂内部 `let clipboard = null`（闭包变量，每个 `createClipboardOps(deps)` 实例独立持有）。这模拟真实 Precis 工厂拆分里"状态 + 操作一起封装进工厂闭包"的约定。

4. **为什么 clipboardOps 直接用 `deps.nodes`，不调 godStore 的方法**：这是工厂拆分的核心约定——**依赖注入而非互相调用**。`createClipboardOps(deps)` 拿到 `deps.nodes` 引用后，`copyNode` 用 `deps.nodes.find(...)` 查节点、`pasteNode` 用 `deps.nodes.push(...)` 加节点，**不回调** `godStore.getNode`/`godStore.addNode`。原因：(a) 调 godStore 方法会把两个工厂耦合（clipboardOps 必须先有 godStore 实例才能工作，违背工厂独立性）；(b) 真实 Precis 的 `createXxxModule({ nodes, edges, ... })` 工厂都只依赖注入进来的响应式引用，不 import store、不互相调用；(c) `deps.nodes` 是同一个数组引用，`push` 进去的节点 godStore 那边立即可见（因为 `nodes` 是共享引用）。verify 的行为检查（`addNode` 后 `copyNode` 能找到、`pasteNode` 后 `nodes.length === 2`）正是验证这条共享引用契约。

5. **为什么 assembly 用 spread 聚合，不嵌套**：`{ ...createGodStore(deps), ...createClipboardOps(deps) }` 把两个工厂的返回扁平合并成**一个 store 对象**。这样对外 API 形态与拆分前完全一致（`store.copyNode`、`store.addNode`、`store.undo` 都在同一层），消费方无感。两个工厂的 key 没有重叠（godStore 出 `addNode`/`removeNode`/`getNode`/`snapshot`/`undo`/`redo`，clipboardOps 出 `copyNode`/`pasteNode`），spread 不会覆盖。这模拟真实 Precis 的 `setup/assembly.ts`——它把所有 `createXxxModule` 的返回聚合成一个扁平 graphStore。

## 参考实现

### `workspace/clipboardOps.js`（新建）

```javascript
/**
 * 剪贴板操作工厂模块（C24 解）。
 *
 * 从 godStore 提取出来的一组内聚逻辑：剪贴板状态 + copy/paste 操作。
 * 约定照搬真实 Precis 的 createXxxModule 模式：
 * - 通过 deps 注入 nodes 引用，不直接导入 store、不回调其他工厂；
 * - 工厂闭包持有私有状态（clipboard），每个实例独立。
 */

function createClipboardOps(deps) {
  const { nodes } = deps
  let clipboard = null  // 持有最近一次复制节点的深拷贝，或 null

  function copyNode(id) {
    const node = nodes.find((n) => n.id === id)
    if (!node) return false
    clipboard = JSON.parse(JSON.stringify(node))
    return true
  }

  function pasteNode(newId) {
    if (!clipboard) return null
    const newNode = { id: newId, data: clipboard.data, type: clipboard.type }
    nodes.push(newNode)
    return newNode
  }

  return { copyNode, pasteNode }
}

module.exports = { createClipboardOps }
```

### `workspace/godStore.js`（删除剪贴板逻辑，保留节点 + 历史）

```javascript
/**
 * God Store（C24 解 —— 已拆分）。
 *
 * 剪贴板操作已提取到独立工厂模块（见 assembly.js 的扁平聚合）。
 * 本文件只保留：
 * - 节点操作（addNode, removeNode, getNode）
 * - 历史操作（snapshot, undo, redo）
 */

function createGodStore(deps) {
  const { nodes } = deps

  // === 节点操作（保留在 godStore）===
  function addNode(node) { nodes.push(node) }
  function removeNode(id) {
    const idx = nodes.findIndex((n) => n.id === id)
    if (idx >= 0) nodes.splice(idx, 1)
  }
  function getNode(id) { return nodes.find((n) => n.id === id) || null }

  // === 历史操作（保留在 godStore）===
  const past = []
  const future = []
  function snapshot() {
    past.push(JSON.parse(JSON.stringify(nodes)))
    future.length = 0
  }
  function undo() {
    if (past.length === 0) return false
    future.push(JSON.parse(JSON.stringify(nodes)))
    const prev = past.pop()
    nodes.length = 0
    nodes.push(...prev)
    return true
  }
  function redo() {
    if (future.length === 0) return false
    past.push(JSON.parse(JSON.stringify(nodes)))
    const next = future.pop()
    nodes.length = 0
    nodes.push(...next)
    return true
  }

  return {
    // node ops
    addNode, removeNode, getNode,
    // history ops
    snapshot, undo, redo,
  }
}

module.exports = { createGodStore }
```

注意：`clipboard` 变量、`copyNode`/`pasteNode` 两个函数、返回对象里的 `// clipboard ops` 注释行和 `copyNode, pasteNode,` 两项都已删除。源码里**完全不含** `clipboard` 字样（含注释）。

### `workspace/assembly.js`（spread 聚合两个工厂）

```javascript
/**
 * 装配入口（C24 解）。
 * 聚合 godStore（节点 + 历史操作）与 clipboardOps（剪贴板操作）成一个扁平 store。
 */
const { createGodStore } = require('./godStore')
const { createClipboardOps } = require('./clipboardOps')

function assembleStore(deps) {
  return { ...createGodStore(deps), ...createClipboardOps(deps) }
}

module.exports = { assembleStore }
```

**verify 计数自查**：12 项全过——3 文件可加载 / clipboardOps 导出 createClipboardOps / godStore 不再定义 copyNode / godStore 不再定义 pasteNode / godStore 不再含 clipboard / assembleStore 返回 copyNode / assembleStore 返回 pasteNode / assembleStore 仍含 addNode / assembleStore 仍含 undo / copy+paste 行为正确 / copy 缺失节点返回 false / 空剪贴板 paste 返回 null → 12/12 PASS。

## 常见错误模式

| 错误 | 后果 |
|------|------|
| 没建 `clipboardOps.js`，剪贴板逻辑留在 godStore | 检查 2（导出 createClipboardOps）失败，连带 assembly 加载报错 |
| `clipboardOps.js` 没用 CommonJS（写成 `export function`） | `require('./clipboardOps')` 报错，检查 1（3 文件可加载）失败 |
| 工厂命名不是 `createClipboardOps`（如 `createClipboard`、`clipboardFactory`） | 检查 2（`typeof clip.createClipboardOps === 'function'`）失败 |
| `clipboard` 状态留在 godStore 没删（只搬走了函数） | 检查 5（godStore 不再含 clipboard）失败——正则扫任何 `clipboard` 字样，含注释也会误判，务必把注释一起删 |
| godStore 里留了 `// clipboard ops 已移到 clipboardOps.js` 之类的注释 | 检查 5 失败——正则 `clipboard` 是子串匹配，**连 `clipboardOps` 这个文件名、连注释里的英文 `clipboard` 都算**。改用中文"剪贴板"措辞（不匹配英文正则），或干脆不写这条注释。本解的 godStore.js 头注释刻意只用"独立工厂模块"，避开该英文词 |
| clipboardOps 里 `copyNode` 调 `godStore.getNode`（耦合） | 行为可能对，但违背工厂独立性约定；真实 Precis 重构里这会导致循环依赖。本题 verify 不直接查这点，但会通过"3 文件可加载"间接暴露循环 require |
| clipboardOps 里 `pasteNode` 调 `godStore.addNode` 而非 `deps.nodes.push` | 同上；且若 assembly 顺序写成 `{ ...createClipboardOps(deps), ...createGodStore(deps) }` 反了，`addNode` 会被覆盖，行为回归可能挂 |
| assembly 没用 spread，而是 `Object.assign(createGodStore(deps), { copyNode, pasteNode })` 手动列 | 若列全也能过行为检查，但违背"扁平聚合两个工厂"的约定；且容易漏方法。正确做法是 `{ ...createGodStore(deps), ...createClipboardOps(deps) }` |
| assembly 只 return `createGodStore(deps)`（忘了聚合 clipboardOps） | 检查 6/7（assembleStore 返回 copyNode/pasteNode）失败 |
| `copyNode` 没深拷贝（`clipboard = node` 直接引用） | 行为检查"copy+paste"在简单场景仍过（因为 paste 只读 `data`/`type`），但真实场景下后续修改原节点会污染剪贴板。本题 verify 用 `{ v: 1 }` 简单数据测不出，但 SOLUTION 要求深拷贝以保持行为完全不变 |
| `pasteNode` 用 `clipboard` 的 `id` 而非传入的 `newId` | 行为检查失败（`pasted.id !== 'b'`） |
| 在文件里 `console.log('PASS')` 试图影响 verify | 无效——verify 用闭包劫持 `console.log` 做作弊检测（`cheated` 标志），模块加载阶段打印 PASS/FAIL/`[✓]`/`[✗]` 会直接判 FAIL |

## 出题者自验步骤

1. `cd challenges/ && ./reset.sh`（生成干净 `workspace/`：`godStore.js` = seed、`assembly.js` = seed、无 `clipboardOps.js`）。
2. 把上方"clipboardOps.js（新建）"代码块写到 `workspace/clipboardOps.js`。
3. 把上方"godStore.js（删除剪贴板逻辑）"代码块整体覆盖到 `workspace/godStore.js`。
4. 把上方"assembly.js（spread 聚合）"代码块整体覆盖到 `workspace/assembly.js`。
5. `cd C24-refactor-split-god-store && node verify.mjs` → 必须 PASS（退出码 0，首行 `PASS`，12 项全 `[✓]`）。
6. 再跑 `cd .. && ./reset.sh` 复位（`workspace/godStore.js` 回到含剪贴板逻辑的 seed、`workspace/clipboardOps.js` 被删除、`workspace/assembly.js` 回到只调 createGodStore 的 seed）。
7. `cd C24-refactor-split-god-store && node verify.mjs` → 应 FAIL（12 项全 `[✗]`）：`require('./clipboardOps.js')` 抛错（文件不存在）→ 检查 1（3 文件可加载）`[✗]` 且 `asm` 从未赋值；连带检查 2（clipboardOps 导出）`[✗]`；godStore 仍含 `function copyNode`/`function pasteNode`/`clipboard` → 检查 3/4/5 `[✗]`；`asm == null` 使 `ctx == null` → 检查 6-12（assembleStore 返回 copyNode/pasteNode/addNode/undo + 三项行为回归）全部 `[✗]`。（seed 阶段因 require 抛错短路，连本该通过的 addNode/undo 保留检查也连带失败——这是 verify 用 try/catch 包裹加载的设计，应用解后 12 项全过即说明拆分干净。）
8. 最后 `cd .. && ./reset.sh` 复位，保持交付态干净（`workspace/` 不入库，由 reset 生成）。
