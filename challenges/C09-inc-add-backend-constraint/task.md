# C09-inc-add-backend-constraint — 后端三层加一个约束类型

| 项 | 值 |
|----|-----|
| ID | C09 |
| 维度 | inc（跨文件跨层增量开发） |
| 栈 | Python |
| 难度 | ★★★ |
| 预估 | 25-40 分钟 |
| 依赖 | Python ≥3.12 + fastapi + pydantic（`pip install fastapi`） |

## 背景

workspace 是 Precis 后端三层分离架构的精简副本，用"约束校验"这条链路建模：

- `workspace/domain.py` — 领域层：`Constraint` 基类 + 已有的 `RegexConstraint` + `CONSTRAINT_FACTORIES` 注册表 + `build_constraint` 工厂入口。
- `workspace/service.py` — 服务层：`validate_column(values, constraint_type, constraint_params)`，编排校验流程。
- `workspace/api.py` — API 层：FastAPI 路由（`POST /validate`、`GET /constraint-types`）。

**先读这三个文件**，理解每一层的职责，以及它们之间怎么协作。已有的约束是 `RegexConstraint`（值必须是字符串且匹配正则）。

## 任务

新增一个 `LengthConstraint`：值必须是字符串，且长度落在闭区间 `[min_len, max_len]` 内（边界值算合法）。

- **类名**：`LengthConstraint`
- **构造参数**：`min_len`（int）、`max_len`（int）
- **constraint_type**：`"length"`

这个约束要贯穿三层才能端到端工作。**自己判断 domain / service / api 三层里哪些需要改**——仔细读现有代码的设计，想清楚再动手。其余设计（校验逻辑细节、错误处理）自行决定。verify 只测行为，不查内部实现。

## 约束

- 只改 `workspace/` 内的文件。
- 不碰 `seed/`、`verify.py`、`task.md`、`SOLUTION.md`。
- 不碰 `workspace/` 以外的任何文件。

## 验证

```bash
python verify.py
```

退出码 0 = PASS，非 0 = FAIL。verify 会真实 import 三个层（共 14 项检查）：调用 `validate`、经 service 端到端验证、真实请求 api 的 `GET /constraint-types` 断言清单含 `"length"`，并检查 service / api 两层源码中没有针对具体类型名（`"length"`）的特判。

完成后按 [challenges/README.md](../README.md) 填 `workspace/RESULT.md`。
