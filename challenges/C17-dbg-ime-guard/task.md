# C17-dbg-ime-guard — 给键盘监听器加 IME 合成态守卫

| 项 | 值 |
|----|-----|
| ID | C17 |
| 维度 | dbg（调试与 bug 修复） |
| 栈 | TS（JS，CommonJS） |
| 难度 | ★★☆ |
| 预估 | 10-15 分钟 |
| 依赖 | Node ≥20 |

## 背景

`workspace/keyboardListener.js` 里有一个 `handleKeydown(event)` 函数，它监听全局 `keydown`，匹配快捷键并返回对应的动作名：`Backspace`→`delete-node`、`Enter`→`confirm`、`Ctrl+S`→`save`、`Ctrl+Z`→`undo`，无匹配返回 `null`。这是 Precis 代码库里真实键盘监听器（`features/keyboard/listeners/keyboardListener.ts`）的**合成简化版**（真实源码不在本仓库，本题为便于 `node` 直接 `require` 而用纯 JS 写成）。

**bug**：当前监听器**没有 IME 合成守卫**。Precis 的默认 locale 是 `zh-CN`，用户普遍用拼音/日文/韩文等 IME 输入。在 IME 合成阶段（拼音选词阶段），浏览器会派发 `keydown` 事件，且 `event.isComposing === true`（旧版浏览器/IE 另有 `event.keyCode === 229`）。当前监听器把这些合成态按键当成真实快捷键匹配，于是：

- 用户在输入中文时按 `Backspace` 想删一个拼音字母，结果**误删了画布节点**（触发了 `delete-node`）；
- 选词时按到的单字符键可能误触发动作；
- 甚至 `Ctrl+S` / `Ctrl+Z` 在合成态下也会误触。

完整背景见主仓库 `AGENTS.md` 的"键盘快捷键与 IME 组合输入"一节。

**先读 `workspace/keyboardListener.js`**，理解：

- 函数签名 `handleKeydown(event)`，返回动作名字符串或 `null`
- 缺陷位于函数体最开头——**直接进入匹配逻辑**，没有任何合成态检查
- 匹配逻辑分单键（`!ctrl && key === ...`）和组合键（`ctrl && key === ...`）两类

## 任务

在 `handleKeydown` 的**最开头**（任何匹配逻辑之前）加一段 **IME 合成守卫**：当 `event.isComposing === true` 或 `event.keyCode === 229` 时，**立即返回 `null`**（表示"没匹配到任何快捷键，放行"），不进入后续匹配。

### 规格

- **函数名/签名**：`handleKeydown(event)`（保持不变）
- **文件**：`workspace/keyboardListener.js`
- **返回契约**：合成态事件返回 `null`；非合成态事件的匹配逻辑**完全不变**（`Backspace`→`delete-node` 等映射照旧）
- **守卫条件**：`event.isComposing === true` **或** `event.keyCode === 229`，二者满足其一即放行（必须检查**两者**——见下方提示）
- **守卫位置**：必须是 `handleKeydown` 函数体里**第一个**执行的语句，在读取 `event.key` / 做任何匹配之前

### 约束（务必遵守）

- 只改 `workspace/keyboardListener.js`。
- 不碰 `seed/`、`verify.mjs`、`task.md`、`SOLUTION.md`。
- 不碰 `workspace/` 以外的任何文件（即不要改主仓库代码）。
- 不引入外部依赖（只用 Node 标准库 / 纯 JS）。
- 不改快捷键映射本身，不改函数签名与返回契约。

### 提示

- 守卫必须是 `handleKeydown` 里**第一个**东西，先于一切匹配。放晚了（比如放在某个 `if` 后面）就晚了——合成态按键可能已经被前面的分支匹配掉。
- 必须**同时**检查 `event.isComposing`（现代标准）和 `event.keyCode === 229`（旧版 IE/老 Chromium 兼容）——有些浏览器只设其中之一，漏一个就会漏放行。
- **关键决策点**：`isIgnoredElement`（检查焦点是否在 input/textarea/contenteditable）**不能**替代这个守卫——当焦点在画布等非输入元素、但 IME 仍处合成态时（例如刚切到画布、IME 选词未提交），输入焦点守卫抓不到，只有 `isComposing` 守卫能拦。两者各自管一类场景，缺一不可；本题只加 IME 这一个。
- 返回 `null` 是正确语义——它表示"这次按键没匹配到快捷键，请让浏览器走默认行为"（即让 IME 正常处理这个按键）。**不要**改成抛错或返回某个哨兵值。

### 验证

在本题目录下运行：

```bash
node verify.mjs
```

退出码 0 = PASS，非 0 = FAIL。检查项涵盖：正常（非合成）快捷键仍工作、各类合成态事件被放行（返回 null）、legacy `keyCode===229` 也被守卫、无匹配键仍返回 null。

完成后按 [challenges/README.md](../README.md) 填 `workspace/RESULT.md`。
