# C10-inc-add-constraint-node — 加新约束节点 NotBlank（5 处注册）

| 项 | 值 |
|----|-----|
| ID | C10 |
| 维度 | inc（跨文件跨层增量开发） |
| 栈 | TS |
| 难度 | ★☆☆ |
| 预估 | 15-25 分钟 |
| 依赖 | Node ≥20（仅用于跑 verify，不需 tsc） |

## 背景

本 `workspace/` 里有 5 个自包含的 TypeScript 文件，分别对应真实 Precis 约束系统的 **5 个注册位点**。现有约束 **NotNull** 已经在全部 5 个文件里登记完毕，作为模板。这 5 个文件彼此独立（无 import 依赖），但通过同一个 `kind` 标识符（`'notNull'`）和三层命名约定（`nodeType` / `kind` / `v2Type`）串成一个完整的约束类型。

在真实 Precis 代码库里，新增一个约束类型必须同时改动这 5 处，缺一不可——见主仓库 `AGENTS.md` 的「约束节点自注册」一节：1) NodeDataBuilder、2) ValidationRegistry、3) 三层命名映射（`constraintMeta`）、4) 前端类型（`nodes.ts`）、5) i18n 文案。本题把这 5 处抽成最小自包含版，命名约定与真实代码完全一致。

**先读 `workspace/constraintMeta.ts` 和 `workspace/handlerRegistry.ts`**，理解三层命名约定与注册模式：

- **三层命名**（同一约束的三种标识，必须对齐）：
  - `kind`（camelCase，注册表索引键）—— 如 `'notNull'`
  - `nodeType`（PascalCase + `Constraint` 后缀）—— 如 `'notNullConstraint'`
  - `v2Type`（PascalCase，落盘 YAML 用）—— 如 `'NotNull'`
- **5 个文件各自的注册形态**（以 NotNull 为例）：
  - `constraintMeta.ts`：往 `CONSTRAINT_TYPES` 数组加一条 `{ nodeType, kind, v2Type, requireInputHandle }`
  - `nodeDataBuilder.ts`：调 `registerBuilder(kind, fn)` 注册构建函数
  - `handlerRegistry.ts`：调 `register({ kind, validate })` 注册校验器
  - `nodes.ts`：加 `XxxConstraintNodeData` 接口 + 加入 `CustomNodeData` 联合类型
  - `i18n.ts`：加 `constraintTypes.<kind> = { name, nameEn, description, descriptionEn }`

## 任务

新增一个约束 **NotBlank**——校验**字符串列不能为空或纯空白**（`''`、`'   '`、`'\t\n'` 等都算不通过）。注意它和 NotNull **不同**：NotNull 只拒绝 `null`/`undefined`；NotBlank 额外拒绝空串与纯空白串（对一个空串 `''`，NotNull 放行、NotBlank 拒绝）。

在全部 5 个文件里，照 NotNull 的模式登记 NotBlank：

### 规格

1. **`workspace/constraintMeta.ts`** —— 往 `CONSTRAINT_TYPES` 加一条：
   `{ nodeType: 'notBlankConstraint', kind: 'notBlank', v2Type: 'NotBlank', requireInputHandle: false }`
2. **`workspace/nodeDataBuilder.ts`** —— 调 `registerBuilder('notBlank', (input) => ({ table: input.table ?? '', column: input.column ?? '' }))`（与 notNull 同形）。
3. **`workspace/handlerRegistry.ts`** —— 调 `register({ kind: 'notBlank', validate: ... })`。`validate` 行为：
   - `ctx.value` 是 `null` / `undefined` → 不通过（与 notNull 一致，空白校验对空值也报错）
   - `ctx.value` 是字符串且 `value.trim() === ''`（空串或纯空白）→ 不通过，message 提示该列不能为空白
   - 其它（非空非纯空白的字符串，或非字符串的非空值）→ 通过
4. **`workspace/nodes.ts`** —— 新增 `interface NotBlankConstraintNodeData extends BaseConstraintNodeData { type: 'notBlankConstraint' }`，并把它加入 `CustomNodeData` 联合类型（用 `|` 连接）。
5. **`workspace/i18n.ts`** —— 在 `constraintTypes` 里加 `notBlank: { name, nameEn, description, descriptionEn }`，zh/en 双侧都要填（参考 notNull 的四字段结构）。

### 约束（务必遵守）

- 只改 `workspace/` 内的 5 个文件。
- 不碰 `seed/`、`verify.mjs`、`task.md`、`SOLUTION.md`。
- 不碰 `workspace/` 以外的任何文件（即不要改主仓库代码）。
- 改动是 **additive**：保留 NotNull 的全部注册，只是**新增** NotBlank。
- 不引入新的 `import`（5 个文件本就各自自包含）。

### 提示

- **照葫芦画瓢**：每个文件里复制 NotNull 那一段，改成 NotBlank 即可。关键是三层命名（`nodeType` / `kind` / `v2Type`）遵循既有约定——`kind` 用 camelCase（`notBlank`）、`nodeType` 加 `Constraint` 后缀（`notBlankConstraint`）、`v2Type` 用 PascalCase（`NotBlank`）。
- **NotBlank ≠ NotNull**：handler 的 `validate` 要判 `value.trim() === ''`（先确认 `typeof value === 'string'` 再 `.trim()`，避免对非字符串调用 `.trim()` 抛错）。
- **关键决策点**：三层命名的三个字段必须与 `constraintMeta.ts` 里那条登记完全对齐；`nodes.ts` 里既要加接口**也要**把接口加进 `CustomNodeData` 联合（漏掉联合成员是最常见错误）；`i18n.ts` 必须 zh/en 双侧都有（`name`+`nameEn`+`description`+`descriptionEn`）。

### 验证

在本题目录下运行：

```bash
node verify.mjs
```

退出码 0 = PASS，非 0 = FAIL。约 14 项静态检查（只读源文件文本做正则匹配，不跑 tsc、不执行 agent 代码）详见 verify 输出。

完成后按 [challenges/README.md](../README.md) 填 `workspace/RESULT.md`。
