<div align="center">

# Precis

**本地优先的可视化数据质量平台**

Visual DAG Editor · Schema-Aware Validation · Local-First · AI-Ready

[🇨🇳 中文](#中文) · [🇺🇸 English](#english)

[![Status](https://img.shields.io/badge/status-Pre--Alpha-critical)](https://github.com/AirSaiga/Precis)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%5E20.19.0%20%7C%7C%20%3E%3D22.12.0-green.svg)](https://nodejs.org/)
[![Python](https://img.shields.io/badge/python-%3E%3D3.12-blue.svg)](https://python.org/)

</div>

---

> **⚠️ 项目状态：Pre-Alpha**
>
> Precis 正处于**方向验证与技术原型**阶段。核心框架已就绪，但以下事项尚未完成：
> - 测试基线已建立，但核心引擎与边界场景覆盖仍不足，已知缺陷存在
> - 配置格式与 API 可能在无预警情况下变更
> - **不适合生产环境或关键业务数据**
>
> 开源目的在于展示技术方向、收集场景反馈。当前阶段**不接受外部 Pull Request**，欢迎通过 [Issues](https://github.com/AirSaiga/Precis/issues) 与 [Discussions](https://github.com/AirSaiga/Precis/discussions) 提交需求与缺陷。

---

<a name="中文"></a>

## 简介

Precis 是一款面向 Excel/CSV 类表格数据的**本地优先**数据质量工具。它通过可视化 DAG（有向无环图）将数据校验流程从代码转化为画布操作——非技术人员亦可拖拽节点、连接边线、配置规则，完成从数据源接入到多维度质量校验的完整链路。

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   数据源      │────→│    Schema    │────→│   转换节点    │────→│   约束节点    │
│ Excel / CSV  │     │   列定义      │     │ 拆分/过滤/映射 │     │ 唯一/非空/外键 │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
                                                      │
                                                      ↓
                                               ┌──────────────┐
                                               │    正则节点   │
                                               │  模式匹配引擎  │
                                               └──────────────┘
```

### 设计原则

- **Local-First** — 数据与配置完全驻留本地，无需上传云端
- **Visual DAG** — 基于 Vue Flow 的无限画布，所见即所得的校验流程编排
- **Schema-Aware** — 强类型列定义驱动，校验规则与数据结构深度绑定
- **Multi-Entry** — Electron 桌面应用、CLI 命令行、REST API 三种入口一致
- **AI-Ready** — 可选 LLM（OpenAI / Ollama）辅助生成校验配置

---

## 核心特性

### 可视化编辑器

- **DAG 画布**：基于 Vue Flow 的节点拖拽、自动连线、拓扑布局
- **节点体系**：Schema、约束、转换、正则、模板实例五大类节点
- **连接规则**：~25 条精确到 Handle 级别的边类型校验，防止非法连接
- **模板展开**：约束模板容器一键展开为子图，支持收起/重新展开

### 数据建模

- **Schema 定义**：列名、数据类型（string / integer / decimal / boolean / datetime / date / time）、内嵌约束
- **数据类型系统**：前端与后端统一类型体系，自动类型转换与校验
- **版本管理**：V2 YAML 配置格式，项目清单 `project.precis.yaml` 统一索引

### 校验引擎（后端）

- **10 种约束类型**：NotNull、Unique、ForeignKey、AllowedValues、Range、Conditional、Scripted、Charset、DateLogic、Composite
- **两阶段流水线**：数据加载与预处理 → 约束逐条校验，聚合错误报告
- **目标引用重验**：外键目标 Schema 数据就绪后，自动触发下游约束重验

### 转换引擎

- **22 种转换算子**：StringSplit、RegexExtract、MathExpr、DateFormat、ConditionalAssign、MapValue、Lookup、FilterRows、SortRows、Aggregate、CastType、Concat、Digits、DropDuplicates、FillNA、LowerCase、UpperCase、Modulo、Replace、Strip、Substring、WeightedSum
- **DAG 拓扑执行**：自动解析依赖图，按拓扑序链式执行

### 工程能力

- **Electron 桌面版**：主进程动态分配端口、启动 Python 后端、健康检查
- **国际化**：基于 Vue I18n，支持简体中文 / 英文切换
- **撤销/重做**：完整的操作历史栈，支持跨步骤回退
- **剪贴板**：节点复制、粘贴、多选批量操作

---

## 架构

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           Electron 桌面应用                                   │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐   │
│  │   Vue 3 前端     │  │   Vue Flow      │  │   Pinia 状态管理             │   │
│  │  TypeScript     │  │   画布引擎       │  │  graphStore（工厂模块拆分）   │   │
│  │  Vite 7         │  │                 │  │                             │   │
│  └────────┬────────┘  └─────────────────┘  └─────────────────────────────┘   │
│           │                                                                  │
│           ▼ IPC                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐   │
│  │                    FastAPI 后端（Python 3.12+）                         │   │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────────────┐  │   │
│  │  │  V2 API    │ │   CLI      │ │  校验引擎   │ │    转换引擎         │  │   │
│  │  │  CRUD      │ │  交互壳     │ │ 两阶段流水  │ │  DAG 拓扑执行      │  │   │
│  │  └────────────┘ └────────────┘ └────────────┘ └────────────────────┘  │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 后端分层

```
backend/app/shared/
├── core/       # 基础设施 — 文件 I/O、配置解析、数据加载（Pandas）
├── domain/     # 纯领域逻辑 — 约束、转换、表达式求值（零 I/O 依赖）
└── services/   # 应用服务 — 编排 core + domain，实现校验、AI、预览用例
```

### 前端核心

```
graphStore（Pinia Setup Store + 工厂模块注入）
├── setup.ts                      # Store 入口
├── modules/
│   ├── factories/                # 节点工厂（Schema / 约束 / 正则 / 转换）
│   ├── v2/
│   │   ├── import/               # V2 资源导入（Schema / 约束 / 正则 / 转换）
│   │   └── persistence/          # V2 持久化（保存 / 加载）
│   ├── connectionOps.ts          # 连接操作
│   ├── connectionStateSync.ts    # 连接状态同步
│   ├── templateExpand.ts         # 模板展开
│   ├── clipboard.ts              # 剪贴板
│   └── history.ts                # 撤销 / 重做
```

---

## 技术栈

| 层级 | 技术选型 |
|------|---------|
| 前端框架 | Vue 3 + TypeScript + Vite 7 |
| 状态管理 | Pinia（Setup Store） |
| 画布引擎 | Vue Flow |
| 路由 | Vue Router |
| 国际化 | Vue I18n（Composition API） |
| 后端框架 | Python 3.12+ + FastAPI + Uvicorn |
| 数据科学 | Pandas + Pydantic |
| 桌面壳 | Electron Forge + TypeScript |
| 前端质量 | ESLint + Prettier + Style Audit + Husky + lint-staged |
| 后端质量 | Ruff（lint + format + import 排序）+ mypy |
| 测试 | Vitest（前端）+ pytest（后端） |

---

## 快速开始

### 前置条件

- **Node.js**：`^20.19.0 || >=22.12.0`
- **Python**：`>=3.12`

### 安装

```bash
git clone https://github.com/AirSaiga/Precis.git
cd Precis
npm run install:all             # 安装 root + frontend + electron 依赖

cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -e ".[dev]"
```

### 启动

**桌面版（推荐）**
```bash
npm run electron:dev            # Electron 自动管理后端子进程
```

**开发模式（前后端分离）**
```bash
npm run dev                     # concurrently 同时启动后端 + 前端
# 或分别启动
npm run backend:dev             # FastAPI on http://127.0.0.1:18000
cd frontend && npm run dev      # Vite dev server
```

> Swagger UI：`http://127.0.0.1:18000/docs`

### CLI

```bash
cd backend
python -B -m app.cli
```

```
precis> open /path/to/project    # 打开项目
precis> validate                 # 校验全部数据表
precis> validate users           # 校验指定表
precis> help                     # 查看命令列表
precis> exit
```

---

## 开发指南

```bash
# 代码检查
npm run lint:all               # 前端 ESLint + 后端 Ruff
npm run format:all             # 前端 Prettier + 后端 Ruff format + fix

# 测试
cd frontend && npm run test    # Vitest
cd backend && python -m pytest # pytest

# 构建
npm run build:all              # 前端 + 后端
npm run frontend:build         # 前端（含 type-check）
npm run backend:build          # 后端（PyInstaller）
```

---

## 项目结构

```
Precis/
├── backend/                  # FastAPI + CLI + 校验 / 转换引擎
│   ├── app/
│   │   ├── api/              # REST API（V2 CRUD、校验、预览、AI）
│   │   │   ├── models/       # Pydantic 请求/响应模型
│   │   │   ├── routers/      # 路由定义
│   │   │   └── services/     # API 层服务
│   │   ├── cli/              # 交互式命令行入口
│   │   ├── shared/
│   │   │   ├── core/         # 配置引擎、项目加载器、文件 I/O
│   │   │   ├── domain/       # 领域模型：约束、转换、表达式、数据类型
│   │   │   └── services/     # 校验引擎、AI 服务、预览服务
│   │   └── start_server.py   # 服务器启动脚本
│   ├── tests/                # pytest 测试（unit + integration）
│   └── pyproject.toml
├── frontend/                 # Vue 3 可视化编辑器
│   ├── src/
│   │   ├── api/              # 后端 API 客户端（Axios）
│   │   ├── components/       # UI 组件（canvas / nodes / layout / settings / ai）
│   │   ├── composables/      # Vue 组合式函数（canvas / nodes / validation）
│   │   ├── core/             # 日志、HTTP、Toast
│   │   ├── features/         # 垂直功能模块（keyboard / regex / node-layout-organizer / ai-config-generator）
│   │   ├── i18n/             # 多语言资源（zh-CN / en-US）
│   │   ├── services/         # 构建器、校验器、连接规则、画布 API 注入
│   │   ├── stores/           # Pinia Stores（graphStore / canvasStore / workspaceStore / ...）
│   │   ├── types/            # TypeScript 类型定义
│   │   └── utils/            # 工具函数
│   └── package.json
├── electron/                 # Electron Forge 桌面壳
│   ├── src/                  # Main process + Preload
│   └── scripts/              # 启动脚本
├── docs/                     # 项目文档
├── scripts/                  # 构建与部署脚本（Windows + macOS/Linux）
├── qa_test/                  # 示例测试项目
├── AGENTS.md                 # AI 辅助开发指南
└── package.json
```

---

## 常见问题

**Q: 可以用于生产环境吗？**  
A: **不可以。** 当前为 Pre-Alpha 原型，存在已知缺陷，API 与配置格式随时可能变更。请勿在关键数据上使用。

**Q: 是否接受外部贡献？**  
A: 当前阶段**不接受外部 Pull Request**。架构与接口尚未稳定，欢迎提交 Issue 或在 Discussions 中交流使用场景。

**Q: 是否提供纯 Web 版本？**  
A: 不提供。Precis 采用本地优先架构，数据始终驻留本地。请使用 Electron 桌面版获得完整功能。

**Q: 后端能否独立部署？**  
A: 技术上可以，但 API 尚未稳定，不推荐服务器部署。

**Q: 支持哪些 LLM？**  
A: 任何兼容 OpenAI API 的服务（OpenAI、Azure、LocalAI）以及 Ollama。在 `~/.precis/ai_providers.yaml` 中配置。

---

## 许可证

[Apache-2.0](LICENSE) — 详见 [LICENSE_NOTICE.md](LICENSE_NOTICE.md)。

---

<a name="english"></a>

## Overview

Precis is a **local-first** data quality platform for Excel/CSV tabular data. It transforms data validation workflows from code into canvas operations through a visual DAG (Directed Acyclic Graph) — enabling non-technical users to drag nodes, connect edges, and configure rules to build complete pipelines from data ingestion to multi-dimensional quality validation.

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Data Source │────→│    Schema    │────→│  Transform   │────→│  Constraint  │
│ Excel / CSV  │     │ Column Defs  │     │ Split/Filter │     │ Unique/Null/FK│
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
                                                      │
                                                      ↓
                                               ┌──────────────┐
                                               │  Regex Node  │
                                               │ Pattern Match│
                                               └──────────────┘
```

### Design Principles

- **Local-First** — All data and configurations remain on your machine, no cloud upload required
- **Visual DAG** — Infinite canvas powered by Vue Flow for WYSIWYG validation pipeline orchestration
- **Schema-Aware** — Strongly-typed column definitions drive validation rules deeply bound to data structure
- **Multi-Entry** — Consistent behavior across Electron desktop app, CLI, and REST API
- **AI-Ready** — Optional LLM-assisted configuration generation (OpenAI / Ollama)

---

## Core Features

### Visual Editor

- **DAG Canvas**: Node drag-and-drop, auto-connection, and topological layout powered by Vue Flow
- **Node System**: Five categories — Schema, Constraint, Transform, Regex, and Template Instance
- **Connection Rules**: ~25 handle-level edge type validations to prevent illegal connections
- **Template Expansion**: One-click expansion of constraint templates into subgraphs, with collapse and re-expand support

### Data Modeling

- **Schema Definition**: Column names, data types (string / integer / decimal / boolean / datetime / date / time), and embedded constraints
- **Type System**: Unified type system across frontend and backend, with automatic type conversion and validation
- **Versioning**: V2 YAML configuration format, indexed by project manifest `project.precis.yaml`

### Validation Engine (Backend)

- **10 Constraint Types**: NotNull, Unique, ForeignKey, AllowedValues, Range, Conditional, Scripted, Charset, DateLogic, Composite
- **Two-Stage Pipeline**: Data loading and preprocessing → constraint-by-constraint validation with aggregated error reporting
- **Target Reference Revalidation**: Automatically triggers downstream constraint revalidation when foreign key target Schema data becomes available

### Transform Engine

- **22 Transform Operators**: StringSplit, RegexExtract, MathExpr, DateFormat, ConditionalAssign, MapValue, Lookup, FilterRows, SortRows, Aggregate, CastType, Concat, Digits, DropDuplicates, FillNA, LowerCase, UpperCase, Modulo, Replace, Strip, Substring, WeightedSum
- **DAG Topological Execution**: Automatically resolves dependency graphs and executes in topological order

### Engineering Capabilities

- **Electron Desktop**: Main process dynamically allocates ports, launches Python backend, and performs health checks
- **Internationalization**: Vue I18n-based, supports Simplified Chinese / English switching
- **Undo/Redo**: Complete operation history stack with cross-step rollback support
- **Clipboard**: Node copy, paste, and multi-select batch operations

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          Electron Desktop App                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐   │
│  │   Vue 3 Frontend │  │   Vue Flow      │  │   Pinia State Management    │   │
│  │  TypeScript     │  │   Canvas Engine │  │  graphStore (Factory Split) │   │
│  │  Vite 7         │  │                 │  │                             │   │
│  └────────┬────────┘  └─────────────────┘  └─────────────────────────────┘   │
│           │                                                                  │
│           ▼ IPC                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐   │
│  │                 FastAPI Backend (Python 3.12+)                        │   │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────────────┐  │   │
│  │  │  V2 API    │ │   CLI      │ │ Validation │ │   Transform Engine │  │   │
│  │  │  CRUD      │ │  Shell     │ │ 2-Stage    │ │  DAG Topological   │  │   │
│  │  └────────────┘ └────────────┘ └────────────┘ └────────────────────┘  │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Backend Layers

```
backend/app/shared/
├── core/       # Infrastructure — file I/O, config parsing, data loading (Pandas)
├── domain/     # Pure domain logic — constraints, transforms, expression evaluation (zero I/O dependency)
└── services/   # Application services — orchestrate core + domain for validation, AI, and preview use cases
```

### Frontend Core

```
graphStore (Pinia Setup Store + Factory Module Injection)
├── setup.ts                      # Store entry
├── modules/
│   ├── factories/                # Node factories (Schema / Constraint / Regex / Transform)
│   ├── v2/
│   │   ├── import/               # V2 resource import (Schema / Constraint / Regex / Transform)
│   │   └── persistence/          # V2 persistence (save / load)
│   ├── connectionOps.ts          # Connection operations
│   ├── connectionStateSync.ts    # Connection state synchronization
│   ├── templateExpand.ts         # Template expansion
│   ├── clipboard.ts              # Clipboard
│   └── history.ts                # Undo / Redo
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend Framework | Vue 3 + TypeScript + Vite 7 |
| State Management | Pinia (Setup Store) |
| Canvas Engine | Vue Flow |
| Routing | Vue Router |
| i18n | Vue I18n (Composition API) |
| Backend Framework | Python 3.12+ + FastAPI + Uvicorn |
| Data Science | Pandas + Pydantic |
| Desktop Shell | Electron Forge + TypeScript |
| Frontend Quality | ESLint + Prettier + Style Audit + Husky + lint-staged |
| Backend Quality | Ruff (lint + format + import sorting) + mypy |
| Testing | Vitest (frontend) + pytest (backend) |

---

## Quick Start

### Prerequisites

- **Node.js**: `^20.19.0 || >=22.12.0`
- **Python**: `>=3.12`

### Installation

```bash
git clone https://github.com/AirSaiga/Precis.git
cd Precis
npm run install:all             # Install root + frontend + electron dependencies

cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -e ".[dev]"
```

### Launch

**Desktop (Recommended)**
```bash
npm run electron:dev            # Electron auto-manages backend child process
```

**Development Mode (Decoupled)**
```bash
npm run dev                     # concurrently starts backend + frontend
# Or start separately
npm run backend:dev             # FastAPI on http://127.0.0.1:18000
cd frontend && npm run dev      # Vite dev server
```

> Swagger UI: `http://127.0.0.1:18000/docs`

### CLI

```bash
cd backend
python -B -m app.cli
```

```
precis> open /path/to/project    # Open a project
precis> validate                 # Validate all tables
precis> validate users           # Validate a specific table
precis> help                     # List all commands
precis> exit
```

---

## Development Guide

```bash
# Code quality
npm run lint:all               # Frontend ESLint + Backend Ruff
npm run format:all             # Frontend Prettier + Backend Ruff format + fix

# Testing
cd frontend && npm run test    # Vitest
cd backend && python -m pytest # pytest

# Build
npm run build:all              # Frontend + Backend
npm run frontend:build         # Frontend (with type-check)
npm run backend:build          # Backend (PyInstaller)
```

---

## Project Structure

```
Precis/
├── backend/                  # FastAPI + CLI + Validation / Transform Engine
│   ├── app/
│   │   ├── api/              # REST API (V2 CRUD, Validation, Preview, AI)
│   │   │   ├── models/       # Pydantic request/response models
│   │   │   ├── routers/      # Route definitions
│   │   │   └── services/     # API-layer services
│   │   ├── cli/              # Interactive CLI entry
│   │   ├── shared/
│   │   │   ├── core/         # Config engine, project loader, file I/O
│   │   │   ├── domain/       # Domain models: constraints, transforms, expressions, data types
│   │   │   └── services/     # Validation engine, AI services, preview services
│   │   └── start_server.py   # Server startup script
│   ├── tests/                # pytest tests (unit + integration)
│   └── pyproject.toml
├── frontend/                 # Vue 3 Visual Editor
│   ├── src/
│   │   ├── api/              # Backend API client (Axios)
│   │   ├── components/       # UI components (canvas / nodes / layout / settings / ai)
│   │   ├── composables/      # Vue composables (canvas / nodes / validation)
│   │   ├── core/             # Logging, HTTP, Toast
│   │   ├── features/         # Vertical feature modules (keyboard / regex / node-layout-organizer / ai-config-generator)
│   │   ├── i18n/             # Multi-language resources (zh-CN / en-US)
│   │   ├── services/         # Builders, validators, connection rules, canvas API injection
│   │   ├── stores/           # Pinia Stores (graphStore / canvasStore / workspaceStore / ...)
│   │   ├── types/            # TypeScript type definitions
│   │   └── utils/            # Utility functions
│   └── package.json
├── electron/                 # Electron Forge Desktop Shell
│   ├── src/                  # Main process + Preload
│   └── scripts/              # Startup scripts
├── docs/                     # Project documentation
├── scripts/                  # Build and deployment scripts (Windows + macOS/Linux)
├── qa_test/                  # Sample test projects
├── AGENTS.md                 # AI-assisted development guide
└── package.json
```

---

## FAQ

**Q: Can it be used in production?**  
A: **No.** This is a Pre-Alpha prototype with known defects. APIs and configuration formats may change without notice. Do not use with critical data.

**Q: Do you accept external contributions?**  
A: **Not accepting external Pull Requests** at this stage. The architecture and interfaces are not yet stable. Issues and Discussions are welcome.

**Q: Is there a pure web version?**  
A: No. Precis adopts a local-first architecture; data always remains on your machine. Please use the Electron desktop app for full functionality.

**Q: Can the backend be deployed independently?**  
A: Technically possible, but APIs are not yet stable and server deployment is not recommended.

**Q: Which LLMs are supported?**  
A: Any OpenAI API-compatible service (OpenAI, Azure, LocalAI) and Ollama. Configure in `~/.precis/ai_providers.yaml`.

---

## License

[Apache-2.0](LICENSE) — See [LICENSE_NOTICE.md](LICENSE_NOTICE.md) for details.
