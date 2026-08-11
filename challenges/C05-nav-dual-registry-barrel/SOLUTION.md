<!--
═══════════════════════════════════════════════════════════════
  ⚠️  做完题前别看这份文件  ⚠️
  这是给出题者自验和人工对照用的参考答案。
═══════════════════════════════════════════════════════════════
-->

# C05 SOLUTION — 双注册表 barrel 缺失的 side-effect import

参考修复：把 `workspace/index.ts` 里被注释掉的 `import './notNullHandler'` 重新启用（去掉行首 `//`）。一行改动，无需新增文件、无需动注册逻辑。

## 关键决策

1. **barrel 的 side-effect import 是注册的唯一触发源**。每个业务模块（`notNullBuilder.ts` / `notNullHandler.ts`）在**模块顶层**调用 `registerBuilder(...)` / `register(...)`，但这行代码只有在"该模块被 import"时才会执行。barrel `index.ts` 用裸 `import './xxx'`（不带 `from`、不绑定名字）把这些模块"拉进来"——ESM 规定 import 一个模块就会执行它的顶层代码，从而触发注册。这就是"side-effect import"的全部含义：import 不是为了拿导出，纯粹是为了让模块的顶层副作用跑一遍。

2. **为什么 builder 注册成功、handler 没注册**。对比 index.ts：
   - `import './notNullBuilder'` —— **未注释** → 模块被加载 → `registerBuilder('notNull', ...)` 执行 → `builders` Map 里有了 notNull
   - `// import './notNullHandler'` —— **被注释** → 模块**没**被加载 → `register({...})` **根本没执行** → `handlers` Map 里没有 notNull

   关键洞察：handler 的注册代码本身**完全正确**（`register({ kind: 'notNull', ... })` 没毛病），`handlers` Map、`register` 函数也都没毛病。唯一的问题是"这段正确的代码没机会运行"。所以修复点不在注册逻辑，而在"把它的触发器重新打开"。

3. **注释掉一行 side-effect import 会静默禁用注册——这是该模式的核心陷阱**。没有任何报错、没有类型错误（TS 不会因为少 import 一个 side-effect 模块而报错）、没有运行时异常。症状只是"某个注册表里悄悄少了一项"。真实 Precis 代码库里，如果有人误删 `validationRegistryHandlers/index.ts` 里的某一行 `import './xxxHandler'`，对应约束类型就会在校验时静默失效——极难排查。本题正是把这个陷阱抽出来做导航训练。

## 参考实现

`workspace/index.ts`（修复后）：

```typescript
/**
 * Barrel 入口（C05 精简版）。
 * 通过 side-effect import 触发各模块的自注册。
 */
import './registry'
import './notNullBuilder'
import './notNullHandler'
```

唯一的改动：第 3 行从 `// import './notNullHandler'` 改回 `import './notNullHandler'`（去掉行首 `//`）。

> **不要把整行删除**——那是错误做法。verify 检查 1 要求"index.ts 含 notNullHandler 的 import 行"，删行后没有任何引用 notNullHandler 的行，检查 1 会失败。**正确做法是"uncomment"（取消注释），保留 import 语句、只去掉行首 `//`**。这样既语义准确（重新启用被禁用的 side-effect import），又能通过全部检查。

## 常见错误模式

| 错误 | 后果 |
|------|------|
| 在 `registry.ts` 里给 `handlers` Map 预填 notNull（`handlers.set('notNull', ...)`） | 偏离自注册模式、治标不治本；且 verify 的检查点是"barrel 的 import 已启用"，不改 barrel 仍 FAIL |
| 在 `index.ts` 里直接内联 `register({ kind: 'notNull', ... })` | 绕过了 `notNullHandler.ts` 模块；虽然能让 `notNullHandler.ts` 里的 register 调用"显得多余"，但 verify 检查的是 barrel 是否 import 了 notNullHandler（检查 1/2/3 失败） |
| 把 `notNullHandler.ts` 的 `register(...)` 调用搬到 `notNullBuilder.ts` 或 `index.ts` | 违背"每个 handler 自注册在自己模块"的模式；verify 检查 `notNullHandler.ts` 含 register 调用（检查 4 失败） |
| 把 `// import './notNullHandler'` 整行**删除**而非**取消注释** | verify 检查 1（"index.ts 含 notNullHandler import 行"）失败——因为没有引用行了。正确做法是去掉 `//`，保留 import 语句 |
| 改 `register` 函数名或 `handlers` Map 名 | 多处检查失败；注册机制本身没问题，别动它 |

## 出题者自验步骤

1. `cd challenges/ && ./reset.sh`（生成干净 workspace/，此时是 buggy seed：handler import 被注释）。
2. 编辑 `workspace/index.ts`：把 `// import './notNullHandler'` 改成 `import './notNullHandler'`（去掉行首 `//`）。
3. `cd C05-nav-dual-registry-barrel && node verify.mjs` → 必须 PASS（退出码 0）。
4. 若 FAIL，检查 verify 输出的 `[✗]` 行对照上方"常见错误模式"修正。
5. 验证后 `cd .. && ./reset.sh` 复位——干净 seed 应让检查 2、3 FAIL（notNullHandler import 仍被注释），整体 FAIL。
6. 再次 `./reset.sh` 复位到干净状态入库。
