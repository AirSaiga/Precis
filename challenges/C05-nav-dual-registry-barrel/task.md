# C05-nav-dual-registry-barrel — 修复双注册表 barrel 的两处断裂

| 项 | 值 |
|----|-----|
| ID | C05 |
| 维度 | nav（代码库导航与理解） |
| 栈 | TS |
| 难度 | ★★★ |
| 预估 | 20-35 分钟 |
| 依赖 | Node ≥20（仅用于跑 verify，不需 tsc） |

## 背景

workspace 里有 4 个自包含的 TypeScript 文件，建模了一个"双自注册注册表"系统（builders / handlers）
——这是真实 Precis 前端约束系统（见主仓库 `AGENTS.md` 的"前端约束系统（双注册表模式）"一节）
的精简复现。

barrel（`index.ts`）承担两个职责：
1. 用 side-effect import 触发各模块顶层自注册；
2. 作为**唯一对外入口**，把 registry 的查询接口再导出给消费方（消费方不直接摸 registry 模块）。

## 任务

**症状有两个**：

1. `notNull` 已经在 `builders` 注册表里，但**不在** `handlers` 注册表里——builder 注册
   成功了，handler 注册失败了。
2. barrel 的**对外 API 面不完整**：消费方需要能从 barrel 同时查询 builders 和 handlers
   两侧的已注册 kind 列表，但当前只能查到一侧。对照 barrel 里已有的再导出写法与
   `registry.ts` 提供的查询函数，自行判断缺了哪一项。

读完 `workspace/` 下的 4 个文件（`registry.ts`、`notNullBuilder.ts`、`notNullHandler.ts`、`index.ts`），
搞清楚两个症状的根因，然后**修复**：使 `notNull` 同时出现在两个注册表里，且 barrel 的对外
API 面覆盖 builders / handlers 两侧的查询接口。

其余设计**自行决定**。verify 只测行为/静态契约，不查内部实现细节。

## 约束

- 只改 `workspace/` 内的现有文件。
- 不碰 `seed/`、`verify.mjs`、`task.md`、`SOLUTION.md`。
- 不碰 `workspace/` 以外的任何文件（即不要改主仓库代码）。
- 不新增文件（修复在现有文件内完成）。

## 验证

在本题目录下运行：

```bash
node verify.mjs
```

退出码 0 = PASS，非 0 = FAIL。检查项为静态契约检查（读源文件文本，不跑 tsc、不执行代码），
详见 verify 输出。
