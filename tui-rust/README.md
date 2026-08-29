# Precis TUI

Precis 的终端 UI（Terminal User Interface）客户端，使用 **Rust + ratatui** 实现。

TUI 是独立于 Electron 桌面端和 Web 前端的**第三种客户端形态**，通过 HTTP 调用 Python 后端（FastAPI），自身不包含业务逻辑——所有数据校验、配置解析、AI 能力都由后端提供。

## 架构

```
┌─────────────────────────────────────────────────┐
│  Precis TUI (Rust)                              │
│                                                 │
│  main.rs ── 同步事件循环（crossterm 事件轮询）   │
│      │                                          │
│      ├── ui/     界面渲染（8 个 tab/面板）       │
│      ├── app.rs  应用状态 + 双主题配色系统       │
│      ├── fx.rs   动效（移动光场背景）            │
│      ├── icons.rs 单宽几何图标字典              │
│      └── theme.rs 主题持久化（~/.precis/）       │
│              │                                  │
│              │ tokio::spawn 异步 + mpsc channel  │
│              ▼                                  │
│  api/ ── HTTP 客户端（reqwest）                 │
└──────────────────┬──────────────────────────────┘
                   │ HTTP (JSON)
                   ▼
          Python 后端 (FastAPI, 动态端口)
```

**核心设计**：渲染循环永不阻塞。HTTP 请求在 `tokio::spawn` 的后台 task 里执行，结果通过 `mpsc::channel` 送回主循环，避免终端卡顿。

## 运行环境要求

- **Rust**（stable toolchain，含 cargo）
- **Python 后端**，三种来源任一即可：复用已运行的后端（启动脚本自动探测）、由 TUI 自行拉起（见下「后端地址解析」）、或经 `PRECIS_BACKEND_URL` 显式指定

## 构建 & 运行

```bash
# 推荐：根目录便捷脚本（自动复用已运行的后端，没有则由 TUI 自行拉起）
npm run start:tui-rust:win        # Windows
npm run start:tui-rust:mac        # macOS / Linux

# 手动构建运行
cd tui-rust && cargo build
cd tui-rust && cargo run          # 未设 PRECIS_BACKEND_URL 时，TUI 会拉起自己的后端
                                  #（dev 态定位系统 python——先激活 backend/.venv 再运行）
                                  # 连接已运行的后端：设 PRECIS_BACKEND_URL=http://127.0.0.1:<端口>

# Release 优化构建（启用 LTO）
cd tui-rust && cargo build --release && ./target/release/precis-tui
```

## 配置（环境变量）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PRECIS_BACKEND_URL` | （见下） | 后端 API 地址。**未设置时**，TUI 会尝试拉起内置后端（打包态自包含）；设置了则直接连该外部后端 |
| `PRECIS_WORK_DIR` | 当前工作目录 | 默认工作目录 |
| `PYTHON_PATH` | — | 指定内置后端用的 Python 解释器路径（未设置时按 bundled runtime → 系统 python 顺序查找） |
| `RUST_LOG` | `info` | 日志级别（tracing） |

### 后端地址解析（`main.rs::resolve_backend_url`）

优先级：
1. `PRECIS_BACKEND_URL` 已设置 → 直接连（外部后端 / dev 模式）
2. 未设置 → 调用 `backend::BackendHandle::start()` 拉起内置后端子进程：
   - 定位 Python 解释器：`PYTHON_PATH` → exe 同级 `python-runtime/`（打包态）→ 仓库根 `python-runtime/`（dev）→ 系统 `python3`/`python`
   - spawn `<python> app/start_server.py --port 0`，cwd = 定位到的 `backend/` 目录
   - 轮询 `backend/.backend-port`（200ms 间隔，30s 超时）拿到 OS 分配的端口
   - `/health` 健康检查通过后进入 TUI 主循环
   - TUI 退出时通过 RAII（`Drop`）杀掉后端子进程树（Unix 进程组 SIGTERM/SIGKILL；Windows `taskkill /T /F`）

## 打包（自包含分发包）

详见仓库根 [`README.md`](../README.md) 的"CLI / TUI 独立打包"章节。

```bash
# Windows（产物 tui-rust/dist-win/precis-tui-win-*.zip）
npm run build:tui:win

# macOS（产物 tui-rust/dist-mac/precis-tui-mac-*.tar.gz）
npm run build:tui:mac
```

打包布局：
```
precis-tui/
├── precis-tui(.exe)   # Rust 二进制，启动时 spawn 同级后端
├── python-runtime/     # bundled CPython（python-build-standalone）
└── backend/            # 后端源码（剔除缓存/测试/.git）
```
解压后直接运行二进制即可，无需自装 Python/Rust。

## 主题

双主题配色系统，运行时按键切换，持久化到 `~/.precis/tui-theme.json`：

- **樱花粉（Sakura）** — 暖色基调
- **飘雪冰蓝（Snow）** — 冷色基调

## 语言 / Language

界面文案默认**中文**。通过环境变量切换**英文**，优先级为 `PRECIS_LANG` → `LC_ALL` → `LC_CTYPE` → `LANG`（取顺序中第一个已设置的变量；值含 `en` 即英文，含 `zh` 或其他值均为中文默认）：

```bash
PRECIS_LANG=en-US cargo run        # 英文界面 / English UI
```

## 源码结构

| 文件/目录 | 职责 |
|-----------|------|
| `src/main.rs` | 入口、事件循环、键位处理、后台任务调度、后端地址解析 |
| `src/app.rs` | 应用状态、双主题配色（thread_local 调色板） |
| `src/backend.rs` | 打包态后端编排：定位 runtime、spawn 子进程、读端口、退出清理 |
| `src/api/` | HTTP 客户端（`client.rs`）、后端响应类型（`types.rs`） |
| `src/ui/` | 界面模块：dashboard / validation / provider / config / chat / widgets / splash |
| `src/fx.rs` | 动效系统（移动光场 + 脉冲波纹，不用字符粒子） |
| `src/icons.rs` | 统一图标字典（单宽几何符号，禁用 emoji） |
| `src/theme.rs` | 主题持久化读写 |

## 开发约定

详见 [`AGENTS.md`](./AGENTS.md)。
