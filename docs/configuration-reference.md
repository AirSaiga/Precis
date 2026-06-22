# Precis 配置参考（V2 YAML 格式）

> **版本**：Pre-Alpha | **最后更新**：2026-06-22

---

## 目录

- [概述](#概述)
- [项目清单](#项目清单projectprecisyaml)
- [Schema 文件](#schema-文件schemasschemayaml)
- [Constraint 文件](#constraint-文件constraintsconstraintyaml)
- [Transform 文件](#transform-file)
- [Regex 文件](#regex-文件regexregexyaml)
- [Template 文件](#template-file)
- [Pattern 文件](#pattern-文件patternsyaml)
- [数据源配置](#数据源配置)
- [Settings 配置](#settings-配置)

---

## 概述

Precis 使用 V2 YAML 格式管理项目配置。项目根目录下的 `project.precis.yaml` 是入口文件，引用各类子配置文件。

**文件命名约定**：

| 文件类型 | 命名模式 | 存放目录 |
|---------|---------|---------|
| 项目清单 | `project.precis.yaml` | 项目根目录 |
| Schema | `*.schema.yaml` | `schemas/` |
| Constraint | `*.constraint.yaml` | `constraints/` |
| Transform | `*.transform.yaml` | `transforms/` |
| Regex | `*.regex.yaml` | `regex/` |
| Template | `*.template.yaml` | `templates/` |
| Pattern | `*.yaml` | `patterns/` |
| 数据文件 | CSV / Excel / JSON | `data/` |

---

## 项目清单（`project.precis.yaml`）

项目入口文件，定义项目元信息、设置和所有子资源引用。

### 完整结构

```yaml
version: 2                    # 固定值
project:
  id: my_project              # 项目唯一标识符
  name: 我的项目               # 项目显示名称

settings:                     # 可选，详见 Settings 章节
  validation: { ... }
  file_processing: { ... }
  script_security: { ... }

schemas:                      # Schema 引用列表
  - id: users
    path: schemas/users.schema.yaml

constraints:                  # 独立约束引用列表
  - id: orders_fk
    path: constraints/orders_fk.constraint.yaml

transforms:                   # Transform 引用列表
  - id: my_transform
    path: transforms/my_transform.transform.yaml

regex_nodes:                  # Regex 节点引用列表
  - id: email_regex
    path: regex/email_regex.regex.yaml

templates:                    # 模板定义引用列表
  - id: age_check
    path: templates/age_check.template.yaml

template_instances:           # 模板实例列表
  - id: instance_001
    template_id: age_check    # 引用的模板 ID
    enabled: true
    params:                   # 模板参数
      source_column: age
      min_age: 18
      max_age: 100
    input_from_node: users    # 上游数据流节点

data_sources:                 # 数据源目录列表
  - id: primary
    path: data                # 相对路径
    mode: relative
    description: 主数据目录

patterns_dir: patterns        # Pattern 目录（相对路径）
warnings: []                  # 加载警告（自动填充）
```

### 引用类型

所有资源引用共享相同结构：`id` + `path`。

| 引用类型 | 对应文件 |
|---------|---------|
| `schemas` | `*.schema.yaml` |
| `constraints` | `*.constraint.yaml` |
| `transforms` | `*.transform.yaml` |
| `regex_nodes` | `*.regex.yaml` |
| `templates` | `*.template.yaml` |

**ID 规则**：
- Schema ID：`sc_` 前缀 + Base64URL 编码（由文件路径 + sheet 名派生），或自定义
- Constraint / Regex / Transform / Template ID：直接使用节点 ID（UUID 或自定义）
- 所有 ID 在项目内必须唯一（系统自动去重校验）

---

## Schema 文件（`schemas/*.schema.yaml`）

定义表结构：列定义、数据源、内嵌约束。

### 完整结构

```yaml
version: 2
id: users                     # Schema 唯一 ID
name: users                   # 显示名称
description: 用户表            # 可选描述

source:                       # 数据源配置
  mode: relative_file         # relative_file | absolute_file
  path: data/users.csv        # 文件路径
  sheet: Sheet1               # 可选，Excel 工作表名
  header_row: 0               # 可选，表头行索引（默认 0）
  options:                    # 可选，格式特定配置
    encoding: utf-8           # CSV: 编码
    delimiter: ","            # CSV: 分隔符

columns:                      # 列定义列表
  - id: id                    # 列 ID（可选，缺省时从 name 生成）
    name: id                  # 列名（必填）
    type: integer             # 数据类型
    primary_key: true         # 是否主键（默认 false）
    nullable: false           # 是否可空（默认 true）

  - name: name
    type: string

  - name: email
    type: string
    nullable: false

  - name: age
    type: integer

  - name: birth_date
    type: date

  - name: salary
    type: decimal

  - name: is_active
    type: boolean

constraints:                  # 内嵌约束列表（可选）
  - id: email_unique
    type: Unique
    column: email

  - id: email_not_null
    type: NotNull
    column: email

  - id: age_range
    type: Range
    column: age
    params:
      min: 0
      max: 150
      boundary_mode: inclusive
```

### 数据类型

| 类型 | 说明 | 示例 |
|------|------|------|
| `string` | 文本 | `"hello"` |
| `integer` | 整数 | `42` |
| `float` | 浮点数 | `3.14` |
| `decimal` | 高精度小数 | `19.99` |
| `boolean` | 布尔值 | `true` / `false` |
| `date` | 日期 | `2024-01-15` |

### Source 配置

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `mode` | `relative_file` \| `absolute_file` | 必填 | 路径模式 |
| `path` | string | 必填 | 文件路径 |
| `sheet` | string | `null` | Excel 工作表名 |
| `header_row` | int | `0` | 表头行索引 |
| `options` | object | `null` | 格式特定选项 |

#### CSV Options

```yaml
options:
  encoding: utf-8       # 文件编码
  delimiter: ","        # 字段分隔符
```

#### JSON Options

```yaml
options:
  record_path: data     # JSON 数组路径
  flatten: true         # 展平嵌套对象
```

### 派生列（Extracted Column）

通过正则从已有列提取子串生成新列：

```yaml
columns:
  - name: email_domain
    type:
      name: Extracted
      source_column: email
      extract_key: domain     # 正则命名捕获组
      result_type: string
```

### JSON Schema 支持

JSON 数据源支持嵌套列定义：

```yaml
columns:
  - name: user
    type: string
    json_path: $.user.name    # JSONPath 映射
    children:                  # 嵌套子列
      - name: name
        type: string
      - name: email
        type: string
```

---

## Constraint 文件（`constraints/*.constraint.yaml`）

独立约束文件，适用于跨 Schema 引用或复杂约束。

### 通用字段

```yaml
version: 2
id: my_constraint           # 约束唯一 ID
type: NotNull               # 约束类型（见下方 10 种类型）
enabled: true               # 是否启用
description: 描述            # 可选
refs:                       # 引用区域
  table_id: users
  column_id: email
params: { }                 # 约束参数（因类型而异）
input_from_node: users      # 上游数据流节点（可选）
```

### 10 种约束类型详解

#### 1. NotNull — 非空校验

```yaml
type: NotNull
refs:
  table_id: users
  column_id: email
```

校验列值不为 `null`、`NaN` 或空字符串。

#### 2. Unique — 唯一校验

```yaml
type: Unique
refs:
  table_id: users
  column_id: email          # 单列唯一

# 或复合唯一
type: Unique
refs:
  table_id: orders
  columns:                  # 多列组合唯一
    - customer_id
    - product_id
```

#### 3. ForeignKey — 外键引用

```yaml
type: ForeignKey
refs:
  from_table_id: orders       # 子表
  from_column_id: customer_id # 子表 FK 列
  to_table_id: customers      # 父表
  to_column_id: id            # 父表引用列
```

自动处理值规范化（去空格、`"123.0"` → `"123"`、布尔转换）。空值跳过。

#### 4. AllowedValues — 允许值列表

```yaml
type: AllowedValues
refs:
  table_id: users
  column_id: status
params:
  allowed_values:
    - active
    - inactive
    - pending
```

#### 5. Range — 范围校验

```yaml
type: Range
refs:
  table_id: orders
  column_id: quantity
params:
  min: 1                      # 最小值（可选，null = 无下限）
  max: 1000                   # 最大值（可选，null = 无上限）
  boundary_mode: inclusive     # inclusive（闭区间）| exclusive（开区间）
```

#### 6. Conditional — 条件校验

**简单模式**（单条件触发）：

```yaml
type: Conditional
refs:
  table_id: users
params:
  if_column: status           # 触发列
  if_value: active            # 触发值
  then_column: email          # 校验列
  then_condition: not_null    # 校验规则
```

**复合模式**（多条件组合）：

```yaml
type: Conditional
refs:
  table_id: users
params:
  if_conditions:
    - {column: status, op: eq, value: active}
    - {column: age, op: gte, value: 18}
  if_logic: and               # and | or
  then_column: email
  then_condition: not_null
```

**then_condition DSL 操作符**：`not_null`、`greater_than`、`less_than`、`in`、`eq`、`neq`

支持 `ref_column` 进行列间比较：

```yaml
then_condition:
  op: greater_than
  ref_column: min_price       # 与另一列比较
```

#### 7. Scripted — 自定义脚本

```yaml
type: Scripted
refs:
  table_id: users
  column_id: age
params:
  name: 年龄必须为正整数
  expression: "isinstance(value, int) and value > 0"
```

**表达式上下文变量**：
- `value` — 当前单元格值
- `row` — 当前行字典
- `re_match(pattern, string)` — 正则匹配
- 内置函数：`len`、`sum`、`max`、`min`、`round`、`abs`、`int`、`str`、`float`、`bool`、`list`、`dict`、`set`

> ⚠️ **安全提示**：Scripted 约束需要在 `settings.script_security.allow_eval: true` 时才生效。表达式在沙箱中执行，但存在已知安全风险，仅在可信环境中使用。

#### 8. Charset — 字符集校验

```yaml
type: Charset
refs:
  table_id: users
  column_id: name
params:
  charset_mode: chinese_mixed   # ascii | chinese | chinese_mixed
```

| 模式 | 说明 |
|------|------|
| `ascii` | 仅 ASCII 字符 |
| `chinese` | 仅 CJK 中文字符 |
| `chinese_mixed` | CJK + ASCII 字母数字 + 常用标点 |

#### 9. DateLogic — 日期逻辑校验

**比较模式**：

```yaml
type: DateLogic
refs:
  table_id: orders
  column_id: order_date
params:
  logic_mode: compare
  compare_op: gte              # gt | gte | lt | lte | eq | range
  reference_date: "2020-01-01" # 固定参考日期
  # 或 reference_column: start_date  # 列引用
```

**范围模式**：

```yaml
params:
  logic_mode: compare
  compare_op: range
  reference_date: "2020-01-01"
  reference_date_end: "2025-12-31"
```

**计算模式 — 年龄**：

```yaml
params:
  logic_mode: calculation
  calculation_type: age
  target_value: 18             # 年龄阈值
  compare_op: gte
```

**计算模式 — 天数差**：

```yaml
params:
  logic_mode: calculation
  calculation_type: days_diff
  target_column: end_date
  target_value: 30
  compare_op: lte
```

#### 10. Composite — 组合约束

```yaml
type: Composite
refs:
  table_id: users
params:
  logic: all                   # all（全部通过）| any（至少一个通过）| none（全部失败）
  sub_constraints:
    - type: NotNull
      column: email
    - type: Range
      column: age
      params: {min: 0, max: 150}
```

### 内嵌约束 vs 独立约束

| 特性 | 内嵌约束（Schema 内） | 独立约束文件 |
|------|---------------------|-------------|
| 适用场景 | 单表简单约束 | 跨表引用、复杂约束 |
| 文件位置 | 写在 Schema YAML 的 `constraints` 字段 | `constraints/*.constraint.yaml` |
| manifest 引用 | 不需要 | 需要在 `project.precis.yaml` 中声明 |
| 支持类型 | NotNull、Unique、ForeignKey、AllowedValues、Range、Conditional、Scripted、Charset、DateLogic | 全部 10 种（含 Composite） |

---

## Transform 文件（`transforms/*.transform.yaml`）

定义数据转换操作。

### 完整结构

```yaml
version: 2
id: my_transform
type: StringSplit               # 转换类型（22 种之一）
enabled: true
description: 拆分姓名列
input_from_node: users          # 上游节点 ID
input_column: full_name         # 输入列名
output_columns:                 # 输出列名列表
  - first_name
  - last_name
params:                         # 转换参数（因类型而异）
  delimiter: " "
  maxsplit: 1
```

### 22 种转换算子详解

#### 字符串操作

| 算子 | 说明 | 参数 |
|------|------|------|
| **StringSplit** | 按分隔符拆分 | `delimiter`（默认 `" "`）、`maxsplit`（默认 `-1`） |
| **Substring** | 按位置截取 | `start`（默认 `0`）、`end`（可选）、`length`（可选，优先于 end） |
| **UpperCase** | 转大写 | 无参数 |
| **LowerCase** | 转小写 | 无参数 |
| **Strip** | 去除空白 | `chars`（可选，默认去除所有空白） |
| **Replace** | 替换子串 | `old`、`new`、`count`（默认 `-1`，全部替换） |
| **Concat** | 拼接多列 | `columns`（列名列表或逗号分隔字符串）、`separator`、`output_column`（可选） |

#### 正则操作

| 算子 | 说明 | 参数 |
|------|------|------|
| **RegexExtract** | 正则提取捕获组 | `pattern`（正则表达式，必须含捕获组）、`flags`（`"i"` 不区分大小写） |

#### 数值操作

| 算子 | 说明 | 参数 |
|------|------|------|
| **MathExpr** | 数学表达式 | `expression`（如 `"@col_a + @col_b * 2"`）、`output_type`（可选：`"int"`/`"float"`） |
| **Modulo** | 取模 | `divisor`（不能为 0） |
| **WeightedSum** | 加权求和 | `weights`（权重数组） |
| **Digits** | 字符拆分为数字 | 无参数（如 `"110101"` → `"1,1,0,1,0,1"`） |

#### 日期操作

| 算子 | 说明 | 参数 |
|------|------|------|
| **DateFormat** | 日期格式转换 | `input_format`（默认 `"%Y-%m-%d"`）、`output_format`（默认 `"%Y/%m/%d"`）、`errors`（`"coerce"`/`"raise"`/`"ignore"`） |

#### 类型操作

| 算子 | 说明 | 参数 |
|------|------|------|
| **CastType** | 类型转换 | `target_type`（`"int"`/`"float"`/`"bool"`/`"datetime"`/`"string"`） |
| **FillNA** | 填充空值 | `strategy`（`"value"`/`"ffill"`/`"bfill"`/`"mean"`/`"median"`）、`value`（strategy 为 value 时使用） |

#### 映射操作

| 算子 | 说明 | 参数 |
|------|------|------|
| **Lookup** | 字典映射 | `mapping`（`{old: new}` 字典）、`default`（未匹配时的默认值） |
| **MapValue** | 索引映射 | `mapping`（数组，按索引取值） |
| **ConditionalAssign** | 条件赋值 | `conditions`（条件列表）、`logic`（`"and"`/`"or"`）、`then_value`、`else_value` |

**条件操作符**（ConditionalAssign / FilterRows 共用）：`eq`、`ne`、`gt`、`gte`、`lt`、`lte`、`contains`、`startswith`、`endswith`、`in`、`not_in`、`is_null`、`is_not_null`

#### 行操作

| 算子 | 说明 | 参数 |
|------|------|------|
| **FilterRows** | 按条件过滤行 | `conditions`、`logic` |
| **DropDuplicates** | 去重 | `subset`（可选，检查的列）、`keep`（`"first"`/`"last"`/`"false"`） |
| **SortRows** | 排序 | `sort_by`（`[{column, order}]`，order 为 `"asc"`/`"desc"`） |
| **Aggregate** | 聚合 | `aggregations`（`[{column, func}]`，func 为 `"count"`/`"sum"`/`"avg"`/`"min"`/`"max"`）、`group_by`（可选） |

---

## Regex 文件（`regex/*.regex.yaml`）

正则节点定义，用于列值匹配或提取。

### 完整结构

```yaml
version: 2
id: email_regex
name: 邮箱格式校验
description: 校验邮箱地址格式
enabled: true

# 模式一：直接定义正则
pattern: '^(?P<local>[^@]+)@(?P<domain>[^@]+)$'
match_mode: extract            # full | partial | extract
case_sensitive: false
flags: ""                      # i=IGNORECASE, m=MULTILINE, s=DOTALL

# 数据流
input_from_node: users         # 上游节点
input_column: email            # 输入列
output_columns:                # extract 模式的输出列
  - local
  - domain
source_ref:                    # 引用（旧版兼容）
  table_id: users
  column_id: email
```

### Pattern 引用模式

引用 `patterns/` 目录中已注册的模式：

```yaml
version: 2
id: semver_check
name: 语义版本校验
uses_pattern:
  registry: patterns
  pattern_name: semver
  as_alias: version_check      # 可选别名
match_mode: extract
input_from_node: releases
input_column: version
output_columns: [major, minor, patch]
```

### Match Mode 说明

| 模式 | 说明 |
|------|------|
| `full` | `fullmatch` — 整个字符串必须匹配 |
| `partial` | `search` — 字符串中包含匹配即可 |
| `extract` | 提取命名捕获组到 `output_columns` |

---

## Template 文件（`templates/*.template.yaml`）

可复用的约束/转换组合模板，支持参数化。

### 完整结构

```yaml
version: 2
id: age_check
name: 年龄检查模板
description: 校验年龄列是否落在指定范围内

parameters:                    # 参数声明
  - {name: source_column, default: age}
  - {name: min_age, default: 0}
  - {name: max_age, default: 150}
  - {name: input_from_node, default: ""}

nodes:                         # 模板内部 DAG 节点
  - id: md_input               # 占位数据节点
    kind: manualData
    type: ManualData
    column_name: "{{source_column}}"
    column_data_type: integer
    rows:
      - ["25"]
      - ["40"]
    enabled: true

  - id: check_age              # 约束节点
    kind: constraint
    type: Range
    input_from_node: "{{input_from_node}}"
    refs:
      table_id: "{{input_from_node}}"
      column_id: "{{source_column}}"
    params:
      min: "{{min_age}}"
      max: "{{max_age}}"
      boundary_mode: inclusive
    enabled: true
```

### 参数占位符

使用 `{{param_name}}` 语法引用 `parameters` 中声明的参数。实例化时传入具体值替换。

### 节点类型（kind）

| kind | 说明 |
|------|------|
| `constraint` | 约束节点，`type` 为 10 种约束类型之一 |
| `transform` | 转换节点，`type` 为 22 种算子之一 |
| `regex` | 正则节点 |
| `manualData` | 手动数据节点（占位输入） |

### 模板实例化

在 `project.precis.yaml` 中声明实例：

```yaml
template_instances:
  - id: age_check_instance_1
    template_id: age_check
    enabled: true
    params:
      source_column: age
      min_age: 18
      max_age: 100
    input_from_node: users      # 绑定到实际的 Schema 节点
```

---

## Pattern 文件（`patterns/*.yaml`）

可复用的正则模式定义，供 Regex 节点引用。

```yaml
name: semver
regex: '^v(?P<major>\d+)\.(?P<minor>\d+)\.(?P<patch>\d+)$'
output:
  type: semver
  major: "{major:int}"
  minor: "{minor:int}"
  patch: "{patch:int}"
```

---

## 数据源配置

在 `project.precis.yaml` 的 `data_sources` 中定义：

```yaml
data_sources:
  - id: primary
    path: data                  # 数据目录路径
    mode: relative              # relative | absolute
    description: 主数据目录
```

Schema 的 `source` 字段引用数据文件：

```yaml
source:
  mode: relative_file          # relative_file | absolute_file
  path: data/users.csv
```

---

## Settings 配置

`project.precis.yaml` 的 `settings` 字段控制项目行为。

### validation — 校验设置

```yaml
settings:
  validation:
    auto_validate: true         # 连线/配置变更后自动校验
    strict_mode: false          # 严格模式：任何错误即校验失败
    error_handling: continue    # stop | continue | report
    timeout_seconds: 30         # 校验超时（1-300 秒）
    batch_max_files: 100        # 批量校验最大文件数（1-1000）
```

### file_processing — 文件处理设置

```yaml
settings:
  file_processing:
    default_encoding: utf-8     # utf-8 | gbk | auto
    csv_delimiter: ","          # CSV 分隔符
```

### script_security — 脚本安全设置

```yaml
settings:
  script_security:
    allow_eval: false           # 允许 Scripted 约束执行
    allow_exec: false           # 允许 exec()
    sandbox_mode: true          # 沙箱模式
    timeout_seconds: 10         # 脚本超时（1-60 秒）
```

> ⚠️ **安全警告**：`allow_eval: true` 会启用 Scripted 约束的表达式执行。当前沙箱基于 `simpleeval`，存在已知绕过风险。仅在可信环境中启用。

---

## 完整示例

参见 `qa_test/qa_v3_complex/` 目录，包含：
- 10 个 Schema 文件（覆盖 CSV/Excel 数据源）
- 1 个独立约束文件（ForeignKey）
- 17 个 Regex 节点
- 2 个 Template 定义 + 2 个 Template 实例
- 1 个 Pattern 文件
- 完整的 `project.precis.yaml` 清单
