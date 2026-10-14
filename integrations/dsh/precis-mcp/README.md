# @local/precis-mcp — Precis MCP 桥接的 DSH 插件（纯插件层，零 Precis 代码改动）

把 `precis-cli` Python 包自带的 MCP server（`precis-mcp`，stdio）桥接为 DSH 的原生 Agent 工具。装入后模型可用四个工具（返回值契约与 CLI `--format json` 同源）：

| 工具 | 用途 |
|---|---|
| `mcp__precis__validate_data` | 运行校验，返回与 CLI `--format json` 完全一致的契约结构 |
| `mcp__precis__infer_schema` | 从数据文件推断 Schema 草稿 |
| `mcp__precis__check_config` | 检查配置加载问题（不跑校验） |
| `mcp__precis__describe_constraints` | 列出 10 种约束类型及参数文档 |

## 组成

| 文件 | 职责 |
|---|---|
| `cordis.patch.yml` | 插入一个 `@deepseek-ai/dsh-mcp-client` 插件实例（`transport: stdio`、`serverName: precis`）及本机配置（`command` / `args` / `cwd`） |
| `locale/{zh,en}.json` | 插件列表的双语标题与描述 |

## 使用

1. 前置：PATH 上有 `precis-cli`，且 MCP 协议层依赖官方 SDK——`pip install "precis-cli[mcp]"`。
2. `plugin_manager install_bundle <本目录绝对路径>`；装入后重启 DSH 生效。
3. 在 DSH 对话中直接提出数据校验需求（如"校验这个项目里的 CSV"）。

GUI 插件 `../precis-panel` 依赖本 bundle 的 `mcp__precis__validate_data` 渲染校验结果 toolview；不装本 bundle 时面板可用，但没有 agent 工具与 toolview 数据。

## 已知限制（PoC）

- **Windows 启动方式**：`precis-mcp` 经 pip/pyenv 安装为 `.bat` shim，Node spawn 须借 `cmd /c` 启动（cordis.patch.yml 配置 `command: cmd`、`args: ['/c', 'precis-mcp']`）；免安装的 uvx 等价写法见 cordis.patch.yml 注释。
- **cwd 即路径白名单根**：`precis-mcp` 的文件参数白名单默认限服务器工作目录，cordis.patch.yml 的 `cwd` 硬编码为本机仓库路径，换机需改；要扩展范围时设 `PRECIS_MCP_ALLOWED_ROOTS`（见 cordis.patch.yml 注释）。
- `failOnStartupError: true`：server 启动失败直接暴露，不做静默降级。
- 模块代缓存：替换已安装包需重启 DSH（或换新包名），与其余 dsh 插件一致。
