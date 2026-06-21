<div align="center">

# Precis

**本地优先的可视化数据质量平台 / Local-First Visual Data Quality Platform**

Visual DAG Editor · Schema-Aware Validation · Local-First

[![Status](https://img.shields.io/badge/status-Pre--Alpha-critical)](https://github.com/AirSaiga/Precis)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%5E20.19.0%20%7C%7C%20%3E%3D22.12.0-green.svg)](https://nodejs.org/)
[![Python](https://img.shields.io/badge/python-%3E%3D3.12-blue.svg)](https://python.org/)

[🇨🇳 中文](#中文) · [🇺🇸 English](#english)

</div>

> **⚠️ Pre-Alpha** — 方向验证与技术原型阶段，配置格式与 API 可能随时变更，不适合生产环境。
> 当前阶段**不接受外部 Pull Request**，欢迎 [Issues](https://github.com/AirSaiga/Precis/issues) 与 [Discussions](https://github.com/AirSaiga/Precis/discussions)。
>
> Ultra-early prototype. Config formats and APIs may change without notice. **No external PRs accepted** at this stage.
> [Issues](https://github.com/AirSaiga/Precis/issues) and [Discussions](https://github.com/AirSaiga/Precis/discussions) welcome.

---

<a name="中文"></a>

## 简介

Precis 是一款面向 Excel/CSV 表格数据的**本地优先**数据质量工具。通过可视化 DAG 画布，将数据校验流程从代码转化为拖拽操作——非技术人员亦可完成从数据源接入到多维度质量校验的完整链路。

三种入口：Electron 桌面应用（推荐）、CLI 命令行、REST API。

## 核心特性

| 能力 | 说明 |
|------|------|
| **可视化 DAG** | 基于 Vue Flow 的节点拖拽、自动连线、拓扑布局；20 条 Handle 级连接规则 |
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

| 工具 | 版本 |
|------|------|
| Node.js | `^20.19.0 \|\| >=22.12.0` |
| Python | `>=3.12,<3.14` |

### 安装

```bash
git clone https://github.com/AirSaiga/Precis.git
cd Precis
npm run install:all                    # 前端 + Electron 依赖
cd backend && python -m venv .venv && .venv\Scripts\activate && pip install -e ".[dev]" && cd ..
cp .env.example .env                   # 环境变量（默认即可）
```

> **一键安装**：`npm run setup:win`（Windows）或 `npm run setup:mac`（macOS/Linux）

### 启动

```bash
npm run electron:dev                   # 桌面版（推荐，自动管理后端）
npm run dev                            # 开发模式：后端(18000) + 前端(5173)
npm run cli                            # CLI 交互式命令行
npm run cli:validate                   # 快速验证安装是否正常
```

> Swagger UI：`http://127.0.0.1:18000/docs`

## 开发命令

| 类别 | 命令 |
|------|------|
| 代码检查 | `npm run lint:all` · `npm run format:all` |
| 类型检查 | `cd frontend && npm run type-check` |
| 测试 | `npm run test:all` · `npm run test:coverage` |
| E2E | `npm run e2e:install` · `npm run e2e:test` |
| 构建 | `npm run build:all` · `npm run frontend:build` · `npm run electron:build` |

> **Electron 生产打包说明**：当前安装包仅打包后端源码，运行时需目标机器已安装 Python `>=3.12,<3.14` 并在安装目录的 `resources/backend` 下执行 `pip install -e ".[api]"`。详见 [`electron/README.md`](electron/README.md)。

## 项目结构

```
Precis/
├── backend/        # FastAPI + CLI + 校验/转换引擎
├── frontend/       # Vue 3 可视化编辑器
├── electron/       # Electron 桌面壳
├── e2e/            # Playwright E2E 测试
├── scripts/        # 构建与部署脚本
├── AGENTS.md       # AI 辅助开发指南（详细的架构与规范）
└── package.json    # Monorepo 脚本入口
```

## 常见问题

**可以用于生产环境吗？** 不可以。Pre-Alpha 原型，API 与配置格式随时可能变更。

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
| **Visual DAG** | Node drag-and-drop, auto-connection, topological layout via Vue Flow; 20 handle-level connection rules |
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

| Tool | Version |
|------|---------|
| Node.js | `^20.19.0 \|\| >=22.12.0` |
| Python | `>=3.12,<3.14` |

### Installation

```bash
git clone https://github.com/AirSaiga/Precis.git
cd Precis
npm run install:all                    # Frontend + Electron deps
cd backend && python -m venv .venv && source .venv/bin/activate && pip install -e ".[dev]" && cd ..
cp .env.example .env                   # Env vars (defaults work)
```

> **One-click setup**: `npm run setup:win` (Windows) or `npm run setup:mac` (macOS/Linux)

### Launch

```bash
npm run electron:dev                   # Desktop app (recommended, auto-manages backend)
npm run dev                            # Dev mode: backend(18000) + frontend(5173)
npm run cli                            # CLI interactive shell
npm run cli:validate                   # Quick verification that setup is correct
```

> Swagger UI: `http://127.0.0.1:18000/docs`

## Development Commands

| Category | Commands |
|----------|----------|
| Lint | `npm run lint:all` · `npm run format:all` |
| Type Check | `cd frontend && npm run type-check` |
| Test | `npm run test:all` · `npm run test:coverage` |
| E2E | `npm run e2e:install` · `npm run e2e:test` |
| Build | `npm run build:all` · `npm run frontend:build` · `npm run electron:build` |

> **Electron production packaging note**: The installer currently ships the backend source only. The target machine must have Python `>=3.12,<3.14` installed, and dependencies must be installed in `resources/backend` via `pip install -e ".[api]"`. See [`electron/README.md`](electron/README.md) for details.

## Project Structure

```
Precis/
├── backend/        # FastAPI + CLI + Validation/Transform engine
├── frontend/       # Vue 3 visual editor
├── electron/       # Electron desktop shell
├── e2e/            # Playwright E2E tests
├── scripts/        # Build and deployment scripts
├── AGENTS.md       # AI-assisted development guide (detailed architecture & conventions)
└── package.json    # Monorepo script entry point
```

## FAQ

**Can it be used in production?** No. Pre-Alpha prototype; APIs and config formats may change without notice.

**Do you accept external contributions?** No external PRs at this stage. Issues and Discussions welcome.

## License

[Apache-2.0](LICENSE) — See [LICENSE_NOTICE.md](LICENSE_NOTICE.md) for details.
