# Precis 部署与启动指南 / Deployment & Startup Guide

> ⚠️ **超早期原型警告 / Ultra-Early Prototype Warning**
>
> 以下脚本和指南仅供技术预览。项目可能存在启动失败、数据异常或其他未预期行为。建议在隔离环境（非生产环境）中使用。
>
> The following scripts and guides are for technical preview only. The project may experience startup failures, data anomalies, or other unexpected behaviors. Use in an isolated environment (non-production) is recommended.

## 📋 目录结构 / Directory Structure

```
scripts/
├── setup.ps1                 # Windows 一键部署 / Windows one-click deploy ⭐
├── setup.sh                  # Mac/Linux 一键部署 / Mac/Linux one-click deploy ⭐
├── check-env.js              # 环境检查工具 / Environment checker
├── README.md                 # 本文档 / This document
│
├── windows/                            # Windows 启动脚本 / Windows startup scripts
│   ├── start.bat                       # 标准模式（后端 + Electron 静态前端）⭐
│   ├── start-dev.bat                   # 开发模式（后端 + Vite + Electron）⭐
│   ├── start-backend.bat               # 仅启动后端 / Backend only
│   ├── start-frontend.bat              # 仅启动前端 Vite / Frontend Vite only
│   ├── start-electron.bat              # 仅启动 Electron / Electron only
│   ├── start-cli.bat                   # 交互式 CLI / Interactive CLI ⭐
│   └── clean-cache.ps1                 # 清理缓存 / Cache cleanup
│
└── mac/                                # Mac/Linux 启动脚本 / Mac/Linux scripts
    ├── _lib.sh                         # 公共函数库（不可单独执行）/ Shared library
    ├── start.sh                        # 标准模式 / Standard mode ⭐
    ├── start-dev.sh                    # 开发模式 / Dev mode ⭐
    ├── start-backend.sh                # 仅启动后端 / Backend only
    ├── start-frontend.sh               # 仅启动前端 Vite / Frontend Vite only
    ├── start-electron.sh               # 仅启动 Electron / Electron only
    ├── start-cli.sh                    # 交互式 CLI / Interactive CLI ⭐
```

> Windows 和 Mac/Linux 的脚本一一对应（除 PowerShell 专属的 `clean-cache.ps1` 外）。Mac 脚本同样适用于 Linux。

## 🚀 快速开始 / Quick Start

### 1. 前置要求 / Prerequisites

| 环境 Environment | 版本要求 Version | 推荐安装方式 Recommended |
|-----------------|-----------------|------------------------|
| Python | `>=3.12`（推荐 3.13） | pyenv / pyenv-win |
| Node.js | `^20.19.0 \|\| >=22.12.0` | nvm / 官网 |
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

1. ✅ 检查 Python `>=3.12` / Check Python `>=3.12`
2. ✅ 检查 Node.js / Check Node.js
3. ✅ 创建 Python 虚拟环境 / Create Python venv (`backend/.venv`)
4. ✅ 安装后端依赖 / Install backend dependencies
5. ✅ 安装前端依赖 / Install frontend deps (root + frontend + electron)
6. ✅ 构建前端 / Build frontend (`npm run build`)
7. ✅ 编译 Electron 主进程 TypeScript / Compile Electron main process

### 3. 启动应用 / Start Application

所有启动脚本会自动检测并优先使用 `backend/.venv` 中的 Python；找不到 venv 时回退到系统 Python。

All startup scripts auto-detect and prefer `backend/.venv` Python; fall back to system Python if not found.

#### 桌面应用 / Desktop (Electron)

| 场景 Scenario | Windows | Mac/Linux |
|--------------|---------|-----------|
| **标准模式**：后端 + Electron 加载已构建静态前端 | `.\scripts\windows\start.bat` | `./scripts/mac/start.sh` |
| **开发模式**：后端 + Vite 热重载 + Electron（带完整日志） | `.\scripts\windows\start-dev.bat` | `./scripts/mac/start-dev.sh` |

#### 单独启动各服务 / Start Services Individually

| 服务 Service | Windows | Mac/Linux |
|-------------|---------|-----------|
| 后端 FastAPI（端口 18000） | `.\scripts\windows\start-backend.bat` | `./scripts/mac/start-backend.sh` |
| 前端 Vite（端口 5173） | `.\scripts\windows\start-frontend.bat` | `./scripts/mac/start-frontend.sh` |
| Electron 桌面壳 | `.\scripts\windows\start-electron.bat` | `./scripts/mac/start-electron.sh` |
| 交互式 CLI | `.\scripts\windows\start-cli.bat` | `./scripts/mac/start-cli.sh` |

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

# Mac/Linux
npm run start:prod:mac       # = start.sh
npm run start:dev:mac        # = start-dev.sh
npm run start:backend:mac    # = start-backend.sh
npm run start:frontend:mac   # = start-frontend.sh
npm run start:desktop:mac    # = start-electron.sh
npm run start:cli:mac        # = start-cli.sh
```

## 🔍 脚本差异对比 / Script Differences

| 脚本 Script | 启动内容 What Starts | 端口 Ports | 适用场景 Use Case |
|------------|---------------------|-----------|------------------|
| `start.{bat,sh}` | 后端 + Electron（加载已构建前端） | 18000 | 体验完整桌面应用 / Full desktop experience |
| `start-dev.{bat,sh}` | 后端 + Vite + Electron | 18000, 5173 | 前端代码调试 / Frontend debugging |
| `start-backend.{bat,sh}` | 后端 FastAPI（热重载） | 18000 | 后端开发 / Backend dev |
| `start-frontend.{bat,sh}` | Vite 开发服务器 | 5173 | 纯前端开发（无桌面壳） / Frontend-only dev |
| `start-electron.{bat,sh}` | Electron 桌面壳 | — | 已手动启动前后端 / Backend + frontend already running |
| `start-cli.{bat,sh}` | Python CLI | — | 命令行交互校验 / CLI validation |

> 注：`start.bat` 在前端/Electron 产物缺失时会自动调用 `npm run build` 重新构建；`start-dev.bat` 仅在 `electron/dist/main.js` 缺失时编译 Electron。

## 🛠️ 手动部署 / Manual Deployment

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

## 📝 环境变量 / Environment Variables

在项目根目录创建 `.env` 文件 / Create `.env` in project root (参考 `.env.example`):

```env
# 后端端口 / Backend port (default: 18000)
VITE_BACKEND_PORT=18000

# AI Provider API Key (可选 / optional)
# OPENAI_API_KEY=your-api-key-here
```

## 🔧 故障排除 / Troubleshooting

| 问题 Issue | 解决方案 Solution |
|-----------|-----------------|
| Python 未找到 / Python not found | 安装 pyenv-win (Windows) 或 pyenv/Homebrew (Mac) |
| Node.js 版本过低 / Node.js too old | `nvm install 20 && nvm use 20` |
| 依赖安装失败 / Dependency install fail | `npm cache clean --force && rm -rf node_modules && npm install` |
| 构建失败 / Build fail | `node --version` 验证版本；运行 `scripts\windows\clean-cache.ps1` (Windows) |
| Mac 脚本 "Permission denied" | `chmod +x scripts/mac/*.sh scripts/setup.sh` |
| Mac 脚本中文乱码 | 确认终端使用 UTF-8 (`export LANG=en_US.UTF-8`) |
| venv 缺失警告 | 运行 `scripts/setup.{ps1,sh}` 创建 `backend/.venv` |
| 端口被占用 / Port in use | Windows: `netstat -ano \| findstr :18000`; Mac: `lsof -i :18000` |

## 📦 生产打包 / Production Build

**⚠️ 当前版本不建议生产部署。以下步骤仅作技术参考。**

**⚠️ Current version is NOT recommended for production. The following is for technical reference only.**

```bash
# Electron 安装包 / Electron installer
cd electron && npm run dist
# 输出在 electron/release/ 目录 / Output in electron/release/

# 后端独立可执行文件 (PyInstaller) / Standalone backend executable
cd backend && python build_backend.py
```

## 💡 提示 / Tips

- 首次部署可能需要 5-10 分钟（下载依赖）/ First deployment may take 5-10 minutes
- 日常开发推荐使用 `start-dev.{bat,sh}` / `start-dev` is recommended for daily development
- 体验完整桌面应用使用 `start.{bat,sh}` / Use `start.{bat,sh}` for full desktop experience
- 脚本均带 venv 优先策略，无需手动激活 / All scripts auto-activate venv

## 🆘 获取帮助 / Get Help

1. 查看本文档 [故障排除](#-故障排除--troubleshooting) 章节 / See [Troubleshooting](#-故障排除--troubleshooting) section
2. 前往 [GitHub Issues](https://github.com/AirSaiga/Precis/issues) / Go to [GitHub Issues](https://github.com/AirSaiga/Precis/issues)
3. 前往 [GitHub Discussions](https://github.com/AirSaiga/Precis/discussions) / Go to [GitHub Discussions](https://github.com/AirSaiga/Precis/discussions)
