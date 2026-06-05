# V2 配置文件格式标准

> 本文档描述 Precis 项目 V2 YAML 配置文件的完整格式规范，包括所有文件类型的字段定义、ID 规则和约束参数结构。

## 目录

- [文件体系总览](#文件体系总览)
- [ID 规则](#id-规则)
- [1. 项目清单 project.precis.yaml](#1-项目清单-projectprecisyaml)
- [2. Schema 文件 *.schema.yaml](#2-schema-文件-schemayaml)
- [3. Constraint 文件 *.constraint.yaml](#3-constraint 文件-constraintyaml)
- [4. Regex 文件 *.regex.yaml](#4-regex-文件-regexyaml)
- [5. Transform 文件 *.transform.yaml](#5-transform-文件-transformyaml)
- [6. Template 文件 *.template.yaml](#6-template-文件-templateyaml)
- [约束类型参考（10 种）](#约束类型参考10-种)
- [关键源码索引](#关键源码索引)

---

## 文件体系总览

```
project-dir/
├── project.precis.yaml          # 项目清单（入口）
├── schemas/                     # Schema 定义
│   ├── users.schema.yaml
│   └── orders.schema.yaml
├── constraints/                 # 独立约束
│   ├── email_notnull.constraint.yaml
│   └── order_user_fk.constraint.yaml
├── regex/                       # 正则节点
│   └── phone_cn.regex.yaml
├── transforms/                  # 数据转换
│   └── split_id.transform.yaml
├── templates/                   # 约束模板
│   └── age_check.template.yaml
├── patterns/                    # 正则模式库（regex 引用）
├── data/                        # 数据文件目录
└── project.view.json            # 画布节点位置（前端生成）
```

| 文件类型 | 命名规则 | 后端 Pydantic 模型 | 前端类型 |
|---------|---------|-------------------|---------|
| 项目清单 | `project.precis.yaml` | `ProjectManifest` | `ProjectManifestV2` |
| Schema | `schemas/{name}.schema.yaml` | `TableSchemaFile` | `TableSchemaFileV2` |
| Constraint | `constraints/{id}.constraint.yaml` | `ConstraintFile` | `ConstraintFileV2` |
| Regex | `regex/{id}.regex.yaml` | `RegexNodeFile` | `RegexNodeFileV2` |
| Transform | `transforms/{id}.transform.yaml` | `TransformFile` | `TransformFileV2` |
| Template | `templates/{id}.template.yaml` | `TemplateFile` | — |

---

## ID 规则

### Schema ID — 编码生成（唯一特殊规则）

Schema ID 由**数据文件路径 + sheet 名**确定性派生，经 XOR + Base64URL 编码生成。

**格式**：`sc_<base64url-xor-payload>`

**生成流程**：

```
1. 标准化路径：反斜杠→正斜杠，去 ./ 前缀，转小写
2. 确定 sheet_key：
   - Excel (.xlsx/.xls) → 使用 sheet 名（小写）
   - 其他文件           → 使用文件名（去扩展名，小写）
3. 拼接 raw_id = "{标准化路径}|{sheet_key}"
4. UTF-8 编码 → XOR 混淆（密钥: "precis-schema-id-secret-v1"）→ URL-safe Base64（去 = 填充）
5. 添加 "sc_" 前缀
```

**示例**：

| 输入 (file_path, sheet_name) | raw_id | Schema ID |
|------------------------------|--------|-----------|
| `data/users.xlsx`, `Sheet1` | `data/users.xlsx\|sheet1` | `sc_FBMRAkYGXhYRG0sVDV4RGF4bAAYGVA` |
| `data/users.xlsx`, `None` | `data/users.xlsx\|` | `sc_FBMRAkYGXhYRG0sVDV4RGA` |
| `data/users.csv`, `None` | `data/users.csv\|users` | `sc_FBMRAkYGXhYRG0sOElsVEV4WFxA` |
| `./data/orders.xlsx`, `Orders` | `data/orders.xlsx\|orders` | `sc_FBMRAkYcXxcGGhZDGUEaHFEcFwcXFwc` |

**关键特性**：
- **确定性**：相同路径 + sheet 名始终生成相同 ID
- **可逆**：`decode_schema_id()` 可还原原始路径
- **前后端一致**：Python 和 TypeScript 使用相同密钥与算法

**后端实现**：`backend/app/shared/core/project/schema/types_parts/schema_id.py`
**前端实现**：`frontend/src/utils/typeHelpers.ts`（`generateSchemaId`, `decodeSchemaId`, `extractSheetFromId`, `isExcelSchema`）

### 其他资源类型 ID — 直接透传

Constraint、Regex、Transform、Template Instance 的 ID **无编码规则**，直接使用画布节点的 `node.id`（前端生成的 UUID）。

| 资源类型 | ID 来源 | 规则 |
|---------|--------|------|
| **Schema** | `generateSchemaId(filePath, sheetName)` | `sc_` 前缀 + XOR + Base64URL 编码 |
| Constraint | `node.id`（UUID） | 无编码，直接透传 |
| Regex | `node.id` | 同上 |
| Transform | `node.id` | 同上 |
| Template Instance | `node.id` | 同上 |

---

## 1. 项目清单 project.precis.yaml

**Pydantic 模型**：`backend/app/shared/core/project/manifest/types_parts/manifest.py` — `ProjectManifest`

### 完整示例

```yaml
version: 2

project:
  id: my-project
  name: 我的数据项目

settings:
  validation:
    auto_validate: true
    strict_mode: false
    error_handling: continue    # stop | continue | report
    timeout_seconds: 30         # 1-300
    batch_max_files: 100        # 1-1000
  file_processing:
    default_encoding: utf-8     # utf-8 | gbk | auto
    csv_delimiter: ","
  script_security:
    allow_eval: false
    allow_exec: false
    sandbox_mode: true
    timeout_seconds: 10         # 1-60

schemas:
  - id: sc_FBMRAkYGXhYRG0sVDV4RGF4bAAYGVA
    path: schemas/users.schema.yaml
  - id: sc_FBMRAkYGXhYRG0sVDV4RGA
    path: schemas/users_no_sheet.schema.yaml

constraints:
  - id: email_notnull
    path: constraints/email_notnull.constraint.yaml
  - id: email_unique
    path: constraints/email_unique.constraint.yaml

regex_nodes:
  - id: phone_validator
    path: regex/phone_validator.regex.yaml

transforms:
  - id: split_id_card
    path: transforms/split_id_card.transform.yaml

data_sources:
  - id: primary
    path: data
    mode: relative             # relative | absolute
    description: 主数据目录

templates:
  - id: age_check
    path: templates/age_check.template.yaml

template_instances:
  - id: instance_age_users
    template_id: age_check
    enabled: true
    input_from_node: sc_FBMRAkYGXhYRG0sVDV4RGF4bAAYGVA
    params:
      min_age: 18

patterns_dir: patterns
```

### 字段参考

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `version` | `int` | 否 | `2` | 配置版本，固定为 2 |
| `project` | `ProjectInfo` | **是** | — | 项目基本信息 |
| `settings` | `ProjectSettings` | 否 | defaults | 运行时设置 |
| `schemas` | `list[SchemaRef]` | 否 | `[]` | Schema 文件引用 |
| `constraints` | `list[ConstraintRef]` | 否 | `[]` | Constraint 文件引用 |
| `regex_nodes` | `list[RegexRef]` | 否 | `[]` | Regex 文件引用 |
| `transforms` | `list[TransformRef]` | 否 | `[]` | Transform 文件引用 |
| `data_sources` | `list[DataSourceRef]` | 否 | `[]` | 数据源目录引用 |
| `templates` | `list[TemplateRef]` | 否 | `[]` | 模板定义引用 |
| `template_instances` | `list[TemplateInstanceRef]` | 否 | `[]` | 模板实例引用 |
| `patterns_dir` | `str` | 否 | `"patterns"` | 正则模式目录 |

### 子类型

**ProjectInfo**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | `str` | **是** | 项目稳定标识符 |
| `name` | `str` | **是** | 显示名称 |

**SchemaRef / ConstraintRef / RegexRef / TransformRef**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | `str` | **是** | 资源 ID（需与文件内部 `id` 一致） |
| `path` | `str` | **是** | 相对于 manifest 的文件路径 |

**DataSourceRef**：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | `str` | **是** | — | 数据源标识符 |
| `path` | `str` | **是** | — | 目录路径 |
| `mode` | `str` | 否 | `"relative"` | `relative` 或 `absolute` |
| `description` | `str | None` | 否 | `None` | 描述 |

**TemplateRef**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | `str` | **是** | 模板 ID |
| `path` | `str` | **是** | 模板文件路径 |

**TemplateInstanceRef**：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | `str` | **是** | — | 实例 ID（全局唯一） |
| `template_id` | `str` | **是** | — | 引用的模板 ID |
| `enabled` | `bool` | 否 | `true` | 是否启用 |
| `input_from_node` | `str` | **是** | — | 上游节点 ID |
| `params` | `dict[str, Any]` | 否 | `{}` | 参数绑定 |

**ValidationSettings**：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `auto_validate` | `bool` | 否 | `true` | 自动校验 |
| `strict_mode` | `bool` | 否 | `false` | 严格模式（任何错误即失败） |
| `error_handling` | `"stop" \| "continue" \| "report"` | 否 | `"continue"` | 错误处理策略 |
| `timeout_seconds` | `int` | 否 | `30` | 超时秒数（1-300） |
| `batch_max_files` | `int` | 否 | `100` | 批量最大文件数（1-1000） |

**FileProcessingSettings**：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `default_encoding` | `"utf-8" \| "gbk" \| "auto"` | 否 | `"utf-8"` | 文件编码 |
| `csv_delimiter` | `str` | 否 | `","` | CSV 分隔符 |

**ScriptSecuritySettings**：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `allow_eval` | `bool` | 否 | `false` | 允许 eval() |
| `allow_exec` | `bool` | 否 | `false` | 允许 exec() |
| `sandbox_mode` | `bool` | 否 | `true` | 沙箱模式 |
| `timeout_seconds` | `int` | 否 | `10` | 脚本超时秒数（1-60） |

---

## 2. Schema 文件 *.schema.yaml

**Pydantic 模型**：`backend/app/shared/core/project/schema/types_parts/table.py` — `TableSchemaFile`

### Tabular（Excel/CSV）

```yaml
version: 2
id: sc_FBMRAkYGXhYRG0sVDV4RGF4bAAYGVA    # 编码生成的 Schema ID
name: 用户表

source:
  mode: relative_file        # relative_file | absolute_file
  path: data/users.xlsx
  sheet: Sheet1              # Excel 专用，可选
  header_row: 0
  # options:                 # 可选格式配置
  #   engine: openpyxl       # openpyxl | xlrd
  #   dtype_inference: true

columns:
  - id: user_id              # 可选，默认等于 name
    name: user_id
    type: integer            # string|integer|decimal|boolean|datetime|date|time
    primary_key: true
    nullable: false
  - id: email
    name: email
    type: string
  - id: username             # 提取列（Extracted）
    name: username
    type:
      name: Extracted
      source_column: email
      extract_key: username
      result_type: string

constraints:                  # 内嵌约束（可选）
  - id: email_notnull
    type: NotNull
    enabled: true
    column: email
  - id: email_unique
    type: Unique
    columns: [email]
```

### JSON

```yaml
version: 2
id: sc_JsonSchemaEncodedId
name: API 数据

source:
  mode: relative_file
  path: data/api_response.json
  header_row: 0
  options:
    format: object           # auto | array | lines | object
    json_path: "$.data.items"
    sep: "."

columns:
  - id: item_id
    name: item_id
    type: integer
```

### 字段参考

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `version` | `int` | 否 | `2` | 配置版本 |
| `id` | `str` | **是** | — | Schema ID（编码生成） |
| `name` | `str` | **是** | — | 显示名称 |
| `source` | `SourceSpec \| None` | 否 | `None` | 数据源 |
| `sheet` | `str \| None` | 否 | `None` | Excel sheet（与 source.sheet 互斥，不可同时指定且不同） |
| `columns` | `list[ColumnSpec]` | 否 | `[]` | 列定义 |
| `constraints` | `list[ConstraintItem]` | 否 | `[]` | 内嵌约束 |
| `script_checks` | `list[dict]` | 否 | `[]` | 脚本检查 |

**SourceSpec**：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `mode` | `"relative_file" \| "absolute_file"` | **是** | — | 路径模式 |
| `path` | `str` | **是** | — | 文件路径 |
| `sheet` | `str \| None` | 否 | `None` | Excel sheet 名 |
| `header_row` | `int` | 否 | `0` | 表头行索引（>=0） |
| `options` | `FormatOptions \| None` | 否 | `None` | 格式选项 |

**FormatOptions**（JSON 相关）：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `format` | `"auto" \| "array" \| "lines" \| "object"` | 否 | `"auto"` | JSON 格式变体 |
| `json_path` | `str \| None` | 否 | `None` | JSONPath 提取，如 `"$.data.items"` |
| `record_path` | `str \| None` | 否 | `None` | 展平路径 |
| `meta_prefix` | `str` | 否 | `"meta."` | 元数据字段前缀 |
| `sep` | `str` | 否 | `"."` | 展平分隔符 |
| `dtype` | `dict[str, str] \| None` | 否 | `None` | 列类型映射 |
| `flatten` | `bool` | 否 | `false` | 自动展平嵌套结构 |

**FormatOptions**（CSV 相关）：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `delimiter` | `str` | 否 | `","` | 字段分隔符 |
| `quotechar` | `str` | 否 | `'"'` | 引用字符 |
| `escapechar` | `str \| None` | 否 | `None` | 转义字符 |
| `encoding` | `str` | 否 | `"utf-8"` | 文件编码 |
| `skip_rows` | `int` | 否 | `0` | 跳过行数 |
| `on_bad_lines` | `"error" \| "warn" \| "skip"` | 否 | `"warn"` | 坏行处理 |

**FormatOptions**（Excel 相关）：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `engine` | `"openpyxl" \| "xlrd"` | 否 | `"openpyxl"` | Excel 引擎 |
| `dtype_inference` | `bool` | 否 | `true` | 自动类型推断 |

**ColumnSpec**：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | `str \| None` | 否 | auto（= name） | 列 ID |
| `name` | `str` | **是** | — | 列名 |
| `type` | `str \| ExtractedSpec` | **是** | — | 数据类型或提取定义 |
| `primary_key` | `bool` | 否 | `false` | 是否主键 |
| `nullable` | `bool` | 否 | `true` | 是否允许空 |
| `expand` | `bool` | 否 | `false` | 展开（array/object） |
| `json_path` | `str \| None` | 否 | `None` | JSON 路径映射 |
| `children` | `list[ColumnSpec] \| None` | 否 | `None` | 子列（JSON 树） |

**ExtractedSpec**（嵌套在 ColumnSpec.type 中）：

```yaml
type:
  name: Extracted
  source_column: email       # 源列名
  extract_key: username      # 正则命名捕获组
  result_type: string        # 结果数据类型
```

**内嵌 ConstraintItem**：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | `str` | **是** | — | 约束 ID（表内唯一） |
| `type` | `str` | **是** | — | 约束类型 |
| `enabled` | `bool` | 否 | `true` | 是否启用 |
| `description` | `str \| None` | 否 | `None` | 描述 |
| `column` | `str \| None` | 否 | `None` | 目标列名（单列） |
| `columns` | `list[str] \| None` | 否 | `None` | 目标列名（多列） |
| `params` | `dict[str, Any]` | 否 | `{}` | 约束参数 |

**模型验证规则**：
- 所有 `columns.id` 必须唯一
- 所有 `columns.name` 必须唯一
- 所有 `constraints.id` 必须唯一
- `source.sheet` 和 `sheet` 字段不可同时指定且不同

---

## 3. Constraint 文件 *.constraint.yaml

**Pydantic 模型**：`backend/app/shared/core/project/constraint/types/constraint_file.py` — `ConstraintFile`

### 示例

```yaml
version: 2
id: email_notnull
type: NotNull
enabled: true
description: "邮箱不能为空"
refs:
  table_id: sc_FBMRAkYGXhYRG0sVDV4RGF4bAAYGVA
  column_id: email
params: {}
```

### 字段参考

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `version` | `int` | 否 | `2` | 配置版本 |
| `id` | `str` | **是** | — | 约束唯一 ID |
| `type` | `str` | **是** | — | 约束类型（10 种） |
| `enabled` | `bool` | 否 | `true` | 是否启用 |
| `description` | `str \| None` | 否 | `None` | 描述 |
| `refs` | `dict[str, Any]` | 否 | `{}` | 引用区：目标表/列 ID |
| `params` | `dict[str, Any]` | 否 | `{}` | 参数区：约束具体配置 |
| `input_from_node` | `str \| None` | 否 | `None` | 上游数据流节点 ID |

**有效 `type` 值**：`NotNull`, `Unique`, `AllowedValues`, `ForeignKey`, `Range`, `Conditional`, `Scripted`, `Charset`, `DateLogic`, `Composite`

---

## 4. Regex 文件 *.regex.yaml

**Pydantic 模型**：`backend/app/shared/core/project/regex/types.py` — `RegexNodeFile`

### 引用模式（推荐）

```yaml
version: 2
id: phone_validator
name: 手机号校验
description: "校验中国大陆手机号格式"
enabled: true

uses_pattern:
  registry: patterns
  pattern_name: phone_cn
pattern_overrides:
  flags: "i"

match_mode: full              # full | partial | extract
case_sensitive: false
flags: ""

input_from_node: sc_FBMRAkYGXhYRG0sVDV4RGF4bAAYGVA
input_column: phone
capture_groups: []            # extract 模式: [{name, group_index}]
output_columns: []            # extract 模式: 输出列名

source_ref:
  table_id: sc_FBMRAkYGXhYRG0sVDV4RGF4bAAYGVA
  column_id: phone
source_column_name: phone
```

### 直接模式

```yaml
version: 2
id: email_direct
name: 邮箱校验
description: "直接编写正则校验邮箱"
pattern: "^[\w\.-]+@[\w\.-]+\.\w+$"
match_mode: full
enabled: true
```

### 字段参考

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `version` | `int` | 否 | `2` | 配置版本 |
| `id` | `str` | **是** | — | 唯一 ID |
| `name` | `str` | **是** | — | 显示名称 |
| `description` | `str \| None` | 否 | `None` | 描述 |
| `uses_pattern` | `PatternRef \| None` | 条件 | `None` | 引用模式（与 `pattern` 互斥） |
| `pattern` | `str \| None` | 条件 | `None` | 直接正则字符串（与 `uses_pattern` 互斥） |
| `pattern_overrides` | `dict \| None` | 否 | `{}` | 引用模式的覆盖参数 |
| `match_mode` | `"full" \| "partial" \| "extract"` | 否 | `"full"` | 匹配模式 |
| `case_sensitive` | `bool` | 否 | `false` | 大小写敏感 |
| `flags` | `str` | 否 | `""` | 正则标志（如 `"i"`, `"m"`） |
| `enabled` | `bool` | 否 | `true` | 是否启用 |
| `parameters` | `list[dict]` | 否 | `[]` | 参数（前端内部） |
| `rules` | `list[dict]` | 否 | `[]` | 规则（前端 RegexDesign） |
| `input_from_node` | `str \| None` | 否 | `None` | 上游节点 ID |
| `input_column` | `str \| None` | 否 | `None` | 上游列名 |
| `capture_groups` | `list[dict]` | 否 | `[]` | 提取捕获组定义 |
| `output_columns` | `list[str]` | 否 | `[]` | 提取输出列名 |
| `source_ref` | `RegexSourceRef \| None` | 否 | `None` | 上游表/列引用 |
| `source_column_name` | `str \| None` | 否 | `None` | 源列显示名 |

**验证规则**：`uses_pattern` 和 `pattern` 必须恰好提供一个，不能同时存在或同时缺失。

**PatternRef**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `registry` | `"patterns"` | **是** | 注册表类型 |
| `pattern_name` | `str` | **是** | 模式名 |

**RegexSourceRef**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `table_id` | `str` | **是** | 上游表 ID |
| `column_id` | `str` | **是** | 上游列 ID |

---

## 5. Transform 文件 *.transform.yaml

**Pydantic 模型**：`backend/app/shared/core/project/transform/types.py` — `TransformFile`

### 示例

```yaml
version: 2
id: split_id_card
type: StringSplit
enabled: true
description: "身份证号拆分"
input_from_node: sc_source01
input_column: id_card
params:
  strategy: fixed_position
  ranges:
    - name: region_code
      start: 0
      end: 6
    - name: birth_date
      start: 6
      end: 14
output_columns: [region_code, birth_date]
```

### 字段参考

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `version` | `int` | 否 | `2` | 配置版本 |
| `id` | `str` | **是** | — | Transform ID |
| `type` | `str` | **是** | — | Transform 类型（22 种） |
| `enabled` | `bool` | 否 | `true` | 是否启用 |
| `description` | `str \| None` | 否 | `None` | 描述 |
| `input_from_node` | `str \| None` | 否 | `None` | 上游节点 ID |
| `input_column` | `str \| None` | 否 | `None` | 上游列名 |
| `params` | `dict[str, Any]` | 否 | `{}` | Transform 参数 |
| `output_columns` | `list[str]` | 否 | `[]` | 输出列名 |

**有效 `type` 值**（22 种）：`StringSplit`, `RegexExtract`, `MathExpr`, `DateFormat`, `Lookup`, `Strip`, `UpperCase`, `LowerCase`, `Replace`, `FillNA`, `FilterRows`, `DropDuplicates`, `CastType`, `Concat`, `Substring`, `Aggregate`, `ConditionalAssign`, `SortRows`, `Digits`, `WeightedSum`, `Modulo`, `MapValue`

---

## 6. Template 文件 *.template.yaml

**Pydantic 模型**：`backend/app/shared/core/project/template/types.py` — `TemplateFile`

### 示例

```yaml
version: 2
id: age_check
name: 年龄校验
description: "校验年龄是否满足条件"

parameters:
  - id: min_age
    type: integer             # string|integer|decimal|boolean
    label: 最小年龄
    required: true
    default: 18

input_anchor:
  id: input_anchor
  label: 数据源入口
  accepts: ["schema", "transformOutput", "manualData"]

nodes:
  - id: check_range
    kind: constraint          # transform | constraint | regex
    type: Range
    input_from_node: "{{input_anchor}}"
    input_column: "{{source_column}}"
    params:
      min: 0
      max: 150
      boundary_mode: inclusive
    enabled: true
```

### 字段参考

**TemplateFile**：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `version` | `int` | 否 | `2` | 配置版本 |
| `id` | `str` | **是** | — | 模板 ID |
| `name` | `str` | **是** | — | 显示名称 |
| `description` | `str \| None` | 否 | `None` | 描述 |
| `parameters` | `list[TemplateParameter]` | 否 | `[]` | 参数定义 |
| `nodes` | `list[TemplateNode]` | 否 | `[]` | 内部 DAG 节点 |
| `input_anchor` | `InputAnchor` | 否 | defaults | 输入锚点 |

**TemplateParameter**：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | `str` | **是** | — | 参数 ID（用于 `{{param_id}}` 占位符） |
| `type` | `str` | **是** | — | `string` / `integer` / `decimal` / `boolean` |
| `label` | `str` | **是** | — | 显示标签 |
| `required` | `bool` | 否 | `true` | 是否必填 |
| `default` | `Any` | 否 | `None` | 默认值 |

**TemplateNode**：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | `str` | **是** | — | 局部 ID（展开时映射为 `{instance_id}__{local_id}`） |
| `kind` | `"transform" \| "constraint" \| "regex"` | **是** | — | 节点类别 |
| `type` | `str` | **是** | — | 具体类型名 |
| `input_from_node` | `str \| None` | 否 | `None` | 上游节点 ID（支持 `{{input_anchor}}`） |
| `input_column` | `str \| None` | 否 | `None` | 输入列名（支持占位符） |
| `params` | `dict[str, Any]` | 否 | `{}` | 参数（支持占位符） |
| `output_columns` | `list[str]` | 否 | `[]` | 输出列（支持占位符） |
| `refs` | `dict[str, Any]` | 否 | `{}` | 约束引用（支持占位符） |
| `description` | `str \| None` | 否 | `None` | 描述 |
| `enabled` | `bool` | 否 | `true` | 是否启用 |

**InputAnchor**：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | `str` | 否 | `"input_anchor"` | 锚点 ID |
| `label` | `str` | 否 | `"数据源入口"` | 显示标签 |
| `accepts` | `list[str]` | 否 | `["schema", "transformOutput", "manualData"]` | 接受的源类型 |

---

## 约束类型参考（10 种）

每种约束类型通过 `refs`（目标引用）和 `params`（约束参数）两部分定义。

### NotNull — 非空

确保列值不为空。

```yaml
type: NotNull
refs:
  table_id: <schema_id>       # 必填
  column_id: <column_id>      # 必填
params: {}
```

### Unique — 唯一

确保列值唯一（支持多列组合）。

```yaml
type: Unique
refs:
  table_id: <schema_id>           # 必填
  column_ids: [<column_id>, ...]  # 必填，可多列
params: {}
```

### AllowedValues — 枚举白名单

确保列值在允许的值列表中。

```yaml
type: AllowedValues
refs:
  table_id: <schema_id>       # 必填
  column_id: <column_id>      # 必填
params:
  allowed_values: [value1, value2, ...]  # 必填
```

### ForeignKey — 外键

确保列值存在于目标表的指定列中。

```yaml
type: ForeignKey
refs:
  from_table_id: <schema_id>      # 必填，源表
  from_column_id: <column_id>     # 必填，外键列
  to_table_id: <schema_id>        # 必填，目标表
  to_column_id: <column_id>       # 必填，目标列（通常为主键）
params: {}
```

### Range — 数值范围

确保数值在指定范围内。

```yaml
type: Range
refs:
  table_id: <schema_id>       # 必填
  column_id: <column_id>      # 必填
params:
  min: <number>                            # 可选，最小值
  max: <number>                            # 可选，最大值
  boundary_mode: inclusive                 # inclusive | exclusive，默认 inclusive
```

### Charset — 字符集

确保字符串符合指定字符集。

```yaml
type: Charset
refs:
  table_id: <schema_id>       # 必填
  column_id: <column_id>      # 必填
params:
  charset_mode: ascii         # ascii | chinese，必填
```

### DateLogic — 日期逻辑

对日期列进行比较或计算校验。

**比较模式**：

```yaml
type: DateLogic
refs:
  table_id: <schema_id>       # 必填
  column_id: <column_id>      # 必填
params:
  logic_mode: compare                             # 必填
  compare_op: gt                                  # gt|gte|lt|lte|eq，必填
  reference_date: "2000-01-01"                    # 可选，固定参考日期
  # 或 reference_column: <column_id>               # 可选，参考列（与 reference_date 互斥）
```

**计算模式**：

```yaml
type: DateLogic
refs:
  table_id: <schema_id>
  column_id: <column_id>
params:
  logic_mode: calculation                         # 必填
  calculation_type: age                           # age | days_diff，必填
  compare_op: gte                                 # 可选，比较运算符
  target_value: 18                                # 可选，目标值
  # 或 target_column: <column_id>                  # 可选，目标列（days_diff）
  # reference_date: "2000-01-01"                   # 可选，参考日期（age）
```

### Conditional — 条件约束

当 IF 条件满足时，THEN 列须满足指定约束。

```yaml
type: Conditional
refs:
  table_id: <schema_id>                           # 必填
  then_column_id: <column_id>                     # 必填，待校验列
  if_logic: and                                   # and | or，默认 and
  if_conditions:                                  # 必填，IF 条件列表
    - if_column_id: <column_id>                   # 必填，条件列
      operator: eq                                # eq|ne|gt|lt|in|not_null|greater_than|less_than
      value: <any>                                # 单值运算符
      # values: [<any>, ...]                      # "in" 运算符
params:
  then_condition:                                 # 必填
    operator: greater_than                        # not_null|greater_than|less_than|in|eq|neq
    value: 1000                                   # 比较运算符的值
    # values: [...]                               # "in" 运算符
    # ref_column: <column_id>                     # 可选，与另一列比较
```

### Scripted — 自定义脚本

通过 Python 表达式进行自定义校验（沙箱执行）。

```yaml
type: Scripted
refs:
  table_id: <schema_id>           # 必填
  column_id: <column_id>          # 可选，设置后可用 `value` 变量
params:
  name: valid_phone               # 可选，规则名
  expression: "re_match(r'^1[3-9]\\d{9}$', str(value))"  # 必填，返回 bool
```

**表达式上下文变量**：
- `value`：当前单元格值（需设置 column_id）
- `row`：当前行数据 dict
- 内置函数：`len`, `sum`, `max`, `min`, `round`, `abs`, `any`, `all`, `int`, `str`, `float`, `bool`, `list`, `dict`, `set`
- `re_match(pattern, string)`：正则匹配

**安全**：需 `settings.script_security.allow_eval = true` 或沙箱模式运行。

### Composite — 组合约束

聚合多个子约束，支持 AND/OR/NOT 逻辑。

```yaml
type: Composite
refs:
  table_id: <schema_id>           # 可选
  column_id: <column_id>          # 可选
params:
  logic: all                      # all | any | none，必填
  sub_constraints:                # 必填，子约束列表
    - id: sub_notnull
      type: NotNull
      enabled: true
      refs:
        table_id: <schema_id>
        column_id: <column_id>
      params: {}
    - id: sub_unique
      type: Unique
      enabled: true
      refs:
        table_id: <schema_id>
        column_ids: [<column_id>]
      params: {}
```

**逻辑策略**：
- `all`：所有子约束必须通过
- `any`：至少一个子约束通过
- `none`：所有子约束必须失败（反向校验）

> **禁止递归**：`sub_constraints` 内不可嵌套 `Composite` 类型。

---

## 关键源码索引

| 领域 | 后端文件 | 前端文件 |
|------|---------|---------|
| Manifest 类型 | `backend/app/shared/core/project/manifest/types_parts/` | `frontend/src/types/projectV2.ts` |
| Schema 类型 | `backend/app/shared/core/project/schema/types_parts/table.py` | `frontend/src/types/projectV2.ts` |
| Schema ID 编解码 | `backend/app/shared/core/project/schema/types_parts/schema_id.py` | `frontend/src/utils/typeHelpers.ts` |
| Source 类型 | `backend/app/shared/core/project/schema/types_parts/source.py` | — |
| Source Options | `backend/app/shared/core/project/schema/types_parts/source_options.py` | — |
| Column 类型 | `backend/app/shared/core/project/schema/types_parts/column.py` | — |
| Constraint 类型 | `backend/app/shared/core/project/constraint/types/` | `frontend/src/types/projectV2.ts` |
| Constraint refs | `backend/app/shared/core/project/constraint/types/refs.py` | — |
| Constraint 工厂 | `backend/app/shared/core/project/constraint/factory.py` | — |
| Regex 类型 | `backend/app/shared/core/project/regex/types.py` | `frontend/src/types/projectV2.ts` |
| Transform 类型 | `backend/app/shared/core/project/transform/types.py` | `frontend/src/types/projectV2.ts` |
| Template 类型 | `backend/app/shared/core/project/template/types.py` | — |
| Manifest 构建器 | `backend/app/shared/core/project/manifest/writer.py` | `frontend/src/services/builders/v2/manifestBuilder.ts` |
| Schema 构建器 | — | `frontend/src/services/builders/v2/schemaBuilder.ts` |
| Constraint 构建器 | — | `frontend/src/services/builders/constraintBuilder.ts` |
| Constraint 导出适配 | — | `frontend/src/services/constraints/constraintExportAdapter.ts` |
| Domain: NotNull | `backend/app/shared/domain/constraints/not_null.py` | — |
| Domain: Unique | `backend/app/shared/domain/constraints/unique.py` | — |
| Domain: AllowedValues | `backend/app/shared/domain/constraints/allowed_values.py` | — |
| Domain: ForeignKey | `backend/app/shared/domain/constraints/foreign_key.py` | — |
| Domain: Range | `backend/app/shared/domain/constraints/range.py` | — |
| Domain: Charset | `backend/app/shared/domain/constraints/charset.py` | — |
| Domain: DateLogic | `backend/app/shared/domain/constraints/date_logic.py` | — |
| Domain: Conditional | `backend/app/shared/domain/constraints/conditional.py` | — |
| Domain: Scripted | `backend/app/shared/domain/constraints/scripted.py` | — |
| Domain: Composite | `backend/app/shared/domain/constraints/composite.py` | — |
