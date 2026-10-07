# @local/precis-panel — Precis GUI 的 DSH 插件（纯插件层，零 Precis 代码改动）

路径③混合方案的 GUI 部分：**完整 Precis 画布面板** + **校验结果原生 toolview**。

## 组成

| 文件 | 职责 |
|---|---|
| `host.js` | Host 半：`ctx.effect` 内 spawn `python app/start_server.py`（cwd=backend，动态端口 → `backend/.backend-port`），并在 `127.0.0.1:17860` 起微壳：静态服务 `frontend/dist`（SPA 回退）+ `/api/*` 反代到后端 + `/_precis/health`；卸载时 taskkill 进程树 |
| `client.js` | Client 半（React）：`sidebar.panellist` 图标（表格+对勾）→ `main[key=precis]` 面板（健康门控 iframe 指向微壳，同源无 CORS/token）；`tool.call.toolview[key=mcp__precis__validate_data]` 消费 validate-json-v1 契约渲染违规表格/通过率/加载警告 |
| `cordis.patch.yml` | 插入行 + 本机配置（`backendDir` / `distDir` / `shellPort` / `pythonCommand`） |

依赖的 Precis 既有边界（均无需改 Precis 代码）：axios 相对路径 `/api/latest` + 反代部署支持、Vite `base:'./'`、`.backend-port` 发现协议、capabilities 层 Web 模式。

## 使用

1. 先装 MCP bundle（`../precis-mcp`），否则面板可用但没有 agent 工具与 toolview 数据。
2. `plugin_manager install_bundle <本目录绝对路径>`；客户端模块随**页面刷新**加载（无 dev:web 时热刷新不生效）。
3. 刷新 DSH 页面 → 左侧边栏出现 Precis 图标 → 点击进入面板（首次等后端启动几秒）。

## 已知限制（PoC）

- **`.backend-port` 冲突**：该文件是 Electron 桌面版与本插件共用的发现协议。**不要同时运行** Precis 桌面版与本插件，否则端口文件被后启动者覆盖，先启动者的代理会指向错误端口。
- `shellPort` 同时硬编码在 client.js 的 `SHELL_ORIGIN`（默认 17860）；改配置需两处同步。生产版应把 shell 地址经配置下发到 Client 半。
- 未声明 Config schema（避免 schemastery 跨 profile 解析问题）；生产版应补 `z.object` 校验并迁移到 `ctx.subprocess`。
- iframe 主题/亮暗不随 DSH（官方 practices 对 iframe 的已知劝退点）；对话面 toolview 是全 token 化的原生组件，不受此限。
- 模块代缓存：DSH 宿主按包名缓存已加载 JS 模块，**替换已安装包需重启 DSH**（或换新包名）。
