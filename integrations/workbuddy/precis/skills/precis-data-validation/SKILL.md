---
name: precis-data-validation
display_name: Precis 数据校验
display_name_en: Precis Data Validation
description: "检查/校验 CSV、Excel、JSON 数据质量，或交付前验收数据时使用：生成 V2 校验配置（表结构 + 约束规则）、执行校验、按行解读违规结果并迭代修复至通过。"
description_zh: "用 Precis 校验表格数据质量：自动生成约束配置、执行校验、逐条汇报违规并迭代修复。"
description_en: "Validate CSV/Excel/JSON data quality with Precis: generate constraint configs, run validation, report violations row by row, and iterate to a clean pass."
version: 0.1.8
author: Precis Team
---

# Precis 数据校验工作流

Precis 是一个数据校验引擎：你为数据文件写一份 V2 YAML 配置（配置格式版本 2，
内容为表结构 + 约束规则），然后用 `precis validate` 执行校验，得到机器可读的
违规清单。本 skill 教你完成"读数据 → 写配置 → 执行 → 解读 → 迭代"的完整闭环。

## 第 0 步：前置检查

按优先级探测 CLI（找到一个可用即进入第 1 步）：

1. `precis --version` —— 用户已 pip 安装
   （`precis-cli` 是等价别名命令；探测与后续执行统一用 `precis` 为准）
2. `uvx --from precis-cli precis --version` —— 用户装有 [uv](https://docs.astral.sh/uv/)，
   免安装运行（首次会下载依赖，需等待）。此后所有 `precis ...` 命令都加
   `uvx --from precis-cli` 前缀执行
   （开发机也可 `uvx --from <Precis 仓库>/backend precis ...` 从源码跑）

两个都不可用时，告诉用户安装方式后**停止**（不要尝试其他替代方案）：

> Precis CLI 未安装。两种安装方式任选：
> 1. 安装 uv 后免安装运行：`uvx --from precis-cli precis --version`
> 2. pip 安装（要求 Python >= 3.12）：`pip install precis-cli`
> 安装后会获得 `precis` 命令。装好后重新发起校验。

## 第 1 步：读数据文件，确认落盘位置

1. 读取数据文件**头部**（CSV/JSON 用 `head`，Excel 需先看 sheet 名与首行），
   确认列名、大致类型、行数。
2. **先向用户确认配置落盘位置**（默认建议：数据文件所在目录下的 `precis-project/`），
   用户同意后再写文件。所有产物留在用户目录，可读、可 diff、可进 git。

## 第 2 步：写 V2 配置

**优先推断，再人工调整**（减少手写 YAML 的错误率）：

```bash
precis infer-schema <数据文件> --output <项目目录>/schemas/<表名>.schema.yaml
# 替换既有 schema 时保持 id 不变：--id <原UUID>；source 路径不对时 --source-path 修正
```

推断产出列类型草稿（string/integer/float/decimal/boolean/date；少量脏值
不会拖垮整列，按数据中的主导类型判定）。展示给用户确认后，按业务语义调整
（如补 primary_key、金额列改 decimal）。

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
  ForeignKey / Charset。Scripted / Conditional / DateLogic / Composite
  按需使用（Scripted 需项目开启 allow_eval，见 @references/v2-format.md）。
- 写完配置即可执行；配置自身的错误会以 `loading_warnings` 透出，无需单独校验。

## 第 3 步：执行校验

```bash
precis validate --manifest <项目目录>/project.precis.yaml --format json
```

- Windows 下路径含空格时用引号包裹。
- 大文件（>500MB）会自动分块加载，耗时长属正常，提醒用户耐心等待。
- **不要**在交互式命令行（REPL）中使用 `--format json`（该选项在 REPL 中会被忽略）。

## 第 4 步：按退出码解读

`--format json` 模式下 **stdout 只有一个 JSON 文档**（stderr 可能有日志，忽略），
退出码三分支：

| 退出码 | 含义 | 你要做的事 |
|--------|------|-----------|
| 0 | 校验通过 | 向用户报告通过，附 tables/summary 概览 |
| 1 | 校验完成，发现数据违规 | 解析 `errors[]`，逐条用中文汇报 |
| 2 | 工具自身错误 | 展示 stderr/错误消息，检查配置与路径后修复重试 |

`errors[]` 每条字段：`table`（表）、`column`（列）、`constraint_type`（约束类型）、
`constraint_file`（来源约束文件，相对 manifest 目录——独立约束是其
`*.constraint.yaml` 路径，schema 内嵌约束是宿主 schema 路径；格式校验等
无来源错误为 null）、`row_index`（行号）、`cell_value`（原始值）、
`error_message`（中文消息）。

汇报格式建议：

> 共发现 N 处违规（涉及 M 项约束检查，通过 X 项）：
> 1. 表 `orders` 第 127 行，列 `email`（NotNull 约束）：值为空 —— 非空约束冲突…
> 2. …

注意：`row_index` 是数据行索引（0 起，不含表头），汇报时可以换算成
"第 row_index+1 行数据"方便用户定位。

## 第 5 步：迭代闭环

违规处理只有两条路，**询问用户选哪条**：

1. **修数据**：用户改数据文件后，直接重新执行第 3 步。
2. **调规则**：你认为某条约束过严/过宽时，修改 `errors[].constraint_file`
   指向的约束文件后重新执行。

迭代直到退出码 0。中途用户要求调整超时/错误处理等项目设置时，参考
@references/v2-format.md 的 settings 一节。

## 禁令

- 不要手改或美化 JSON 输出，只做解析与转述。
- 不要绕过确认直接写配置文件到用户目录。
- 不要在交互式命令行（REPL）中使用 `--format json`。
- **不要替用户开启 `script_security.allow_eval`**——Scripted 约束需要执行
  表达式，属用户显式授权的安全决策；只在用户明确同意时由用户自己修改
  settings，并把风险（脚本执行）讲清楚。默认用其他约束类型替代。
- 环境配置了 MCP（`precis-mcp` server）时，优先直接调用 MCP 工具
  （validate_data / infer_schema / check_config / describe_constraints），
  其返回结构与 CLI JSON 契约一致；无 MCP 时走 Bash + CLI。
