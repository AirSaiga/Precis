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

`workspace/` 里有 2 个自包含的 TypeScript 文件，对应真实 Precis 的**能力抽象层**（AGENTS.md「前端能力抽象层（Electron/Web 解耦）」一节）：

- `workspace/shellApi.ts` —— 已存在的 **shell 能力**，是本题的模板。它把"用系统程序打开本地文件"这个 Electron/Web 差异封装成统一接口。
- `workspace/component.ts` —— 一个**消费方**示例，演示业务代码如何用 `shellApi.canOpenLocalFile` 控制按钮显隐。

**先读 `workspace/shellApi.ts`**，理解能力层的四件套结构：

1. `interface XxxApi` —— 能力契约，含若干 `readonly canXxx: boolean` **探测属性** + 方法签名。
2. `class ElectronXxxAdapter implements XxxApi` —— Electron 环境实现，方法里调 `window.electronAPI.*`，探测属性硬编码为 `true`。
3. `class WebXxxAdapter implements XxxApi` —— Web 环境回退实现，探测属性按浏览器实际能力计算（可能为 `false`）。
4. `export const xxxApi: XxxApi = isElectron() ? new ElectronXxxAdapter() : new WebXxxAdapter()` —— 按运行环境选适配器的**单例**。

**核心约定**（AGENTS.md 原文）：业务组件 / 组合式函数**禁止**直接访问 `window.electronAPI` 或调用 `isElectron()`；UI 层通过能力探测属性（如 `shellApi.canOpenLocalFile`）控制按钮显隐 / 禁用。能力层内部才用 `window.electronAPI`。

消费方范例见 `workspace/component.ts` 的 `renderOpenButton`：先看 `shellApi.canOpenLocalFile` 决定按钮 `show`，`onClick` 调 `shellApi.openPath(...)`。

## 任务

照 `shellApi` 的模式，新增一个**剪贴板能力 clipboardApi**，并让消费方用上它。

### 规格

1. **创建 `workspace/clipboardApi.ts`**，结构完全镜像 `shellApi.ts`（复制后改名）：
   - `interface ClipboardApi`：
     - `readonly canWriteClipboard: boolean`（探测属性：能否写剪贴板）
     - `writeText(text: string): Promise<void>`（写文本到剪贴板）
   - `class ElectronClipboardAdapter implements ClipboardApi`：
     - `canWriteClipboard = true`（Electron 一定支持）
     - `writeText` 调 `window.electronAPI.clipboard.writeText(text)`
   - `class WebClipboardAdapter implements ClipboardApi`：
     - `canWriteClipboard` **必须是计算值**：`typeof navigator !== 'undefined' && !!navigator.clipboard`（浏览器不一定有 `navigator.clipboard`，比如非 HTTPS / 老浏览器，故不能硬编码 `true`）
     - `writeText`：有 `navigator.clipboard` 时调 `navigator.clipboard.writeText(text)`；否则 `throw new Error(...)`（不可用时抛错）
   - `isElectron()` 辅助函数（与 shellApi 同形，可照抄）
   - `export const clipboardApi: ClipboardApi = isElectron() ? new ElectronClipboardAdapter() : new WebClipboardAdapter()`

2. **更新 `workspace/component.ts`**：新增一个 `renderCopyButton(text: string)` 函数，返回 `{ show: boolean; onClick?: () => void }`：
   - 仅当 `clipboardApi.canWriteClipboard` 为真时 `show: true`
   - `onClick` 调 `clipboardApi.writeText(text)`
   - **import `clipboardApi`**（从 `./clipboardApi`）
   - **保留**已有的 `renderOpenButton`（不要删，只是新增 `renderCopyButton`）

### 约束（务必遵守）

- 只在 `workspace/` 里改 / 增文件：新建 `workspace/clipboardApi.ts`，编辑 `workspace/component.ts`。
- 不碰 `seed/`、`verify.mjs`、`task.md`、`SOLUTION.md`。
- 不碰 `workspace/` 以外的任何文件（即不要改主仓库代码）。
- **不要改 `workspace/shellApi.ts`**（它是只读模板）。
- 改动是 **additive**：`component.ts` 里保留 `renderOpenButton`，只是新增 `renderCopyButton`。

### 提示

- **照葫芦画瓢**：把 `shellApi.ts` 整段复制成 `clipboardApi.ts`，把 `Shell`→`Clipboard`、`openPath`→`writeText`、`canOpenLocalFile`→`canWriteClipboard` 全局替换，再调整各自的实现细节。
- **WebClipboardAdapter 的 `canWriteClipboard` 必须是计算值**：写 `readonly canWriteClipboard = typeof navigator !== 'undefined' && !!navigator.clipboard`。**不要**硬编码 `true`/`false`——浏览器环境不一定有 `navigator.clipboard`（非安全上下文 / 旧浏览器），硬编码会误导 UI。
- **关键决策点**：两个适配器都要存在（Electron + Web），单例用 `isElectron()` 三元选其一。漏掉 Web 适配器会让纯浏览器环境直接崩（没有任何剪贴板能力）；漏掉 Electron 适配器会让桌面端绕过原生剪贴板走浏览器 API（可能因 sandbox 受限）。
- 消费方 `renderCopyButton` 的 `onClick` 调 `clipboardApi.writeText(text)` 时**不要** await（保持与 `renderOpenButton` 一致的 `() => xxxApi.fn(...)` 写法，返回值忽略即可）。

### 验证

在本题目录下运行：

```bash
node verify.mjs
```

退出码 0 = PASS，非 0 = FAIL。约 14 项静态检查（只读源文件文本做正则匹配，不跑 tsc、不执行 agent 代码）详见 verify 输出。

完成后按 [challenges/README.md](../README.md) 填 `workspace/RESULT.md`。
