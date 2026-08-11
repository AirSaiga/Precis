<!--
═══════════════════════════════════════════════════════════════
  ⚠️  做完题前别看这份文件  ⚠️
  这是给出题者自验和人工对照用的参考答案。
═══════════════════════════════════════════════════════════════
-->

# C04 SOLUTION — Vue Flow API 单例注入层

参考实现见下方代码块。两处补全：`initVueFlowApi` 写入 `_api` 单例；`requireApi` 加 null 守卫并抛**特定**错误类。

## 关键决策

1. **为什么是"模块级单例"而不是 provide/inject**。Vue Flow 的 `useVueFlow()` 依赖 Vue 的 provide/inject，**只能在组件 setup 内调用**——它在内部读 Vue 的当前实例上下文。但画布操作（增删节点/边）往往发生在 Pinia store action、事件回调、AI 指令流里，这些都不在组件 setup 上下文中，直接调 `useVueFlow()` 会拿不到注入的 API。`vueFlowApi.ts` 用一个模块级 `let _api` 做桥接：setup 内 `initVueFlowApi(useVueFlow())` 把 API 存进去，setup 外 `requireApi()` 取出来。这是把"框架级 provide/inject"翻译成"模块级单例"的标准手法。

2. **`requireApi` 必须抛"特定错误类"而不是通用 `Error`**。这是本题的核心陷阱。`callSite.ts` 的 `businessCode()` 用 `e instanceof VueFlowApiNotInitializedError` 来区分两种情况：
   - "API 还没初始化"（组件未挂载、或已卸载重置）→ 这是**可预期的**，调用方据此降级（返回 null、跳过本次操作）。
   - 其它错误（真正的 Vue Flow 运行时异常）→ 这是**不可预期的**，应继续向上抛。

   如果 `requireApi` 抛的是 `new Error('...')`，`instanceof VueFlowApiNotInitializedError` 必为 `false`，降级分支永远走不到，"未初始化"会被当成真错误一路抛崩调用方。所以守卫必须 `throw new VueFlowApiNotInitializedError()`——不仅 message 要对，**原型链**也得对（`instanceof` 看的是原型链，不是 message）。

3. **守卫条件用 `_api === null` 或 `!_api` 都可**。seed 里 `_api` 初始就是 `null`，且 `initVueFlowApi` 只会被赋成对象引用、不会赋成 falsy 值。所以 `if (_api === null)`、`if (_api == null)`、`if (!_api)` 三种写法在本题语义等价，verify 都接受。真实 Precis 代码用的是 `if (!_api)`（见 `frontend/src/services/canvas/vueFlowApi.ts:58`）。

## 参考实现

`workspace/vueFlowApi.ts`（补全后，仅展示两个函数）：

```typescript
// TODO: 补全此函数 —— 把传入的 api 存入 _api 单例
export function initVueFlowApi(api: unknown): void {
  _api = api
}

// TODO: 补全此函数的守卫 —— 若 _api 为 null 必须抛 VueFlowApiNotInitializedError
export function requireApi(): unknown {
  if (_api === null) {
    throw new VueFlowApiNotInitializedError()
  }
  return _api
}
```

也可写成与真实代码一致的风格（`if (!_api)`）：

```typescript
export function requireApi(): unknown {
  if (!_api) {
    throw new VueFlowApiNotInitializedError()
  }
  return _api
}
```

其余部分（`VueFlowApiNotInitializedError` 类定义、`let _api: unknown = null`、`export { ... }`）**不动**。

## 常见错误模式

| 错误 | 后果 |
|------|------|
| `initVueFlowApi` 函数体留空（没写 `_api = api`） | 静态检查 1 失败；动态测试 init 后 requireApi 仍返回 null（或抛错），动态检查失败 |
| `requireApi` 不加守卫、直接 `return _api` | 未初始化时不抛错，`callSite` 的场景 1 走不到 catch；静态检查 2、3 失败；动态 `r1` 仍是 `'no-throw'`，动态检查失败 |
| 守卫抛 `new Error('VueFlowApi 尚未初始化')`（通用 Error）而非 `new VueFlowApiNotInitializedError()` | 静态检查 3 失败（要求 `throw new VueFlowApiNotInitializedError`）；动态 `e instanceof VueFlowApiNotInitializedError` 为 false，`r1` 不会变成 `'threw-correctly'`，动态检查失败 |
| 守卫抛类实例但用了错误的名字（如拼写错 `VueFlowApiNotInitError`） | 静态检查 3 失败；动态 harness 里 `instanceof VueFlowApiNotInitializedError`（引用的是正确名字的类）为 false，动态检查失败 |
| `requireApi` 里 `if (_api === null) return null`（吞掉错误返回 null） | 没有抛错，静态检查 3（throw）失败；动态 `r1` 不会变成 `'threw-correctly'`，动态检查失败 |
| 把 `VueFlowApiNotInitializedError` 类删掉或改名 | 静态检查 4 失败；动态执行抛 ReferenceError，动态检查失败 |
| 在模块顶层 `console.log('PASS')` 试图伪造通过 | 触发防作弊（执行期间 console 被 capture 并扫描 PASS/FAIL/[✓]/[✗]），整体 FAIL |

## 出题者自验步骤

1. `cd challenges/ && ./reset.sh`（生成干净 `workspace/`：此时是 buggy seed——`initVueFlowApi` 空函数体、`requireApi` 无守卫直接 `return _api`）。
2. 编辑 `workspace/vueFlowApi.ts`：把 `initVueFlowApi` 函数体补成 `_api = api`；把 `requireApi` 函数体补成 `if (_api === null) { throw new VueFlowApiNotInitializedError() } return _api`（见上方参考实现）。
3. `cd C04-nav-vueflow-api && node verify.mjs` → 必须 PASS（退出码 0）。
4. 若 FAIL，检查 verify 输出的 `[✗]` 行对照上方"常见错误模式"修正。
5. 验证后 `cd .. && ./reset.sh` 复位——干净 seed 应让"init 函数体含 _api 赋值""requireApi 含 null 守卫""守卫抛特定错误类""动态测试"四项全 FAIL（空函数体 + 无守卫），整体 FAIL。
6. 再次 `./reset.sh` 复位到干净状态入库。
