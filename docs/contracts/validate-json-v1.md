# `precis validate --format json` 输出契约 v1

> 状态：**已冻结**（自 2026-09-20 起）
> 实现单一事实源：`backend/app/cli/shell/commands/validate.py` 的 `_build_json_payload`
> 契约快照测试：`backend/tests/unit/cli/test_validate_json_contract.py`

本文档定义 `precis validate --manifest <path> --format json` 在 **stdout** 上输出的
JSON 文档结构。消费方（Kimi Code 插件、CI、其他 agent harness）可依赖本文档的承诺。

## 总则

- stdout **只包含一个 JSON 文档**（`json.dumps(..., ensure_ascii=False)`，单行，UTF-8）。
  Spinner、rich 摘要等人类可读输出在 JSON 模式下被抑制；日志走 stderr。
- **字段必须存在，缺值填 `null`**——消费方判空即可，不需要判键存在。
- `schema_version` 当前为 `1`。

## 兼容性承诺（v1）

1. **只增不减**：v1 生命周期内新增字段是允许的（消费方应容忍未知字段）；
   既有字段的**名称与语义不变**。
2. **破坏性变更**（删字段、改语义、改类型）必须递增 `schema_version`，
   并同步更新本文档。
3. 退出码语义（见下）独立于 `schema_version`，同为冻结承诺。

## 顶层字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `schema_version` | `int` | 输出契约版本，当前恒为 `1` |
| `is_valid` | `bool` | `true` 当且仅当 `errors` 为空；loading_warnings 不影响该判定 |
| `interrupted` | `bool` | 因 `error_handling: stop`（遇错即停）提前终止时为 `true` |
| `duration_ms` | `int` | 校验总耗时（毫秒） |
| `tables` | `list[TableEntry]` | 加载并参与校验的数据表清单，见下 |
| `summary` | `Summary` | 约束检查统计，见下 |
| `errors` | `list[ErrorEntry]` | 违规/错误条目，见下 |
| `loading_warnings` | `list[dict]` | 加载阶段问题（原样透传 `loading_errors`），条目结构见下 |

### `tables[i]`

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | `str \| null` | 表显示名（来自 validation_details.format_checks） |
| `rows` | `int \| null` | 表行数；标准模式为 DataFrame 长度，分块模式为 `row_count`；取不到为 `null` |

### `summary`

| 字段 | 类型 | 说明 |
|------|------|------|
| `constraints_total` | `int` | 执行过的约束检查项数 |
| `constraints_passed` | `int` | 通过项数 |
| `constraints_failed` | `int` | 失败项数（`total = passed + failed`） |

### `errors[i]`

| 字段 | 类型 | 说明 |
|------|------|------|
| `table` | `str \| null` | 表显示名 |
| `column` | `str \| null` | 列名；跨表/表级错误可能为 `null` |
| `constraint_type` | `str \| null` | 约束类名（如 `NotNullConstraint`）；格式校验错误为 `FormatValidation`；超时/中断类为对应类型 |
| `constraint_file` | `str \| null` | **相对 manifest 目录**的来源文件路径：独立约束为其 `*.constraint.yaml` 路径，schema 内嵌约束为宿主 `*.schema.yaml` 路径；格式校验/超时/模板展开产物等无来源错误为 `null` |
| `row_index` | `int \| null` | 0 起的数据行索引（不含表头）；无行概念的错误为 `null` |
| `cell_value` | `any (JSON) \| null` | 违规单元格原始值；numpy 标量归一为 Python 原生类型，NaN/Inf 转字符串 |
| `error_message` | `str \| null` | 人类可读错误消息（中文） |

### `loading_warnings[i]`

加载阶段问题（`LoadingError.to_dict()` 原样透传），常用字段：`error_type`、
`file_path`、`ref_id`、`message`、`severity`、`title`、`description`、`fix_hint`。
manifest 版本问题（`ManifestVersionError`）、文件缺失、解析失败、ID 不一致等
都经此通道透出。

## 退出码契约（单发模式，与输出格式正交）

| 码 | 含义 | 典型场景 |
|----|------|---------|
| `0` | 校验通过 | `errors` 为空且校验正常完成 |
| `1` | 校验完成，发现数据违规 | `errors` 非空（含格式错误、约束违规） |
| `2` | 工具自身错误 | 参数错误（含非法 `--format` 值、未知命令）、manifest 路径不存在、异常崩溃 |

注意：manifest **存在但版本不支持**（`ManifestVersionError`）经 loading_warnings
结构化透出，校验流程可控收场（`errors` 含数据未加载错误）→ 退出码 `1`；
manifest 不存在/内容非法崩溃 → 退出码 `2`。

`--report` 导出失败（路径不可写/非法扩展名）**不破坏 stdout 契约**：stdout 仍输出
完整 JSON 文档（校验结果如实呈现），错误文案经 stderr 透出，退出码为 `2`
（工具自身错误；与数据违规的 `1` 区分）。

交互 REPL 模式不受退出码契约影响；`--format` 仅在 standalone（含 `--manifest`）模式生效。
