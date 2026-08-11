# C08-inc-add-actiontype — 加一个新 AI actionType（同步两处）

| 项 | 值 |
|----|-----|
| ID | C08 |
| 维度 | inc（跨文件跨层增量开发） |
| 栈 | Python |
| 难度 | ★★☆ |
| 预估 | 15-25 分钟 |
| 依赖 | Python ≥3.12（标准库，无第三方依赖） |

## 背景

Precis 的 AI 动作类型（actionType）有一套**单一事实源 + codegen** 契约（见 [AGENTS.md](../../../AGENTS.md) "AI 动作类型契约"）：

- 后端 `backend/app/shared/services/llm/actions/registry.py` 的 `ACTIONS` 字典是动作类型的**唯一权威定义**。
- 前端 `frontend/src/types/generated/actions.ts` 由 `frontend/scripts/codegen.mjs` 调用 `export_for_codegen()` 自动生成，**禁止手改**。
- AGENTS.md 明确规定：「修改后端动作类型后，必须跑 `npm run codegen` 重新生成并提交 `actions.ts`，否则 CI 失败」。

本题 workspace 里有 2 个文件（精简版）：

- `workspace/registry.py` — 动作类型注册表，4 条记录。
- `workspace/actions.ts` — codegen 生成的前端类型文件，与上面 4 条记录对应。

**先读 `workspace/registry.py` 和 `workspace/actions.ts`**，理解：

- `ActionTypeDef(type, spec_field, category, read_only)` 的 4 个字段含义。
- `category` 与 actions.ts 里 family Set 的对应关系：`constraint`/`schema`/`regex`/`transform` 各有**专属** family Set（`CONSTRAINT_ACTION_TYPES` 等），而 `validate`/`canvas`/`settings` **没有**专属 family Set —— 这三类只在 `READ_ONLY_ACTION_TYPES` / `WRITE_ACTION_TYPES` 里出现。
- `read_only` 与 actions.ts 的对应：`read_only=True` → 进 `READ_ONLY_ACTION_TYPES`；`read_only=False` → 进 `WRITE_ACTION_TYPES`。
- 对照 `VALIDATE_PROJECT`（`category="validate"`, `read_only=True`）：它在 actions.ts 里**只**出现在 `ActionType` 联合类型 + `READ_ONLY_ACTION_TYPES`，**不**在任何 family Set，**不**在 `WRITE_ACTION_TYPES`。这是最重要的参考样板。

## 任务

新增一个动作类型 **EXPORT_REPORT**，规格如下：

| 字段 | 值 |
|------|-----|
| type | `EXPORT_REPORT` |
| spec_field | `reportSpec` |
| category | `validate` |
| read_only | `True` |

同时修改两个文件：

### 1. `workspace/registry.py`

在 `ACTIONS` 字典里加一行：

```python
"EXPORT_REPORT": ActionTypeDef("EXPORT_REPORT", "reportSpec", "validate", True),
```

### 2. `workspace/actions.ts`

模拟 codegen 会产出的结果（真实环境里跑 `npm run codegen` 即可，但本题要求**手动**改这个文件来体现你理解了 codegen 的派生规则）：

- 在 `ActionType` 联合类型里加 `| 'EXPORT_REPORT'`。
- 因为 `category="validate"`（**没有**专属 family Set），**不要**加进 `CONSTRAINT_ACTION_TYPES` / `SCHEMA_ACTION_TYPES` / `REGEX_ACTION_TYPES` / `TRANSFORM_ACTION_TYPES` 任何一个。
- 因为 `read_only=True`，把 `'EXPORT_REPORT',` 加进 `READ_ONLY_ACTION_TYPES`。
- 因为 `read_only=True`（不是 False），**不要**加进 `WRITE_ACTION_TYPES`。
- 保留文件头的 codegen 警告注释不要删。

### 约束（务必遵守）

- 只改 `workspace/` 内的文件（本题只有 `workspace/registry.py` 和 `workspace/actions.ts` 两个）。
- 不碰 `seed/`、`verify.py`、`task.md`、`SOLUTION.md`。
- 不碰 `workspace/` 以外的任何文件（即不要改主仓库代码）。
- **不要**真的去跑 `npm run codegen`（本题模拟手动改 actions.ts，验证你理解派生规则）。即便你跑了，CI 之外的环境也不会自动同步，本题考的是手改的正确性。

### 提示

- 拿 `VALIDATE_PROJECT`（`category="validate"`, `read_only=True`）当模板对照 —— EXPORT_REPORT 的派生位置应该和它**完全一样**（联合类型 + `READ_ONLY_ACTION_TYPES`，仅此而已）。
- **关键决策点**：`validate` 类别**没有**专属 family Set。别把 EXPORT_REPORT 塞进 CONSTRAINT/SCHEMA/REGEX/TRANSFORM 这四个 Set 里的任何一个 —— 那是 `category` 为 constraint/schema/regex/transform 的动作才去的地方。
- **第二个关键决策点**：`read_only=True` 意味着进 `READ_ONLY_ACTION_TYPES`，**不**进 `WRITE_ACTION_TYPES`。`WRITE` 是 `read_only=False` 的动作的归宿。
- `actions.ts` 里每个 Set 的元素顺序对 verify 不重要（codegen 实际会排序，但本题 verify 只检查"在/不在"，不检查顺序）。

### 验证

在本题目录下运行：

```bash
python verify.py
```

退出码 0 = PASS，非 0 = FAIL。共 11 项检查（registry 4 项 + actions.ts 7 项）详见 verify 输出。verify 只做静态文本分析（读源文件 + 正则），不执行 agent 代码。

完成后按 [challenges/README.md](../README.md) 填 `workspace/RESULT.md`。
