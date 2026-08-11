<!--
═══════════════════════════════════════════════════════════════
  ⚠️  做完题前别看这份文件  ⚠️
  这是给出题者自验和人工对照用的参考答案。
═══════════════════════════════════════════════════════════════
-->

# C07 SOLUTION — 加一个新 datetime 数据类型

参考实现 = `seed/data_types.py` + `seed/registry.py` 加上 `DateTimeType` 后的版本（见下方代码块）。整体策略：**把 `DateType` 整段照抄，改 4 处**（类名 / `name` / `_PATTERN` / `strptime` 格式串），再在 `registry.py` 里补 import 和注册表条目。

## 关键决策

1. **`parse` 返回完整 `datetime` 对象，不调 `.date()`**。这是本题与 `DateType` 最重要的差异。
   `DateType.parse` 末尾有 `.date()`，把 `datetime` 截成只剩日期的 `date`；`DateTimeType` 必须**保留**时间部分，
   所以直接 `return datetime.strptime(value, "%Y-%m-%d %H:%M:%S")`，不加 `.date()`。
   verify 检查 7 会断言 `isinstance(r, datetime) and r.hour == 14`——调了 `.date()` 会得到 `date` 对象，
   `isinstance(r, datetime)` 为 `False`，检查失败。

2. **日期与时间之间是空格分隔，不是 ISO 的 `T`**。`strptime` 格式串写成 `"%Y-%m-%d %H:%M:%S"`
   （中间一个空格），**不要**写成 `"%Y-%m-%dT%H:%M:%S"`。对应的 `_PATTERN` 用 `\s` 匹配那个空格：
   `r"^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}$"`。正则和 strptime 必须一致，否则会出现"正则过了、strptime 失败"
   或反过来的不一致。

3. **跨文件：类定义和注册缺一不可**。光在 `data_types.py` 写出 `DateTimeType` 类，
   `build_type_from_config("datetime")` 仍会因 `"datetime"` 不在 `TYPE_REGISTRY` 里而抛 `ValueError`；
   反过来只在 `registry.py` 写 `"datetime": DateTimeType` 而忘了 import / 没定义类，会 `NameError`。
   必须同时：(a) `data_types.py` 加类，(b) `registry.py` 的 `from data_types import ...` 加 `DateTimeType`，
   (c) `TYPE_REGISTRY` 加 `"datetime": DateTimeType`。这是 `inc` 维度的核心——增量改动要跨文件对齐。

4. **照抄 `validate` 的三段式结构**（`isinstance` → 正则 → `strptime`），别自作聪明简化。
   `strptime` 本身能拒掉很多非法输入，但前面的 `isinstance(value, str)` 用来拦 `None` / 数字
   （否则 `strptime(None, ...)` 会抛 `TypeError` 而非 `ValueError`），正则则拦掉 `2026/07/19` 这类
   形似但不合规的分隔符。三段缺一会让对应的行为检查失败。

## 参考实现

### `workspace/data_types.py`（在 `DateType` 后面新增一个类）

```python
class DateTimeType(DataType):
    """日期时间类型（YYYY-MM-DD HH:MM:SS）。"""
    name = "datetime"
    _PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}$")

    def validate(self, value: object) -> bool:
        if not isinstance(value, str):
            return False
        if not self._PATTERN.match(value):
            return False
        try:
            datetime.strptime(value, "%Y-%m-%d %H:%M:%S")
            return True
        except ValueError:
            return False

    def parse(self, value: object) -> object:
        return datetime.strptime(value, "%Y-%m-%d %H:%M:%S")
```

### `workspace/registry.py`（改两处）

```python
# import 行：追加 DateTimeType
from data_types import DataType, DateType, DateTimeType, IntegerType

# TYPE_REGISTRY：追加一项
TYPE_REGISTRY: dict[str, type[DataType]] = {
    "integer": IntegerType,
    "date": DateType,
    "datetime": DateTimeType,
}
```

## 常见错误模式

| 错误 | 后果 |
|------|------|
| `parse` 末尾多写了 `.date()`（照抄 `DateType` 忘删） | 检查 7 失败（返回 `date` 而非 `datetime`，`isinstance(r, datetime)` 为假） |
| strptime 格式串写成 `"%Y-%m-%dT%H:%M:%S"`（用 ISO 的 `T`） | 检查 3 失败（`strptime` 因分隔符不匹配抛 `ValueError` → validate 返回 `False`） |
| 正则写成 `^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$`（字面空格）而对 `'2026-07-19 14:30:00'` 也能过 | 通常不影响（字面空格也能匹配单空格）；但若误用 `.` 或漏了时间部分，检查 3/4 失败 |
| 只改了 `data_types.py`，忘了在 `registry.py` 注册（漏 import 或漏 `TYPE_REGISTRY` 条目） | 检查 2 失败（`build_type_from_config("datetime")` 抛 `ValueError`/`NameError`）；连带检查 3-8 全失败（`dt` 为 `None`） |
| 只改了 `registry.py`，没在 `data_types.py` 定义 `DateTimeType` | 检查 1 失败；import 期 `NameError` 导致检查 2-8 全失败 |
| `validate` 漏了 `isinstance(value, str)` 守卫 | `validate(None)` 会抛 `TypeError` 而非返回 `False`，检查 5 失败 |
| `name` 写成 `"DateTime"` / `"date_time"` 等大小写/分隔不符 | 检查 8 失败（要求严格等于 `"datetime"`） |
| 误删/改动了已有的 `DateType`、`IntegerType` 或 `build_type_from_config` | 检查 9 失败（未知类型不再抛 `ValueError`），或注册表其它行为被破坏 |
| 在模块顶部 `print("PASS"); sys.exit(0)` 试图伪造通过 | 触发防作弊（import 期输出含 PASS），整体 FAIL |

## 出题者自验步骤

1. `cd challenges/ && ./reset.sh`（生成干净 workspace/，从 seed/ 复制）。
2. 按上方"参考实现"编辑 `workspace/data_types.py`（新增 `DateTimeType` 类）和
   `workspace/registry.py`（import 加 `DateTimeType` + `TYPE_REGISTRY` 加一项）。
3. `cd C07-inc-add-datetime-type && python verify.py` → 必须 PASS（退出码 0），9 项全 `[✓]`。
4. 若 FAIL，对照 verify 输出的 `[✗]` 行与上方"常见错误模式"修正。
   最常踩的是检查 7（`.date()` 没删）和检查 3（strptime 用了 `T`）。
5. 验证后 `./reset.sh` 复位，确认干净 seed 会 FAIL：
   没有 `DateTimeType`、`"datetime"` 未注册 → 检查 1、2 及 3-8 失败
   （`dt` 为 `None`），检查 9 仍 PASS（注册表对未知类型仍报错）——证明题目有区分度。
