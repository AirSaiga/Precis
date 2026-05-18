---
name: "precis-config"
description: "Precis V2 项目配置规范。适用于 project.precis.yaml、*.schema.yaml、*.constraint.yaml、*.regex.yaml 及 patterns/*.yaml 的编写与维护。"
scope: ["**/*.precis.yaml", "**/*.schema.yaml", "**/*.constraint.yaml", "**/*.regex.yaml", "patterns/*.yaml"]
---

# Precis V2 配置规范

## 适用范围

- 项目清单文件 `project.precis.yaml`
- 表结构文件 `*.schema.yaml`
- 约束文件 `*.constraint.yaml`
- 正则节点文件 `*.regex.yaml`
- 表达式模式文件 `patterns/*.yaml`

## 项目清单文件 (project.precis.yaml)

### 标准结构

```yaml
# ============================================================
# Precis 项目清单文件
# ============================================================

version: 2

project:
  id: my-data-project           # 项目唯一标识符（必填）
  name: My Data Project         # 项目展示名称（必填）

settings:
  validation:                   # 校验行为设置
    auto_validate: true         # 配置变更时自动执行校验
    strict_mode: false          # 非严格模式
    error_handling: continue    # 错误处理策略：continue/report/stop
    timeout_seconds: 30         # 单次校验超时时间（秒）
    batch_max_files: 100        # 批量校验最大文件数
  file_processing:              # 文件处理设置
    default_encoding: utf-8     # 默认文件编码
    csv_delimiter: ","          # CSV 分隔符
    null_value_strategy: null   # 空值处理策略
    date_format: "%Y-%m-%d"     # 日期格式
  script_security:              # 脚本安全设置
    allow_eval: false           # 禁止 eval() 函数
    allow_exec: false           # 禁止 exec() 函数
    sandbox_mode: true          # 启用沙箱模式
    timeout_seconds: 10         # 脚本执行超时时间（秒）

schemas:
  - id: users                   # 表 ID（必填，必须唯一）
    path: schemas/users.schema.yaml   # 相对路径（必填）

constraints:
  - id: unique_user_email
    path: constraints/unique_user_email.constraint.yaml

regex_nodes:
  - id: phone_number
    path: regex_nodes/phone_number.regex.yaml

patterns_dir: patterns
```

### 字段规范

| 字段 | 类型 | 必填 | 说明 |
|-----|------|-----|------|
| `version` | int | 是 | 配置版本号，固定为 2 |
| `project.id` | string | 是 | 项目唯一标识符，建议使用小写+下划线 |
| `project.name` | string | 是 | 项目展示名称 |
| `schemas[].id` | string | 是 | Schema ID，必须唯一 |
| `schemas[].path` | string | 是 | 相对于 manifest 的路径 |
| `constraints[].id` | string | 是 | Constraint ID，必须唯一 |
| `regex_nodes[].id` | string | 是 | Regex ID，必须唯一 |

## 表结构文件 (*.schema.yaml)

```yaml
# ============================================================
# 表结构配置文件
# ============================================================

version: 2

id: users

name: users

source:
  mode: relative_file
  path: data/users.xlsx
  sheet: Sheet1
  header_row: 0

columns:
  - id: user_id
    name: user_id
    type: string
    primary_key: true
    nullable: false
  - id: email
    name: email
    type: string
    nullable: true
  - id: age
    name: age
    type: integer
    nullable: true

constraints: []
script_checks: []
```

### 数据类型规范

| 类型 | 说明 |
|-----|------|
| `string` | 字符串 |
| `integer` | 整数 |
| `decimal` | 小数 |
| `boolean` | 布尔值 |
| `datetime` | 日期时间 |
| `date` | 日期 |
| `time` | 时间 |

## 约束文件通用结构

所有约束文件采用 **refs（引用区）+ params（参数区）** 分离设计：

```yaml
version: 2

id: constraint_id           # 约束唯一标识
type: ConstraintType        # 约束类型
enabled: true               # 是否启用
description: "约束描述"     # 描述信息

refs:
  table_id: table_name
  column_ids: [col1, col2]

params:
  # 根据约束类型变化的参数
```

### 约束类型规范

#### Unique（唯一性约束）

```yaml
version: 2
id: unique_user_email
type: Unique
enabled: true
description: "用户邮箱必须唯一"

refs:
  table_id: users
  column_ids: [email]

params: {}
```

#### NotNull（非空约束）

```yaml
version: 2
id: email_notnull
type: NotNull
enabled: true
description: "邮箱不能为空"

refs:
  table_id: users
  column_id: email

params: {}
```

#### AllowedValues（允许值约束）

```yaml
version: 2
id: gender_allowed
type: AllowedValues
enabled: true
description: "性别只能是男、女、未知"

refs:
  table_id: users
  column_id: gender

params:
  allowed_values: [男, 女, 未知]
```

#### ForeignKey（外键约束）

```yaml
version: 2
id: fk_order_user
type: ForeignKey
enabled: true
description: "订单必须关联有效用户"

refs:
  from_table_id: orders
  from_column_id: user_id
  to_table_id: users
  to_column_id: user_id

params: {}
```

#### Conditional（条件约束）

```yaml
version: 2
id: adult_status
type: Conditional
enabled: true
description: "年龄大于18岁则标记为成人"

refs:
  table_id: users
  then_column_id: status
  if_conditions:
    - if_column_id: age
      operator: ">"          # 支持: eq, ne, >, >=, <, <=, in, not_in
      value: 18
  if_logic: and              # 多条件逻辑: and/or

params:
  then_value: "成人"
```

#### Scripted（脚本约束）

```yaml
version: 2
id: valid_email
type: Scripted
enabled: true
description: "验证邮箱格式"

refs:
  table_id: users
  column_id: email

params:
  expression: "validate_email(value)"
```

#### Range（区间约束）

```yaml
version: 2
id: price_range
type: Range
enabled: true
description: "商品价格必须在0-10000之间"

refs:
  table_id: products
  column_id: price

params:
  min: 0
  max: 10000
```

## 正则节点文件 (*.regex.yaml)

### 引用模式（推荐）

```yaml
version: 2

id: phone_number
name: 手机号校验
description: "校验中国大陆手机号格式"

uses_pattern:
  registry: patterns
  pattern_name: phone_cn

pattern_overrides:
  flags: "i"

match_mode: full            # full/partial/extract
case_sensitive: false
enabled: true

source_ref:
  table_id: users
  column_id: phone
```

### 直接模式

```yaml
version: 2

id: email_direct
name: 邮箱校验
description: "校验邮箱格式"

pattern: "^[\\w\\.-]+@[\\w\\.-]+\\.\\w+$"

match_mode: full
enabled: true

source_ref:
  table_id: users
  column_id: email
```

## 表达式模式文件 (patterns/*.yaml)

```yaml
name: phone_cn

regex: "^1[3-9]\\d{9}$"

description: "中国大陆手机号格式校验"

output:
  type: boolean
  message: "手机号格式不正确"
```

## 文件命名规范

| 文件类型 | 命名规范 | 示例 |
|---------|---------|------|
| 项目清单 | `project.precis.yaml` | project.precis.yaml |
| Schema | `*.schema.yaml` | users.schema.yaml |
| Constraint | `*.constraint.yaml` | unique_email.constraint.yaml |
| Regex 节点 | `*.regex.yaml` | phone.regex.yaml |
| Pattern | `*.yaml` (在 patterns/ 目录) | phone_cn.yaml |
