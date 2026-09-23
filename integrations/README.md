# Precis Agent Harness 集成（通用）

让任何 AI agent 宿主程序（下称 harness，即运行 agent 的终端/编辑器环境，如
Kimi Code、Claude Code、ZCode、Cursor 及一切支持 MCP 或 shell 的 CLI agent）
用自然语言完成数据质量校验：推断数据结构、生成 V2 校验配置（配置格式版本 2）、
执行校验、逐条汇报违规、导出报告，迭代直到全部通过。

无需安装或打开 Precis 桌面 GUI。

## 分层设计（本目录是 harness 中立的共享内容根）

```
┌─ L1 CLI 契约（所有 harness 共用的基础层）────────────────┐
│  precis 命令 + JSON 输出契约 + 退出码 0/1/2              │
│  只要有 shell，任何 agent 都能用；也是下两层的地基        │
├─ L2 通用 skill（有文件系统 + shell 的 harness）──────────┤
│  skills/precis-data-validation/：工作流手册 + V2 格式速查 │
│  纯 markdown + 相对路径引用，无专有语法，可直接拷贝使用   │
├─ L3 MCP（协议原生的 harness）────────────────────────────┤
│  precis-mcp stdio server：4 个工具，返回值即 L1 契约      │
└──────────────────────────────────────────────────────────┘
```

- **单一实现**：L2/L3 共用 L1 的同一套实现与输出结构，不存在第二份分叉实现
  （CLI `--format json`、MCP `validate_data`、`--report` 报告三者内容同源）。
- 本目录同时是一个完整的 **Kimi Code 插件包根**（`kimi.plugin.json` 与
  `skills/`、`commands/` 同级），支持整目录/子目录 URL 安装。

## 宿主程序接入矩阵

| 宿主程序 | 接入方式 | 说明 |
|---------|---------|------|
| **Kimi Code** | 插件包安装（见下） | 同时提供 skill、`/precis:*` 命令与 MCP 三种接入 |
| **Claude Code** | 拷贝 skills + commands（见下） | 同一份 SKILL.md；命令变为 `/precis:validate` 等项目命令 |
| **ZCode** | 拷贝 skill 或经 MCP | skill 规范兼容；`precis-mcp` 配置见下 |
| **Cursor / 其他 MCP harness** | MCP 配置 `precis-mcp` | 无需 skill，工具返回结构化 JSON |
| **任意 shell agent** | 直接用 L1 CLI | 本 README 的契约文档即接口说明 |

## 前置条件（任选其一，所有 harness 通用）

**方式 A：pip 安装（要求 Python >= 3.12，< 3.14）**

```bash
pip install precis-cli     # 分发名 precis-cli（PyPI "precis" 已被占用），命令名是 precis
precis --version           # 验证
```

**方式 B：uvx 免安装（要求 [uv](https://docs.astral.sh/uv/)，无需 pip）**

```bash
uvx --from precis-cli precis --version
# 此后所有命令加 uvx --from precis-cli 前缀，如：
uvx --from precis-cli precis validate --manifest ./project.precis.yaml --format json
```

**方式 C：从源码（开发者）**

```bash
pip install -e /path/to/Precis/backend
# 或 uvx --from /path/to/Precis/backend precis ...
```

MCP 需要 `pip install "precis-cli[mcp]"`（可选依赖，官方 mcp SDK）。

## Kimi Code 安装

```
# 本地路径（开发态即装即用）
/plugins install /path/to/Precis/integrations

# GitHub URL（四种形式，以 Kimi Code 官方文档为准）
/plugins install https://github.com/AirSaiga/Precis                              # 1. 仓库根（经 .kimi-plugin/plugin.json 垫片）
/plugins install https://github.com/AirSaiga/Precis/tree/main                    # 2. 仓库默认分支
/plugins install https://github.com/AirSaiga/Precis/tree/main/integrations       # 3. 子目录（kimi.plugin.json 在该目录根）
/plugins install https://github.com/AirSaiga/Precis/tree/v0.1.2/integrations     # 4. 指定 tag/commit 的子目录
```

安装后 `/reload` 生效。

> 双 manifest 说明：`integrations/kimi.plugin.json` 与仓库根
> `.kimi-plugin/plugin.json` 指向同一份 skills/commands，**必须同步修改**
> （CI golden 测试校验一致性）。

## Claude Code 安装

```bash
# 项目级（仅当前项目可用）
mkdir -p .claude/skills .claude/commands/precis
cp -r integrations/skills/precis-data-validation .claude/skills/
cp integrations/commands/*.md .claude/commands/precis/   # 子目录即命名空间：/precis:validate 等

# 或用户级（所有项目可用）
mkdir -p ~/.claude/skills ~/.claude/commands/precis
cp -r integrations/skills/precis-data-validation ~/.claude/skills/
cp integrations/commands/*.md ~/.claude/commands/precis/
```

之后自然语言触发（"用 precis 检查这个 CSV"）或使用 `/precis:validate` 等项目命令。
命令文件为 description frontmatter + `$ARGUMENTS` 正文，与 Claude Code
命令规范兼容。

> 注意：命令必须拷进 `commands/precis/` **子目录**——Claude Code 以子目录名
> 作命令命名空间；平铺到 `commands/` 得到的是 `/validate`、`/init`、`/report`，
> 其中 `/init` 会与 Claude Code 内置命令撞名。

## MCP 直连（Cursor / ZCode / 其他 MCP harness）

插件的 `mcpServers.precis` 声明（命令 `precis-mcp`，stdio）。手动接入：

```json
{ "mcpServers": { "precis": { "command": "precis-mcp", "args": [] } } }
```

| 工具 | 作用 |
|------|------|
| `validate_data` | 执行校验，返回与 CLI `--format json` **完全相同**的契约结构 |
| `infer_schema` | 从数据文件推断 schema 草稿 |
| `check_config` | 检查配置加载问题（不执行校验） |
| `describe_constraints` | 列出 10 种约束类型与 refs/params 说明 |

健康自检（仅源码仓库）：`cd backend && python -m scripts.mcp_smoke_test`（模拟 stdio 客户端
完成 initialize → tools/list → tools/call 全流程）。

> 依赖说明：MCP 协议层使用官方 `mcp` Python SDK（`mcp>=1.30.0,<2`，
> 2.x 尚处迁移期）。工具执行复用 CLI 同一实现，未分叉第二套输出格式。

## CLI 契约（L1，供任何 agent 直接消费）

```bash
precis validate --manifest <项目目录>/project.precis.yaml --format json
precis infer-schema <数据文件> [--output <path>]     # 推断 schema 草稿
precis validate ... --report <path>.html|.xlsx       # 可分享报告，与 JSON 同源
```

**退出码**：

| 码 | 含义 |
|----|------|
| 0 | 校验通过 |
| 1 | 校验完成，发现数据违规 |
| 2 | 工具自身错误（参数错误、文件不存在、异常崩溃） |

**JSON 输出**（`--format json` 时 stdout 仅含一个 UTF-8 JSON 文档，
人类可读输出被抑制；完整契约见
[validate-json-v1.md](https://github.com/AirSaiga/Precis/blob/main/docs/contracts/validate-json-v1.md)）：

```json
{
  "schema_version": 1,
  "is_valid": false,
  "interrupted": false,
  "duration_ms": 120,
  "tables": [{"name": "orders", "rows": 15234}],
  "summary": {"constraints_total": 5, "constraints_passed": 3, "constraints_failed": 2},
  "errors": [
    {
      "table": "orders",
      "column": "amount",
      "constraint_type": "NotNullConstraint",
      "constraint_file": "constraints/orders_amount_notnull.constraint.yaml",
      "row_index": 127,
      "cell_value": null,
      "error_message": "非空约束冲突: 列 'amount' 的值不能为空。"
    }
  ],
  "loading_warnings": []
}
```

- 缺值字段一律为 `null`，但字段始终存在。
- `row_index` 为 0 起的数据行索引（不含表头）。
- `constraint_file` 为**相对 manifest 目录**的来源文件路径：独立约束是其
  `*.constraint.yaml` 路径，schema 内嵌约束是宿主 `*.schema.yaml` 路径；
  格式校验/超时等无约束来源的错误为 `null`。凭此可直接打开并修改约束文件。
- `loading_warnings` 透传配置/加载阶段的问题（如 ID 不一致、文件缺失、
  manifest 版本不支持），配置写错通常在这里暴露。

## 安全说明

- **Scripted 约束与 `allow_eval`**：执行自定义表达式属安全敏感操作。skill 明确
  约束 agent **不得替用户开启** `script_security.allow_eval`，只能提示用户自行
  修改并讲清风险；默认以其他 9 种约束类型替代。
- **MCP 路径白名单**：`precis-mcp` 的所有文件参数（manifest/数据目录/数据文件）
  只允许访问 **server 工作目录** 内的路径，防止 agent 被诱导读写任意文件；
  需要扩展范围时由用户设置 `PRECIS_MCP_ALLOWED_ROOTS` 环境变量（os.pathsep 分隔）。
- 校验全程只读数据文件；写操作仅限用户明确请求的 `--output` / `--report` 路径。

## 故障排查

| 症状 | 处理 |
|------|------|
| `precis --version` 报命令未找到 | 未安装或不在 PATH：`pip install precis-cli` 后重开终端，或改用 `uvx --from precis-cli` |
| agent 说配置已写但校验报"清单文件不存在" | 检查 `--manifest` 路径与落盘位置是否一致（Windows 路径含空格需引号） |
| errors 一直为空但数据明显有问题 | 约束可能没写或没在 manifest `constraints:` 里登记；或 `refs.column_id` 用了列名而非列 ID |
| Scripted 约束报权限错误 | 在 `project.precis.yaml` 的 `settings.script_security.allow_eval: true`（用户自行操作） |
| 大文件校验很久无响应 | >500MB 自动分块加载，属正常；可调大 `settings.validation.timeout_seconds` |
| 退出码 2 且 stderr 有堆栈 | 工具错误：多为 YAML 语法错误或路径不存在，按 stderr 提示修正 |
| MCP 工具调用无响应 | 确认装了 `precis-cli[mcp]`；跑 `python -m scripts.mcp_smoke_test` 自检 |

## 卸载与版本兼容

- 卸载：`/plugins remove precis`（仅删除安装记录，插件副本与源文件保留在磁盘上）。
- 插件版本与 `precis-cli` 版本独立演进：本文档按最新版 CLI 的行为编写，
  建议保持 CLI 为最新（`pip install -U precis-cli`）；版本不一致时以 CLI 实际行为为准。

## License

Apache-2.0（见本目录 `LICENSE` 文件）。

## 目录结构

```
integrations/                          # 通用集成根（同时是 Kimi 插件包根）
├── kimi.plugin.json                   # Kimi Code 插件 manifest（入口之一）
├── marketplace.json                   # Kimi marketplace 上架材料
├── LICENSE                            # Apache-2.0
├── README.md                          # 本文件：通用接入文档
├── skills/precis-data-validation/
│   ├── SKILL.md                       # 通用 skill 工作流手册（无专有语法）
│   └── references/v2-format.md        # V2 YAML 格式速查
├── commands/                          # 通用命令正文（description frontmatter + $ARGUMENTS）
│   ├── validate.md
│   ├── init.md
│   └── report.md
└── workbuddy/                         # 腾讯 WorkBuddy 开放平台上架材料（见该目录 README）
```

对应仓库根 `.kimi-plugin/plugin.json`（整仓安装垫片）与后端
`precis` / `precis-mcp` 命令（`backend/app/cli/` 与 `backend/app/mcp_server.py`）。
