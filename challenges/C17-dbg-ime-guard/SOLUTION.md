<!--
═══════════════════════════════════════════════════════════════
  ⚠️  做完题前别看这份文件  ⚠️
  这是给出题者自验和人工对照用的参考答案。
═══════════════════════════════════════════════════════════════
-->

# C17 SOLUTION — IME 合成态守卫

参考实现见下方代码块。思路极简：在 `handleKeydown` 最开头加一个守卫，合成态直接 `return null`。

## 关键决策

1. **守卫必须是函数体第一个语句**：在读取 `event.key`、做任何 `if` 匹配之前。原因——合成态按键（如拼音选词时的 `Backspace`）和真实快捷键在 `event.key` 上看不出区别（都是 `'Backspace'`），唯一能区分的就是 `isComposing` / `keyCode===229` 标志。若守卫放在某个匹配分支之后，合成态按键可能已被前面分支命中并返回了动作名，守卫形同虚设。

2. **必须同时检查 `event.isComposing` 和 `event.keyCode === 229`**：浏览器实现不一致。
   - `isComposing`（标准 `KeyboardEvent` 属性）是现代浏览器（Chrome/Firefox/Safari 较新版本）的主信号；
   - `keyCode === 229` 是旧版 IE / 老 Chromium / 部分国产浏览器在合成态下的遗留信号（标准已废弃 `keyCode`，但老环境只设它）。
   - 两个 API 不同浏览器覆盖面不完全重合——只查一个会漏掉另一类浏览器的合成态。这正是真实代码 `keyboardListener.ts:182` 写成 `event.isComposing || event.keyCode === 229` 的原因。

3. **守卫与 `isIgnoredElement`（输入焦点检查）是两回事，不能互相替代**：
   - `isIgnoredElement` 判定的是"焦点是否落在 input/textarea/contenteditable"——覆盖的是"用户在文本框里打字"。
   - IME 合成守卫判定的是"这次按键是否处于 IME 选词合成阶段"——覆盖的是"IME 正在工作"。
   - **两者交集之外的盲区**：焦点在画布等**非输入元素**、但 IME 仍处合成态（典型场景：刚从输入框切到画布，IME 选词气泡还没提交；或画布本身允许 IME 直接触发）。此时 `isIgnoredElement` 返回 false（焦点不在输入框），输入焦点守卫放行；但 `isComposing===true`，必须靠 IME 守卫拦下。两个守卫各自管一类场景，缺一不可——AGENTS.md 明确强调"两个守卫缺一不可"。

4. **返回 `null` 而非抛错/返回哨兵**：`null` 在该函数的契约里就是"这次按键没匹配到任何快捷键"——语义上等价于"放行，让浏览器/IME 走默认行为"。这正是我们想要的：合成态按键交给 IME 自己处理（删拼音字母、选词等），而不是被快捷键系统截走。抛错会被调用方的 try/catch 当成异常处理，反而引入不必要的错误路径；返回特殊哨兵（如 `'ime-composing'`）会让调用方多一个永远不该触发的分支。

## 参考实现

```javascript
const shortcuts = require('./shortcuts')

/**
 * 处理 keydown 事件。
 * @param {KeyboardEvent} event
 * @returns {string | null} 被触发的快捷键动作名，未匹配返回 null
 */
function handleKeydown(event) {
  // IME 合成中（拼音/日文/韩文选词阶段）一律放行，避免误触单键/Backspace 快捷键。
  // isComposing（标准）为主，keyCode===229 为旧版 IE/老 Chromium 兼容兜底。
  if (event.isComposing || event.keyCode === 229) {
    return null
  }

  const key = event.key
  const ctrl = event.ctrlKey || event.metaKey

  // 单键快捷键
  if (!ctrl && key === 'Backspace') {
    return 'delete-node'
  }
  if (!ctrl && key === 'Enter') {
    return 'confirm'
  }
  // 组合键
  if (ctrl && key === 's') {
    return 'save'
  }
  if (ctrl && key === 'z') {
    return 'undo'
  }
  return null
}

module.exports = { handleKeydown }
```

## 常见错误模式

| 错误 | 后果 |
|------|------|
| 只查 `event.isComposing`，漏掉 `keyCode === 229` | 检查 9（legacy 守卫）失败：`mkEvent({ key: 'Backspace', keyCode: 229 })`（不设 isComposing）仍触发 `delete-node` |
| 只查 `keyCode === 229`，漏掉 `isComposing` | 检查 5-8 失败：现代浏览器只设 `isComposing`、`keyCode` 为 0 的合成态事件未被守卫 |
| 守卫放在匹配逻辑**之后**（如放在单键 `if` 之后、组合键 `if` 之前） | 检查 5（isComposing 的 Backspace）失败：Backspace 在守卫之前已被 `delete-node` 分支命中返回 |
| 守卫里抛错 / 返回非 null 哨兵（如 `return 'ime'`） | 检查 5-10 失败：期望 `=== null`，实际拿到 Error 或字符串 |
| 把守卫条件写成 `event.isComposing && event.keyCode === 229`（&& 而非 \|\|） | 检查 5-9 失败：两个条件要求同时满足才放行，单条件场景全部漏放 |
| 在 `return null` 之外还顺手改了快捷键映射（"顺手优化"） | 检查 3-4 可能失败（正常快捷键映射被破坏），或检查 11 失败 |
| 改成 default export 或改了函数名 | 检查 2 失败（`mod.handleKeydown` 不是函数） |
| 在模块顶层 `console.log("PASS")` 试图伪造通过 | 触发防作弊，整体 FAIL（verify 重定向 require 期间的 stdout 并扫描 `\bPASS\b`/`\bFAIL\b`/`[✓]`/`[✗]` 关键字） |

## 出题者自验步骤

1. `cd challenges/ && ./reset.sh`（生成干净 workspace/，此时是 buggy seed——没有 IME 守卫）。
2. 把参考实现代码块写进 `workspace/keyboardListener.js`（覆盖 seed 副本）。
3. `cd C17-dbg-ime-guard && node verify.mjs` → 必须 PASS（退出码 0，11 项检查全 ✓）。
4. 若 FAIL，对照 verify 输出的 `[✗]` 行与上方"常见错误模式"修正。
5. 验证后 `cd .. && ./reset.sh` 复位——干净 seed 应让检查 5、6、7、8、9、10 FAIL（合成态事件仍触发快捷键），整体 FAIL。
   - 具体地：seed 下 `isComposing=true` 的 Backspace 仍返回 `'delete-node'`（检查 5 ✗），`keyCode=229` 的 Backspace 也仍返回 `'delete-node'`（检查 9 ✗）等。
6. 再次 `./reset.sh` 复位到干净状态入库（workspace/ 是 gitignore 的运行时副本，不入库；入库的是 seed/ + task.md + verify.mjs + SOLUTION.md）。
