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

workspace 是 Precis 数据类型体系的精简副本：

- `workspace/data_types.py` — `DataType` 基类 + 已有的 `IntegerType`、`DateType`。
- `workspace/registry.py` — `TYPE_REGISTRY` 字典 + `build_type_from_config(type_name)` 工厂入口（未知类型抛 `ValueError`）。

新增一个数据类型需要同时改这两个文件。先读这两个文件，理解现有 `DateType` 是怎么写、怎么注册的。

## 任务

新增一个 `DateTimeType`，校验/解析完整的日期时间（日期 + 时间）。

- **类名**：`DateTimeType`
- **文件**：`workspace/data_types.py`（新增类）
- **注册**：在 `workspace/registry.py` 的 `TYPE_REGISTRY` 里注册到类型名 `"datetime"`，使 `build_type_from_config("datetime")` 能返回实例

其余设计（具体格式、`validate` 校验逻辑、`parse` 返回什么类型对象、边缘情况）**自行决定**——参照现有 `DateType` 的写法自己推断。verify 只测行为，不查正则或格式串。

## 约束

- 只改 `workspace/` 内的两个文件。
- 不碰 `seed/`、`verify.py`、`task.md`、`SOLUTION.md`。
- 不碰 `workspace/` 以外的任何文件。

## 验证

```bash
python verify.py
```

退出码 0 = PASS，非 0 = FAIL。verify 会真实 import 你的代码并调用 `validate` / `parse`，包含一些不那么明显的边缘情况。

完成后按 [challenges/README.md](../README.md) 填 `workspace/RESULT.md`。
