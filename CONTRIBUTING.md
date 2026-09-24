# 关于贡献 / About Contributing

感谢你对 Precis 项目的关注！

Thank you for your interest in the Precis project!

## 当前阶段说明 / Current Stage

Precis 目前处于 **Alpha 阶段**。核心功能已实现，但接口可能调整，稳定性仍在打磨中。

Precis is currently in **Alpha stage**. Core features are implemented, but interfaces may change and stability is still being polished.

**因此，本项目现阶段仍暂不寻求外部代码贡献。**

**Therefore, this project is still not seeking external code contributions at this stage.**

- **不接受外部 Pull Request** / No external Pull Requests accepted
- **欢迎提交 Issue**（Bug 报告、功能建议、使用反馈）/ Issues welcome (bugs, features, feedback)
- **欢迎通过 GitHub Discussions 讨论使用场景** / Welcome to discuss use cases on GitHub Discussions
- **欢迎分享你的需求想法** / Welcome to share your needs and ideas

## 为什么暂时不接受贡献？/ Why not accept contributions now?

1. **架构不稳定** — 底层设计可能随时大幅调整，外部贡献的代码很可能在重构中被废弃
   
   **Architecture unstable** — Underlying design may change significantly at any time; externally contributed code is likely to be discarded during refactoring

2. **方向未验证** — 在确认这个方向有人需要之前，我们不希望扩大维护面
   
   **Direction unvalidated** — Before confirming that this direction is needed, we do not want to expand the maintenance surface

## 后续计划 / Future Plans

当项目进入 Beta 阶段（功能与接口基本稳定）后，我们将重新开放贡献渠道，届时会更新本文档并发布具体的贡献指南。

When the project enters the Beta stage (features and interfaces basically stable), we will reopen contribution channels and update this document with specific contribution guidelines.

如果你在此期间有任何想法，欢迎通过 Discussions 与我们交流。

If you have any ideas during this period, feel free to exchange with us via Discussions.

---

## 开发参考 / Development Reference

> 以下内容面向本仓库的开发者（含维护者），从 README 迁移而来。
> The sections below are for developers working on this repo, moved here from the README.

### 技术栈 / Tech Stack

| 层级 Layer | 技术 Technology |
|------|------|
| 前端 Frontend | Vue 3 + TypeScript + Vite + Pinia + Vue Flow + Vue I18n |
| 后端 Backend | Python 3.12+ · FastAPI + Uvicorn + Pydantic + Pandas |
| 桌面端 Desktop | Electron + electron-builder |
| 终端 TUI | Rust + ratatui + crossterm + tokio |
| 测试 Testing | Vitest + pytest + Playwright E2E |
| 代码质量 Quality | ESLint + Prettier + Ruff + mypy |

架构原则与约定见 [AGENTS.md](AGENTS.md)，实现细节索引见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

Architecture principles & conventions: [AGENTS.md](AGENTS.md); implementation detail index: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### 开发命令 / Development Commands

| 类别 Category | 命令 Commands |
|------|------|
| 代码检查 Lint | `npm run lint:all` · `npm run format:all` |
| 类型检查 Type Check | `cd frontend && npm run type-check` |
| 测试 Test | `npm run test:all` · `npm run test:coverage` |
| E2E | `npm run e2e:install` · `npm run e2e:test`（需先启动后端，如 `npm run dev` / requires a running backend） |
| 构建 Build | `npm run build:all` · `npm run frontend:build` · `npm run electron:build` |

> **Electron 生产打包 / Production packaging**：安装包内嵌 Python 运行时（python-build-standalone）与全部后端依赖，用户无需自装 Python。详见 [`electron/README.md`](electron/README.md)。
> The installer bundles a self-contained Python runtime (python-build-standalone) and all backend dependencies — end users do not need to install Python. See [`electron/README.md`](electron/README.md).

### 环境变量 / Environment Variables

根目录 `.env` 由 `.env.example` 复制而来，**默认全部留空即可运行**。
The root `.env` is copied from `.env.example` — **all defaults work as-is**.

| 变量 Variable | 默认 Default | 说明 Description |
|------|------|------|
| `VITE_BACKEND_PORT` | 留空 → 动态分配 / empty → dynamic | 留空时后端端口由 OS 分配（永不冲突），实际端口写入 `backend/.backend-port`；设为 `18000` 即固定端口。When empty, the OS assigns a port (never conflicts); the actual port is written to `backend/.backend-port`. Set `18000` to pin a fixed port. |
| `VITE_FRONTEND_PORT` | `5173` | 前端 Vite dev server 端口 / Vite dev server port |

> Swagger UI 地址随后端端口：动态端口时请看启动日志；固定 `18000` 时为 `http://127.0.0.1:18000/docs`。
> The Swagger UI URL follows the backend port: check the startup log for dynamic ports, or use `http://127.0.0.1:18000/docs` when pinned to 18000.

### CLI / TUI 独立打包 / Standalone CLI & TUI Packaging

除桌面应用外，CLI 与 TUI 也可各打成自包含分发包（内置 Python 运行时 + 后端源码，解压即用，无需自装 Python/Rust）。
Besides the desktop app, the CLI and TUI can each be packaged as self-contained bundles (bundled Python runtime + backend source; extract and run, no Python/Rust install needed).

> **TUI 不随 Release 发布**：TUI 为实验性形态，GitHub Release 资产不再包含 `precis-tui-*` 压缩包（CD 已移除 TUI 构建）；下表 TUI 打包命令仅用于本地自用。Release 资产 = Electron 安装包 + CLI 自包含包（CLI 另经 PyPI 发布 `precis-cli`）。
> **TUI is not attached to Releases**: the TUI is experimental; GitHub Release assets no longer include `precis-tui-*` bundles (CD no longer builds the TUI). The TUI commands below are for local self-use packaging only. Release assets = Electron installers + self-contained CLI bundles (the CLI is also published to PyPI as `precis-cli`).

| 产物 Artifact | Windows | macOS |
|------|---------|-------|
| CLI | `npm run build:cli:win` → `backend/dist-win/precis-cli-win-*.zip` | `npm run build:cli:mac` → `backend/dist-mac/precis-cli-mac-*.tar.gz` |
| TUI | `npm run build:tui:win` → `tui-rust/dist-win/precis-tui-win-*.zip` | `npm run build:tui:mac` → `tui-rust/dist-mac/precis-tui-mac-*.tar.gz` |
| 一键全打 All-in-one | `npm run build:all:win`（CLI + TUI + GUI） | `npm run build:all:mac`（CLI + TUI + GUI） |

解压后：CLI 运行 `precis.bat` / `./precis`；TUI 运行 `precis-tui.exe` / `./precis-tui`（自动拉起内置后端）。
After extraction: CLI runs `precis.bat` / `./precis`; TUI runs `precis-tui.exe` / `./precis-tui` (auto-spawns the bundled backend).
