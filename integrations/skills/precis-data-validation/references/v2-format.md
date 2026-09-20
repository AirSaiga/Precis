# Precis V2 配置格式速查（MVP 子集）

> 供 agent 编写配置使用。只覆盖数据校验最小所需子集；完整规范以后端
> `backend/app/shared/` 的类型定义为准（`ConstraintFile`、`TableSchemaFile` 等）。
> 格式处于 Alpha 阶段，可能调整。

## 目录结构与 ID 规则

```
<项目目录>/
├── project.precis.yaml           # 项目清单（入口）
├── schemas/<表名>.schema.yaml     # 每张表一个
├── constraints/<任意名>.constraint.yaml  # 每条约束一个
└── <数据文件>                     # CSV / JSON / Excel 等
```

- 所有实体的 `id`（manifest 条目、schema、constraint）使用 **UUID v4**，
  且 manifest 引用 ID 与文件内部 `id` 必须一致。
- **禁止**使用旧的 `sc_` 前缀编码 ID。
- schema 与 constraint 文件的 `id` 也可以用可读的语义 ID（如 `orders_amount_range`），
  两种都合法；UUID v4 是无冲突的默认选择。

## project.precis.yaml 最小骨架

```yaml
version: 2
project:
  id: <uuid-v4>        # 项目标识
  name: 我的数据校验项目
schemas:
  - id: <schema 文件内的 id>
    path: schemas/orders.schema.yaml
constraints:
  - id: <constraint 文件内的 id>
    path: constraints/orders_amount_range.constraint.yaml
# 可选：数据源目录（schema 未写 source.path 时按此目录解析）
data_sources:
  - id: primary
    path: .
    mode: relative
```

可选 `settings`（按需添加）：

```yaml
settings:
  validation:
    timeout_seconds: 30     # 校验超时（秒）
    error_handling: continue  # continue=跑完全部；stop=发现首个错误即停
  script_security:
    allow_eval: false       # Scripted 约束需要表达式求值时设 true
    sandbox_mode: true
```

## schema 文件（schemas/*.schema.yaml）

```yaml
version: 2
id: orders                      # 与 manifest schemas[].id 一致
name: orders                    # 表显示名
source:
  mode: relative_file           # 相对 manifest 所在目录
  path: ../data/orders.csv      # 数据文件相对路径
columns:
  - id: order_id                # 列 ID
    name: order_id              # 列名（须与数据文件列头一致）
    type: string                # 数据类型，见下
    primary_key: true           # 可选
    nullable: false             # 可选（信息性声明，真正的非空校验用 NotNull 约束）
  - id: amount
    name: amount
    type: integer
```

**6 种数据类型**：`string` / `integer` / `float` / `decimal` / `boolean` / `date`

- 类型校验在格式解析阶段执行：列头与 `name` 不匹配、值无法按类型解析都会报错。
- Excel/JSON 同样支持；JSON 数组-of-对象、Excel 需在 source 指定 `sheet`。

## 约束文件（constraints/*.constraint.yaml）

通用骨架：`version: 2` + `id` + `type` + `refs`（指向表/列）+ `params`（参数）。
`refs.table_id` / `column_id` 填 **schema 的 id / 列的 id**。

### 1. NotNull 非空

```yaml
version: 2
id: <uuid>
type: NotNull
enabled: true
description: amount 非空
refs:
  table_id: orders
  column_id: amount
params: {}
```

### 2. Unique 唯一（注意 column_id**s** 是列表）

```yaml
version: 2
id: <uuid>
type: Unique
enabled: true
description: order_id 唯一
refs:
  table_id: orders
  column_ids: [order_id]
params: {}
```

### 3. AllowedValues 枚举

```yaml
version: 2
id: <uuid>
type: AllowedValues
enabled: true
refs:
  table_id: orders
  column_id: status
params:
  allowed_values: [pending, paid, shipped, closed]
```

### 4. Range 数值区间

```yaml
version: 2
id: <uuid>
type: Range
enabled: true
refs:
  table_id: orders
  column_id: amount
params:
  min: 0
  max: 100000
  boundary_mode: inclusive   # inclusive 闭区间 / exclusive 开区间
```

### 5. ForeignKey 跨表引用

```yaml
version: 2
id: <uuid>
type: ForeignKey
enabled: true
description: orders.customer_id 引用 customers.id
refs:
  from_table_id: orders
  from_column_id: customer_id
  to_table_id: customers
  to_column_id: id
params: {}
```

### 6. Charset 字符集

```yaml
version: 2
id: <uuid>
type: Charset
enabled: true
refs:
  table_id: customers
  column_id: username
params:
  charset_mode: ascii   # ascii / chinese / chinese_mixed
```

### 7. Conditional 条件约束

```yaml
version: 2
id: <uuid>
type: Conditional
enabled: true
description: 中国用户必须填身份证号
refs:
  table_id: customers
  then_column_id: id_card
  if_conditions:
    - if_column_id: country
      operator: eq            # eq / neq / in / not_null / greater_than / less_than
      value: CN
  if_logic: and              # 多条件时 and / or
params:
  then_condition:
    operator: not_null
```

### 8. DateLogic 日期逻辑

```yaml
version: 2
id: <uuid>
type: DateLogic
enabled: true
description: 出生日期必须晚于 1900-01-01
refs:
  table_id: customers
  column_id: birth_date
params:
  logic_mode: compare
  compare_op: gt             # gt / gte / lt / lte / eq / range
  reference_date: "1900-01-01"
```

### 9. Scripted 脚本约束（需 settings.script_security.allow_eval: true）

```yaml
version: 2
id: <uuid>
type: Scripted
enabled: true
description: 手机号必须是 11 位数字且以 1 开头
refs:
  table_id: customers
  column_id: phone
params:
  name: phone_format_check
  expression: 're_match(r"^1[3-9]\d{9}$", str(value))'
```

- `expression` 逐行求值，`value` 为当前单元格值，返回真值表示通过。
- 项目未开启 `allow_eval` 时该约束会报错，MVP 场景优先用其他类型替代。

### 10. Composite 组合约束

```yaml
version: 2
id: <uuid>
type: Composite
enabled: true
description: 邮箱必须非空且唯一
refs:
  table_id: customers
params:
  logic: all                # all（全部满足）/ any（任一满足）
  sub_constraints:
    - version: 2
      id: <子约束 uuid 1>
      type: NotNull
      enabled: true
      refs: { table_id: customers, column_id: email }
      params: {}
    - version: 2
      id: <子约束 uuid 2>
      type: Unique
      enabled: true
      refs: { table_id: customers, column_ids: [email] }
      params: {}
```

## 常见错误与排查

| 现象 | 原因 |
|------|------|
| `loading_warnings` 出现 IdMismatchWarning | manifest 引用的 id 与文件内部 id 不一致 |
| 报"表不在数据集中" | `refs.table_id` 写的不是 schema 的 `id` |
| 报"列不存在" | `column_id` 写的不是 schema columns 里的 `id`（要用列 ID，不是随便的列名） |
| Scripted 约束报权限错误 | `settings.script_security.allow_eval` 未开启 |
| 数据文件找不到 | schema `source.path` 相对 manifest 所在目录解析 |
