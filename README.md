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
> - 测试覆盖率严重不足，已知缺陷存在
> - 配置格式与 API 可能在无预警情况下变更
> - **不适合生产环境或关键业务数据**
>
> 开源目的在于展示技术方向、收集场景反馈。当前阶段**不接受 Pull Request**，欢迎通过 [Issues](https://github.com/AirSaiga/Precis/issues) 与 [Discussions](https://github.com/AirSaiga/Precis/discussions) 提交需求与缺陷。

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
A: 当前阶段**不接受 Pull Request**。架构与接口尚未稳定，欢迎提交 Issue 或在 Discussions 中交流使用场景。

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

## English

> **⚠️ Status: Pre-Alpha**
>
> Precis is a **direction-validation prototype**. The core framework is functional but:
> - Test coverage is critically low and known bugs exist
> - Configuration formats and APIs may change without notice
> - **Not suitable for production or critical data**
>
> Open-sourced to demonstrate the technical direction and collect feedback. **Not accepting Pull Requests at this stage.** Issues and Discussions are welcome.

### Overview

Precis is a **local-first** data quality platform for Excel/CSV tabular data. It empowers non-developers to build complex validation pipelines through a **visual DAG editor** — drag nodes, connect edges, and configure rules without writing code.

### Design Principles

- **Local-First** — All data and configs stay on your machine
- **Visual DAG** — Infinite canvas powered by Vue Flow
- **Schema-Aware** — Strongly-typed column definitions drive validation rules
- **Multi-Entry** — Electron desktop, CLI, and REST API with consistent behavior
- **AI-Ready** — Optional LLM-assisted configuration generation (OpenAI / Ollama)

### Feature Highlights

| Capability | Status | Description |
|-----------|--------|-------------|
| Visual DAG Editor | Working | Node drag, auto-connection, topological layout |
| Schema Modeling | Working | Column definitions, 7 data types, embedded constraints |
| Constraint Engine | Working | 10 constraint types, 2-stage validation pipeline |
| Transform Engine | Working | 22 transform operators, DAG topological execution |
| Regex Nodes | Working | Pattern definition and matching |
| Template Expansion | Working | Expand/collapse/re-expand constraint templates |
| Validation History | Partial | Result persistence and historical query |
| AI Config Gen | Experimental | OpenAI / Ollama integration |
| i18n | Basic | zh-CN / en-US |

### Quick Start

**Prerequisites:** Node.js `^20.19.0 || >=22.12.0`, Python `>=3.12`

```bash
git clone https://github.com/AirSaiga/Precis.git
cd Precis
npm run install:all

cd backend
python -m venv .venv && source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install -e ".[dev]"
```

**Desktop:** `npm run electron:dev`

**Dev mode:** `npm run dev`

**CLI:**
```bash
cd backend && python -B -m app.cli
precis> open /path/to/project
precis> validate
```

### License

[Apache-2.0](LICENSE) — See [LICENSE_NOTICE.md](LICENSE_NOTICE.md).
</content>