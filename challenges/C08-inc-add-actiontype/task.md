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

- `workspace/registry.py` 的 `ACTIONS` 字典是动作类型的**唯一权威定义**，每条是 `ActionTypeDef(type, spec_field, category, read_only)`。
- `workspace/actions.ts` 是 codegen 从 registry 派生出的前端类型文件（真实环境由 `npm run codegen` 重生，**禁止手改**；但本题要求你**手动**改它，体现你理解派生规则——**不要**真的去跑 codegen）。

新增一个动作类型必须**两处同步**。先读这两个文件，仔细对照现有条目，理解 `ActionTypeDef` 各字段如何决定 `actions.ts` 里联合类型、各 family Set、`READ_ONLY_ACTION_TYPES` / `WRITE_ACTION_TYPES` 的归属——派生规则要自己从现有条目里归纳。

## 任务

新增一个动作类型 **`EXPORT_REPORT`**（导出报告），同时改 `workspace/registry.py` 和 `workspace/actions.ts` 两处。

- `workspace/registry.py` — 在 `ACTIONS` 字典里加一条 `EXPORT_REPORT`。
- `workspace/actions.ts` — 按 codegen 派生规则同步更新（联合类型 + 该进哪个/哪些 Set）。

`EXPORT_REPORT` 的 `spec_field`、`category`、`read_only` 三个字段取值**自行决定**——通过研究现有条目（尤其那些和"导出报告"性质相近的）归纳出最合理的取值与派生位置。verify 会对照正确答案判分。

## 约束

- 只改 `workspace/` 内的两个文件（`workspace/registry.py` 和 `workspace/actions.ts`）。
- 不碰 `seed/`、`verify.py`、`task.md`、`SOLUTION.md`。
- 不碰 `workspace/` 以外的任何文件。
- **不要**真的跑 `npm run codegen`——本题考的是手动改 actions.ts 的正确性。

## 验证

```bash
python verify.py
```

退出码 0 = PASS，非 0 = FAIL。verify 做静态文本分析（读源文件 + 正则），不执行 agent 代码。

完成后按 [challenges/README.md](../README.md) 填 `workspace/RESULT.md`。
