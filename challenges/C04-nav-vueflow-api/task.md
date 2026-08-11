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

workspace 里有 2 个自包含的 TypeScript 文件，建模了 Precis 前端的 "Vue Flow API 单例注入层"
模式（详见主仓库 `AGENTS.md` 的 "Critical Patterns & Pitfalls → Vue Flow DAG 操作规范" 一节）。

## 任务

`workspace/vueFlowApi.ts` 是一个半成品——单例注入机制没有完成。补全 `initVueFlowApi` 和
`requireApi` 两个函数，让注入机制正常工作。

**先读 `workspace/callSite.ts`**（只读参考，不改），理解这两个函数是如何被消费的——它是
契约的可执行规格。其余设计（守卫条件、错误处理）**自行决定**。verify 只测行为，不查内部实现。

## 约束

- 只改 `workspace/vueFlowApi.ts`。
- 不碰 `seed/`、`verify.mjs`、`task.md`、`SOLUTION.md`。
- 不碰 `workspace/callSite.ts`（只读参考，verify 不要求改它）。
- 不碰 `workspace/` 以外的任何文件（即不要改主仓库代码）。

## 验证

在本题目录下运行：

```bash
node verify.mjs
```

退出码 0 = PASS，非 0 = FAIL。检查项含静态检查 + 动态测试，详见 verify 输出。
