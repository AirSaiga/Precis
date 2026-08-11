# C11-inc-add-capability — 加新能力 clipboardApi（能力抽象层）

| 项 | 值 |
|----|-----|
| ID | C11 |
| 维度 | inc（跨文件跨层增量开发） |
| 栈 | TS |
| 难度 | ★★☆ |
| 预估 | 15-25 分钟 |
| 依赖 | Node ≥20（仅用于跑 verify，不需 tsc） |

## 背景

workspace 里有 2 个自包含的 TypeScript 文件，对应真实 Precis 的**能力抽象层**（AGENTS.md「前端能力抽象层」一节）：

- `workspace/shellApi.ts` —— 已存在的 **shell 能力**，是本题的模板。它把"用系统程序打开本地文件"这个 Electron/Web 差异封装成统一接口。
- `workspace/component.ts` —— 一个**消费方**示例，演示业务代码如何用 `shellApi.canOpenLocalFile` 控制按钮显隐。

**核心约定**（AGENTS.md 原文）：业务组件 / 组合式函数**禁止**直接访问 `window.electronAPI` 或调用 `isElectron()`；UI 层通过能力探测属性控制按钮显隐 / 禁用。能力层内部才用 `window.electronAPI`。

**先读 `workspace/shellApi.ts` 和 `workspace/component.ts`**，理解能力层的完整结构（契约接口、两套环境适配、单例导出、消费方用法）——你要照这个模式新增一个能力。

## 任务

照 `shellApi` 的模式，新增一个**剪贴板能力 `clipboardApi`**，并让消费方用上它。

- **新建 `workspace/clipboardApi.ts`**：暴露 `clipboardApi` 单例，含能力探测属性 `canWriteClipboard`（能否写剪贴板）和方法 `writeText(text)`（写文本到剪贴板）。具体接口形状、环境适配器怎么组织、单例怎么选——**照 `shellApi` 的模式自己设计**。
- **更新 `workspace/component.ts`**：新增一个 `renderCopyButton(text)` 消费函数（参照已有的 `renderOpenButton` 写法，保留它不删），用 `clipboardApi` 的探测属性控制显隐、用方法执行复制。

其余实现细节（探测属性的取值策略、各环境适配器的行为差异）**自行决定**——仔细想清楚不同环境下探测属性该怎么取值。verify 只做静态文本检查，确认能力层的模式落地了。

## 约束

- 只在 `workspace/` 里改 / 增文件：新建 `workspace/clipboardApi.ts`，编辑 `workspace/component.ts`。
- 不碰 `seed/`、`verify.mjs`、`task.md`、`SOLUTION.md`。
- 不碰 `workspace/` 以外的任何文件。
- **不要改 `workspace/shellApi.ts`**（它是只读模板）。
- 改动是 **additive**：`component.ts` 里保留 `renderOpenButton`，只新增 `renderCopyButton`。

## 验证

```bash
node verify.mjs
```

退出码 0 = PASS，非 0 = FAIL。verify 只读源文件文本做正则匹配，不跑 tsc、不执行 agent 代码。

完成后按 [challenges/README.md](../README.md) 填 `workspace/RESULT.md`。
