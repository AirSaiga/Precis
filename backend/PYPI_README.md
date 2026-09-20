# Precis CLI

> Local-first data validation engine — define schemas and constraints in YAML, validate CSV / Excel / JSON with a single command.
> 本地优先的数据校验引擎：用 YAML 定义表结构与约束规则，一条命令校验 CSV / Excel / JSON。

**Alpha** — 核心功能稳定，配置格式有版本保障（V2）。

## 安装

```bash
pip install precis-cli          # 需要 Python >= 3.12

# 或免安装直接运行（需要 uv）
uvx --from precis-cli precis --version
```

## 快速上手

```bash
# 1. 从数据文件推断 schema 草稿
precis infer-schema orders.csv > schemas/orders.schema.yaml

# 2. 在项目清单 project.precis.yaml 中登记 schema 与约束文件
#    （格式见下方示例）

# 3. 执行校验
precis validate --manifest project.precis.yaml --format json
```

退出码契约（CI / AI agent 友好）：

| 退出码 | 含义 |
|--------|------|
| `0` | 校验通过 |
| `1` | 校验完成，发现数据违规（详情见 JSON 输出的 `errors`） |
| `2` | 工具自身错误（参数错误、文件不存在、异常崩溃） |

## 配置示例（V2 YAML）

`project.precis.yaml`：

```yaml
version: 2
project:
  id: my-project
  name: 订单数据校验
schemas:
  - id: orders
    path: schemas/orders.schema.yaml
constraints:
  - id: orders_amount_range
    path: constraints/orders_amount_range.constraint.yaml
```

`constraints/orders_amount_range.constraint.yaml`：

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

## 10 种约束类型

`NotNull` 非空 · `Unique` 唯一 · `AllowedValues` 枚举 · `Range` 数值区间 ·
`ForeignKey` 跨表引用 · `Conditional` 条件约束 · `Scripted` 脚本表达式 ·
`Charset` 字符集 · `DateLogic` 日期逻辑 · `Composite` 组合约束

数据类型：`string` / `integer` / `float` / `decimal` / `boolean` / `date`。
大文件（>500MB）自动分块加载。

## 与 AI Agent 集成

`--format json` 输出为机器可读契约（含行级错误定位与约束来源文件回溯），
可直接被 AI 编程助手消费：

- **MCP server**：`pip install "precis-cli[mcp]"` 后运行 `precis-mcp`（stdio），
  提供 `validate_data` / `infer_schema` / `check_config` / `describe_constraints` 四个工具
- **Kimi Code 插件**：`/plugins install https://github.com/AirSaiga/Precis`
- **CLI 自带 AI 命令**（自然语言生成/修改校验配置，独立于宿主 agent）：
  `pip install "precis-cli[ai]"`，然后 `precis ai chat` 或 `precis ai ask "..."`

## 链接

- 仓库与文档：<https://github.com/AirSaiga/Precis>
- 问题反馈：<https://github.com/AirSaiga/Precis/issues>
- 桌面 GUI 版本（画布式可视化编辑）见仓库 releases

License: Apache-2.0
