# Precis 部署与启动指南 / Deployment & Startup Guide

> **Alpha 阶段提示 / Alpha-Stage Notice**
>
> 以下脚本和指南适用于 Alpha 阶段试用。项目可能存在启动失败、数据异常或其他未预期行为，建议在隔离环境（非生产环境）中使用。
>
> The following scripts and guides are for Alpha-stage trial. The project may experience startup failures, data anomalies, or other unexpected behaviors. Use in an isolated (non-production) environment is recommended.

## 目录结构 / Directory Structure

```
scripts/
├── setup.ps1                 # Windows 一键部署 / Windows one-click deploy
├── setup.sh                  # Mac/Linux 一键部署 / Mac/Linux one-click deploy
├── check-env.js              # 环境检查工具 / Environment checker
├── build-mac.sh              # Mac 打包脚本(DMG) / Mac build script
├── build-cli.ps1             # Windows 打包 CLI 为自包含 zip / Win CLI packaging
├── build-cli.sh              # Mac 打包 CLI 为自包含 tar.gz / Mac CLI packaging
├── build-tui.ps1             # Windows 打包 TUI(Rust) 为自包含 zip / Win TUI packaging
├── build-tui.sh              # Mac 打包 TUI(Rust) 为自包含 tar.gz / Mac TUI packaging
├── README.md                 # 本文档 / This document
│
├── windows/                            # Windows 启动脚本 / Windows startup scripts
│   ├── start.bat                       # 标准模式(Electron 自行 spawn 后端)/ Standard mode
│   ├── start-dev.bat                   # 开发模式(后端 + Vite + Electron)/ Dev mode
│   ├── start-backend.bat               # 仅启动后端 / Backend only
│   ├── start-frontend.bat              # 仅启动前端 Vite / Frontend Vite only
│   ├── start-electron.bat              # 仅启动 Electron / Electron only
│   ├── start-cli.bat                   # 交互式 CLI / Interactive CLI
│   ├── start-tui-rust.bat              # Rust TUI 终端界面 / Rust TUI
│   ├── free-port.bat                   # 端口清理工具(手动)/ Port cleanup (manual)
│   └── clean-cache.ps1                 # 清理缓存 / Cache cleanup
│
└── mac/                                # Mac/Linux 启动脚本 / Mac/Linux scripts
    ├── _lib.sh                         # 公共函数库(不可单独执行)/ Shared library
    ├── start.sh                        # 标准模式 / Standard mode
    ├── start-dev.sh                    # 开发模式 / Dev mode
    ├── start-backend.sh                # 仅启动后端 / Backend only
    ├── start-frontend.sh               # 仅启动前端 Vite / Frontend Vite only
    ├── start-electron.sh               # 仅启动 Electron / Electron only
    ├── start-cli.sh                    # 交互式 CLI / Interactive CLI
    └── start-tui-rust.sh               # Rust TUI 终端界面 / Rust TUI
```

> Windows 和 Mac/Linux 的启动脚本一一对应。`free-port.bat`(端口清理)和 `clean-cache.ps1`(缓存清理)为 Windows 专属手动工具。Mac 脚本同样适用于 Linux。

## 快速开始 / Quick Start

### 1. 前置要求 / Prerequisites

| 环境 Environment | 版本要求 Version | 推荐安装方式 Recommended |
|-----------------|-----------------|------------------------|
| Python | `>=3.12`（推荐 3.13）/ `>=3.12` (3.13 recommended) | pyenv / pyenv-win |
| Node.js | `^20.19.0 \|\| >=22.12.0` | nvm / 官网 / Official site |
| Git | 任意 Any | 官网 / Official site |

### 2. 一键部署 / One-Click Deploy

#### Windows (PowerShell)

```powershell
git clone https://github.com/AirSaiga/Precis.git
cd Precis
.\scripts\setup.ps1
# 只安装依赖，跳过构建 / Install deps only, skip build
.\scripts\setup.ps1 -SkipBuild
```

#### Mac/Linux (Terminal)

```bash
git clone https://github.com/AirSaiga/Precis.git
cd Precis
chmod +x scripts/setup.sh scripts/mac/*.sh
./scripts/setup.sh
# 只安装依赖，跳过构建 / Install deps only, skip build
./scripts/setup.sh --skip-build
```

部署脚本自动完成 / The deploy script will automatically:

1. 检查 Python `>=3.12` / Check Python `>=3.12`
2. 检查 Node.js / Check Node.js
3. 创建 Python 虚拟环境 / Create Python venv (`backend/.venv`)
4. 安装后端依赖 / Install backend dependencies
5. 安装前端依赖（root + frontend + electron）/ Install frontend deps
6. 构建前端 / Build frontend (`npm run build`)
7. 编译 Electron 主进程 TypeScript / Compile Electron main process

### 3. 启动应用 / Start Application

所有启动脚本会自动检测并优先使用 `backend/.venv` 中的 Python；找不到 venv 时回退到系统 Python。

All startup scripts auto-detect and prefer `backend/.venv` Python; fall back to system Python if not found.

#### 桌面应用 / Desktop (Electron)

| 场景 Scenario | Windows | Mac/Linux |
|--------------|---------|-----------|
| **标准模式**：后端 + Electron 加载已构建静态前端 / Standard: backend + Electron with built static frontend | `.\scripts\windows\start.bat` | `./scripts/mac/start.sh` |
| **开发模式**：后端 + Vite 热重载 + Electron（带完整日志）/ Dev: backend + Vite HMR + Electron with full logs | `.\scripts\windows\start-dev.bat` | `./scripts/mac/start-dev.sh` |

#### 单独启动各服务 / Start Services Individually

| 服务 Service | Windows | Mac/Linux |
|-------------|---------|-----------|
| 后端 FastAPI(端口动态分配)/ Backend FastAPI (dynamic port) | `.\scripts\windows\start-backend.bat` | `./scripts/mac/start-backend.sh` |
| 前端 Vite(端口 5173)/ Frontend Vite (port 5173) | `.\scripts\windows\start-frontend.bat` | `./scripts/mac/start-frontend.sh` |
| Electron 桌面壳(需先起前后端)/ Electron shell | `.\scripts\windows\start-electron.bat` | `./scripts/mac/start-electron.sh` |
| 交互式 CLI / Interactive CLI | `.\scripts\windows\start-cli.bat` | `./scripts/mac/start-cli.sh` |
| Rust TUI 终端界面 / Rust TUI | `.\scripts\windows\start-tui-rust.bat` | `./scripts/mac/start-tui-rust.sh` |

#### 通过 npm 别名启动 / Via npm Aliases

根目录 `package.json` 已注册便捷别名 / Convenience aliases in root `package.json`:

```bash
# 跨平台 / Cross-platform
npm run dev                  # 后端 + 前端 (无 Electron) / Backend + Frontend (no Electron)

# Windows
npm run start:prod:win       # = start.bat
npm run start:dev:win        # = start-dev.bat
npm run start:backend:win    # = start-backend.bat
npm run start:frontend:win   # = start-frontend.bat
npm run start:electron:win   # = start-electron.bat
npm run start:cli:win        # = start-cli.bat
npm run start:tui-rust:win   # = start-tui-rust.bat

# Mac/Linux
npm run start:prod:mac       # = start.sh
npm run start:dev:mac        # = start-dev.sh
npm run start:backend:mac    # = start-backend.sh
npm run start:frontend:mac   # = start-frontend.sh
npm run start:electron:mac   # = start-electron.sh
npm run start:cli:mac        # = start-cli.sh
npm run start:tui-rust:mac   # = start-tui-rust.sh
```

## 脚本差异对比 / Script Differences

| 脚本 Script | 启动内容 What Starts | 端口 Ports | 适用场景 Use Case |
|------------|---------------------|-----------|------------------|
| `start.{bat,sh}` | 仅 Electron(自行 spawn 后端,加载已构建前端)/ Electron only (spawns backend) | 动态 Dynamic | 体验完整桌面应用 / Full desktop experience |
| `start-dev.{bat,sh}` | 后端 + Vite + Electron / Backend + Vite + Electron | 动态, 5173 | 前端代码调试 / Frontend debugging |
| `start-backend.{bat,sh}` | 后端 FastAPI(热重载)/ Backend FastAPI (hot reload) | 动态 Dynamic | 后端开发 / Backend dev |
| `start-frontend.{bat,sh}` | Vite 开发服务器 / Vite dev server | 5173 | 纯前端开发(无桌面壳)/ Frontend-only dev |
| `start-electron.{bat,sh}` | 仅 Electron(需先起前后端)/ Electron only | — | 已手动启动前后端 / Backend + frontend already running |
| `start-cli.{bat,sh}` | Python CLI | — | 命令行交互校验 / CLI validation |
| `start-tui-rust.{bat,sh}` | Rust TUI(需先起后端)/ Rust TUI | — | 终端界面 / Terminal UI |

> 注：`start.bat` 在前端/Electron 产物缺失时会自动调用 `npm run build` 重新构建；`start-dev.bat` 仅在 `electron/dist/main.js` 缺失时编译 Electron。
> Note: `start.bat` auto-runs `npm run build` when frontend/Electron artifacts are missing; `start-dev.bat` only compiles Electron when `electron/dist/main.js` is missing.

## 手动部署 / Manual Deployment

如需细粒度控制 / For finer control:

```bash
# Python 环境 / Python env
python -m venv backend/.venv
# Windows
backend\.venv\Scripts\activate
# Mac/Linux
source backend/.venv/bin/activate
pip install -r backend/requirements.txt

# Node 依赖 / Node deps
npm install
cd frontend && npm install && cd ..
cd electron && npm install && cd ..

# 构建 / Build
cd frontend && npm run build && cd ..
cd electron && npm run build:electron && cd ..
```

## 环境变量 / Environment Variables

后端端口默认由 OS 动态分配,通常无需配置 `.env`。如需固定端口(向后兼容),在项目根目录创建 `.env`(参考 `.env.example`):

Backend port is dynamically allocated by the OS by default; `.env` is usually unnecessary. To pin a fixed port, create `.env` in project root (see `.env.example`):

```env
# 后端端口(可选,留空则 OS 动态分配)/ Backend port (optional, empty = dynamic)
# VITE_BACKEND_PORT=18000

# 前端开发服务器端口 / Frontend dev server port
VITE_FRONTEND_PORT=5173

# AI Provider API Key (可选 / optional)
# OPENAI_API_KEY=your-api-key-here
```

## 端口发现协议 / Port Discovery Protocol

后端启动时端口由 OS 原子分配(`--port 0`),实际端口写入 `backend/.backend-port` 文件:

- **Vite 代理**(`npm run dev`):自动读取该文件,动态转发请求到后端
- **Electron 桌面版**:自行 spawn 后端,通过该文件发现端口
- **Rust TUI**(`start-tui-rust.*`):启动脚本读取该文件,注入 `PRECIS_BACKEND_URL` 环境变量

无需手动查阅端口文件,除非调试需要:`cat backend/.backend-port`。

## 故障排除 / Troubleshooting

| 问题 Issue | 解决方案 Solution |
|-----------|-----------------|
| Python 未找到 / Python not found | 安装 pyenv-win (Windows) 或 pyenv/Homebrew (Mac) / Install pyenv-win (Windows) or pyenv/Homebrew (Mac) |
| Node.js 版本过低 / Node.js too old | `nvm install 20 && nvm use 20` |
| 依赖安装失败 / Dependency install fail | `npm cache clean --force && rm -rf node_modules && npm install` |
| 构建失败 / Build fail | `node --version` 验证版本；运行 `scripts\windows\clean-cache.ps1` (Windows) / Verify `node --version`; run `scripts\windows\clean-cache.ps1` (Windows) |
| Mac 脚本 "Permission denied" | `chmod +x scripts/mac/*.sh scripts/setup.sh` |
| Mac 脚本中文乱码 / Mac script garbled text | 确认终端使用 UTF-8 (`export LANG=en_US.UTF-8`) / Ensure terminal uses UTF-8 |
| venv 缺失警告 / venv missing warning | 运行 `scripts/setup.{ps1,sh}` 创建 `backend/.venv` / Run `scripts/setup.{ps1,sh}` to create `backend/.venv` |
| 端口被占用 / Port in use | 后端默认动态分配,通常无此问题。如使用固定端口(`VITE_BACKEND_PORT`)遇占用:Windows `netstat -ano \| findstr :<端口>`;Mac `lsof -i :<端口>` / Backend uses dynamic ports by default; if a fixed port is pinned and occupied, check with netstat/lsof |

## 生产打包 / Production Build

> 当前为 Alpha 阶段，不建议生产部署。以下步骤仅作技术参考。
> Alpha stage; production deployment is not recommended. The following is for technical reference only.

```bash
# Electron 安装包 / Electron installer
cd electron && npm run dist
# 输出在 electron/release/ 目录 / Output in electron/release/

# 后端独立可执行文件 (PyInstaller) / Standalone backend executable
cd backend && python build_backend.py
```

## 提示 / Tips

- 首次部署可能需要 5-10 分钟（下载依赖）/ First deployment may take 5-10 minutes (downloading deps)
- 日常开发推荐使用 `start-dev.{bat,sh}` / `start-dev` is recommended for daily development
- 体验完整桌面应用使用 `start.{bat,sh}` / Use `start.{bat,sh}` for full desktop experience
- 脚本均带 venv 优先策略，无需手动激活 / All scripts auto-activate venv

## 获取帮助 / Get Help

1. 查看本文档 [故障排除](#故障排除--troubleshooting) 章节 / See [Troubleshooting](#故障排除--troubleshooting) section
2. 前往 [GitHub Issues](https://github.com/AirSaiga/Precis/issues) / Go to [GitHub Issues](https://github.com/AirSaiga/Precis/issues)
3. 前往 [GitHub Discussions](https://github.com/AirSaiga/Precis/discussions) / Go to [GitHub Discussions](https://github.com/AirSaiga/Precis/discussions)
