# C17 — 修复键盘监听器在 IME 输入时误触快捷键

| 项 | 值 |
|------|-----|
| ID | C17 |
| 维度 | dbg（调试与 bug 修复） |
| 栈 | TS（JS，CommonJS） |
| 难度 | ★★☆ |
| 预估 | 10-15 分钟 |
| 依赖 | Node ≥20 |

## 背景

`workspace/keyboardListener.js` 里有一个 `handleKeydown(event)` 函数，监听全局 `keydown`，匹配快捷键并返回对应动作名：`Backspace`→`delete-node`、`Enter`→`confirm`、`Ctrl+S`→`save`、`Ctrl+Z`→`undo`，无匹配返回 `null`。它是 Precis 真实键盘监听器的合成简化版（用纯 JS 写成，便于 `node` 直接 `require`）。

## 症状

当用户用 IME（输入法）输入中文 / 日文 / 韩文等，处于**输入法合成态**（拼音/选词阶段）时，浏览器仍会派发 `keydown` 事件，当前监听器把这些按键当成真实快捷键匹配，导致误触发：

- 输入中文时按 `Backspace` 想删一个拼音字母，结果**误删了画布节点**（触发了 `delete-node`）；
- 选词时按到的单字符键、甚至 `Ctrl+S` / `Ctrl+Z` 也可能误触。

修复 `handleKeydown`，使其在 IME 合成态下**不触发任何快捷键**（直接放行，让 IME 正常处理该按键）。非合成态下的匹配逻辑**完全不变**。

> 提示：如何用 `KeyboardEvent` 检测"按键处于 IME 合成态"属于 Web 标准范畴，需自行查阅/确认（注意不同浏览器/版本可能用不同信号表达合成态）。

## 规格

- **函数名/签名**：`handleKeydown(event)`（保持不变）
- **文件**：`workspace/keyboardListener.js`
- **行为**：
  - IME 合成态事件 → 返回 `null`（不匹配任何快捷键，放行）
  - 非合成态事件 → 匹配逻辑**完全不变**（`Backspace`→`delete-node` 等映射照旧）
  - 无匹配 → 返回 `null`
- 守卫必须在任何匹配逻辑之前执行（否则合成态按键可能已被前面的分支命中）。

## 约束

- 只改 `workspace/keyboardListener.js`。
- 不碰 `seed/`、`verify.mjs`、`task.md`、`SOLUTION.md`。
- 不碰 `workspace/` 以外的任何文件（即不要改主仓库代码）。
- 不引入外部依赖（只用 Node 标准库 / 纯 JS）。
- 不改快捷键映射本身，不改函数签名与返回契约。

## 验证

在本题目录下运行：

```bash
node verify.mjs
```

退出码 0 = PASS，非 0 = FAIL。检查项涵盖：正常（非合成）快捷键仍工作、各类合成态事件被放行（返回 null）、无匹配键仍返回 null。

完成后按 [challenges/README.md](../README.md) 填 `workspace/RESULT.md`。
