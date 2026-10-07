# Precis CLI

> Local-first data validation engine — define schemas and constraints in YAML, validate CSV / TSV / Excel / JSON / JSONL with a single command.

**Beta** — core functionality is stable and the configuration format is versioned and frozen (V2, additive changes only).

## Installation

```bash
pip install precis-cli          # requires Python >= 3.12

# Or run without installing (requires uv)
uvx --from precis-cli precis --version
```

The distribution name is `precis-cli`; the command name is `precis` (`precis-cli` works as an equivalent alias).

## Quick Start

```bash
# 1. Infer a draft schema from a data file
precis infer-schema orders.csv > schemas/orders.schema.yaml

# 2. Register the schema and constraint files in the project manifest
#    project.precis.yaml (format shown below)

# 3. Run validation
precis validate --manifest project.precis.yaml --format json
```

Exit code contract (CI / AI-agent friendly):

| Exit code | Meaning |
|-----------|---------|
| `0` | Validation passed |
| `1` | Validation completed and found data violations (see `errors` in the JSON output) |
| `2` | Tool error (invalid arguments, missing file, unhandled crash) |

## Configuration Example (V2 YAML)

`project.precis.yaml`:

```yaml
version: 2
project:
  id: my-project
  name: Orders validation
schemas:
  - id: orders
    path: schemas/orders.schema.yaml
constraints:
  - id: orders_amount_range
    path: constraints/orders_amount_range.constraint.yaml
```

`constraints/orders_amount_range.constraint.yaml`:

```yaml
version: 2
id: orders_amount_range
type: Range
enabled: true
refs:
  table_id: orders
  column_id: amount
params:
  min: 0
  max: 1000000
  boundary_mode: inclusive
```

## 10 Constraint Types

`NotNull` not null · `Unique` unique · `AllowedValues` allowed values · `Range` numeric range ·
`ForeignKey` cross-table reference · `Conditional` conditional constraint · `Scripted` scripted expression ·
`Charset` character set · `DateLogic` date logic · `Composite` composite constraint

Data types: `string` / `integer` / `float` / `decimal` / `boolean` / `date`.
Large files (>500MB) are loaded in chunks automatically.

## AI Agent Integration

The `--format json` output is a machine-readable contract (including row-level error locations and
traceability back to the constraint source file), ready to be consumed by AI coding assistants:

- **MCP server**: after `pip install "precis-cli[mcp]"`, run `precis-mcp` (stdio), which exposes four
  tools: `validate_data` / `infer_schema` / `check_config` / `describe_constraints`
- **Kimi Code plugin**: `/plugins install https://github.com/AirSaiga/Precis`
- **Built-in CLI AI commands** (generate or modify validation config in natural language, independent of
  the host agent): `pip install "precis-cli[ai]"`, then `precis ai chat` or `precis ai ask "..."`

## Links

- Repository and documentation: <https://github.com/AirSaiga/Precis>
- Issue tracker: <https://github.com/AirSaiga/Precis/issues>
- Desktop GUI edition (canvas-based visual editing) is available on the repository releases page

License: Apache-2.0

## 中文简介

本地优先的数据校验引擎：用 YAML 定义表结构与约束规则，一条命令校验 CSV / TSV / Excel / JSON / JSONL。
安装：`pip install precis-cli`（需 Python >= 3.12），或免安装运行 `uvx --from precis-cli precis --version`。
最简上手：`precis infer-schema orders.csv > schemas/orders.schema.yaml`，在 `project.precis.yaml` 中登记 schema 与约束文件后，
执行 `precis validate --manifest project.precis.yaml --format json`。
退出码：`0` 校验通过 · `1` 发现数据违规 · `2` 工具自身错误。命令名为 `precis`（`precis-cli` 为等价别名）。
