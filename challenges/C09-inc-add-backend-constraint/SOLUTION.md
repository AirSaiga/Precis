<!--
═══════════════════════════════════════════════════════════════
  ⚠️  做完题前别看这份文件  ⚠️
  这是给出题者自验和人工对照用的参考答案。
═══════════════════════════════════════════════════════════════
-->

# C09 SOLUTION — 后端三层加一个约束类型

参考实现 = `seed/domain.py` 加上 `LengthConstraint` 后的版本（见下方代码块）。
**只动 `workspace/domain.py`，不碰 `service.py` / `api.py`**——这正是本题的架构教训。

## 关键决策

1. **三层分离的回报：新约束只触 domain 一层**。`service.validate_column` 和
   `api` 的两个路由都是 **generic 编排**：

   - service 层只做"`build_constraint(type_name, params)` → 拿实例 → 循环 `.validate()`
     → 聚合违规索引"，从不针对具体约束类型写 `if constraint_type == "regex"`。
   - api 层的 `POST /validate` 把请求字段透传给 service；`GET /constraint-types`
     读 `CONSTRAINT_FACTORIES.keys()`。

   所以一个新约束**只要**在 `CONSTRAINT_FACTORIES` 注册，就会自动从 domain
   流到 service、再流到 api。这是 `inc` 维度里"跨层增量但只需动一层"的典型——
   因为另外两层被设计成了无知的透传/编排。**如果你发现自己在改 service.py 或
   api.py，几乎可以肯定你漏了 domain 的注册，或在重写本不该重写的 generic 逻辑。**

2. **照搬 `RegexConstraint` 的结构，只换约束语义**。`RegexConstraint` 提供了
   类定义模板：类属性 `constraint_type = "..."` + `__init__` 存参数 + `validate`
   返回 bool + 在 `CONSTRAINT_FACTORIES` 字典里加一行。`LengthConstraint` 完全套用
   这个骨架，把"正则匹配"换成"长度闭区间判断"。

3. **`validate` 必须先 `isinstance(value, str)` 再取 `len()`**。两个理由：

   - **类型安全**：`len(123)` / `len(None)` 会抛 `TypeError`，不是返回 `False`。
     verify 会 `lc.validate(123)` / `lc.validate(None)`，不守卫直接异常 → 检查失败。
   - **语义正确**：非字符串值对"长度约束"本就无意义，应判 `False` 而非崩溃。

4. **闭区间**：`min_len <= len(value) <= max_len`，边界值（恰好等于 min 或 max）
   算合法。verify 显式测 `"ab"`（len 2 = min）和 `"abcde"`（len 5 = max）必须 `True`。
   写成 `<` / `>` 开区间会让边界检查失败。

## 参考实现

### `workspace/domain.py`（**唯一需要改的文件**）

在 `RegexConstraint` 之后、`CONSTRAINT_FACTORIES` 之前新增一个类：

```python
class LengthConstraint(Constraint):
    """长度约束：字符串长度必须在 [min_len, max_len] 闭区间内。"""

    constraint_type = "length"

    def __init__(self, min_len: int, max_len: int):
        self._min_len = min_len
        self._max_len = max_len

    def validate(self, value: Any) -> bool:
        if not isinstance(value, str):
            return False
        return self._min_len <= len(value) <= self._max_len
```

然后在注册表字典里加一行（紧挨 `"regex": RegexConstraint,`）：

```python
CONSTRAINT_FACTORIES: dict[str, type[Constraint]] = {
    "regex": RegexConstraint,
    "length": LengthConstraint,
}
```

### `workspace/service.py` / `workspace/api.py` — **不动**

- `service.validate_column` 用 `build_constraint("length", {"min_len": 2, "max_len": 5})`
  自动拿到 `LengthConstraint` 实例，循环 `.validate()` 聚合违规——无需任何修改。
- `api` 的 `GET /constraint-types` 读 `CONSTRAINT_FACTORIES.keys()`，自动返回
  `["length", "regex"]`；`POST /validate` 透传给 service——同样无需修改。

## 常见错误模式

| 错误 | 后果 |
|------|------|
| 只定义了 `LengthConstraint` 类，忘了在 `CONSTRAINT_FACTORIES` 加 `"length"` 条目 | 检查 4 失败（注册表不含 `"length"`）；检查 5 失败（`build_constraint` 返回 `None`）；连带检查 6-8 全失败 |
| 只改了注册表，没定义 `LengthConstraint` 类 | import 期 `NameError` → 检查 1（domain 可导入）失败，全部连锁失败 |
| `validate` 漏了 `isinstance(value, str)` 守卫 | `lc.validate(123)` 抛 `TypeError` 而非返回 `False`，检查 6 失败 |
| 写成开区间 `<` / `>`（照抄了"长度必须严格大于/小于"） | 检查 6 失败：`"ab"`（len 2 = min）或 `"abcde"`（len 5 = max）被误判 `False` |
| `min_len` / `max_len` 存成同名实例属性覆盖了什么，或参数名写错（如 `min_length`） | `build_constraint("length", {"min_len": 2, "max_len": 5})` 调用时 `**params` 解包 → `__init__` 收到意料外的 kwargs → `TypeError`，检查 5 失败 |
| 自作主张改了 `service.validate_column` 加 `if constraint_type == "length"` 分支 | 不直接导致检查失败（功能上仍对），但违背架构教训；若改坏了 generic 循环会导致检查 8/9 失败。reference solution 不动 service/api |
| 在 `api.py` 给 `/validate` 加 length 专属分支，或硬编码 `/constraint-types` 返回列表 | 同上，多余且违背三层分离；`GET /constraint-types` 若被硬编码成 `["regex"]` 则会漏 `"length"` |
| 把 `min_len`/`max_len` 做成类属性而非 `__init__` 实例属性 | 多个 `LengthConstraint` 实例共享同一对参数 → 逻辑可能仍过，但违背"`__init__(self, min_len, max_len)` 存参数"的契约；构造方式不健壮 |
| 在模块顶部 `print("PASS"); sys.exit(0)` 伪造通过 | 触发防作弊（import 期输出含 PASS），整体 FAIL |

## 出题者自验步骤

1. `cd challenges/ && ./reset.sh`（生成干净 workspace/，从 seed/ 复制三个文件）。
2. 按上方"参考实现"**只编辑 `workspace/domain.py`**：新增 `LengthConstraint` 类
   + 在 `CONSTRAINT_FACTORIES` 加 `"length": LengthConstraint`。
3. `cd C09-inc-add-backend-constraint && python verify.py` → 必须 PASS（退出码 0），
   约 10 项全 `[✓]`。
4. 若 FAIL，对照 verify 输出的 `[✗]` 行与上方"常见错误模式"修正。
   最常踩的是检查 6（漏 `isinstance` 守卫 / 写成开区间）和检查 4（漏注册表条目）。
5. 验证后 `./reset.sh` 复位，确认干净 seed 会 FAIL：
   没有 `LengthConstraint`、`"length"` 未注册 → 检查 3、4、5 失败（`lc` 为 `None`），
   连带检查 6、7 失败；service 端到端检查 8 失败（`build_constraint` 返 `None` →
   `validate_column` 走 error 分支，`constraint_type` 字段缺失）。
   检查 1、2、9、10 仍 PASS（domain/service 可导入、未知类型仍报错、service 未被改）——
   证明题目有区分度，且干净 seed 只在"新增约束相关"检查上失败。
