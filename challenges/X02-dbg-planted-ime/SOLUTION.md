# X02 参考答案 — IME 合成态守卫被删除

## 根因

`plant.py` 删除了 `frontend/src/features/keyboard/listeners/keyboardListener.ts` 中
`handleKeydown()` 的 **IME 组合输入守卫**：

```ts
// IME 组合输入守卫：拼音/日文/韩文等 IME 选词过程中派发的 keydown（尤其
// Backspace/Enter/单字符键）不得触发任何快捷键，否则会误删节点、误发消息。
// isComposing（标准）为主，keyCode===229 为旧版 Chromium 兼容兜底。
// 注意：isIgnoredElement 只覆盖 input/textarea/contenteditable 聚焦场景，
// 焦点在画布等非输入元素但 IME 仍处合成态时只能靠本守卫拦截，两者缺一不可。
if (event.isComposing || event.keyCode === 229) {
  return
}
```

**机制**：IME（拼音/日文/韩文）选词阶段，浏览器仍会派发 `keydown` 事件。
这些事件带有合成态标记——标准信号是 `event.isComposing === true`，旧版 Chromium
的兜底信号是 `event.keyCode === 229`（合成态下所有按键的 keyCode 恒为 229）。
守卫删除后，合成态的 `Backspace`（删拼音字母）一路穿过所有匹配逻辑到达
`emit('shortcut')`，下游命令执行器把它当作「删除节点」执行——这就是
「删拼音字母却删了画布节点」的由来。

**为什么焦点在画布时复现率最高**：监听器里已有 `isIgnoredElement`（焦点在
input/textarea/contenteditable 时忽略按键），但它**只覆盖焦点在输入元素内**的场景。
用户刚切到画布、焦点在 body/画布容器上时 IME 仍处于合成态，`isIgnoredElement`
返回 false，唯一兜底就是上面这段守卫。两者是互补关系，缺一不可。

**定位线索**（给 agent 的正向路径，不唯一）：

1. 现象与 IME 强相关 + 快捷键误触发 → 全局键盘监听分发链路是首要怀疑对象
   （`frontend/src/features/keyboard/`）。
2. 仓库 `AGENTS.md` 的「键盘快捷键与 IME 组合输入」一节明确记载了该守卫约定
   （`isComposing || keyCode === 229`，且必须在所有匹配逻辑之前）——文档描述的
   不变量与代码现状不符，即注入点。
3. `git diff`（worktree 内）直接可见被删的代码块——注入未提交，diff 即答案。

## 参考修复

在 `handleKeydown()` 中、`isIgnoredElement` 检查**之前**（`when` 配置检查之后）
恢复原守卫块：

```ts
if (this.config.when && !this.config.when()) {
  return
}

// IME 组合输入守卫：拼音/日文/韩文等 IME 选词过程中派发的 keydown（尤其
// Backspace/Enter/单字符键）不得触发任何快捷键，否则会误删节点、误发消息。
// isComposing（标准）为主，keyCode===229 为旧版 Chromium 兼容兜底。
// 注意：isIgnoredElement 只覆盖 input/textarea/contenteditable 聚焦场景，
// 焦点在画布等非输入元素但 IME 仍处合成态时只能靠本守卫拦截，两者缺一不可。
if (event.isComposing || event.keyCode === 229) {
  return
}

if (this.isIgnoredElement(event)) {
  return
}
```

要点：守卫必须在**任何快捷键匹配逻辑之前**；两个信号（isComposing 主、
keyCode 229 兜底）都要判；直接 `return` 放行（不要 preventDefault——会干扰 IME 自身处理）。

## 常见错误

| 错误 | 后果 |
|------|------|
| 只守 `isComposing`，漏 `keyCode === 229` | 旧版 Chromium / 部分环境下合成态漏判；verify 中 keyCode=229 用例 FAIL |
| 只守 `keyCode === 229`，漏 `isComposing` | 标准信号漏判；verify 中 isComposing 用例 FAIL |
| 认为 `isIgnoredElement` 已足够 | 焦点在画布时它返回 false，合成态事件穿透 |
| 守卫放在快捷键匹配**之后** | 合成态按键已被前面的分支命中，守卫形同虚设 |
| 用 `compositionstart/end` 自维护「合成中」状态机 | 异步竞态脆弱（blur/异常路径状态残留），且事件级判断本就够用 |
| 在每个快捷键 handler 里各自判 IME | 下游打补丁，新增快捷键时必漏；违反「上游一处修复」 |
| `event.preventDefault()` 后继续分发 | 干扰 IME 自身的按键处理，且 shortcut 依然被派发 |

## 自验步骤

```bash
# 1. 注入故障（在 worktree 副本内）
python plant.py
node verify.mjs            # 预期 FAIL：合成态用例全部失败，非合成态用例通过

# 2. 修复（恢复守卫）
node verify.mjs            # 预期 PASS：9 个注入用例 + 既有 4 个测试文件全绿

# 3.（开发用）还原注入
python plant.py --restore  # 从 .plant-backup 或 git restore 还原
python plant.py --status   # 查看当前注入状态
```

## 验证记录（出题方实测）

- 干净仓库（未注入）：`node verify.mjs` → PASS。
- worktree 中注入后：FAIL（5 个合成态用例失败，4 个非合成态用例通过）。
- 恢复守卫后：PASS。
