# R04 参考答案 — 新增「格式化画布」快捷键

## 核心难点（为什么这题是 ★★）

快捷键系统是**分层 + 分类聚合**的，新增一个快捷键命令需要接通 **4 个文件**，
遗漏任何一个都会让测试失败：

1. **命令处理器（handler）** — 真实动作的实现（`handlers/canvas/`）+ 该类别处理器的
   barrel 导出（`handlers/canvas/index.ts`）。
2. **命令定义（command factory）** — 在对应类别命令文件里写一个 `createXxxCommand()` 工厂，
   配齐 `defaultShortcut` 与 `platformVariants.{mac,windows}`。
3. **类别聚合数组** — 同一个文件末尾的 `getCanvasCommands()` 把该类别所有工厂收集成数组，
   新命令必须 push 进去（这是测试重点校验的"注册出口"）。
4. **i18n 键** — 命令的 `name` 是 i18n 键（`shortcuts.commands.formatCanvas`），需在
   `zh-CN` / `en-US` 的 `shortcuts.ts` 双侧补条目，否则 i18n 完整性守卫（CI）会失败。

> 命令对象的结构契约在 `features/keyboard/types.ts` 的 `Command` 接口里：
> `id` / `name` / `defaultShortcut` / `platformVariants?` / `execute` / `category?` / `priority?`。
> 平台适配器（`platform/adapter.ts`）会根据当前平台在 `defaultShortcut` 与
> `platformVariants.{mac,windows}` 之间挑选实际生效的快捷键——所以 Mac 必须给 `meta` 变体。

## 测试为什么不执行 `execute`

测试只校验**命令对象的字段完整性 + 是否进聚合出口**，不调用 `execute`。原因：
`execute` 内部会触达 Pinia store / 组合式函数（需要 Vue setup 上下文），在 vitest 单元层
难以干净地 mock。因此 handler 的真实行为对测试无影响——但一个完整的实现仍应提供 handler，
并在工厂的 `execute` 里调用它（参考答案如此）。

## 需要改动的 4 个文件

### 1. `frontend/src/features/keyboard/handlers/canvas/view.ts`

新增 `formatCanvas()` 处理器。节点布局整理器（`node-layout-organizer`）是组合式函数，
必须在 Vue setup 内使用，所以沿用 `focusToProjectRoot` 的「window 钩子」解耦模式：
画布组件在 setup 时把整理函数挂到 `window.__organizeCanvas`，快捷键处理器只负责派发，
钩子未挂载时优雅降级。

```ts
export async function formatCanvas(): Promise<{ success: boolean; message?: string }> {
  const w = window as unknown as { __organizeCanvas?: () => void | Promise<void> }
  if (typeof window !== 'undefined' && w.__organizeCanvas) {
    await w.__organizeCanvas()
    return { success: true, message: 'shortcuts.feedback.formatCanvas' }
  }
  return { success: false, message: 'shortcuts.feedback.notAvailable' }
}
```

> 生产可选增强：在 `composables/canvas/useCanvasLifecycle.ts` 里把
> `useNodeOrganizer().organizeNodes` 挂到 `window.__organizeCanvas`（与
> `__focusToProjectRoot` 同处），快捷键即真正触发自动整理。verify 不校验这一步。

### 2. `frontend/src/features/keyboard/handlers/canvas/index.ts`

barrel 加一项导出：

```ts
export { fitView, toggleMinimap, centerView, focusToProjectRoot, formatCanvas } from './view'
```

### 3. `frontend/src/features/keyboard/commands/canvasCommands.ts`

三处改动：

**(a) 顶部 import 加 `formatCanvas`：**

```ts
import {
  zoomIn, zoomOut, resetZoom, fitView, toggleMinimap,
  centerView, focusToProjectRoot, formatCanvas,
} from '../handlers/canvas'
```

**(b) 新增工厂函数（放在视图类命令附近）：**

```ts
export function createFormatCanvasCommand(): Command {
  return {
    id: 'canvas.formatCanvas',
    name: 'shortcuts.commands.formatCanvas',
    defaultShortcut: { key: 'f', ctrl: true, shift: true },
    platformVariants: {
      mac: { key: 'f', meta: true, shift: true },
      windows: { key: 'f', ctrl: true, shift: true },
    },
    category: 'canvas',
    priority: 44,
    execute: async (context) => {
      const result = await formatCanvas()
      if (context.showFeedback && result.message) {
        showFeedback(result.message)
      }
    },
  }
}
```

**(c) 加入类别聚合数组：**

```ts
export function getCanvasCommands(): Command[] {
  return [
    createZoomInCommand(),
    // ...
    createCenterViewCommand(),
    createFormatCanvasCommand(),   // 新增
    createCanvasDeleteCommand(),
    // ...
  ]
}
```

> id 命名遵循现有约定 `<category>.<action>`（如 `canvas.fitView`、`editor.save`）。
> 测试按 `id` 包含 `format`（不区分大小写）查找，故 `canvas.formatCanvas` / `canvas.format`
> 均可命中；参考答案用 `canvas.formatCanvas`。

### 4. i18n（`zh-CN` 与 `en-US` 的 `shortcuts.ts`，双侧）

**commands 段**（画布命令分组内）：

```ts
formatCanvas: '格式化画布',   // zh-CN
formatCanvas: 'Format Canvas', // en-US
```

**feedback 段**（双侧，且双侧原本都没有 `feedback.notAvailable`，handler 用到，需一并补）：

```ts
formatCanvas: '画布已格式化',        // zh-CN
notAvailable: '当前操作不可用',       // zh-CN
formatCanvas: 'Canvas formatted',    // en-US
notAvailable: 'Action not available', // en-US
```

## 验证记录

- 参考方案就位：`node verify.mjs` → **PASS**（exit 0），13/13 测试通过，临时测试文件自动清理。
- 回退方案（clean repo）：`node verify.mjs` → **FAIL**（exit 1），13 项全部失败
  （`expected undefined to be defined` / `expected false to be true`），临时测试文件自动清理。
- 现有键盘测试套件回归（参考方案在位时）：`npx vitest run tests/features/keyboard/`
  → 181 passed（含本题 13 项），0 失败，不破坏任何既有测试。

## 陷阱提示

- **不能只设 `defaultShortcut` 而漏 `platformVariants`**：Mac 用户期望 `Cmd+Shift+F`。
  测试明确校验 `platformVariants.mac.meta === true` 且 `platformVariants.windows.ctrl === true`。
- **必须进 `getCanvasCommands()` 聚合数组**：只在文件里写工厂、不加入数组，
  命令不会随默认命令注册。测试用 `getCanvasCommands().some(id 含 'format')` 校验。
- **verify.mjs 清理纪律**：runner 不能在 `try`/`catch` 里直接 `process.exit()`——那会跳过
  `finally` 导致临时测试文件残留、污染真实仓库。正确做法：先记退出码，`finally` 里清理，
  之后统一 `process.exit(code)`。
