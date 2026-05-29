<div align="center">

# Precis

**本地优先的可视化数据校验工具（Visual DAG Flow）**

[🇨🇳 中文](#中文) · [🇺🇸 English](#english)

[![Status](https://img.shields.io/badge/status-Prototype%2FPre--Alpha-red.svg)]()
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%5E20.19.0%20%7C%7C%20%3E%3D22.12.0-green.svg)](https://nodejs.org/)
[![Python](https://img.shields.io/badge/python-%3E%3D3.12-blue.svg)](https://python.org/)

</div>

---

> ⚠️ **超早期原型（Pre-Alpha）**
>
> 这是一个**方向验证中的技术原型**，核心功能框架已搭成并在持续迭代：
> - ❌ **测试覆盖严重不足**，已知存在 Bug
> - ❌ **配置格式和 API 不稳定**，随时可能重构
> - ❌ **不适合生产环境或关键数据**
> - ✅ **开源仅为展示方向、收集需求反馈**
> - ✅ **暂不接受 Pull Request，但欢迎提交 Issue**
>
> 如果你对这个方向感兴趣，欢迎通过 [Discussions](https://github.com/AirSaiga/Precis/discussions) 聊聊你的痛点和需求。

---

<a name="中文"></a>

## 🎯 我们在尝试解决什么问题？

Precis 是一个**本地优先**的数据校验工具，面向 Excel/CSV 类表格数据。它通过**可视化 DAG（有向无环图）**让非开发人员也能搭建复杂的数据校验流程——拖拽节点、连线、配置规则，无需编写代码。

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  数据源      │────→│   表结构    │────→│   转换节点   │────→│   约束节点   │
│ (Excel/CSV) │     │  (列定义)   │     │ (拆分/过滤等)│     │ (唯一/非空等)│
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
                                                │
                                                ↓
                                         ┌─────────────┐
                                         │    正则     │
                                         │  (模式匹配)  │
                                         └─────────────┘
```

**设计理念：**
- 🏠 **Local-First** — 所有文件留在本地，不上传云端
- 🎨 **可视化 DAG** — 用画布编排校验流程（Vue Flow）
- ⚡ **多入口** — Electron 桌面版、CLI、API 三种入口
- 🔌 **AI-Ready** — 可选 LLM 辅助生成校验配置

---

## ✨ 功能概览

| 模块 | 状态 | 说明 |
|------|------|------|
| V2 项目清单 | 🚧 可用 | `project.precis.yaml` 索引 Schema、Constraint、Regex、Transform |
| 可视化编辑器 | 🚧 可用 | Vue Flow 画布，节点拖拽、连线、属性编辑、模板展开 |
| Schema 编辑 | 🚧 可用 | 列定义、数据类型（string/integer/decimal/boolean/datetime/date/time） |
| 约束引擎 | 🚧 可用 | 10 种约束类型（见下表），支持内嵌约束与独立约束 |
| 转换引擎 | 🚧 可用 | 22 种转换类型，DAG 拓扑排序链式执行 |
| 正则节点 | 🚧 可用 | 正则表达式定义与模式匹配 |
| 约束规则集 | 🚧 部分可用 | 约束规则分组与规则集管理 |
| 校验历史 | 🚧 部分可用 | 校验结果持久化存储与历史查询 |
| AI 配置生成 | 🚧 实验性 | OpenAI / Ollama 集成 |
| 国际化 | ✅ 基础 | 简体中文 / 英文 |
| 测试覆盖 | ❌ 严重不足 | 尚未达到生产可用标准 |

### 约束类型（10 种）

| 约束类型 | 说明 |
|---------|------|
| NotNull | 非空检查 |
| Unique | 唯一性检查 |
| ForeignKey | 外键引用检查 |
| AllowedValues | 允许值枚举 |
| Range | 数值/日期区间 |
| Conditional | 条件约束 |
| Scripted | 自定义脚本（simpleeval 沙箱） |
| Charset | 字符集检查 |
| DateLogic | 日期逻辑约束 |
| Composite | 复合约束 |

### 转换类型（22 种）

StringSplit、RegexExtract、MathExpr、DateFormat、ConditionalAssign、MapValue、Lookup、FilterRows、SortRows、Aggregate、CastType、Concat、Digits、DropDuplicates、FillNA、LowerCase、UpperCase、Modulo、Replace、Strip、Substring、WeightedSum

---

## 🏗️ 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        Electron 桌面应用                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │  Vue 3 前端  │  │  Vue Flow   │  │   Pinia 状态管理         │ │
│  │  (Vite)     │  │  (画布引擎)  │  │  (graphStore 工厂模块)   │ │
│  └──────┬──────┘  └─────────────┘  └─────────────────────────┘ │
│         │                                                        │
│         ▼ IPC                                                    │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              FastAPI 后端 (Python 3.12+)                   │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐ │  │
│  │  │ API 路由  │ │  CLI    │ │ 校验引擎  │ │  转换引擎    │ │  │
│  │  │ (V2 CRUD)│ │  交互壳  │ │ (2阶段流水)│ │ (DAG 拓扑)  │ │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────┘ │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 后端三层分离

```
backend/app/shared/
├── core/       # 框架级基础设施 — 文件 I/O、配置解析、数据加载
├── domain/     # 纯业务领域逻辑 — 约束、转换、表达式求值（无 I/O 依赖）
└── services/   # 应用服务 — 编排 core 和 domain 实现用例（校验、AI、预览）
```

### 前端核心架构

```
graphStore (God Store + 工厂模块)
├── setup.ts              # Pinia Setup Store 入口
└── modules/              # ~17 个工厂函数模块
    ├── factories/        # 节点工厂（Schema、约束、正则、转换等）
    ├── v2/               # V2 导入与持久化
    ├── connectionOps/    # 连接操作
    ├── templateExpand/   # 模板展开
    ├── clipboard/        # 剪贴板
    └── history/          # 撤销/重做
```

---

## 🛠️ 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Vue 3 + TypeScript + Vite 7 + Pinia + Vue Router + Vue I18n + Vue Flow |
| 后端 | Python 3.12+ + FastAPI + Uvicorn + Pydantic + Pandas |
| 桌面端 | Electron Forge + TypeScript |
| 前端质量 | ESLint + Prettier + Style Audit + Husky + lint-staged |
| 后端质量 | Ruff（lint + format + import 排序）+ mypy |
| 测试 | Vitest（前端）+ pytest（后端）|

---

## 🚀 快速开始

### 前置条件

- **Node.js**：`^20.19.0 || >=22.12.0`
- **Python**：`>=3.12`

### 安装

```bash
git clone https://github.com/AirSaiga/Precis.git
cd Precis
npm run install:all             # 安装全部依赖（root + frontend + electron）
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -e ".[dev]"
```

### 启动桌面版

```bash
npm run electron:dev            # Electron 自动管理后端进程
```

### 启动开发模式（前后端分离）

```bash
npm run dev                     # 同时启动后端 + 前端（concurrently）
# 或分别启动
npm run backend:dev             # FastAPI on :18000
cd frontend && npm run dev      # Vite dev server
```

- 后端 API：`http://127.0.0.1:18000` — Swagger 文档在 `/docs`

### CLI 使用

```bash
cd backend
python -B -m app.cli
```

```
precis> open /path/to/project    # 打开项目
precis> validate                 # 校验全部数据表
precis> validate users           # 校验指定表
precis> help                     # 查看所有命令
precis> exit
```

> ⚠️ 可能遇到崩溃和功能未完善的情况。这只是预览，不是稳定版本。

---

## 📁 项目结构

```
Precis/
├── backend/                  # FastAPI + CLI + 校验引擎
│   ├── app/
│   │   ├── api/              # REST API 路由（V2 CRUD、校验、预览、AI）
│   │   │   ├── models/       # 请求/响应模型
│   │   │   ├── routers/      # 路由定义（core/ project/ validation/ preview/ ai/）
│   │   │   └── services/     # API 层服务
│   │   ├── cli/              # 交互式命令行
│   │   ├── shared/
│   │   │   ├── core/         # 配置引擎 & 项目加载器
│   │   │   ├── domain/       # 领域模型（约束、转换、表达式、数据类型）
│   │   │   └── services/     # 校验引擎、AI 服务、预览服务
│   │   └── start_server.py   # 服务器启动入口
│   ├── tests/                # pytest 测试套件（unit/ + integration/）
│   └── pyproject.toml
├── frontend/                 # Vue 3 可视化编辑器
│   ├── src/
│   │   ├── api/              # 后端 API 客户端
│   │   ├── components/       # UI 组件（canvas/ nodes/ layout/ settings/ ai/ ...）
│   │   ├── composables/      # Vue 组合式函数（canvas/ nodes/ validation/ ...）
│   │   ├── core/             # 日志、HTTP、Toast
│   │   ├── features/         # 垂直功能模块（keyboard/ regex/ node-layout-organizer/ ai-config-generator/）
│   │   ├── i18n/             # 简体中文 / 英文
│   │   ├── services/         # 构建器、校验器、连接规则、画布服务
│   │   ├── stores/           # Pinia Stores（graphStore/ canvasStore/ workspaceStore/ ...）
│   │   ├── types/            # TypeScript 类型定义
│   │   └── utils/            # 工具函数
│   └── package.json
├── electron/                 # Electron Forge 桌面壳
│   ├── src/                  # Main process + preload
│   └── scripts/              # 启动脚本
├── docs/                     # 项目文档
├── scripts/                  # 构建和部署脚本（Windows + Mac/Linux）
├── AGENTS.md                 # AI 辅助开发指南
└── qa_test/                  # 示例测试项目
```

---

## 💻 开发命令

```bash
# 开发
npm run dev                    # 同时启动后端 + 前端
npm run electron:dev           # Electron 桌面版
npm run backend:dev            # 仅后端

# 代码检查
npm run lint:all               # 前端 ESLint + 后端 Ruff
npm run format:all             # 前端 Prettier + 后端 Ruff format

# 测试
cd frontend && npm run test    # Vitest
cd backend && python -m pytest # pytest

# 构建
npm run build:all              # 前端 + 后端
npm run frontend:build         # 前端（含 type-check）
```

---

## ❓ 常见问题

**Q: 这个能用于生产环境吗？**
> 绝对不能。这只是原型，不要在关键数据上使用。

**Q: 我可以贡献代码吗？**
> 当前阶段**不接受 Pull Request**。架构尚未稳定，测试覆盖也不足。欢迎提交 Issue 或前往 [Discussions](https://github.com/AirSaiga/Precis/discussions) 交流使用场景和需求。

**Q: 有 Web 浏览器版本吗？**
> 没有。Precis 采用本地优先架构，数据不会离开你的机器。请使用 Electron 桌面版获得完整功能。

**Q: 后端可以部署到服务器吗？**
> 技术上可以，但我们目前不推荐。API 接口尚未稳定。

**Q: 支持哪些 LLM 服务商？**
> 任何兼容 OpenAI API 的服务（OpenAI、Azure、LocalAI）以及 Ollama。在 `~/.precis/ai_providers.yaml` 中配置。

## 📄 许可证

[Apache-2.0](LICENSE) — 详情和项目状态说明请见 [LICENSE_NOTICE.md](LICENSE_NOTICE.md)。

---

<a name="english"></a>

## English

> ⚠️ **Project Status (Pre-Alpha)**
>
> This is a **prototype for direction validation**, not a mature product:
> - ❌ **Severely lacking test coverage**, known bugs exist
> - ❌ **Config formats and APIs are unstable** and may change without notice
> - ❌ **Not suitable for production or critical data**
> - ✅ **Open-sourced to showcase direction and collect feedback**
> - ✅ **Not accepting Pull Requests at this stage, but Issues are welcome**
>
> If you're interested in this direction, feel free to share your pain points and needs via [Discussions](https://github.com/AirSaiga/Precis/discussions).

### What problem are we trying to solve?

Precis is a **local-first** data validation tool for Excel/CSV-like tabular data. It lets non-developers build complex data validation pipelines through a **visual DAG (Directed Acyclic Graph)** — drag nodes, connect them, and configure rules without writing code.

**Design principles:**
- 🏠 **Local-First** — All files stay local, no cloud upload
- 🎨 **Visual DAG** — Build validation pipelines on a canvas (Vue Flow)
- ⚡ **Multi-Entry** — Electron desktop app, CLI, and API
- 🔌 **AI-Ready** — Optional LLM-assisted config generation

### Feature Overview

| Module | Status | Description |
|--------|--------|-------------|
| V2 Project Manifest | 🚧 Working | `project.precis.yaml` indexes schemas, constraints, regex, transforms |
| Visual Editor | 🚧 Working | Vue Flow canvas with node drag, connections, property editing, template expansion |
| Schema Editing | 🚧 Working | Column definitions, data types (string/integer/decimal/boolean/datetime/date/time) |
| Constraint Engine | 🚧 Working | 10 constraint types, embedded & standalone constraints |
| Transform Engine | 🚧 Working | 22 transform types, DAG topological execution |
| Regex Nodes | 🚧 Working | Regex pattern definition and matching |
| Constraint Rule Sets | 🚧 Partial | Constraint rule grouping and rule set management |
| Validation History | 🚧 Partial | Validation result persistence and history query |
| AI Config Generation | 🚧 Experimental | OpenAI / Ollama integration |
| i18n | ✅ Basic | zh-CN / en-US |
| Test Coverage | ❌ Minimal | Not production-ready |

### Constraint Types (10)

NotNull, Unique, ForeignKey, AllowedValues, Range, Conditional, Scripted, Charset, DateLogic, Composite

### Transform Types (22)

StringSplit, RegexExtract, MathExpr, DateFormat, ConditionalAssign, MapValue, Lookup, FilterRows, SortRows, Aggregate, CastType, Concat, Digits, DropDuplicates, FillNA, LowerCase, UpperCase, Modulo, Replace, Strip, Substring, WeightedSum

### Quick Start

**Prerequisites:** Node.js `^20.19.0 || >=22.12.0`, Python `>=3.12`

```bash
git clone https://github.com/AirSaiga/Precis.git
cd Precis
npm run install:all
cd backend
python -m venv .venv
# Activate venv, then:
pip install -e ".[dev]"
```

Run desktop app: `npm run electron:dev`

Run dev mode: `npm run dev`

> ⚠️ Expect crashes. This is a preview, not a stable release.

### License

[Apache-2.0](LICENSE) — See [LICENSE_NOTICE.md](LICENSE_NOTICE.md) for details and project status.
