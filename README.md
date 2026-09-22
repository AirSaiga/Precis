<div align="center">

# Precis

**本地优先的可视化数据质量平台 / Local-First Visual Data Quality Platform**

Visual DAG Editor · Schema-Aware Validation · Local-First

[![Status](https://img.shields.io/badge/status-Alpha-orange)](https://github.com/AirSaiga/Precis)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%5E20.19.0%20%7C%7C%20%3E%3D22.12.0-green.svg)](https://nodejs.org/)
[![Python](https://img.shields.io/badge/python-3.12%20%7C%203.13-blue.svg)](https://python.org/)

[中文](#中文) · [English](#english)

</div>

> **Alpha** — 核心功能已实现，API 与配置格式可能调整，暂不建议生产环境使用。
> 当前阶段**暂不接受外部 Pull Request**，欢迎 [Issues](https://github.com/AirSaiga/Precis/issues) 与 [Discussions](https://github.com/AirSaiga/Precis/discussions)。
>
> Alpha stage. Core features are implemented; APIs and config formats may change. **Not recommended for production.**
> **No external PRs accepted** at this stage. [Issues](https://github.com/AirSaiga/Precis/issues) and [Discussions](https://github.com/AirSaiga/Precis/discussions) welcome.

---

<a name="中文"></a>

## 这是什么

Precis 是一款面向 Excel/CSV 表格数据的**本地优先**数据质量工具。通过可视化 DAG 画布，把数据校验流程从代码变成拖拽操作——非技术人员也能完成从数据源接入到多维度质量校验的完整链路。数据全程不出本机。

四种入口，按需选择：**Electron 桌面应用**（推荐）、**CLI 命令行**、**TUI 终端界面**、**REST API**。

## 核心特性

- **可视化校验流程** — 拖拽节点、连线即完成建模，无需编写校验代码
- **10 种约束类型** — 非空 / 唯一 / 外键 / 枚举值 / 范围 / 条件 / 脚本 / 字符集 / 日期逻辑 / 组合
- **22 种转换算子** — 字符串拆分、正则提取、数学表达式、聚合、过滤、排序等
- **大文件友好** — 超大文件自动分块处理
- **本地优先** — 数据不出本机；中英双语界面；桌面应用内置运行时，开箱即用

## 快速开始

### 前置条件

| 工具 | 版本 | 说明 |
|------|------|------|
| Node.js | `^20.19.0 \|\| >=22.12.0` | 含 npm |
| Python | `>=3.12,<3.14` | 3.12 或 3.13 |
| Rust | stable | 可选，仅构建 TUI 需要 |

<details>
<summary>🔍 如何确认本机版本</summary>

```bash
node --version          # 应 ≥ 20.19.0 或 ≥ 22.12.0
python3 --version       # 应为 3.12.x 或 3.13.x
```

若系统默认 `python3` 低于 3.12（macOS 自带 3.9 即如此），可用 Homebrew 装一个：

```bash
brew install python@3.12    # 装好后用 python3.12 调用
```

</details>

### 安装

```bash
git clone https://github.com/AirSaiga/Precis.git
cd Precis
npm run setup:mac              # macOS / Linux
# npm run setup:win            # Windows
```

一键脚本自动完成：Python 探测 → 创建虚拟环境 → 安装依赖 → 构建前端与 Electron。

> 只想在命令行 / agent 里做数据校验、不需要 GUI？直接 `pip install precis-cli`（PyPI）获得 `precis` 命令，也可以在任何 agent harness（Kimi Code / Claude Code / MCP 客户端等）中接入：[`integrations/`](integrations/README.md)。

<details>
<summary>🛠️ 开发者手动安装（可编辑模式 + 测试工具）</summary>

```bash
git clone https://github.com/AirSaiga/Precis.git
cd Precis

# 1. 前端依赖（npm workspaces：根目录一次安装 frontend / electron / e2e）
npm run install:all

# 2. 后端虚拟环境 + 可编辑安装（含开发工具）
cd backend
python3.12 -m venv .venv               # 若命令是 python3.13 则相应替换
source .venv/bin/activate              # Windows PowerShell: .venv\Scripts\Activate.ps1；Git Bash: source .venv/Scripts/activate
pip install --upgrade pip
pip install -e ".[dev]"                # 含 pytest / ruff / mypy 等
cd ..
```

> **关键提示**：凡是调用 `python` 的 npm 脚本（`dev` / `backend:dev` / `cli` / `electron:dev`），执行前都要先 `source backend/.venv/bin/activate`，否则会用到系统过低的 Python。

</details>

### 启动

```bash
npm run electron:dev          # 桌面应用（推荐）：自动拉起后端 + 前端
npm run dev                   # 开发模式：前后端分离，带热重载
npm run cli                   # 纯命令行，无需前端
npm run start:tui             # Rust 终端界面
```

> 更多启动方式与脚本说明见 [`scripts/README.md`](scripts/README.md) 与 [`tui-rust/README.md`](tui-rust/README.md)。

### 验证安装

```bash
npm run cli:validate          # 用内置示例数据（qa_test/qa_simple/）跑一次校验
```

输出校验结果即代表环境就绪。

## 项目结构

```
Precis/
├── backend/        # FastAPI + CLI + 校验/转换引擎
├── frontend/       # Vue 3 可视化编辑器
├── electron/       # Electron 桌面壳
├── tui-rust/       # Rust 终端界面（TUI）
├── e2e/            # Playwright E2E 测试
├── qa_test/        # 内置示例/测试数据
├── scripts/        # 构建与部署脚本
└── docs/           # 架构参考
```

## 更多文档

- **开发者**：开发命令、技术栈与打包说明见 [CONTRIBUTING.md](CONTRIBUTING.md)；架构细节见 [AGENTS.md](AGENTS.md) 与 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [CHANGELOG.md](CHANGELOG.md) — 变更日志
- [SECURITY.md](SECURITY.md) — 安全说明
- 各端详情：[backend](backend/README.md) · [frontend](frontend/README.md) · [electron](electron/README.md) · [tui-rust](tui-rust/README.md) · [scripts](scripts/README.md) · [e2e](e2e/README.md)

## 许可证

[Apache-2.0](LICENSE) — 详见 [LICENSE_NOTICE.md](LICENSE_NOTICE.md)。

---

<a name="english"></a>

## What is Precis

Precis is a **local-first** data quality platform for Excel/CSV tabular data. It turns validation workflows from code into drag-and-drop operations on a visual DAG canvas — non-technical users can build complete validation pipelines without writing code. Your data never leaves your machine.

Four entry points: **Electron desktop app** (recommended), **CLI**, **TUI terminal app**, and **REST API**.

## Core Features

- **Visual validation pipelines** — drag nodes and connect edges, no validation code required
- **10 constraint types** — NotNull / Unique / ForeignKey / AllowedValues / Range / Conditional / Scripted / Charset / DateLogic / Composite
- **22 transform operators** — string split, regex extract, math expression, aggregate, filter, sort, etc.
- **Large-file friendly** — oversized files are automatically processed in chunks
- **Local-first** — data stays on your machine; zh-CN/en-US UI; the desktop app ships with a bundled runtime, ready out of the box

## Quick Start

### Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | `^20.19.0 \|\| >=22.12.0` | includes npm |
| Python | `>=3.12,<3.14` | 3.12 or 3.13 |
| Rust | stable | optional, only for building the TUI |

<details>
<summary>🔍 How to check your local versions</summary>

```bash
node --version          # should be ≥ 20.19.0 or ≥ 22.12.0
python3 --version       # should be 3.12.x or 3.13.x
```

If the system `python3` is older than 3.12 (macOS ships 3.9 by default), install one via Homebrew:

```bash
brew install python@3.12    # then invoke as python3.12
```

</details>

### Installation

```bash
git clone https://github.com/AirSaiga/Precis.git
cd Precis
npm run setup:mac              # macOS / Linux
# npm run setup:win            # Windows
```

The one-click script automatically: detects Python → creates a venv → installs dependencies → builds the frontend & Electron.

> Only need validation from the command line / an agent, no GUI? Just `pip install precis-cli` (PyPI) to get the `precis` command — or integrate it into any agent harness (Kimi Code / Claude Code / MCP clients, etc.): [`integrations/`](integrations/README.md).

<details>
<summary>🛠️ Manual install for developers (editable mode + test tools)</summary>

```bash
git clone https://github.com/AirSaiga/Precis.git
cd Precis

# 1. Frontend deps (npm workspaces: one root install covers frontend / electron / e2e)
npm run install:all

# 2. Backend venv + editable install (with dev tools)
cd backend
python3.12 -m venv .venv               # replace with python3.13 if that's your command
source .venv/bin/activate              # Windows PowerShell: .venv\Scripts\Activate.ps1; Git Bash: source .venv/Scripts/activate
pip install --upgrade pip
pip install -e ".[dev]"                # includes pytest / ruff / mypy etc.
cd ..
```

> **Key tip**: any npm script that invokes `python` (`dev` / `backend:dev` / `cli` / `electron:dev`) requires `source backend/.venv/bin/activate` first, otherwise the system's outdated Python will be used.

</details>

### Launch

```bash
npm run electron:dev          # Desktop app (recommended): auto-spawns backend + frontend
npm run dev                   # Dev mode: backend + frontend split, with hot reload
npm run cli                   # CLI only, no frontend needed
npm run start:tui             # Rust terminal UI
```

> More launch options and script details: [`scripts/README.md`](scripts/README.md) and [`tui-rust/README.md`](tui-rust/README.md).

### Verify the Installation

```bash
npm run cli:validate          # runs a validation pass on the built-in sample data (qa_test/qa_simple/)
```

A successful validation output means your environment is ready.

## Project Structure

```
Precis/
├── backend/        # FastAPI + CLI + Validation/Transform engine
├── frontend/       # Vue 3 visual editor
├── electron/       # Electron desktop shell
├── tui-rust/       # Rust terminal UI (TUI)
├── e2e/            # Playwright E2E tests
├── qa_test/        # Built-in sample/test data
├── scripts/        # Build and deployment scripts
└── docs/           # Architecture reference
```

## More Documentation

- **Developers**: dev commands, tech stack & packaging notes in [CONTRIBUTING.md](CONTRIBUTING.md); architecture details in [AGENTS.md](AGENTS.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [CHANGELOG.md](CHANGELOG.md) — Changelog
- [SECURITY.md](SECURITY.md) — Security notes
- Per-app details: [backend](backend/README.md) · [frontend](frontend/README.md) · [electron](electron/README.md) · [tui-rust](tui-rust/README.md) · [scripts](scripts/README.md) · [e2e](e2e/README.md)

## License

[Apache-2.0](LICENSE) — See [LICENSE_NOTICE.md](LICENSE_NOTICE.md) for details.
