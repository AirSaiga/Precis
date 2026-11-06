---
name: spreadsheet-data-check
display_name: 表格数据检查
display_name_en: Spreadsheet Data Checker
description: "检查 Excel/CSV/JSON 数据质量、交付前验收、上报前自查或迁移后对账时使用：自动推断表结构，把自然语言规则变成校验配置（9 类约束 + 22 种清洗转换），逐行报告违规（行号、原始值、修复建议）并产出验收报告，支持修数据或调规则后一键复验、规则复用与 CI 门控。"
description_zh: "一句话讲清验收标准，AI 翻译成可复用的校验规则：覆盖空值、重复、组合唯一、范围/枚举、字符集、跨列条件、日期逻辑与跨表引用等 9 类规则；违规逐行定位到单元格并附修复建议；规则沉淀为配置，可复用、一键复验、可接 CI。"
description_en: "Turn plain-language acceptance criteria into reusable validation rules for Excel, CSV, and JSON: 9 constraint types (nulls, duplicates, composite uniqueness, ranges, enums, charset, cross-column conditions, date logic, foreign keys) plus 22 cleaning transforms; row-level violations with cell values and fix suggestions; rules persist as YAML configs for one-click revalidation and CI gating."
examples_zh:
  - "帮我验收这份 orders.xlsx：订单号不能空且不能重复，金额在 0 到 100000 之间，发货日期不得早于下单日期"
  - "检查客户表：邮箱和电话不许为空、客户编号必须唯一，给我逐行问题清单和修复建议"
  - "订单表里的 customer_id 必须都能在客户表里找到，帮我找出孤儿记录"
  - "用上次沉淀的校验规则复跑这份新导出的数据，看看问题还剩多少"
examples_en:
  - "Accept orders.xlsx: order_id must be unique and non-empty, amount between 0 and 100000, ship_date no earlier than order_date"
  - "Check the customers table: emails and phones must not be empty, customer codes unique; list issues row by row with fixes"
  - "Every customer_id in orders must exist in customers - find the orphan records"
  - "Re-run last time's validation rules on this new export and tell me what is left"
version: 0.1.12
author: Precis Team
---

# 表格数据检查工作流

Precis 是一个数据校验引擎：你为数据文件写一份 V2 YAML 配置（配置格式版本 2，
内容为表结构 + 约束规则），然后用 `precis validate` 执行校验，得到机器可读的
违规清单。本 skill 教你完成"读数据 → 写配置 → 执行 → 解读 → 迭代"的完整闭环。

## 第 0 步：前置检查

按优先级探测 CLI（找到一个可用即进入第 1 步）：

1. `precis --version` —— 用户已 pip 安装
   （`precis-cli` 是等价别名命令；探测与后续执行统一用 `precis` 为准）
2. `uvx --from precis-cli precis --version` —— 用户装有 [uv](https://docs.astral.sh/uv/)，
   免安装运行（首次需下载依赖）。此后所有 `precis ...` 命令都加
   `uvx --from precis-cli` 前缀执行

两个都不可用时，告诉用户安装方式后**停止**（不要尝试其他替代方案）：

> Precis CLI 未安装。两种安装方式任选：
> 1. 安装 uv 后免安装运行：`uvx --from precis-cli precis --version`
> 2. pip 安装（要求 Python >= 3.12、< 3.14）：`pip install precis-cli`
> 安装后会获得 `precis` 命令。装好后重新发起校验。

## 第 1 步：读数据文件，确认落盘位置

1. 读取数据文件**头部**（CSV/JSON 用 `head`，Excel 需先看 sheet 名与首行），
   确认列名和大致类型，并统计数据行数。
2. **先向用户确认配置落盘位置**（默认建议：数据文件所在目录下的 `precis-project/`），
   用户同意后再写文件。所有产物留在用户目录，可读、可 diff、可进 git。

## 第 2 步：写 V2 配置

**优先推断，再人工调整**（减少手写 YAML 的错误率）：

```bash
precis infer-schema <数据文件> --output <项目目录>/schemas/<表名>.schema.yaml
# 替换既有 schema 时保持 id 不变：--id <原UUID>；source 路径不对时 --source-path 修正
```

推断产出 string/integer/float/boolean/date 五类列类型草稿（少量脏值不会拖垮整列，
按数据中的主导类型判定）。展示给用户确认后，按业务语义调整（如补 primary_key；
推断不会产出 decimal，金额等精确数值列需手工改为 decimal）。

然后严格按 @references/v2-format.md 的格式速查补齐约束：

```
<项目目录>/
├── project.precis.yaml          # 清单：引用所有 schema 与约束
├── schemas/<表名>.schema.yaml    # 每张表一个：列定义 + 数据源路径
└── constraints/*.constraint.yaml # 每条约束一个
```

要点：

- 所有 ID（schema/constraint 的 `id`）用 **UUID v4**（如
  `8f3d2a1c-4b5e-4f6a-9c8d-1e2f3a4b5c6d`），**禁止** `sc_` 前缀旧格式。
- 约束优先用 6 种简单类型：NotNull / Unique / AllowedValues / Range /
  ForeignKey / Charset。Conditional / DateLogic / Composite 按需使用。
- 写完配置即可执行，无需单独校验；配置加载问题通过 `loading_warnings` 透出，约束配置与执行错误通过 `errors[]` 透出。

### 基线规则包（用户没给明确规则时）

当用户只说"检查一下/验收这份数据"而没给规则时，不要停下来等规则：从推断出的 schema
派生一份基线规则包，以短清单形式展示（"我默认加这 N 条规则——确认或调整"），用户确认
后再写配置：

- 标了 `primary_key: true` 的列 → Unique + NotNull
- 名称含 `id`、`code`、`no`、`key` 的编号/代码类列 → Unique（复合主键用多列 Unique）
- 用户确认的业务必填列 → NotNull
- 数值列 → 仅在用户给出边界或存在显然值域（如评分 0-100）时加 Range；否则宁可跳过也不猜
- 日期列 → DateLogic 合理性下界（compare gte 1900-01-01）；列间先后关系（如发货日期不早于
  下单日期）仅在语义显然时提议——只提议，不强加
- 形如 `<另一张表>_id` 且目标表已在项目中的列 → ForeignKey

## 第 3 步：执行校验

```bash
precis validate --manifest <项目目录>/project.precis.yaml --format json
```

- Windows 下路径含空格时用引号包裹。
- 大文件（>500MB）会自动分块加载，耗时长属正常，提醒用户耐心等待。
- **不要**在交互式命令行（REPL）中使用 `--format json`（该选项在 REPL 中会被忽略）。

## 第 4 步：按退出码解读

`--format json` 模式下 **stdout 只有一个 JSON 文档**；stderr 可能有日志或错误信息，退出码为 2 时必须查看。
退出码三分支：

| 退出码 | 含义 | 你要做的事 |
|--------|------|-----------|
| 0 | 未发现数据违规 | 检查 `loading_warnings`；有配置警告先逐条报告并处理，无则报告通过并附 tables/summary 概览 |
| 1 | 校验完成，发现数据违规 | 解析 `errors[]`，逐条用中文汇报 |
| 2 | 工具自身错误 | 展示 stderr/错误消息，检查配置与路径后修复重试 |

`errors[]` 每条字段包括：`table`（表）、`column`（列）、`constraint_type`（约束类型）、
`constraint_file`（来源约束文件，相对 manifest 目录——独立约束是其
`*.constraint.yaml` 路径，schema 内嵌约束是宿主 schema 路径；格式校验等
无来源错误为 null）、`row_index`（行号）、`cell_value`（原始值）、
`error_message`（中文消息），以及 `error_code`、`error_params`、`error_message_en`、`suggestion`。

汇报格式建议：

> 共发现 N 处违规（涉及 M 项约束检查，通过 X 项）：
> 1. 表 `orders` 第 127 行，列 `email`（NotNull 约束）：值为空 —— 非空约束冲突…
> 2. …

注意：`row_index` 是数据行索引（0 起，不含表头），汇报时可以换算成
"第 row_index+1 行数据"方便用户定位。

## 第 4.5 步：产出验收报告（交付物）

聊天文字会沉底，报告文件才是用户能转发的东西。在聊天里汇报完结果后，把
`validation-report.md` 写进第 1 步约定的项目目录（该确认已覆盖此文件；若用户当时
拒绝了项目目录，先询问）：

- 头部：数据文件、行数、执行时间、manifest 路径
- 结论行："M 项约束检查通过 X 项，发现 N 处违规"（或"全部通过"）
- 按表分节的违规明细表：数据行 | 列 | 约束类型 | 原始值 | 问题 | 修复建议 —— 只取自
  `errors[]` 字段（`row_index`+1、`column`、`constraint_type`、`cell_value`、
  `error_message`、`suggestion`），禁止编造行
- 违规很多时：给出按约束聚合的计数全量 + 前 100 行明细，注明截断与完整清单位置（JSON 输出）
- 全部通过时：一段简短验收结论，列出本次生效的检查项

最后一行告诉用户报告路径。

## 第 5 步：迭代闭环

违规处理只有两条路，**询问用户选哪条**：

1. **修数据**：用户改数据文件后，直接重新执行第 3 步。
2. **调规则**：你认为某条约束过严/过宽时，修改 `errors[].constraint_file`
   指向的约束文件后重新执行。

迭代直到退出码为 0 且 `loading_warnings` 中没有阻塞级配置问题。中途用户要求调整
超时/错误处理等项目设置时，参考 @references/v2-format.md 的 settings 一节。

## 规则沉淀与复用（CI 门控）

配置目录是长期资产而非一次性输出——汇报结果时用一句话点明：

- 随数据管道一起进 git：规则可读、可 diff、可评审
- 下一批数据复用同一 manifest：复验就是一条 `precis validate` 命令
- CI/CD：退出码 0=通过、1=发现违规、2=工具错误，流水线可用退出码 0 门控合并或交付

## 禁令

- 不要手改或美化 JSON 输出，只做解析与转述。
- 不要绕过确认直接写配置文件到用户目录。
- 不要在交互式命令行（REPL）中使用 `--format json`。
- 不要使用 Scripted 约束——它需要在用户机器上执行表达式，本技能一律用其余
  约束类型替代（正则格式类校验无法覆盖时，向用户说明限制即可）。
- 环境配置了 MCP（`precis-mcp` server）时，优先直接调用 MCP 工具
  （validate_data / infer_schema / check_config / describe_constraints），
  其返回结构与 CLI JSON 契约一致；无 MCP 时走 Bash + CLI。
