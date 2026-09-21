# Precis V2 配置格式速查

> 供 agent 编写配置使用。覆盖全部 10 种约束、schema 内嵌约束、转换节点与常用 settings；
> 完整规范以后端 `backend/app/shared/` 的类型定义为准（`ConstraintFile`、`TableSchemaFile`、
> `TransformFile` 等）。格式处于 Alpha 阶段，可能调整。

## 目录结构与 ID 规则

```
<项目目录>/
├── project.precis.yaml           # 项目清单（入口）
├── schemas/<表名>.schema.yaml     # 每张表一个
├── constraints/<任意名>.constraint.yaml  # 每条约束一个
├── transforms/<任意名>.transform.yaml    # 转换节点（可选）
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
  file_processing:
    default_encoding: utf-8  # utf-8 / gbk / auto（中文 CSV 乱码时改 gbk 或 auto）
    csv_delimiter: ','       # CSV 分隔符
  script_security:
    allow_eval: false       # Scripted 约束需要表达式求值时设 true
    sandbox_mode: true
```

> **Scripted 双钥匙**：Scripted 约束要求 **两把钥匙同时开启** 才执行——
> ① 项目配置 `settings.script_security.allow_eval: true`；
> ② 运行 precis 的**进程环境变量** `PRECIS_ALLOW_UNSAFE_EVAL=1`（服务端总开关，
> 默认关闭）。只开 ① 时 Scripted 约束会逐行报权限错误——这是安全设计而非 bug。
> 无法控制宿主进程环境变量时，优先用其他约束类型（正则格式校验可参考 golden 集
> 的 Scripted+`re_match` 变体，但同样受此闸门限制）。

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
- `decimal` 可用 dict 形式声明精度：`type: { name: decimal, precision: 28, scale: 2 }`。
- 数据源 `source.mode` 还支持 `absolute_file`（绝对路径）；`relative_file` 相对 manifest 目录解析。

### schema 内嵌约束（可选）

约束也可以直接写在 schema 文件的 `constraints:` 列表里（不必建独立 constraint 文件），
加载时会自动展开为独立约束（ID 加 `{schema_id}_` 前缀）。支持全部 10 种类型；
列引用用**列名或列 ID**（`column`/`columns`），ForeignKey 用 `from_column`/`to_table`/`to_column`：

```yaml
version: 2
id: customers
name: customers
source:
  mode: relative_file
  path: ../data/customers.csv
columns:
  - id: email
    name: email
    type: string
  - id: country
    name: country
    type: string
constraints:
  - id: email_notnull          # 表内唯一即可
    type: NotNull
    column: email
  - id: cn_must_have_email
    type: Conditional
    column: email              # THEN 目标列
    params:
      # Conditional 内嵌形态：IF 条件与 THEN 列写在 params，加载时自动提取
      if_logic: and
      if_conditions:
        - if_column_id: country
          operator: eq
          value: CN
      then_column_id: email
      then_condition:
        operator: not_null
  - id: orders_customer_fk
    type: ForeignKey
    from_column: customer_id   # 本表列
    to_table: customers        # 目标 schema 的 id
    to_column: id
    params: {}
```

> 独立约束文件（下一节）与内嵌约束二选一即可；复杂约束（Composite 子约束较多）
> 建议用独立文件，内嵌更适合每列一两条的简单规则。

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
      operator: eq            # IF 侧：eq / neq / in / not_null / greater_than / less_than
      value: CN
  if_logic: and              # 多条件时 and / or
params:
  then_condition:
    operator: not_null
```

`params.then_condition` —— THEN 侧要求，两种形态：

- **DSL 对象**：`operator` 必填，取值 `not_null` / `greater_than` / `less_than` / `in` / `eq` / `neq`；
  - `greater_than`/`less_than`/`eq`/`neq` 配 `value`（固定比较值）或 `ref_column`（与同表另一列比较）；
  - `in` 配 `values` 列表；
  - 序比较仅数值域，日期比较请用 DateLogic。
    ```yaml
    then_condition: { operator: greater_than, value: 1000 }
    then_condition: { operator: in, values: [A, B, C] }
    then_condition: { operator: eq, ref_column: confirm_email }   # 两列必须相等
    ```
- **字符串**：已注册条件函数名，如 `is_not_empty` / `is_positive_number`。

IF 侧 `if_conditions` 每项：`if_column_id` + `operator`（同上六种）+ `value`（或 `values` 列表，`in` 时）。
IF 与 THEN 都为空时对所有行生效。

### 8. DateLogic 日期逻辑

**compare 模式**（与固定日期或参考列比较）：

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
  reference_date: "1900-01-01"   # 固定日期；或用 reference_column: <列 id> 与同表另一列逐行比较
```

- `range` 为闭区间，需成对提供起点/终点且形态一致：
  `reference_date` + `reference_date_end`，或 `reference_column` + `reference_column_end`。
- 参考列形式（如"签约日期不得早于入职日期"）：

```yaml
params:
  logic_mode: compare
  compare_op: gte
  reference_column: hire_date
```

**calculation 模式**（日期计算后与目标值比较）：

```yaml
# 年龄必须 ≥ 18（按出生日期计算，reference_date 可选、默认当前日期）
params:
  logic_mode: calculation
  calculation_type: age
  target_value: 18            # 比较目标值（数值，必填）

# 发货日期与下单日期相差天数必须恰好等于 3（保留符号的 24h 完整天数）
params:
  logic_mode: calculation
  calculation_type: days_diff
  target_column: order_date   # 天数差的另一侧列（days_diff 必填）
  target_value: 3
```

- 非空但无法解析的日期会报"日期无效"错误（目标列与参考列同口径）。

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
- **双钥匙**：除项目 `allow_eval: true` 外，运行 precis 的进程还需环境变量
  `PRECIS_ALLOW_UNSAFE_EVAL=1`（见上文 settings 一节）；只开一边会逐行报权限错误。
  无法控制宿主环境变量时优先用其他约束类型替代。

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
  logic: all                # all（全部满足）/ any（任一满足）/ none（全部不满足才通过）
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

- `sub_constraints` 每项是完整约束对象（version/id/type/enabled/refs/params），
  **不允许嵌套 Composite**；任一子约束配置非法时整条 Composite 被跳过并在
  `loading_warnings` 提示（fail-closed，不会静默缺子约束）。

## 转换节点（transforms/*.transform.yaml，可选）

转换在**格式解析之后、约束校验之前**执行——约束校验的是转换后的数据。
典型用途：清洗/标准化后再校验（如 status 统一转大写后做 AllowedValues）。

```yaml
# transforms/normalize_status.transform.yaml
version: 2
id: normalize_status
name: 状态标准化
type: UpperCase
enabled: true
description: 将 orders.status 原地转为大写
input_from_node: orders       # 上游 schema 的 id
input_column: status
output_columns:
  - status                    # 与 input_column 同名 = 原地覆盖
```

manifest 登记：

```yaml
transforms:
  - id: normalize_status
    path: transforms/normalize_status.transform.yaml
```

**22 种转换类型**：`StringSplit` `RegexExtract` `MathExpr` `DateFormat` `Lookup`
`Strip` `UpperCase` `LowerCase` `Replace` `FillNA` `FilterRows` `DropDuplicates`
`CastType` `Concat` `Substring` `Aggregate` `ConditionalAssign` `SortRows` `Digits`
`WeightedSum` `Modulo` `MapValue`。

- 多列输出：`StringSplit` / `RegexExtract`（`output_columns` 多项）。
- **改变行数**：`FilterRows` / `DropDuplicates` / `Aggregate` / `SortRows`——
  转换后约束错误的 `row_index` 与原始文件行号不再一一对应（已知限制，汇报错误行号时注意）。
- 参数放 `params`（如 `Replace` 的 `old`/`new`、`MapValue` 的映射表），具体键名
  以后端 `backend/app/shared/domain/transforms/` 各实现为准。

## 常见错误与排查

| 现象 | 原因 |
|------|------|
| `loading_warnings` 出现 IdMismatchWarning | manifest 引用的 id 与文件内部 id 不一致 |
| 报"表不在数据集中" | `refs.table_id` 写的不是 schema 的 `id` |
| 报"列不存在" | `column_id` 写的不是 schema columns 里的 `id`（要用列 ID，不是随便的列名） |
| Scripted 约束报权限错误 | 双钥匙缺一：`settings.script_security.allow_eval` 未开启，或进程环境变量 `PRECIS_ALLOW_UNSAFE_EVAL=1` 未设置 |
| 数据文件找不到 | schema `source.path` 相对 manifest 所在目录解析 |
