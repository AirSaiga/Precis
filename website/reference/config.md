# 配置参考

Precis 使用 V2 YAML 格式管理项目配置：项目根目录的 `project.precis.yaml` 是入口文件，引用各类子配置文件。

> 本页为常用配置精简参考。完整字段与全部算子参数见仓库 [`docs/configuration-reference.md`](https://github.com/AirSaiga/Precis/blob/main/docs/configuration-reference.md)。

## 文件命名约定

| 文件类型 | 命名模式 | 存放目录 |
| -------- | -------- | -------- |
| 项目清单 | `project.precis.yaml` | 项目根目录 |
| Schema | `*.schema.yaml` | `schemas/` |
| Constraint | `*.constraint.yaml` | `constraints/` |
| Transform | `*.transform.yaml` | `transforms/` |
| Regex | `*.regex.yaml` | `regex/` |
| Template | `*.template.yaml` | `templates/` |
| Pattern | `*.yaml` | `patterns/` |
| 数据文件 | CSV / Excel / JSON | `data/` |

## 项目清单（project.precis.yaml）

```yaml
version: 2                    # 固定值
project:
  id: my_project              # 项目唯一标识符
  name: 我的项目               # 项目显示名称

settings:                     # 可选，见下文 Settings 章节
  validation: { ... }

schemas:                      # Schema 引用列表
  - id: users
    path: schemas/users.schema.yaml

constraints:                  # 独立约束引用列表
  - id: orders_fk
    path: constraints/orders_fk.constraint.yaml

transforms: []                # Transform 引用列表
regex_nodes: []               # Regex 节点引用列表
templates: []                 # 模板定义引用列表
template_instances: []        # 模板实例列表

data_sources:                 # 数据源目录列表
  - id: primary
    path: data                # 相对路径
    mode: relative
```

所有资源引用共享 `id` + `path` 结构，ID 在项目内必须唯一。

## Schema 文件（schemas/*.schema.yaml）

定义表结构：列定义、数据源、内嵌约束。

```yaml
version: 2
id: users
name: 用户表

source:                       # 数据源配置
  mode: relative_file         # relative_file | absolute_file
  path: data/users.csv
  # sheet: Sheet1             # 可选，Excel 工作表名
  # options:                  # 可选，CSV: encoding / delimiter
  #   encoding: utf-8
  #   delimiter: ","

columns:
  - name: id
    type: integer
    primary_key: true
    nullable: false
  - name: email
    type: string
    nullable: false
  - name: age
    type: integer

constraints:                  # 内嵌约束（可选）
  - id: email_unique
    type: Unique
    column: email
```

### 数据类型

| 类型 | 说明 | 示例 |
| ---- | ---- | ---- |
| `string` | 文本 | `"hello"` |
| `integer` | 整数 | `42` |
| `float` | 浮点数 | `3.14` |
| `decimal` | 高精度小数 | `19.99` |
| `boolean` | 布尔值 | `true` / `false` |
| `date` | 日期 | `2024-01-15` |

## 约束

共 10 种约束类型，可**内嵌**在 Schema 中，也可作为**独立文件**（`constraints/*.constraint.yaml`）跨表引用：

| 类型 | 说明 |
| ---- | ---- |
| `NotNull` | 列值不允许为空 |
| `Unique` | 列值唯一，支持多列复合唯一 |
| `ForeignKey` | 外键引用完整性（跨表） |
| `AllowedValues` | 值必须在允许列表内 |
| `Range` | 数值范围校验 |
| `Conditional` | 条件触发校验（若 A 列满足条件，则 B 列必须满足另一条件） |
| `Scripted` | 自定义 Python 表达式校验 |
| `Charset` | 字符集校验（`ascii` / `chinese` / `chinese_mixed`） |
| `DateLogic` | 日期逻辑（比较、年龄计算、天数差） |
| `Composite` | 多个子约束的逻辑组合（all / any / none） |

常用示例：

```yaml
# 范围校验（内嵌写法）
- id: age_range
  type: Range
  column: age
  params: { min: 0, max: 150, boundary_mode: inclusive }

# 允许值列表
- id: status_allowed
  type: AllowedValues
  column: status
  params:
    allowed_values: [active, inactive, pending]
```

```yaml
# 外键（独立文件 constraints/orders_fk.constraint.yaml）
version: 2
id: orders_fk
type: ForeignKey
enabled: true
refs:
  from_table_id: orders       # 子表
  from_column_id: customer_id # 子表 FK 列
  to_table_id: customers      # 父表
  to_column_id: id            # 父表引用列
```

| 特性 | 内嵌约束 | 独立约束文件 |
| ---- | -------- | ------------ |
| 适用场景 | 单表简单约束 | 跨表引用、复杂约束 |
| manifest 引用 | 不需要 | 需在 `project.precis.yaml` 声明 |
| 支持类型 | 除 Composite 外 9 种 | 全部 10 种 |

## Transform（转换）

对数据列做转换处理，共 22 种算子，串联成 DAG 按拓扑顺序执行：

```yaml
version: 2
id: split_name
type: StringSplit
enabled: true
input_from_node: users        # 上游节点 ID
input_column: full_name
output_columns: [first_name, last_name]
params:
  delimiter: " "
  maxsplit: 1
```

| 分类 | 算子 |
| ---- | ---- |
| 字符串 | StringSplit、Substring、UpperCase、LowerCase、Strip、Replace、Concat |
| 正则 | RegexExtract |
| 数值 | MathExpr、Modulo、WeightedSum、Digits |
| 日期 | DateFormat |
| 类型 | CastType、FillNA |
| 映射 | Lookup、MapValue、ConditionalAssign |
| 行操作 | FilterRows、DropDuplicates、SortRows、Aggregate |

各算子参数详见仓库完整文档。

## Regex 与 Template

**Regex 节点**（`regex/*.regex.yaml`）对列值执行正则匹配或提取，`match_mode` 支持三种：`full`（全文匹配）、`partial`（部分匹配）、`extract`（提取命名捕获组到输出列）。也可通过 `uses_pattern` 引用 `patterns/` 目录中注册的复用模式。

**Template**（`templates/*.template.yaml`）是参数化的约束 / 转换组合：`parameters` 声明参数，节点字段用 `{{param}}` 占位，在 `project.precis.yaml` 的 `template_instances` 中传入具体值实例化、绑定到实际 Schema 节点。

## Settings

`project.precis.yaml` 的 `settings` 字段控制项目行为：

```yaml
settings:
  validation:
    auto_validate: true       # 连线/配置变更后自动校验
    strict_mode: false        # 严格模式：任何错误即校验失败
    error_handling: continue  # stop | continue | report
    timeout_seconds: 30       # 校验超时（1-300 秒）

  file_processing:
    default_encoding: utf-8   # utf-8 | gbk | auto
    csv_delimiter: ","        # CSV 分隔符

  script_security:
    allow_eval: false         # 允许 Scripted 约束执行表达式
    sandbox_mode: true        # 沙箱模式
    timeout_seconds: 10       # 脚本超时（1-60 秒）
```

> [!WARNING]
> `allow_eval: true` 会启用 Scripted 约束的表达式执行，沙箱存在已知绕过风险，仅在可信环境中启用。

## 完整示例

仓库中的 [`qa_test/qa_simple/`](https://github.com/AirSaiga/Precis/tree/main/qa_test/qa_simple) 是一个覆盖 CSV / Excel / JSON 数据源、全部 10 种约束、Regex 与 Template 的完整示例工程，可作为配置模板参考。
