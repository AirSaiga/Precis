<!--
═══════════════════════════════════════════════════════════════
  ⚠️  做完题前别看这份文件  ⚠️
  这是给出题者自验和人工对照用的参考答案。
═══════════════════════════════════════════════════════════════
-->

# C16 SOLUTION — createGraphEdges 静默丢边

参考实现见下方代码块（Option B：返回 `{ edges, warnings }`）。Option A（抛错）同样被 verify 接受，见"备选方案"。

## 关键决策

1. **不能裸 `continue`**：原 bug 的本质是"出错时什么信号都不留"。修复的核心是让缺失节点的边对调用方**可见**——要么 throw（调用方必须 catch 才能继续），要么塞进一个显式列表（调用方必须主动忽略才会漏）。两种都比"静默少返回几条"强。

2. **选 Option B（warnings）作为参考答案而非 Option A（throw）**：理由是"边同步"这种批量场景下，throw 会中断整批处理——明明只有 1 条边坏，却让其它正常边也白处理了。warnings 模式让正常边继续产出、坏边单独报告，更贴近 Vue Flow 真实场景里"边能建多少建多少，剩下的告警"的语义。但 verify 两种都接受，因为 ★☆☆ 难度只考"是否消除静默"，不考"用哪种消除方式"。

3. **warnings 元素带 `edgeId` + `missing` 数组**：让人能从 warnings 直接回溯是哪条边丢了哪个节点，不用反查输入。`missing` 用数组而非字符串，兼容"source 和 target 同时缺失"。

4. **返回值从数组改成对象 `{ edges, warnings }`**：这是破坏性变更，调用方需要适配。但题目允许（只要 `createGraphEdges` 仍具名导出）。如果在意向后兼容，可以选 Option A 避免改返回类型。

## 参考实现（Option B — warnings）

```javascript
/**
 * 把逻辑边列表转换成渲染边列表。
 * 缺失节点的边不再静默丢弃——而是记入 warnings，由调用方决定如何处理。
 *
 * @param {Array<{id: string, source: string, target: string}>} edges - 逻辑边
 * @param {(id: string) => object|null} findNode - 查找节点，找不到返回 null
 * @returns {{ edges: Array<object>, warnings: Array<{edgeId: string, missing: string[]}> }}
 */
function createGraphEdges(edges, findNode) {
  const result = []
  const warnings = []
  for (const edge of edges) {
    const sourceNode = findNode(edge.source)
    const targetNode = findNode(edge.target)
    if (!sourceNode || !targetNode) {
      const missing = []
      if (!sourceNode) missing.push(edge.source)
      if (!targetNode) missing.push(edge.target)
      warnings.push({ edgeId: edge.id, missing })
      continue
    }
    result.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceNode,
      targetNode,
    })
  }
  return { edges: result, warnings }
}

module.exports = { createGraphEdges }
```

## 备选方案（Option A — 抛错，verify 同样接受）

```javascript
function createGraphEdges(edges, findNode) {
  const result = []
  for (const edge of edges) {
    const sourceNode = findNode(edge.source)
    const targetNode = findNode(edge.target)
    if (!sourceNode || !targetNode) {
      const missing = []
      if (!sourceNode) missing.push(edge.source)
      if (!targetNode) missing.push(edge.target)
      // 抛错让调用方明确知道：这条边引用了不存在的节点
      throw new Error(
        `Edge "${edge.id}" references missing node(s): ${missing.join(', ')}`
      )
    }
    result.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceNode,
      targetNode,
    })
  }
  return result
}

module.exports = { createGraphEdges }
```

> Option A 保持数组返回类型，但混合场景下"正常边"也会因为前面的坏边抛错而无法返回（因为 throw 中断了循环）。verify 对混合场景接受"抛错且提到缺失边/节点"，所以 Option A 能过——但语义上不如 Option B 优雅（丢失了已处理的好边）。

## 常见错误模式

| 错误 | 后果 |
|------|------|
| 只把 `continue` 删了但不加任何信号（如改成 `result.push({...缺 node...})`） | 检查 3 失败（缺失边既没进 warnings 也没抛错，仍不可感知） |
| 加了 warnings 但只在"source 缺失"时记、忘了"target 缺失"分支 | 检查 3 在 target 缺失场景失败（本 verify 用的就是 target 缺失） |
| 抛错但错误信息没提到边 id 或节点 id 或 edge/node 字样 | 检查 3 失败（verify 用正则 `/e2\|missing\|edge\|node/i` 匹配错误信息） |
| Option B 忘了把正常边也放进 `result`（只收集 warnings） | 检查 2 失败（正常边没被处理） |
| 破坏了 `module.exports = { createGraphEdges }`（如改成 default export 或改名） | 检查 5 失败（`mod.createGraphEdges` 不是函数） |
| 在模块顶层 `console.log("PASS")` 试图伪造通过 | 触发防作弊，整体 FAIL（verify 重定向 require 期间的 stdout 并扫描 `\bPASS\b`/`\bFAIL\b`/`[✓]`/`[✗]` 关键字） |
| 在 `createGraphEdges` 内部 `console.log("PASS")` | verify 调用期间吞掉 stdout 不据此判作弊，但行为已由返回值/异常判定——若行为错仍 FAIL，若行为对则 print 被吞无害（不会伪造通过） |

## 出题者自验步骤

1. `cd challenges/ && ./reset.sh`（生成干净 workspace/，此时是 buggy seed）
2. 把参考答案（Option B 代码块）写进 `workspace/edgeSync.js`（覆盖 seed 副本）。
3. `cd C16-dbg-setedges-drop && node verify.mjs` → 必须 PASS（退出码 0）。
4. 若 FAIL，检查 verify 输出的 `[✗]` 行对照上方"常见错误模式"修正。
5. 验证后 `cd .. && ./reset.sh` 复位——干净 seed 应让检查 3、4 FAIL（静默丢边仍存在），整体 FAIL。
6. 再次 `./reset.sh` 复位到干净状态入库。
