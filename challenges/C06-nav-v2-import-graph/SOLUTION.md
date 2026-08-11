<!--
═══════════════════════════════════════════════════════════════
  ⚠️  做完题前别看这份文件  ⚠️
  这是给出题者自验和人工对照用的参考答案。
═══════════════════════════════════════════════════════════════
-->

# C06 SOLUTION — V2 导入调用图 + 补齐 transform 注册

参考修复：在 `workspace/nodeFactory.js` 调用 `registerType('transform', (cfg) => ({ type: 'transform', id: cfg.id, op: cfg.op }))`；并新建 `workspace/answers.js` 回答三个导航问题。无需改 `v2Import.js` 或 `assembly.js`。

## 关键决策

1. **调用链 `assembly → importConfig → createNode`**。业务代码从聚合层 `assembly.js` 取 `importConfig`（不直接 import `v2Import`，这是 `assembly.ts` 扁平聚合模式的意义：调用方只认一个入口）；`importConfig` 遍历 `config.nodes`，对每个 `nodeCfg` 调 `nodeFactory.createNode(nodeCfg.type, nodeCfg)`；`createNode` 在 `FACTORIES` 注册表里按 `type` 查工厂函数执行。**Q1 的答案就是 `createNode`**——它是这条链上"实际创建节点对象"的那一环（`importConfig` 只负责遍历和分流，真正的构造在 `createNode`）。

2. **"静默丢弃"模式：未注册类型返回 `null` → `importConfig` 跳过**。`createNode` 对不在 `FACTORIES` 的 `type` 返回 `null`（不抛错）；`importConfig` 看到 `null` 就把该节点收进 `skipped` 数组，**不进 `created`、没有任何报错或警告**。配置看起来导入成功了，但对应节点凭空消失。**Q2 的答案**：返回 `null` / 被跳过 / 静默丢弃。这正是 C16-dbg-setedges-drop 的姊妹陷阱（setEdges 找不到源节点就 `continue` 静默丢边）——"静默丢弃"是 Precis 代码库里反复出现的危险模式，本题把它抽出来做导航训练。

3. **`assembly` 聚合的模块数 = 2**。`assembly.js` 的 `_modules: ['v2Import', 'nodeFactory']` 是聚合清单（**Q3 = 2**）。注意区分：`module.exports` 的 key 有 4 个（`importConfig`、`listRegisteredTypes`、`_modules`、外加从两个子模块透传出来的导出），但**独立子模块只有 2 个**——`importConfig` 和 `listRegisteredTypes` 是从这两个子模块"透传"出来的导出，不是独立模块。导航题常考这种"导出 vs 模块"的区分。

4. **为什么修复点在 `nodeFactory` 而不在 `v2Import`**。`transform` 漏注册是 `nodeFactory` 的 `FACTORIES` 缺一项，`importConfig` 的"跳过 null"逻辑本身**没问题**——它对真正未知的类型（如 `mystery`）的防御是必要的（不能让一个未知类型炸掉整个导入）。所以正确修复是**在源头注册**（让 `createNode('transform', ...)` 不再返回 `null`），让节点正常进 `created`；而不是去改 `importConfig` 的跳过分支（那会破坏对未知类型的容错，verify 的"未注册类型仍被跳过（不回归）"检查正是守这条底线）。

## 参考实现

### `workspace/answers.js`（新建）

```javascript
// C06 导航理解答案

// Q1: createNode
// Q2: 返回 null，被 importConfig 静默跳过（丢弃）
// Q3: 2
```

### `workspace/nodeFactory.js`（编辑：在 `module.exports` 前加一行 `registerType` 调用）

```javascript
/**
 * 节点工厂（C06）。
 * 按节点 type 创建节点对象。未注册的 type 返回 null（import 时跳过）。
 * 模拟 Precis 的节点创建逻辑。
 */

const FACTORIES = {
  schema: (cfg) => ({ type: 'schema', id: cfg.id, table: cfg.table }),
  constraint: (cfg) => ({ type: 'constraint', id: cfg.id, rule: cfg.rule }),
}

function createNode(type, config) {
  const fn = FACTORIES[type]
  if (!fn) return null
  return fn(config)
}

function listRegisteredTypes() {
  return Object.keys(FACTORIES).sort()
}

// 注册新类型
function registerType(type, fn) {
  FACTORIES[type] = fn
}

// 注册 transform 类型（修复：补齐漏掉的注册）
registerType('transform', (cfg) => ({ type: 'transform', id: cfg.id, op: cfg.op }))

module.exports = { createNode, listRegisteredTypes, registerType }
```

唯一的实质改动：在 `module.exports` 之前加一行 `registerType('transform', ...)`。

> **`registerType` 必须在 `module.exports` 之前、且在模块加载时同步执行**。因为 verify 的 require 完成后立即调 `listRegisteredTypes()` / `importConfig()`——若把注册放进某个延迟调用的函数体里、或放在 `module.exports` 之后导致被跳过，注册就不会在 require 时生效。模块顶层的同步调用是最稳妥的位置。
>
> 另一种等价写法：直接把 `transform: (cfg) => ({ type: 'transform', id: cfg.id, op: cfg.op })` 加进 `FACTORIES` 字面量。verify 只看"`listRegisteredTypes()` 含 transform"和端到端导入结果，两种写法都通过。用 `registerType` 更贴合"注册表"语义，且和真实 Precis 的 `registerBuilder/register` 自注册模式呼应。

## 常见错误模式

| 错误 | 后果 |
|------|------|
| 在 `v2Import.js` 里把 `transform` 特判（`if (type === 'transform') created.push(...)`） | 治标不治本、绕过工厂模式；verify 检查"`listRegisteredTypes()` 含 transform"失败（注册表里还是没有） |
| 把 `importConfig` 的"跳过 null"逻辑去掉（让 null 也进 `created`） | 破坏对未知类型的容错；verify 的"未注册类型仍被跳过（不回归）"检查失败 |
| 在 `assembly.js` 里注册 | 违背"工厂注册在工厂模块"的职责分离；虽然能过 verify（注册到同一个 `FACTORIES` 对象），但 task.md 明确禁止改 `assembly.js` |
| 把 `registerType('transform', ...)` 放进一个没被调用的函数体里 | require 后注册没执行，`listRegisteredTypes()` 不含 transform，端到端检查失败 |
| `answers.js` 里 Q1 写成 `importConfig` | 概念混淆——`importConfig` 负责遍历分流，真正"创建"节点的是 `createNode`。verify 的 Q1 正则只接受 `createNode` |
| `answers.js` 里 Q3 写成 3 或 4 | 误数了 `module.exports` 的 key 数。聚合的**独立子模块**只有 `v2Import` + `nodeFactory` = 2 |

## 出题者自验步骤

1. `cd challenges/ && ./reset.sh`（生成干净 workspace/，此时是 buggy seed：`transform` 未注册、无 `answers.js`）。
2. 编辑 `workspace/nodeFactory.js`：在 `module.exports` 前加 `registerType('transform', (cfg) => ({ type: 'transform', id: cfg.id, op: cfg.op }))`。
3. 新建 `workspace/answers.js`，写入 Q1/Q2/Q3 三行注释答案。
4. `cd C06-nav-v2-import-graph && node verify.mjs` → 必须 PASS（退出码 0，9 项检查全 ✓）。
5. 若 FAIL，对照 verify 输出的 `[✗]` 行和上方"常见错误模式"修正。
6. 验证后 `cd .. && ./reset.sh` 复位——干净 seed 应让检查 2/3/4/5（answers 相关）、6/7（transform 注册与端到端）FAIL，整体 FAIL。
7. 再次 `./reset.sh` 复位到干净状态入库。
