<div align="center">

# Precis

**本地优先的可视化数据质量平台 / Local-First Visual Data Quality Platform**

Visual DAG Editor · Schema-Aware Validation · Local-First

[![Status](https://img.shields.io/badge/status-Alpha-orange)](https://github.com/AirSaiga/Precis)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%5E20.19.0%20%7C%7C%20%3E%3D22.12.0-green.svg)](https://nodejs.org/)
[![Python](https://img.shields.io/badge/python-%3E%3D3.12-blue.svg)](https://python.org/)

[中文](#中文) · [English](#english)

</div>

> **Alpha** — 核心功能已实现，API 与配置格式可能调整，暂不建议生产环境使用。
> 当前阶段**暂不接受外部 Pull Request**，欢迎 [Issues](https://github.com/AirSaiga/Precis/issues) 与 [Discussions](https://github.com/AirSaiga/Precis/discussions)。
>
> Alpha stage. Core features are implemented; APIs and config formats may change. **Not recommended for production.**
> **No external PRs accepted** at this stage. [Issues](https://github.com/AirSaiga/Precis/issues) and [Discussions](https://github.com/AirSaiga/Precis/discussions) welcome.

---

<a name="中文"></a>

## 简介

Precis 是一款面向 Excel/CSV 表格数据的**本地优先**数据质量工具。通过可视化 DAG 画布，将数据校验流程从代码转化为拖拽操作——非技术人员亦可完成从数据源接入到多维度质量校验的完整链路。

三种入口：Electron 桌面应用（推荐）、CLI 命令行、REST API。

## 核心特性

| 能力 | 说明 |
|------|------|
| **可视化 DAG** | 基于 Vue Flow 的节点拖拽、自动连线、拓扑布局；22 条 Handle 级连接规则 |
| **Schema 建模** | 6 种数据类型（string / integer / float / decimal / boolean / date），V2 YAML 配置格式 |
| **校验引擎** | 10 种约束（NotNull / Unique / ForeignKey / AllowedValues / Range / Conditional / Scripted / Charset / DateLogic / Composite），两阶段流水线，≥500MB 自动分块 |
| **转换引擎** | 22 种算子（字符串拆分、正则提取、数学表达式、聚合、过滤、排序……），DAG 拓扑执行 |
| **工程能力** | Electron 桌面版、中英双语 i18n、撤销/重做、剪贴板、自动更新 |

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Vue 3 + TypeScript + Vite + Pinia + Vue Flow + Vue I18n |
| 后端 | Python 3.12+ · FastAPI + Uvicorn + Pydantic + Pandas |
| 桌面端 | Electron + electron-builder |
| 测试 | Vitest + pytest + Playwright E2E |
| 代码质量 | ESLint + Prettier + Ruff + mypy |

## 架构

后端三层分离：`core/`（基础设施）→ `domain/`（纯领域逻辑，零 I/O）→ `services/`（应用服务编排）。

前端核心：Pinia Setup Store + 工厂模块注入的 graphStore，统一管理画布节点/边/历史。

## 快速开始

### 前置条件

| 工具 | 版本 | 说明 |
|------|------|------|
| Node.js | `^20.19.0 \|\| >=22.12.0` | 含 npm |
| Python | `>=3.12,<3.14` | 3.12 或 3.13；CLI 命令为 `python3.12` / `python3.13` 亦可 |

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

克隆仓库后，根据使用场景二选一。

#### 路径一：一键脚本（推荐，普通用户）

脚本自动完成：Python 3.12+ 探测 → 创建虚拟环境 → 安装后端依赖（`requirements.txt`）→ 安装前端三处依赖 → 构建前端与 Electron。

```bash
git clone https://github.com/AirSaiga/Precis.git
cd Precis
npm run setup:mac              # macOS / Linux（等同 bash scripts/setup.sh）
# npm run setup:win            # Windows（等同 scripts/setup.ps1）
```

> - 想跳过构建只装依赖？`bash scripts/setup.sh --skip-build`
> - 一键脚本用 `requirements.txt`（打包锁定快照），**不含** pytest/ruff/mypy 等开发工具。

#### 路径二：手动分步（开发者）

开发者应改用可编辑安装 `pip install -e ".[dev]"`，以获得代码补全、类型检查与测试工具。

```bash
git clone https://github.com/AirSaiga/Precis.git
cd Precis

# 1. 前端三处依赖（根 / frontend / electron）
npm run install:all

# 2. 后端虚拟环境 + 可编辑安装（含开发工具）
cd backend
python3.12 -m venv .venv               # 若命令是 python3.13 则相应替换
source .venv/bin/activate              # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install --upgrade pip
pip install -e ".[dev]"                # 含 pytest / ruff / mypy 等
cd ..

# 3. 环境变量（可选，默认即可，见下方「环境变量」）
cp .env.example .env
```

> **关键提示**：凡是调用 `python` 的 npm 脚本（`dev` / `backend:dev` / `cli` / `electron:dev`），执行前都要先 `source backend/.venv/bin/activate`，否则会用到系统过低的 Python。

### 启动

三种入口，按需选择：

```bash
npm run electron:dev          # ① 桌面应用（推荐）：自动拉起后端 + 前端
npm run dev                   # ② 开发模式：前后端分离，带热重载（端口动态分配）
npm run cli                   # ③ CLI：交互式命令行
```

| 入口 | 前置条件 | 说明 |
|------|---------|------|
| `npm run electron:dev` | 已 `source backend/.venv/bin/activate` | Electron 自动管理后端子进程，最省心 |
| `npm run dev` | 已 `source backend/.venv/bin/activate` | concurrently 同时起后端 + 前端，便于调试 |
| `npm run cli` | 已 `source backend/.venv/bin/activate` | 纯命令行，无需前端 |
| `./scripts/mac/start-cli.sh` | 无需激活 | macOS 脚本自动定位 venv |

### 验证安装

```bash
npm run cli:validate          # 用内置示例数据跑一次校验
```

该命令依赖随仓库的 `qa_test/qa_simple/` 示例数据（已被 git 跟踪，clone 后即可用）。运行后输出校验结果即代表环境就绪。

### 环境变量

根目录 `.env` 由 `.env.example` 复制而来，**默认全部留空即可运行**：

| 变量 | 默认 | 说明 |
|------|------|------|
| `VITE_BACKEND_PORT` | 留空 → 动态分配 | 留空时后端端口由 OS 分配（永不冲突），实际端口写入 `backend/.backend-port`；取消注释设为 `18000` 即固定端口 |
| `VITE_FRONTEND_PORT` | `5173` | 前端 Vite dev server 端口 |

> Swagger UI 地址随后端端口：动态端口时请看启动日志；固定 `18000` 时为 `http://127.0.0.1:18000/docs`。

## 开发命令

| 类别 | 命令 |
|------|------|
| 代码检查 | `npm run lint:all` · `npm run format:all` |
| 类型检查 | `cd frontend && npm run type-check` |
| 测试 | `npm run test:all` · `npm run test:coverage` |
| E2E | `npm run e2e:install` · `npm run e2e:test` |
| 构建 | `npm run build:all` · `npm run frontend:build` · `npm run electron:build` |

> **Electron 生产打包说明**：安装包内嵌 Python 运行时（python-build-standalone）与全部后端依赖，用户无需自装 Python。详见 [`electron/README.md`](electron/README.md)。

> **CLI / TUI 独立打包**：除桌面应用外，CLI 与 TUI 也可各打成自包含分发包（内置 Python 运行时 + 后端源码，解压即用，无需自装 Python/Rust）。
>
> | 产物 | Windows | macOS |
> |------|---------|-------|
> | CLI | `npm run build:cli:win` → `backend/dist-win/precis-cli-win-*.zip` | `npm run build:cli:mac` → `backend/dist-mac/precis-cli-mac-*.tar.gz` |
> | TUI | `npm run build:tui:win` → `tui-rust/dist-win/precis-tui-win-*.zip` | `npm run build:tui:mac` → `tui-rust/dist-mac/precis-tui-mac-*.tar.gz` |
> | 一键全打 | `npm run build:all:win`（CLI + TUI + GUI） | `npm run build:all:mac`（CLI + TUI + GUI） |
>
> 解压后：CLI 运行 `precis.bat` / `./precis`；TUI 运行 `precis-tui.exe` / `./precis-tui`（自动拉起内置后端）。

## 项目结构

```
Precis/
├── backend/        # FastAPI + CLI + 校验/转换引擎
├── frontend/       # Vue 3 可视化编辑器
├── electron/       # Electron 桌面壳
├── e2e/            # Playwright E2E 测试
├── scripts/        # 构建与部署脚本（完整启动指南见 scripts/README.md）
├── AGENTS.md       # AI 辅助开发指南（详细的架构与规范）
└── package.json    # Monorepo 脚本入口
```

## 常见问题

**可以用于生产环境吗？** 暂不建议。Alpha 阶段，核心功能可用但稳定性仍在打磨，API 与配置格式可能调整。

**接受外部贡献吗？** 当前不接受外部 PR，欢迎 Issue 和 Discussion。

## 许可证

[Apache-2.0](LICENSE) — 详见 [LICENSE_NOTICE.md](LICENSE_NOTICE.md)。

---

<a name="english"></a>

## Overview

Precis is a **local-first** data quality platform for Excel/CSV tabular data. It transforms data validation workflows from code into canvas operations through a visual DAG — non-technical users can build complete validation pipelines by dragging nodes and connecting edges.

Three entry points: Electron desktop app (recommended), CLI, and REST API.

## Core Features

| Capability | Description |
|-----------|-------------|
| **Visual DAG** | Node drag-and-drop, auto-connection, topological layout via Vue Flow; 22 handle-level connection rules |
| **Schema Modeling** | 6 data types (string / integer / float / decimal / boolean / date), V2 YAML config format |
| **Validation Engine** | 10 constraint types (NotNull / Unique / ForeignKey / AllowedValues / Range / Conditional / Scripted / Charset / DateLogic / Composite), two-stage pipeline, auto-chunking for files ≥500MB |
| **Transform Engine** | 22 operators (string split, regex extract, math expression, aggregate, filter, sort, etc.), DAG topological execution |
| **Engineering** | Electron desktop, zh-CN/en-US i18n, undo/redo, clipboard, auto-update |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vue 3 + TypeScript + Vite + Pinia + Vue Flow + Vue I18n |
| Backend | Python 3.12+ · FastAPI + Uvicorn + Pydantic + Pandas |
| Desktop | Electron + electron-builder |
| Testing | Vitest + pytest + Playwright E2E |
| Quality | ESLint + Prettier + Ruff + mypy |

## Architecture

Backend three-layer separation: `core/` (infrastructure) → `domain/` (pure domain logic, zero I/O) → `services/` (application service orchestration).

Frontend core: Pinia Setup Store + factory module injection graphStore for unified canvas node/edge/history management.

## Quick Start

### Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | `^20.19.0 \|\| >=22.12.0` | includes npm |
| Python | `>=3.12,<3.14` | 3.12 or 3.13; `python3.12` / `python3.13` also fine |

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

After cloning, pick the path that matches your use case.

#### Path 1: One-click script (recommended, regular users)

The script automatically: detects Python 3.12+ → creates a venv → installs backend deps (`requirements.txt`) → installs the three frontend dep sets → builds frontend & Electron.

```bash
git clone https://github.com/AirSaiga/Precis.git
cd Precis
npm run setup:mac              # macOS / Linux (equivalent to bash scripts/setup.sh)
# npm run setup:win            # Windows (equivalent to scripts/setup.ps1)
```

> - Want to install deps without building? `bash scripts/setup.sh --skip-build`
> - The one-click script uses `requirements.txt` (a locked snapshot for packaging) and does **not** include dev tools like pytest/ruff/mypy.

#### Path 2: Manual steps (developers)

Developers should use the editable install `pip install -e ".[dev]"` to get code completion, type checking, and testing tools.

```bash
git clone https://github.com/AirSaiga/Precis.git
cd Precis

# 1. Frontend deps (root / frontend / electron)
npm run install:all

# 2. Backend venv + editable install (with dev tools)
cd backend
python3.12 -m venv .venv               # replace with python3.13 if that's your command
source .venv/bin/activate              # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install --upgrade pip
pip install -e ".[dev]"                # includes pytest / ruff / mypy etc.
cd ..

# 3. Env vars (optional, defaults work — see "Environment Variables" below)
cp .env.example .env
```

> **Key tip**: any npm script that invokes `python` (`dev` / `backend:dev` / `cli` / `electron:dev`) requires `source backend/.venv/bin/activate` first, otherwise the system's outdated Python will be used.

### Launch

Three entry points — pick as needed:

```bash
npm run electron:dev          # ① Desktop app (recommended): auto-spawns backend + frontend
npm run dev                   # ② Dev mode: backend + frontend split, with hot reload (dynamic ports)
npm run cli                   # ③ CLI: interactive shell
```

| Entry | Prerequisite | Notes |
|-------|--------------|-------|
| `npm run electron:dev` | `source backend/.venv/bin/activate` | Electron manages the backend subprocess — least hassle |
| `npm run dev` | `source backend/.venv/bin/activate` | concurrently runs backend + frontend, good for debugging |
| `npm run cli` | `source backend/.venv/bin/activate` | CLI only, no frontend needed |
| `./scripts/mac/start-cli.sh` | none | macOS script auto-locates the venv |

### Verify the Installation

```bash
npm run cli:validate          # runs a validation pass on built-in sample data
```

This command relies on the `qa_test/qa_simple/` sample data shipped with the repo (git-tracked, available right after clone). A successful validation output means your environment is ready.

### Environment Variables

The root `.env` is copied from `.env.example` — **all defaults work as-is**:

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_BACKEND_PORT` | empty → dynamic | When empty, the OS assigns a port (never conflicts); the actual port is written to `backend/.backend-port`. Uncomment and set to `18000` to pin a fixed port |
| `VITE_FRONTEND_PORT` | `5173` | Vite dev server port |

> The Swagger UI URL follows the backend port: check the startup log for dynamic ports, or use `http://127.0.0.1:18000/docs` when pinned to 18000.

## Development Commands

| Category | Commands |
|----------|----------|
| Lint | `npm run lint:all` · `npm run format:all` |
| Type Check | `cd frontend && npm run type-check` |
| Test | `npm run test:all` · `npm run test:coverage` |
| E2E | `npm run e2e:install` · `npm run e2e:test` |
| Build | `npm run build:all` · `npm run frontend:build` · `npm run electron:build` |

> **Electron production packaging note**: The installer bundles a self-contained Python runtime (python-build-standalone) and all backend dependencies — users do not need to install Python. See [`electron/README.md`](electron/README.md) for details.

> **Standalone CLI / TUI packaging**: Besides the desktop app, the CLI and TUI can each be packaged as self-contained bundles (bundled Python runtime + backend source; extract and run, no Python/Rust install needed).
>
> | Artifact | Windows | macOS |
> |----------|---------|-------|
> | CLI | `npm run build:cli:win` → `backend/dist-win/precis-cli-win-*.zip` | `npm run build:cli:mac` → `backend/dist-mac/precis-cli-mac-*.tar.gz` |
> | TUI | `npm run build:tui:win` → `tui-rust/dist-win/precis-tui-win-*.zip` | `npm run build:tui:mac` → `tui-rust/dist-mac/precis-tui-mac-*.tar.gz` |
> | All-in-one | `npm run build:all:win` (CLI + TUI + GUI) | `npm run build:all:mac` (CLI + TUI + GUI) |
>
> After extraction: CLI runs `precis.bat` / `./precis`; TUI runs `precis-tui.exe` / `./precis-tui` (auto-spawns the bundled backend).

## Project Structure

```
Precis/
├── backend/        # FastAPI + CLI + Validation/Transform engine
├── frontend/       # Vue 3 visual editor
├── electron/       # Electron desktop shell
├── e2e/            # Playwright E2E tests
├── scripts/        # Build and deployment scripts (full startup guide in scripts/README.md)
├── AGENTS.md       # AI-assisted development guide (detailed architecture & conventions)
└── package.json    # Monorepo script entry point
```

## FAQ

**Can it be used in production?** Not yet recommended. Alpha stage: core features work, but stability is still being polished and APIs/config formats may change.

**Do you accept external contributions?** No external PRs at this stage. Issues and Discussions welcome.

## License

[Apache-2.0](LICENSE) — See [LICENSE_NOTICE.md](LICENSE_NOTICE.md) for details.
