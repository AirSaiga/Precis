# C07-inc-add-datetime-type — 加一个新 datetime 数据类型

| 项 | 值 |
|----|-----|
| ID | C07 |
| 维度 | inc（跨文件跨层增量开发） |
| 栈 | Python |
| 难度 | ★☆☆ |
| 预估 | 10-15 分钟 |
| 依赖 | Python ≥3.12（标准库，无第三方依赖） |

## 背景

Precis 的数据集 schema 支持若干基础数据类型（见 [AGENTS.md](../../../AGENTS.md) "数据类型" 小节：string / integer / float / decimal / boolean / date）。在真实代码库里，这套类型体系的核心是两块：

- `backend/app/shared/domain/schema/builder.py` 的 `TYPE_REGISTRY`（约第 47-79 行）：一个字典，把**类型名**（如 `"date"`、`"integer"`）映射到工厂/实例。`build_type_from_config`（约第 82 行）是这个注册表的入口——传入一个类型名，返回对应的 `DataType` 实例；**未知类型名会抛 `ValueError`**。
- `backend/app/shared/domain/data_types_parts/scalars.py` 里的具体类型类（如第 537 行的 `DateType(DataType)`）：每个类型负责自己的 `validate` / `parse` 逻辑。

因此**新增一个数据类型 = 两件事**：

1. 在 scalars 里写一个新的 `DataType` 子类（validate + parse）。
2. 在 builder 的 `TYPE_REGISTRY` 里把它注册到对应的类型名。

本题的 workspace 是这两个文件的精简自包含版本：

- `workspace/data_types.py` — `DataType` 基类 + 已有的 `IntegerType`、`DateType`。
- `workspace/registry.py` — `TYPE_REGISTRY` 字典 + `build_type_from_config` 工厂入口。

**先读 `workspace/data_types.py` 和 `workspace/registry.py`**，理解：

- `DataType` 基类的 `validate(value) -> bool` 与 `parse(value) -> object` 契约。
- `DateType` 的写法：类属性 `name`、一个编译好的 `_PATTERN` 正则、`validate` 的三段式校验（先判 `isinstance(value, str)` → 再正则匹配 → 再 `datetime.strptime` 兜底）、`parse` 用 `strptime` 解析后调 `.date()` 返回 `date` 对象。
- `registry.py` 怎么把类型名 `"date"` 关联到 `DateType`：`TYPE_REGISTRY` 里 `"date": DateType`（映射到**类**），`build_type_from_config` 取出类后 `type_cls()` 实例化。要新增类型必须同时**在 import 里把新类引进来** + **在 `TYPE_REGISTRY` 字典里加一项**。

## 任务

新增一个 **`DateTimeType`**，校验/解析完整的日期时间，ISO 8601 格式 **`YYYY-MM-DD HH:MM:SS`**（注意：是空格分隔，**不是** `T` 分隔）。完全照搬 `DateType` 的写法：

### 1. `workspace/data_types.py` — 新增 `DateTimeType(DataType)` 类

- 类属性：`name = "datetime"`
- 正则：`_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}$")`（注意 `\s`，匹配日期和时间之间的空格）
- `validate(self, value) -> bool`：三段式，与 `DateType` 结构一致：
  1. 值不是 `str` → `False`
  2. 不匹配 `_PATTERN` → `False`
  3. `datetime.strptime(value, "%Y-%m-%d %H:%M:%S")` 抛 `ValueError` → `False`，否则 `True`
- `parse(self, value) -> object`：`return datetime.strptime(value, "%Y-%m-%d %H:%M:%S")` —— 返回一个 **`datetime` 对象**（完整日期时间，**不要**像 `DateType` 那样调 `.date()` 截成 `date`）。

### 2. `workspace/registry.py` — 注册新类型

- 把 `DateTimeType` 加进 `from data_types import ...` 那一行。
- 在 `TYPE_REGISTRY` 字典里加一项：`"datetime": DateTimeType,`（照搬 `"date": DateType` 的写法）。

### 约束（务必遵守）

- 只改 `workspace/` 内的两个文件（`workspace/data_types.py` 和 `workspace/registry.py`）。
- 不碰 `seed/`、`verify.py`、`task.md`、`SOLUTION.md`。
- 不碰 `workspace/` 以外的任何文件（即不要改主仓库代码）。

### 提示

- 拿 `DateType` 当模板**整体照抄**，只改 4 处：类名、`name`、`_PATTERN`、`strptime` 格式串。
- **关键决策点 1**：`parse` 返回的是完整 **`datetime` 对象**（直接 `return datetime.strptime(...)`），**不要**像 `DateType` 那样追加 `.date()`。`.date()` 会把时间信息砍掉，只剩 `date`，这是本题最常见的错。
- **关键决策点 2**：strptime 格式串里日期和时间之间是**空格** `"%Y-%m-%d %H:%M:%S"`，不是 ISO 的 `T`（即**不要**写成 `"%Y-%m-%dT%H:%M:%S"`）。对应的正则里日期和时间之间也是 `\s`。
- **跨文件**：光在 `data_types.py` 里写出 `DateTimeType` 类还不够，必须在 `registry.py` 里同时加 import 和 `TYPE_REGISTRY` 条目，`build_type_from_config("datetime")` 才能返回实例。漏了任一处，verify 的注册检查会失败。

### 验证

在本题目录下运行：

```bash
python verify.py
```

退出码 0 = PASS，非 0 = FAIL。共 9 项检查（类存在 + 注册 + 4 项 validate 行为 + parse 类型 + name 属性 + 注册表完整性）详见 verify 输出。verify 会真实 import 你的代码并调用 `validate` / `parse`，所以行为必须正确（不能靠静态伪装通过）。

完成后按 [challenges/README.md](../README.md) 填 `workspace/RESULT.md`。
