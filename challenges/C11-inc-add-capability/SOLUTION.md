<!--
═══════════════════════════════════════════════════════════════
  ⚠️  做完题前别看这份文件  ⚠️
  这是给出题者自验和人工对照用的参考答案。
═══════════════════════════════════════════════════════════════
-->

# C11 SOLUTION — 加新能力 clipboardApi（能力抽象层）

参考实现 = 新建 `workspace/clipboardApi.ts`（镜像 `shellApi.ts`）+ 在 `workspace/component.ts` 末尾新增 `renderCopyButton`（保留 `renderOpenButton`）。下方按文件给出完整内容与 diff。

## 关键决策

1. **两个适配器都要存在**（Electron + Web），单例用 `isElectron()` 三元选其一。这是能力层的核心模式：
   - 漏掉 **Web 适配器**：纯浏览器环境（直接 `npm run dev` 起的 Vite、用户用浏览器访问）下，`clipboardApi` 没有回退实现，桌面外的场景直接崩。
   - 漏掉 **Electron 适配器**：桌面端只能走 `navigator.clipboard`，但 Electron renderer 在 `sandbox: true` + 非安全上下文下 `navigator.clipboard` 可能不可用（AGENTS.md「Electron 集成」明确 sandbox: true），反而绕过了稳定的原生 `window.electronAPI.clipboard`。
   - 单例 `isElectron() ? new Electron... : new Web...` 保证运行时只构造一个适配器，业务方拿到的永远是符合当前环境的那一个。

2. **Web 适配器的 `canWriteClipboard` 必须是计算值**（`typeof navigator !== 'undefined' && !!navigator.clipboard`），不能硬编码：
   - 浏览器不一定暴露 `navigator.clipboard`——非 HTTPS（非安全上下文）、旧浏览器、或 iframe 受限场景下它是 `undefined`。
   - 若硬编码 `true`，UI 会显示"复制"按钮，但点击后 `writeText` 抛错（运行时才发现不可用），体验劣于"按钮压根不显示"。
   - Electron 适配器则可以硬编码 `true`：preload 脚本注入的 `window.electronAPI.clipboard` 一定可用（主进程原生 clipboard 模块）。

3. **消费方用 `canWriteClipboard` 控制显隐**（而非 try/catch）：与 `renderOpenButton` 用 `shellApi.canOpenLocalFile` 的模式一致——能力探测属性是 UI 显隐的**单一事实来源**，AGENTS.md 原文「UI 层通过能力探测属性控制按钮显隐 / 禁用」。直接 try/catch 调 `writeText` 再在 catch 里藏按钮，会让用户先看到按钮、点击后才消失，且违反"探测先于调用"的能力层约定。

4. **保留 `renderOpenButton`**（additive 改动）：本题是增量加能力，不是替换。shellApi 与 renderOpenButton 都不动，只新增 clipboardApi 与 renderCopyButton。verify 专门检查 `renderOpenButton` 仍在。

## 参考实现

### `workspace/clipboardApi.ts`（新建 —— 完整文件）

镜像 `shellApi.ts` 的四件套：interface + Electron 适配器 + Web 适配器 + 单例。

```typescript
/**
 * Clipboard 能力抽象（C11 —— 新增能力，镜像 shellApi 模式）。
 *
 * 把"写文本到剪贴板"的 Electron/Web 差异封装成统一接口：
 *   - ElectronClipboardAdapter：调 window.electronAPI.clipboard（主进程原生剪贴板）
 *   - WebClipboardAdapter：调 navigator.clipboard（浏览器异步剪贴板 API）
 * 业务组件通过 clipboardApi.canWriteClipboard 控制复制按钮显隐。
 * AGENTS.md："业务组件禁止直接访问 window.electronAPI"。
 */

interface ClipboardApi {
  /** 是否能写剪贴板（Electron 恒 true；Web 取决于 navigator.clipboard 是否可用） */
  readonly canWriteClipboard: boolean
  writeText(text: string): Promise<void>
}

class ElectronClipboardAdapter implements ClipboardApi {
  readonly canWriteClipboard = true
  async writeText(text: string): Promise<void> {
    return window.electronAPI.clipboard.writeText(text)
  }
}

class WebClipboardAdapter implements ClipboardApi {
  // 关键：必须计算——浏览器不一定有 navigator.clipboard（非安全上下文 / 旧浏览器）
  readonly canWriteClipboard = typeof navigator !== 'undefined' && !!navigator.clipboard
  async writeText(text: string): Promise<void> {
    if (!navigator.clipboard) {
      throw new Error('Web 环境不支持 clipboard.writeText')
    }
    return navigator.clipboard.writeText(text)
  }
}

function isElectron(): boolean {
  return typeof window !== 'undefined' && !!(window as { electronAPI?: unknown }).electronAPI
}

export const clipboardApi: ClipboardApi = isElectron()
  ? new ElectronClipboardAdapter()
  : new WebClipboardAdapter()
```

### `workspace/component.ts`（编辑 —— 新增 renderCopyButton）

```diff
 /**
  * 业务组件示例（C11 seed —— 使用 shellApi 的范例）。
  * 此文件展示能力层的消费方式。
  */
 import { shellApi } from './shellApi'
+import { clipboardApi } from './clipboardApi'

 export function renderOpenButton(filePath: string): { show: boolean; onClick?: () => void } {
   // 通过能力探测属性控制按钮显隐
   if (!shellApi.canOpenLocalFile) {
     return { show: false }
   }
   return { show: true, onClick: () => shellApi.openPath(filePath) }
 }
+
+export function renderCopyButton(text: string): { show: boolean; onClick?: () => void } {
+  // 通过能力探测属性控制按钮显隐（与 renderOpenButton 同模式）
+  if (!clipboardApi.canWriteClipboard) {
+    return { show: false }
+  }
+  return { show: true, onClick: () => clipboardApi.writeText(text) }
+}
```

**verify 自查**：clipboardApi.ts 存在 ✓；ClipboardApi interface + readonly canWriteClipboard ✓；writeText 方法 ✓；ElectronClipboardAdapter + canWriteClipboard=true ✓；WebClipboardAdapter + canWriteClipboard 是计算值（含 navigator、非裸 true/false）✓；导出单例三元 ✓；component import clipboardApi ✓；renderCopyButton ✓；renderCopyButton 用 canWriteClipboard ✓；onClick 调 writeText ✓；renderOpenButton 保留 ✓ → PASS（14/14）。

## 常见错误模式

| 错误 | 后果 |
|------|------|
| Web 适配器硬编码 `canWriteClipboard = true` | verify「计算值」检查失败（类体内无 navigator，或匹配到裸 true）；生产里非安全上下文下按钮显示却点击抛错 |
| Web 适配器硬编码 `canWriteClipboard = false` | verify「计算值」检查失败；浏览器环境永远显示不出复制按钮（即使 navigator.clipboard 可用） |
| 漏掉 Web 适配器（只写 Electron） | verify「WebClipboardAdapter 类」失败；单例三元也失败（找不到 new WebClipboardAdapter） |
| 漏掉 Electron 适配器（只写 Web） | verify「ElectronClipboardAdapter 类」+「canWriteClipboard=true」+ 单例三元全失败；桌面端绕过原生剪贴板 |
| 单例写错（如 `new Web... : new Electron...` 三元顺序反，或不用 isElectron） | verify「导出单例（三元选适配器）」失败——正则要求顺序 isElectron → Electron → Web |
| `component.ts` 删掉 renderOpenButton（非 additive） | verify「renderOpenButton 仍存在」失败 |
| `renderCopyButton` 用 try/catch 调 writeText 而非先探测 canWriteClipboard | verify「用 canWriteClipboard 控制显隐」失败（找不到 clipboardApi.canWriteClipboard）；违反能力层"探测先于调用"约定 |
| 改了 `shellApi.ts` | 违反约束（题目明确 shellApi.ts 是只读模板）；本题 verify 不检查 shellApi.ts 内容，但出题约束禁止改 |
| 把 `canWriteClipboard` 计算式写成 `typeof navigator !== 'undefined' && !!navigator.clipboard` 之外的形式（如 `!!navigator?.clipboard`）| 仍通过——verify 只要求"类体含 navigator 且非裸 true/false"，不强制具体写法 |

## 出题者自验步骤

1. `cd challenges/ && ./reset.sh`（生成干净 workspace/ = seed 副本：只有 shellApi.ts + component.ts，无 clipboardApi.ts、无 renderCopyButton）。
2. 按上方参考实现：新建 `workspace/clipboardApi.ts`，编辑 `workspace/component.ts` 加 import + renderCopyButton。
3. `cd C11-inc-add-capability && node verify.mjs` → 必须 PASS（退出码 0，首行 `PASS`，14 项检查全 `[✓]`）。
4. 若 FAIL，对照 verify 输出的 `[✗]` 行修正（最常见：Web 适配器 canWriteClipboard 硬编码、漏掉某个适配器、单例三元顺序错）。
5. `cd .. && ./reset.sh` 复位（workspace 回到 seed）。
6. `cd C11-inc-add-capability && node verify.mjs` → 应 FAIL（首行 `FAIL`，多个 `[✗]`：clipboardApi.ts 不存在导致前 9 项全挂、component 的 4 项 clipboard 检查也挂；但 component.ts 存在 + renderOpenButton 保留检查仍 `[✓]`）。
7. 最后 `cd .. && ./reset.sh` 复位，保持交付态干净。
