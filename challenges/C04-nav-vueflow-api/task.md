# C04-nav-vueflow-api — 补全 Vue Flow API 单例注入层

| 项 | 值 |
|----|-----|
| ID | C04 |
| 维度 | nav（代码库导航与理解） |
| 栈 | TS |
| 难度 | ★☆☆ |
| 预估 | 10-15 分钟 |
| 依赖 | Node ≥20（仅用于跑 verify，不需 tsc） |

## 背景

本 `workspace/` 里有 2 个自包含的 TypeScript 文件，建模了 Precis 前端的 "Vue Flow API 单例注入层" 模式（见主仓库 `AGENTS.md` 的 "Critical Patterns & Pitfalls → Vue Flow DAG 操作规范" 一节："`services/canvas/vueFlowApi.ts` 在 `NodeCanvas.vue` setup 中通过 `initVueFlowApi(useVueFlow())` 完成注入"）。

Vue Flow 的 `useVueFlow()` 依赖 Vue 的 provide/inject，**只能在组件 setup 内调用**。但 Pinia store 和业务代码常需要在 setup 外（如事件回调、store action）操作画布。本模块就是这个限制的桥接：在 setup 内把 API 存进模块级单例，setup 外再取出来用。

两个文件的职责：

- `workspace/vueFlowApi.ts`：注入层本体。`initVueFlowApi(api)` 在 setup 内写入模块级单例 `_api`；`requireApi()` 在 setup 外读出，未初始化时抛 `VueFlowApiNotInitializedError`。**当前是半成品**：两个函数都被掏空了。
- `workspace/callSite.ts`：调用方示例（**只读，不改**）。`runScenario()` 演示了两条路径：未 init 就 requireApi（应抛错）、init 后 requireApi（应返回注入的 api）。

**先读 `workspace/vueFlowApi.ts` 和 `workspace/callSite.ts`**，理解：

- `_api` 是模块级单例（`let _api: unknown = null`）
- `initVueFlowApi(api)` 应把传入的 `api` 存入 `_api`
- `requireApi()` 应返回 `_api`，但若 `_api` 为 `null` 必须抛 `VueFlowApiNotInitializedError`
- `callSite.ts` 的 `businessCode()` 用 `instanceof VueFlowApiNotInitializedError` 区分"未初始化"（可降级返回 null）与其它真错误（继续抛）

## 任务

补全 `workspace/vueFlowApi.ts` 里的两个函数，让单例注入机制正常工作：

1. **`initVueFlowApi(api)`**：把传入的 `api` 赋给模块级 `_api` 单例。
2. **`requireApi()`**：加 null 守卫——`_api` 为 `null` 时抛 `new VueFlowApiNotInitializedError()`，否则返回 `_api`。

### 规格

- **`initVueFlowApi(api: unknown): void`**
  - 行为：`_api = api`（把传入值存入单例）
  - 文件：`workspace/vueFlowApi.ts`
- **`requireApi(): unknown`**
  - 行为：`_api === null`（或 `!_api`）→ `throw new VueFlowApiNotInitializedError()`；否则 `return _api`
  - 文件：`workspace/vueFlowApi.ts`
- **不要改** `VueFlowApiNotInitializedError` 类定义（错误类已完整，message 含"尚未初始化"）

### 约束（务必遵守）

- 只改 `workspace/vueFlowApi.ts`。
- 不碰 `seed/`、`verify.mjs`、`task.md`、`SOLUTION.md`。
- 不碰 `workspace/callSite.ts`（它是只读参考，verify 不要求改它）。
- 不碰 `workspace/` 以外的任何文件（即不要改主仓库代码）。

### 提示

- 看 `callSite.ts` 的 `runScenario()`：它就是契约的可执行规格——"场景 1 未 init 抛错 / 场景 2 init 后返回 api"两条路径都依赖你的实现。
- **关键决策点**：`requireApi` 必须抛**特定的 `VueFlowApiNotInitializedError` 类**（`new VueFlowApiNotInitializedError()`），**不能**抛 `new Error(...)` 之类的通用错误。原因是 `callSite.ts` 的 `businessCode()` 用 `e instanceof VueFlowApiNotInitializedError` 来区分"未初始化"与"真错误"——你抛 `Error` 的话这个 `instanceof` 判定为假，降级逻辑失效、错误会被继续向上抛。

### 验证

在本题目录下运行：

```bash
node verify.mjs
```

退出码 0 = PASS，非 0 = FAIL。检查项含静态检查（函数体是否含 `_api` 赋值、守卫是否抛特定错误类）+ 动态测试（剥离类型注解后执行，验证"未 init 抛错 + init 后返回 api"两条路径）。详见 verify 输出。

完成后按 [challenges/README.md](../README.md) 填 `workspace/RESULT.md`。
