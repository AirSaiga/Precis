# 贡献指南 / Contributing Guide

感谢你对 Precis 项目的关注！我们欢迎外部贡献——Issue、Discussion 与 Pull Request 均可。

Thank you for your interest in Precis! External contributions are welcome — Issues, Discussions, and Pull Requests alike.

- **Bug 报告与功能建议**：请通过 [Issues](https://github.com/AirSaiga/Precis/issues) 提交（模板会引导你填写影响类型，用于缺陷分级）
- **使用场景与想法讨论**：推荐先到 [Discussions](https://github.com/AirSaiga/Precis/discussions)
- **代码贡献**：按下文流程发起 Pull Request

- **Bug reports & feature suggestions**: open an [Issue](https://github.com/AirSaiga/Precis/issues) (the template guides you through an impact-type field used for defect triage)
- **Use cases & ideas**: [Discussions](https://github.com/AirSaiga/Precis/discussions) is the recommended venue
- **Code contributions**: follow the Pull Request workflow below

> 项目当前处于 Beta 阶段，接口与配置格式已冻结（只增不减），欢迎外部贡献。
> The project is currently in Beta stage; interfaces and config formats are frozen (additive changes only), and external contributions are welcome.

行为准则见 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。
See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for the code of conduct.

---

## 环境搭建 / Setting Up

运行环境要求 / Requirements: Node.js `^20.19.0 || >=22.12.0`，Python `>=3.12,<3.14`，Rust stable（仅构建 TUI 时需要 / only for the TUI）。

```bash
git clone https://github.com/AirSaiga/Precis.git
cd Precis

# 1. 前端依赖（npm workspaces：根目录一次安装覆盖全部子项目）
#    Frontend deps (npm workspaces: one root install covers all sub-projects)
npm run install:all

# 2. 后端开发依赖（pytest / ruff / mypy）
#    Backend dev deps (pytest / ruff / mypy)
cd backend
python3.12 -m venv .venv               # 若命令为 python3.13 则相应替换 / substitute python3.13 if that is your command
source .venv/bin/activate              # Windows PowerShell: .venv\Scripts\Activate.ps1；Git Bash: source .venv/Scripts/activate
pip install --upgrade pip
pip install -e ".[dev]"
cd ..

# 3. E2E 浏览器二进制（依赖已随 workspaces 安装）
#    E2E browser binaries (deps already installed via workspaces)
npx playwright install chromium
```

> **npm workspaces 红线**：依赖统一 hoist 到根 `node_modules`——**不要在子目录单独 `npm install` / `npm ci`**（会整树重装）。
> **npm workspaces rule**: dependencies are hoisted to the root `node_modules` — **never run `npm install` / `npm ci` inside a sub-directory** (it reinstalls the whole tree).

验证环境（跑一次内置示例校验）/ Verify your setup (run the bundled sample validation):

```bash
npm run cli:validate
```

本地开发启动 / Local development:

```bash
npm run dev              # 后端 + 前端（concurrently）/ backend + frontend
npm run electron:dev     # Electron 桌面版（自动管理后端进程）/ desktop app (manages backend automatically)
```

更多命令见 [AGENTS.md](AGENTS.md) 的 Build & Run Commands 一节。
For the full command list, see the "Build & Run Commands" section of [AGENTS.md](AGENTS.md).

---

## 缺陷分级 / Defect Triage

排查、测试与审计中发现缺陷时按两级红线分流（与 AGENTS.md「缺陷处理分级」一致）。提交 Issue 或 PR 时请按此分级标注：

Defects found during investigation, testing, or audits are triaged into two red-line levels (identical to the "缺陷处理分级" section of AGENTS.md). Please label Issues and PRs accordingly:

| 级别 Level | 判据 Criteria | 处理方式 Handling |
|------|------|------|
| **立即修 Fix immediately** | ① 崩溃/未捕获 traceback（crash / uncaught traceback）；② 数据误判——校验误报或漏报（wrong verdict: false positive or false negative）；③ 契约破坏——CLI JSON 输出结构、退出码语义、V2 YAML 格式、API 状态码（contract break: CLI JSON shape, exit-code semantics, V2 YAML format, API status codes） | 当前批次内修复并附带可复现测试，不跨批滞留 / Fixed within the current batch with a reproducible test; never carried across batches |
| **可延迟 Deferrable** | 非数量级性能问题、文案瑕疵、罕见平台边缘行为、GUI 非阻断问题（non-order-of-magnitude performance, wording flaws, rare platform edge cases, non-blocking GUI issues） | 记入 backlog（CHANGELOG 遗留清单或 GitHub issue），不阻断当前批次 / Recorded in the backlog (CHANGELOG leftover list or a GitHub issue); does not block the current batch |

> 数据误判是校验工具的生命线：误报让用户关掉规则，漏报让用户失去信任，两者都比崩溃更伤产品。
> Wrong verdicts are the lifeline of a validation tool: false positives make users turn rules off, false negatives destroy trust — both hurt more than crashes.

Issue 模板的「影响类型」字段与此分级对应：崩溃 / 数据误判 / 契约破坏三项即「立即修」。
The Issue template's "Impact Type" field maps to this triage: crash / wrong verdict / contract break are the "fix immediately" items.

---

## PR 流程与质量门 / Pull Request Workflow & Quality Gates

### 流程 / Workflow

1. Fork 仓库并创建特性分支 / Fork the repo and create a feature branch: `git checkout -b feat/short-description`
2. 完成改动并自测（跑下方质量门）/ Make your changes and self-check (run the quality gates below)
3. 发起 Pull Request，填写 PR 模板（说明动机、改动内容、测试方式）/ Open a Pull Request and fill in the template (motivation, what changed, how it was tested)
4. 等待 CI 与维护者评审；如需修改，向同一分支追加 commit 即可 / Wait for CI and maintainer review; push follow-up commits to the same branch if changes are requested

> 大型改动（新功能、破坏性调整）建议先开 Issue 或 Discussion 对齐方案，再动手实现。
> For large changes (new features, breaking adjustments), please open an Issue or Discussion to align on the approach before implementing.

### 质量门 / Quality Gates

提交前必须全部通过（CI 同样拦截）/ All must pass before submitting (CI enforces the same):

```bash
# 后端 / Backend
cd backend
python -m pytest -q
python -m ruff check .
cd ..

# 前端 / Frontend
cd frontend
npm run type-check
npm run lint:check  # 含 eslint（--max-warnings 阈值随存量清理收紧，以 package.json 为准，勿在文档记录具体数字）/ threshold tightens over time; defer to lint:check in package.json
cd ..
```

补充要求 / Additional requirements:

| 要求 Requirement | 说明 Details |
|------|------|
| **测试 Tests** | 新增后端功能必须附带 pytest 单测；前端功能优先补 Playwright E2E；纯逻辑可提取为独立函数后补 vitest 单测（策略见 AGENTS.md「Testing Strategy」）/ New backend features require pytest unit tests; frontend features should prefer Playwright E2E; pure logic may be extracted and covered by vitest (see "Testing Strategy" in AGENTS.md) |
| **License 头 License header** | 新增源码文件须在前 15 行内含 Apache-2.0 头（`SPDX-License-Identifier: Apache-2.0` + `Copyright 2026 Precis Team`），覆盖 frontend / backend / electron / src / tui-rust / e2e；缺头 CI 直接失败。生成物 `types/generated/actions.ts` 由 codegen 模板带头，**禁止手改** / New source files need an Apache-2.0 header within the first 15 lines (`SPDX-License-Identifier: Apache-2.0` + `Copyright 2026 Precis Team`), covering frontend / backend / electron / src / tui-rust / e2e; CI fails on missing headers. The generated `types/generated/actions.ts` carries a header from the codegen template — **never edit it by hand** |
| **文件头注释 File header** | `frontend/src/` 下 `.ts` 须在前 40 行内含 `/** @fileoverview <职责一句话> */`；`.vue` 以职责描述注释开头；禁止空洞复读文件名 / `.ts` files under `frontend/src/` need `/** @fileoverview ... */` within the first 40 lines; `.vue` files start with a purpose-describing comment block; no hollow filename-echo headers |
| **i18n 守卫 i18n guard** | 改动 i18n 相关内容（`t('key')` 引用或语言包）后运行 `cd frontend && npm run audit:i18n`；zh-CN 与 en-US 双侧都必须有 key 定义 / After touching i18n (`t('key')` references or locale files), run `cd frontend && npm run audit:i18n`; every key must exist in both zh-CN and en-US |
| **Codegen 守卫 Codegen guard** | 修改后端 `backend/app/shared/services/llm/actions/registry.py` 后必须运行 `cd frontend && npm run codegen` 重新生成 `actions.ts` 并一并提交，否则 CI 失败 / After modifying `backend/app/shared/services/llm/actions/registry.py`, run `cd frontend && npm run codegen` and commit the regenerated `actions.ts`, otherwise CI fails |
| **版本号 Versions** | **禁止手改任何 manifest 版本号**——版本单一事实源是根 `package.json`，统一经发布流程同步 / **Never hand-edit manifest version numbers** — the single source of truth is the root `package.json`, synchronized via the release process |

### Commit 信息规范 / Commit Message Convention

格式 / Format: `<type>(<scope>): <subject>`

| type | 用途 Purpose |
|------|------|
| `feat` | 新功能 / new feature |
| `fix` | 缺陷修复 / bug fix |
| `docs` | 仅文档 / documentation only |
| `refactor` | 重构（不改行为、不加功能）/ refactoring without behavior change |
| `test` | 补充或调整测试 / adding or adjusting tests |
| `chore` | 构建、脚本、依赖等杂项 / build, scripts, dependencies, etc. |

- subject 用祈使句、不加句号，中文或英文均可 / subject in imperative mood, no trailing period; Chinese or English both fine
- 例 / e.g.: `feat(validation): 支持 decimal 列的 Range 约束` · `fix(cli): 修正退出码 3 在配置缺失时未返回的问题`
- 涉及缺陷修复的 PR 请在描述中注明分级（立即修/可延迟）/ For bug-fix PRs, note the triage level (fix-immediately / deferrable) in the description

---

## 开发参考 / Development Reference

> 以下内容面向在本仓库上开发的所有人（外部贡献者与维护者），从 README 迁移而来。
> The sections below are for everyone developing on this repo (external contributors and maintainers alike), moved here from the README.

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
