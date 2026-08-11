<!--
═══════════════════════════════════════════════════════════════
  ⚠️  做完题前别看这份文件  ⚠️
  这是给出题者自验和人工对照用的参考答案。
═══════════════════════════════════════════════════════════════
-->

# C08 SOLUTION — 加一个新 AI actionType（同步两处）

参考实现 = `seed/registry.py` + `seed/actions.ts` 加上 EXPORT_REPORT 后的版本（见下方代码块）。

## 关键决策

1. **registry.py 是单一事实源，actions.ts 是它的 codegen 产物**：所以必须**两处都改**。
   在真实 Precis 代码库里你会跑 `npm run codegen` 让 actions.ts 自动重生；本题考的是你
   **手动**把 codegen 会产出的结果写对，证明你理解派生规则。两处改完才算完成，只改一处会
   让 verify 的对应检查失败（registry 改了但 actions.ts 没改 → 检查 5/6 失败；反之检查 1-4 失败）。

2. **`category` → family Set 的映射是不对称的**：只有 `constraint`/`schema`/`regex`/`transform`
   这 4 个类别在 actions.ts 里有**专属** family Set（`CONSTRAINT_ACTION_TYPES` 等，见 codegen.mjs
   第 75 行的 `if (!['constraint','schema','regex','transform'].includes(cat)) continue`）。
   `validate`/`canvas`/`settings` **没有**专属 family Set。EXPORT_REPORT 的 `category="validate"`，
   所以它**不进**任何 family Set。拿同类的 `VALIDATE_PROJECT` 对照即可确认。

3. **`read_only` → READ_ONLY vs WRITE 的二分**：`read_only=True` 进 `READ_ONLY_ACTION_TYPES`，
   `read_only=False` 进 `WRITE_ACTION_TYPES`，两者互斥（WRITE 是 READ_ONLY 的补集）。
   EXPORT_REPORT 的 `read_only=True`，所以进 `READ_ONLY_ACTION_TYPES`，**不进** `WRITE_ACTION_TYPES`。

4. **`ActionType` 联合类型必须加**：codegen 会把所有 actionType 平铺进联合类型，所以
   `| 'EXPORT_REPORT'` 不能漏。

## 参考实现

### `workspace/registry.py`（在 ACTIONS 末尾加一行）

```python
ACTIONS: dict[str, ActionTypeDef] = {
    "ADD_CONSTRAINT_NODE": ActionTypeDef("ADD_CONSTRAINT_NODE", "constraintSpec", "constraint", False),
    "ADD_SCHEMA": ActionTypeDef("ADD_SCHEMA", "schemaSpec", "schema", False),
    "VALIDATE_PROJECT": ActionTypeDef("VALIDATE_PROJECT", "constraintSpec", "validate", True),
    "ADD_TO_CANVAS": ActionTypeDef("ADD_TO_CANVAS", "canvasSpec", "canvas", True),
    "EXPORT_REPORT": ActionTypeDef("EXPORT_REPORT", "reportSpec", "validate", True),
}
```

### `workspace/actions.ts`（联合类型加一行 + READ_ONLY 加一行）

```typescript
export type ActionType =
  | 'ADD_CONSTRAINT_NODE'
  | 'ADD_SCHEMA'
  | 'VALIDATE_PROJECT'
  | 'ADD_TO_CANVAS'
  | 'EXPORT_REPORT'

// CONSTRAINT / SCHEMA / REGEX / TRANSFORM 四个 family Set 完全不变（validate 无专属 Set）

export const READ_ONLY_ACTION_TYPES: ReadonlySet<ActionType> = new Set([
  'VALIDATE_PROJECT',
  'ADD_TO_CANVAS',
  'EXPORT_REPORT',
])

// WRITE_ACTION_TYPES 完全不变（read_only=True 不进 WRITE）
```

## 常见错误模式

| 错误 | 后果 |
|------|------|
| 只改 registry.py，忘了改 actions.ts | 检查 5（含 'EXPORT_REPORT'）、检查 6（READ_ONLY 含）失败 |
| 只改 actions.ts，忘了改 registry.py | 检查 1-4（registry 条目 / spec_field / category / read_only）失败 |
| 把 EXPORT_REPORT 加进了某个 family Set（如 SCHEMA_ACTION_TYPES） | 对应的检查 7 子项失败（"XX 不含 EXPORT_REPORT"） |
| 把 EXPORT_REPORT 加进了 WRITE_ACTION_TYPES（误以为所有新动作都进 WRITE） | 检查 8 失败 |
| 漏了 `ActionType` 联合类型里的 `| 'EXPORT_REPORT'` | 检查 5 失败（actions.ts 里完全没有该字符串） |
| 把 EXPORT_REPORT 加进 READ_ONLY 但同时又加进 WRITE（两端都写） | 检查 8 失败（WRITE 不应含） |
| 删掉了 actions.ts 头部的 codegen 警告注释 | 检查 9 失败 |
| spec_field / category / read_only 填错值（如把 category 写成 "constraint"） | 检查 2/3/4 失败（正则要求精确串 reportSpec/validate/True） |
| 试图 `print("PASS"); sys.exit(0)` 伪造通过 | **无效**：verify 只静态读源文件，不 import agent 代码，所以根本没有地方注入 print |

## 出题者自验步骤

1. `cd challenges/ && ./reset.sh`（生成干净 workspace/，从 seed/ 复制）
2. 按上方"参考实现"编辑 `workspace/registry.py`（加 ACTIONS 一行）和 `workspace/actions.ts`
   （联合类型加一行 + READ_ONLY 加一行）。
3. `cd C08-inc-add-actiontype && python verify.py` → 必须 PASS（退出码 0），11 项全 `[✓]`。
4. 若 FAIL，检查 verify 输出的 `[✗]` 行对照上方"常见错误模式"修正。
5. 验证后 `./reset.sh` 复位（确认干净 seed 会 FAIL —— 没有任何 EXPORT_REPORT，检查 1-6 失败，
   证明题目有区分度）。
