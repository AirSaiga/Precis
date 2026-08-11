<!--
═══════════════════════════════════════════════════════════════
  ⚠️  做完题前别看这份文件  ⚠️
  这是给出题者自验和人工对照用的参考答案。
═══════════════════════════════════════════════════════════════
-->

# C10 SOLUTION — 加新约束节点 NotBlank（5 处注册）

参考实现 = 在 5 个 seed 文件里各**新增**一段 NotBlank 登记（保留 NotNull 不动）。下方按文件给出 diff。

## 关键决策

1. **三层命名严格对齐**（`constraintMeta.ts` 是单一事实源）：
   - `kind` = `'notBlank'`（camelCase，注册表索引键）
   - `nodeType` = `'notBlankConstraint'`（camelCase + `Constraint` 后缀）
   - `v2Type` = `'NotBlank'`（PascalCase，落盘 YAML 用）
   这三个字段必须跨文件一致——builder / handler 按 `kind` 注册，节点类型按 `nodeType` 区分，持久化按 `v2Type` 落盘。任何一个拼错，约束就接不上。

2. **NotBlank ≠ NotNull**：NotNull 只拒绝 `null`/`undefined`；NotBlank 额外拒绝**空串与纯空白串**（`''`、`'   '`、`'\t\n'`）。所以 handler 的 `validate` 要：先判 `null`/`undefined`（与 notNull 一致），再判"是字符串且 `trim() === ''`"。**必须先 `typeof value === 'string'` 再 `.trim()`**，否则对 `null`/数字等非字符串值调 `.trim()` 会抛 `TypeError`——这是最易踩的坑。

3. **`nodes.ts` 两处都要改**：既要新增 `interface NotBlankConstraintNodeData`，**也要**把它加进 `CustomNodeData` 联合（用 `|` 连接）。只加接口、忘加联合成员是最常见的漏改——verify 用"NotBlankConstraintNodeData 出现 ≥2 次"专门抓这个。

4. **i18n 必须 zh/en 双侧**：seed 的结构是 `{ name, nameEn, description, descriptionEn }`（四字段），不是真实的 zh-CN/en-US 拆分文件（本题做了自包含精简）。notBlank 四个字段都要填，缺 `nameEn`/`descriptionEn` 在真实代码里会让英文界面显示空白。

## 参考实现（5 个文件的 diff）

### `workspace/constraintMeta.ts`

```diff
 export const CONSTRAINT_TYPES: ConstraintTypeMeta[] = [
   { nodeType: 'notNullConstraint', kind: 'notNull', v2Type: 'NotNull', requireInputHandle: false },
+  { nodeType: 'notBlankConstraint', kind: 'notBlank', v2Type: 'NotBlank', requireInputHandle: false },
 ]
```

### `workspace/nodeDataBuilder.ts`

```diff
 // notNull 的 builder 注册
 registerBuilder('notNull', (input) => ({ table: input.table ?? '', column: input.column ?? '' }))
+
+// notBlank 的 builder 注册
+registerBuilder('notBlank', (input) => ({ table: input.table ?? '', column: input.column ?? '' }))
```

### `workspace/handlerRegistry.ts`

```diff
 register({
   kind: 'notNull',
   validate: (ctx) => {
     if (ctx.value === null || ctx.value === undefined) {
       return { passed: false, message: `${ctx.column} 不能为空` }
     }
     return { passed: true }
   },
 })
+
+// notBlank 的 handler 注册：拒绝 null/undefined，以及空串/纯空白串
+register({
+  kind: 'notBlank',
+  validate: (ctx) => {
+    if (ctx.value === null || ctx.value === undefined) {
+      return { passed: false, message: `${ctx.column} 不能为空白` }
+    }
+    if (typeof ctx.value === 'string' && ctx.value.trim() === '') {
+      return { passed: false, message: `${ctx.column} 不能为空白` }
+    }
+    return { passed: true }
+  },
+})
```

### `workspace/nodes.ts`

```diff
 export interface NotNullConstraintNodeData extends BaseConstraintNodeData {
   type: 'notNullConstraint'
 }

+export interface NotBlankConstraintNodeData extends BaseConstraintNodeData {
+  type: 'notBlankConstraint'
+}
+
-export type CustomNodeData = NotNullConstraintNodeData
+export type CustomNodeData = NotNullConstraintNodeData | NotBlankConstraintNodeData
```

### `workspace/i18n.ts`

```diff
 export const constraintTypes = {
   notNull: {
     name: '非空约束',
     nameEn: 'Not Null',
     description: '确保列不能包含空值',
     descriptionEn: 'Ensures the column cannot contain null values',
   },
+  notBlank: {
+    name: '非空白约束',
+    nameEn: 'Not Blank',
+    description: '确保列不能包含空值或纯空白字符串',
+    descriptionEn: 'Ensures the column cannot contain null or whitespace-only values',
+  },
 } as const
```

**verify 自查**：constraintMeta 三字段 ✓；builder registerBuilder('notBlank') ✓；handler kind + validate ✓；nodes 接口 + 联合（出现 2 次）✓；i18n notBlank 块含 name + description ✓；3 个注册表文件 kind 一致 ✓；NotNull 全保留 ✓ → PASS。

## 常见错误模式

| 错误 | 后果 |
|------|------|
| 只加 `interface NotBlankConstraintNodeData`，忘加进 `CustomNodeData` 联合 | 检查「出现 ≥2 次」失败（只有 1 次）；联合里没有该类型，运行时无法识别此节点 |
| 三层命名拼错（如 `nodeType: 'notblankConstraint'`、`v2Type: 'Notblank'`、`kind: 'not_blank'`） | 跨文件对不上：constraintMeta 三字段正则失配、注册表 kind 不一致 |
| handler 里直接 `ctx.value.trim()` 不先判类型 | 对 `null`/数字等非字符串值会抛 `TypeError`（verify 不执行代码查不到，但生产会崩） |
| handler 只判空串不判 `null`/`undefined`，或只判 `null` 不判空串 | 语义偏离：NotBlank 应同时拒绝 null 与纯空白（题目规格明确要求） |
| i18n 只填 `name`/`description`（中文），漏 `nameEn`/`descriptionEn` | 真实代码英文界面显示空白（verify 只检查 name/description 存在，不强制 En，但题目规格要求双侧） |
| 删掉 NotNull 只留 NotBlank（非 additive） | 检查「NotNull 在 5 文件中保留」失败 |
| 在 `.ts` 里 `console.log('PASS')` 想影响 verify | 无效——verify 只读源文件文本做正则匹配，不执行 agent 代码 |

## 出题者自验步骤

1. `cd challenges/ && ./reset.sh`（生成干净 workspace/ = seed 副本，5 文件里都没有 notBlank）。
2. 按上方 5 个 diff 把 NotBlank 登记分别写入 `workspace/` 的 5 个文件（保留 NotNull）。
3. `cd C10-inc-add-constraint-node && node verify.mjs` → 必须 PASS（退出码 0，首行 `PASS`，约 14 项检查全 `[✓]`）。
4. 若 FAIL，对照 verify 输出的 `[✗]` 行修正（最常见是漏加 `CustomNodeData` 联合、或三层命名拼错）。
5. `cd .. && ./reset.sh` 复位（workspace 回到 seed）。
6. `cd C10-inc-add-constraint-node && node verify.mjs` → 应 FAIL（首行 `FAIL`，多个 `[✗]`：notBlank 相关检查全挂，但文件存在 + NotNull 保留检查仍 `[✓]`）。
7. 最后 `cd .. && ./reset.sh` 复位，保持交付态干净。
