<div align="center">

# Precis

**本地优先的可视化数据校验工具（Visual DAG Flow）**

[🇨🇳 中文](#中文) · [🇺🇸 English](#english)

[![Status](https://img.shields.io/badge/status-Prototype%2FPre--Alpha-red.svg)]()
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%5E20.19.0%20%7C%7C%20%3E%3D22.12.0-green.svg)](https://nodejs.org/)
[![Python](https://img.shields.io/badge/python-3.12-blue.svg)](https://python.org/)

</div>

---

> ⚠️ **超早期原型（Pre-Alpha）**
>
> 这是一个**方向验证中的技术原型**，核心功能框架刚搭成：
> - ❌ **测试覆盖严重不足**，已知存在大量 Bug
> - ❌ **配置格式和 API 不稳定**，随时可能重构
> - ❌ **不适合生产环境或关键数据**
> - ✅ **开源仅为展示方向、收集需求反馈**
> - ✅ **暂不接受 Pull Request，但欢迎提交 Issue**
>
> 如果你对这个方向感兴趣，欢迎通过 [Discussions](https://github.com/AirSaiga/Precis/discussions) 聊聊你的痛点和需求。

---

<a name="中文"></a>

## 🎯 我们在尝试解决什么问题？

Precis 是一个**本地优先**的数据校验工具原型，面向 Excel/CSV 类表格数据。它尝试通过**可视化 DAG（有向无环图）**让非开发人员也能搭建复杂的数据校验流程——拖拽节点、连线、配置规则，无需编写代码。

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

**当前验证中的设计假设：**
- 🏠 **Local-First** — 所有文件留在本地，不上传云端
- 🎨 **可视化 DAG** — 用画布编排校验流程（Vue Flow）
- ⚡ **多入口** — Electron 桌面版、CLI、API 三种入口
- 🔌 **AI-Ready** — 可选 LLM 辅助生成校验配置

---

## ⚠️ 项目状态

这是一个**技术原型**，不是成熟产品。

- 核心框架已有，但**缺乏测试，Bug 较多**
- **配置格式和接口随时可能变更**
- 开源的目的是**验证方向、收集需求反馈**，暂不需要贡献者社区
- 当前阶段**暂不接受 Pull Request，但欢迎提交 Issue**

## ✨ 目前已实现（部分）

| 模块 | 状态 | 说明 |
|------|------|------|
| V2 项目清单 | 🚧 可用 | `project.precis.yaml` 索引 Schema、Constraint、Regex、Transform |
| 可视化编辑器 | 🚧 部分可用 | Vue Flow 画布，基础节点和连线 |
| 转换引擎 | 🚧 部分可用 | 19 种转换类型，支持 DAG 链式连接 |
| 校验引擎 | 🚧 部分可用 | 唯一性、非空、区间、条件、脚本等约束 |
| AI 配置生成 | 🚧 实验性 | OpenAI / Ollama 集成 |
| 国际化 | ✅ 基础 | 简体中文 / 英文 |
| 测试覆盖 | ❌ 严重不足 | 尚未达到生产可用标准 |

## 🏗️ 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        Electron 桌面应用                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │  Vue 3 前端  │  │  Vue Flow   │  │   Pinia 状态管理         │ │
│  │  (Vite)     │  │  (画布引擎)  │  │                         │ │
│  └──────┬──────┘  └─────────────┘  └─────────────────────────┘ │
│         │                                                        │
│         ▼ IPC                                                    │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              FastAPI 后端 (Python 3.12)                    │  │
│  │  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │  │
│  │  │  API    │ │  CLI     │ │  DAG     │ │  校验引擎     │  │  │
│  │  │  路由   │ │  交互壳   │ │  引擎    │ │              │  │  │
│  │  └─────────┘ └──────────┘ └──────────┘ └──────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## 🛠️ 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Vue 3 + TypeScript + Vite + Pinia + Vue Router + Vue I18n + Vue Flow |
| 后端 | Python 3.12 + FastAPI + Uvicorn + Pydantic + Pandas |
| 桌面 | Electron Forge + TypeScript |

## 🚀 快速开始（仅供预览）

### 前置条件

- **Node.js**：`^20.19.0 || >=22.12.0`
- **Python**：`>=3.12`

### 安装

```bash
git clone https://github.com/AirSaiga/Precis.git
cd Precis
npm install                    # 根目录依赖
cd frontend && npm install     # 前端
cd ../electron && npm install  # 桌面壳
cd ../backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -e ".[dev]"
```

### 启动桌面版

```bash
# 在项目根目录
npm run electron:dev
```

- 桌面窗口自动打开
- 后端 API：`http://127.0.0.1:8000` — Swagger 文档在 `/docs`

### CLI 使用

```bash
cd backend
python app/cli_main.py
```

```
precis> open /path/to/project    # 打开项目
precis> validate                 # 校验全部数据表
precis> validate users           # 校验指定表
precis> help                     # 查看所有命令
precis> exit
```

> ⚠️ 可能遇到崩溃和功能未完善的情况。这只是预览，不是稳定版本。

## 📁 项目结构

```
Precis/
├── backend/              # FastAPI + CLI + 校验引擎
│   ├── app/
│   │   ├── api/          # REST API 路由
│   │   ├── cli/          # 交互式命令行
│   │   ├── core/         # 配置引擎 & 项目加载器
│   │   ├── services/     # 校验引擎、LLM 服务
│   │   └── shared/       # 领域模型 & 共享工具
│   ├── tests/            # pytest 测试套件（覆盖不足）
│   └── pyproject.toml
├── frontend/             # Vue 3 可视化编辑器
│   ├── src/
│   │   ├── components/   # UI 组件（节点、画布、检查器）
│   │   ├── features/     # 垂直功能模块（键盘、正则、布局）
│   │   ├── stores/       # Pinia（graphStore、projectStore）
│   │   ├── composables/  # Vue 组合式函数
│   │   ├── services/     # 构建器、导出器、校验器
│   │   ├── api/          # 后端 API 客户端
│   │   ├── core/         # 日志、HTTP、Toast
│   │   └── i18n/         # 简体中文 / 英文
│   └── package.json
├── electron/             # Electron Forge 桌面壳
├── docs/                 # 项目文档
├── scripts/              # 构建和启动脚本
└── qa_v3_complex/        # 示例测试项目
```

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
> - ❌ **Severely lacking test coverage**, known to have many bugs
> - ❌ **Config formats and APIs are unstable** and may change without notice
> - ❌ **Not suitable for production or critical data**
> - ✅ **Open-sourced to showcase direction and collect feedback**
> - ✅ **Not accepting Pull Requests at this stage, but Issues are welcome**
>
> If you're interested in this direction, feel free to share your pain points and needs via [Discussions](https://github.com/AirSaiga/Precis/discussions).

### What problem are we trying to solve?

Precis is a **local-first** data validation prototype for Excel/CSV-like tabular data. It attempts to let non-developers build complex data validation pipelines through a **visual DAG (Directed Acyclic Graph)** — drag nodes, connect them, and configure rules without writing code.

**Current design hypotheses:**
- 🏠 **Local-First** — All files stay local, no cloud upload
- 🎨 **Visual DAG** — Build validation pipelines on a canvas (Vue Flow)
- ⚡ **Multi-Entry** — Electron desktop app, CLI, and API
- 🔌 **AI-Ready** — Optional LLM-assisted config generation

### What's Implemented (Partial)

| Module | Status | Description |
|--------|--------|-------------|
| V2 Project Manifest | 🚧 Working | `project.precis.yaml` indexes schemas, constraints, regex, transforms |
| Visual Editor | 🚧 Partial | Vue Flow canvas with basic nodes and connections |
| Transform Engine | 🚧 Partial | 19 transform types, DAG chaining |
| Validation Engine | 🚧 Partial | Unique, NotNull, Range, Conditional, Scripted, etc. |
| AI Config Generation | 🚧 Experimental | OpenAI / Ollama integration |
| i18n | ✅ Basic | zh-CN / en-US |
| Test Coverage | ❌ Minimal | Not production-ready |

### Quick Start (Preview Only)

**Prerequisites:** Node.js `^20.19.0 || >=22.12.0`, Python `>=3.12`

```bash
git clone https://github.com/AirSaiga/Precis.git
cd Precis
npm install
cd frontend && npm install
cd ../electron && npm install
cd ../backend
python -m venv .venv
pip install -e ".[dev]"
```

Run desktop app: `npm run electron:dev`

> ⚠️ Expect crashes. This is a preview, not a stable release.

### License

[Apache-2.0](LICENSE) — See [LICENSE_NOTICE.md](LICENSE_NOTICE.md) for details and project status.
