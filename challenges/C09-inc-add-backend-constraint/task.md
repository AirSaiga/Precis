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

Precis 后端采用**三层分离**架构（见 [AGENTS.md](../../../AGENTS.md) "后端三层分离（backend/app/shared/）"小节）：

```
shared/
├── core/       # 框架级基础设施 — 文件 I/O、配置解析、数据加载
├── domain/     # 纯业务领域逻辑 — 数据类型、约束、表达式求值（无 I/O 依赖）
└── services/   # 应用服务 — 编排 core 和 domain 实现用例（校验、AI、预览）
```

加上暴露 HTTP 的 `api/routers/`，就是**领域 → 编排 → 路由**三层。本题的 workspace 是这套架构的精简自包含版本，用"约束校验"这条链路建模：

- `workspace/domain.py` — **领域层**：`Constraint` 基类 + 已有的 `RegexConstraint` + `CONSTRAINT_FACTORIES` 注册表 + `build_constraint` 工厂入口。纯业务逻辑，无 I/O。
- `workspace/service.py` — **服务层**：`validate_column(values, constraint_type, constraint_params)`，调用 `build_constraint` 拿到一个约束实例，遍历一列值执行 `validate`，聚合违规索引。它**不认识任何具体约束类型**，只通过注册表拿实例。
- `workspace/api.py` — **API 层**：FastAPI 两个路由——`POST /validate`（透传请求给 `validate_column`）和 `GET /constraint-types`（列出 `CONSTRAINT_FACTORIES` 的 keys）。也是**纯透传**。

已有的约束是 `RegexConstraint`（值必须是字符串且匹配正则）。

**先读这三个文件**，特别注意 service / api 两层是怎么写的——它们对约束类型是**完全 generic** 的：

- `service.validate_column` 只调 `build_constraint(constraint_type, constraint_params)`，拿到实例后调 `.validate()`，从不 `if constraint_type == "regex"`。
- `api` 的两个路由也只是把请求字段透传给 service / 把注册表 keys 列出来。

## 任务

新增一个 **`LengthConstraint`**：值必须是字符串，且长度落在闭区间 `[min_len, max_len]` 内。贯穿**三层**：

### 1. `workspace/domain.py` — 新增 `LengthConstraint(Constraint)` 类

照搬 `RegexConstraint` 的写法（类定义 + 类属性 `constraint_type` + `__init__` 存参数 + `validate`），但**关键差异**是约束逻辑：

- 类属性：`constraint_type = "length"`
- `__init__(self, min_len: int, max_len: int)`：把两个参数存到 `self._min_len` / `self._max_len`。
- `validate(self, value) -> bool`：当且仅当 `value` 是 `str` **且** `self._min_len <= len(value) <= self._max_len` 时返回 `True`，否则 `False`。**闭区间**（边界值算合法）。
- 注册：在 `CONSTRAINT_FACTORIES` 字典里加 `"length": LengthConstraint,`（照搬 `"regex": RegexConstraint,` 的写法）。

### 2. `workspace/service.py` — ？

**先想清楚再动手**。`validate_column` 是 generic 的——它用 `build_constraint(type_name, params)` 拿实例，再调 `.validate()`。一个在 `CONSTRAINT_FACTORIES` 里注册过的新约束，会不会**自动**流过 service 层？

> 如果你的结论是"不用改"，就**别改**。改了反而说明你没想通这层的职责。

### 3. `workspace/api.py` — ？

同样的问题再问一遍。`POST /validate` 透传 `constraint_type` / `constraint_params` 给 service；`GET /constraint-types` 读 `CONSTRAINT_FACTORIES.keys()`。新约束注册后，这两个端点会不会**自动**支持 `"length"`？

> 同样：想清楚后**该不改就不改**。

### 验证你的判断

加完 `LengthConstraint` 并注册后，端到端应该是这样：

- `GET /constraint-types` 返回的列表里**自动**多了 `"length"`（因为读的是注册表）。
- `POST /validate` 传 `{"values": [...], "constraint_type": "length", "constraint_params": {"min_len": 2, "max_len": 5}}` **自动**走通（因为 service 透传给 domain）。

如果这两个端点不工作，说明你漏了 domain 层的注册，或者误改了 service / api 的 generic 逻辑。

### 约束（务必遵守）

- 只改 `workspace/` 内的文件。推荐只改 `workspace/domain.py`——**这正是三层分离的回报**：新增一个领域概念，只动领域层，编排层和路由层自动跟上。
- 如果你确信需要改 service / api（想清楚！），也允许，但 reference solution 只动 domain。
- 不碰 `seed/`、`verify.py`、`task.md`、`SOLUTION.md`。
- 不碰 `workspace/` 以外的任何文件（即不要改主仓库代码）。

### 提示

- 拿 `RegexConstraint` 当模板：类定义结构（类属性 `constraint_type` + `__init__` + `validate`）、注册表条目位置，整体照抄，只换约束逻辑。
- **关键决策点（架构洞察）**：service.py 和 api.py 是**generic 编排**——它们用 `build_constraint(type_name, params)` 拿实例再调 `.validate()`，从不针对具体约束类型写分支。一个新约束只要在 `CONSTRAINT_FACTORIES` 里注册过，就会**自动**从 domain 流到 service、再流到 api。**这是三层分离的全部回报**：`inc` 增量改动只触一层。如果你发现自己在改 service.py 或 api.py，停下来再读一遍这两个文件——你大概率漏了 generic 设计，正在做多余的事。
- `LengthConstraint` 的参数样例：`{"min_len": 2, "max_len": 10}`。verify 用 `{"min_len": 2, "max_len": 5}` 测闭区间边界。
- `validate` 必须**先**判 `isinstance(value, str)` 再取 `len()`——否则 `len(123)` / `len(None)` 会抛 `TypeError`，verify 会判定失败。

### 验证

在本题目录下运行：

```bash
python verify.py
```

退出码 0 = PASS，非 0 = FAIL。verify 会真实 import 三个层、调用 `validate`、并经 service 端到端验证（不靠静态伪装）。共约 9 项检查：domain 可导入 / service 可导入 / `LengthConstraint` 类存在 / 注册表含 `"length"` / `build_constraint("length", ...)` 成功 / `validate` 闭区间正确且拒非字符串 / `constraint_type` 属性 / service 端到端 / 未知类型仍报错 / service 未被大改。

完成后按 [challenges/README.md](../README.md) 填 `workspace/RESULT.md`。
