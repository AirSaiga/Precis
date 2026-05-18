# Precis 部署与启动指南 / Deployment & Startup Guide

> ⚠️ **超早期原型警告 / Ultra-Early Prototype Warning**
>
> 以下脚本和指南仅供技术预览。项目可能存在启动失败、数据异常或其他未预期行为。建议在隔离环境（非生产环境）中使用。
>
> The following scripts and guides are for technical preview only. The project may experience startup failures, data anomalies, or other unexpected behaviors. Use in an isolated environment (non-production) is recommended.

## 📋 目录结构 / Directory Structure

```
scripts/
├── setup.ps1                          # Windows 部署脚本 / Windows deploy script ⭐️
├── setup.sh                           # Mac/Linux 部署脚本 / Mac/Linux deploy script ⭐️
├── check-env.js                       # 环境检查工具 / Environment checker ⭐️
├── README.md                          # 本文档 / This document
├── SCRIPTS_GUIDE.md                   # 脚本详细指南 / Detailed script guide
├── windows/                           # Windows 启动脚本 / Windows startup scripts
│   ├── start-dev.bat                  # 开发调试启动 / Dev startup (with logs) ⭐️
│   ├── start.bat                      # 标准启动模式 / Standard startup ⭐️
│   ├── start-backend.bat              # 单独启动后端 / Start backend only ⭐️
│   ├── start-frontend.bat             # 单独启动前端 / Start frontend only ⭐️
│   ├── start-electron.bat             # 单独启动 Electron / Start Electron only ⭐️
│   └── start-cli.bat                  # 启动交互式 CLI / Start CLI ⭐️
└── mac/                               # Mac/Linux 启动脚本 / Mac/Linux startup scripts
    ├── start-cli.sh                   # 启动 CLI / Start CLI ⭐️
    └── start-electron.sh              # 启动 Electron 桌面版 / Start Electron desktop ⭐️

注：⭐️ 标记为常用脚本 / ⭐️ marks commonly used scripts
```

## 🚀 快速开始 / Quick Start

### 1. 前置要求 / Prerequisites

| 环境 Environment | 版本要求 Version | 推荐安装方式 Recommended |
|-----------------|-----------------|------------------------|
| Python | 3.13+ | pyenv / pyenv-win |
| Node.js | 20.19.0+ | 官网 / Official site / nvm |
| Git | 任意 Any | 官网 / Official site |

### 2. 一键部署 / One-Click Deploy

#### Windows (PowerShell)

```powershell
git clone <repository-url>
cd "Precis"
.\scripts\setup.ps1
# 或只安装依赖，跳过构建 / Or install deps only, skip build
.\scripts\setup.ps1 -SkipBuild
```

#### Mac/Linux (Terminal)

```bash
git clone <repository-url>
cd "Precis"
chmod +x scripts/setup.sh
./scripts/setup.sh
# 或只安装依赖，跳过构建 / Or install deps only, skip build
./scripts/setup.sh --skip-build
```

部署脚本会自动完成 / The deploy script will automatically:
1. ✅ 检查 Python 3.13+ / Check Python 3.13+
2. ✅ 检查 Node.js 20+ / Check Node.js 20+
3. ✅ 创建 Python 虚拟环境 / Create Python venv (`backend/.venv`)
4. ✅ 安装后端依赖 / Install backend dependencies
5. ✅ 安装前端依赖 / Install frontend dependencies (root + frontend + electron)
6. ✅ 构建前端 / Build frontend (`npm run build`)
7. ✅ 构建 Electron / Build Electron (`npm run build:electron`)

### 3. 启动应用 / Start Application

#### 桌面应用 / Desktop (Electron)

```powershell
# Windows - 开发调试模式 (带完整日志输出，一键启动全部)
# Windows - Dev mode (full logs, one-click start all)
.\scripts\windows\start-dev.bat

# Windows - 标准模式 (最小化日志输出)
# Windows - Standard mode (minimal logs)
.\scripts\windows\start.bat

# Windows - 单独启动各个服务 / Start services individually
.\scripts\windows\start-backend.bat
.\scripts\windows\start-frontend.bat
.\scripts\windows\start-electron.bat
.\scripts\windows\start-cli.bat

# Mac/Linux
./scripts/mac/start-cli.sh
./scripts/mac/start-electron.sh
```

## 🛠️ 手动部署 / Manual Deployment

如需细粒度控制，请参阅 `SCRIPTS_GUIDE.md`。基本步骤：

For finer control, see `SCRIPTS_GUIDE.md`. Basic steps:

1. **Python 环境 / Python env**：创建虚拟环境并安装 `requirements.txt`
2. **Node.js 环境 / Node.js env**：分别安装 root、frontend、electron 依赖
3. **构建 / Build**：`frontend: npm run build` → `electron: npm run build:electron`

## 📝 环境变量 / Environment Variables

在项目根目录创建 `.env` 文件 / Create `.env` in project root:

```env
PYTHON_VERSION=3.13.5
BACKEND_PORT=18000
FRONTEND_PORT=5173
SKIP_BUILD=false
```

## 🔧 故障排除 / Troubleshooting

| 问题 Issue | 解决方案 Solution |
|-----------|-----------------|
| Python 未找到 / Python not found | 安装 pyenv-win (Windows) 或 pyenv (Mac) |
| Node.js 版本过低 / Node.js too old | `nvm install 20 && nvm use 20` |
| 依赖安装失败 / Dependency install fail | `npm cache clean --force; rm -rf node_modules; npm install` |
| 构建失败 / Build fail | 检查 Node 版本 `node --version`，清理后重试 / Check `node --version`, clean and retry |

## 📦 生产部署 / Production Deployment

**⚠️ 当前版本不建议生产部署。以下步骤仅作技术参考。**

**⚠️ Current version is not recommended for production deployment. The following is for technical reference only.**

```bash
cd electron && npm run make
# 输出在 electron/out/ 目录 / Output in electron/out/
```

## 💡 提示 / Tips

- 首次部署可能需要 5-10 分钟（下载依赖）/ First deployment may take 5-10 minutes (downloading dependencies)
- 后续启动只需运行 `start-dev.bat` 或 `start.bat` / Subsequent startups just run `start-dev.bat` or `start.bat`
- 建议定期更新依赖 / Recommend regularly updating dependencies

## 🆘 获取帮助 / Get Help

遇到问题？/ Having issues?
1. 查看 [常见问题](#故障排除) / See [Troubleshooting](#故障排除)
2. 前往 [GitHub Discussions](https://github.com/AirSaiga/Precis/discussions) / Go to [GitHub Discussions](https://github.com/AirSaiga/Precis/discussions)
