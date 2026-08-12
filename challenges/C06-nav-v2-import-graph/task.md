# C06-nav-v2-import-graph — 理解 V2 导入调用图 + 补齐缺失的节点类型注册

| 项 | 值 |
|----|-----|
| ID | C06 |
| 维度 | nav（代码库导航与理解） |
| 栈 | JS（建模 TS 架构，纯 JS 便于 node 直接执行） |
| 难度 | ★★★ |
| 预估 | 25-40 分钟 |
| 依赖 | Node ≥20 |

## 背景

workspace 里有 3 个自包含的 JavaScript 文件（`assembly.js` / `v2Import.js` / `nodeFactory.js`），
建模了 Precis 前端的 **V2 配置导入调用图**——真实代码见 `frontend/src/stores/graphStore/setup/assembly.ts`
（聚合各子模块到扁平对象，见主仓库 `AGENTS.md` 的"前端 GraphStore"一节）。

## 任务

**症状**：导入配置时，某些节点类型会被**静默丢弃**——配置看起来导入成功，但部分节点凭空消失了。
`v2Import.js` 里的 `EXAMPLE_CONFIG` 覆盖了目前项目用到的全部节点类型，但其中**有不止一种类型**
未在工厂注册，导入时都会被丢进 `skipped`。

读完 `workspace/` 下的 3 个文件，沿着调用链走一遍，搞清楚为什么会丢节点、丢了哪些类型，
然后**修复**使示例配置里的所有节点类型都能正常创建。同时回答四道理解题。

### 1. 回答四道理解题

新建 `workspace/answers.js`，用注释回答四个问题（每行一个，verify 用正则匹配）：

```javascript
// Q1: <函数名>
// Q2: <一句话>
// Q3: <数字>
// Q4: <一句话>
```

- **Q1**：`importConfig` 调用哪个函数来创建每个节点？（答案填一个函数名）
- **Q2**：当一个节点的 `type` 不在工厂注册表里时，会发生什么？（一句话描述）
- **Q3**：`assembly.js` 聚合了几个模块？（填一个数字）
- **Q4**：为什么"注册表查不到就 `return null`、由调用方静默跳过"比**直接抛错**更危险？（一句话）

### 2. 修复

定位所有被静默丢弃的节点类型，在合适的文件里补齐注册，使导入示例配置时**所有节点都能创建、
`skipped` 为空**。其中 `template` 类型节点的创建契约（写死，必须遵守）：

- 返回对象形如 `{ type: 'template', id, templateId, params }`；
- `id` 与 `templateId` 从配置**透传**；
- `params` 从配置透传，但配置缺省时必须**填充默认值 `{}`**（不能是 `undefined`）。

其余缺失类型保持其配置字段透传即可（对照已有工厂的写法）。具体改哪个文件、怎么改，
读完代码自行决定。注意：`importConfig` 对真正未知类型（如 `mystery`）的跳过防御不能破坏。
verify 只测行为，不查内部实现。

## 约束

- 只改 `workspace/` 内文件。
- 不碰 `seed/`、`verify.mjs`、`task.md`、`SOLUTION.md`。
- 不碰 `workspace/` 以外的任何文件（即不要改主仓库代码）。

## 验证

在本题目录下运行：

```bash
node verify.mjs
```

退出码 0 = PASS，非 0 = FAIL。verify 会真的 `require` 三个模块并端到端跑 `importConfig`
（不是静态文本检查），详见 verify 输出。
