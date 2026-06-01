#!/usr/bin/env bash
# ============================================
# Precis - Electron 桌面应用启动脚本 (Mac/Linux)
# 自动启动后端 + 前端 + Electron，带完整日志输出
# 用法:
#   ./scripts/mac/start-electron.sh
# ============================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "${SCRIPT_DIR}/_lib.sh"
resolve_project_root
cd "${PROJECT_ROOT}"

banner "Precis Desktop (Electron Dev)"

info "检查环境..."
require_node || prompt_exit 1
require_npm  || prompt_exit 1
resolve_python || prompt_exit 1
echo ""
ok "环境检查通过"
echo ""

# 依赖检查
info "检查依赖..."
if [ ! -d "node_modules" ]; then
    error "根目录 node_modules 缺失。请先运行: scripts/setup.sh 或 npm run install:all"
    prompt_exit 1
fi
ok "根目录依赖已安装"

if [ ! -d "${FRONTEND_DIR}/node_modules" ]; then
    error "前端依赖缺失。请先运行: scripts/setup.sh 或 npm run install:all"
    prompt_exit 1
fi
ok "前端依赖已安装"

if [ ! -d "${ELECTRON_DIR}/node_modules" ]; then
    error "Electron 依赖缺失。请先运行: scripts/setup.sh 或 npm run install:all"
    prompt_exit 1
fi
ok "Electron 依赖已安装"

if ! $PYTHON_CMD -c "import fastapi, uvicorn, pydantic, pandas" 2>/dev/null; then
    error "后端关键依赖缺失。请先运行: scripts/setup.sh"
    prompt_exit 1
fi
ok "后端依赖已安装"
echo ""

# 编译 Electron 主进程 TypeScript
USE_TS_NODE=""
if [ ! -f "${ELECTRON_DIR}/dist/main.js" ]; then
    info "编译 Electron TypeScript..."
    if ( cd "${ELECTRON_DIR}" && npm run build:electron ); then
        ok "Electron 编译完成"
    else
        warn "Electron 编译失败，将使用 electron-forge start (ts-node) 直接运行"
        USE_TS_NODE=1
    fi
    echo ""
fi

banner "正在启动 Precis Desktop..."
echo "启动顺序:"
echo "  1. Python 后端服务 (端口 18000)"
echo "  2. Vite 前端开发服务器 (端口 5173)"
echo "  3. Electron 桌面应用 (等待前后端就绪后启动)"
echo ""
echo "提示: 首次启动可能需要几秒钟; 按 Ctrl+C 停止所有服务"
echo ""

if ! npx concurrently --version &> /dev/null; then
    error "未找到 concurrently，请运行: npm install"
    prompt_exit 1
fi

if [ -n "${USE_TS_NODE}" ]; then
    ELECTRON_CMD="npx wait-on --delay 1000 --timeout 60000 http://127.0.0.1:18000/docs http://localhost:5173 && cd electron && npx electron-forge start"
else
    ELECTRON_CMD="npx wait-on --delay 1000 --timeout 60000 http://127.0.0.1:18000/docs http://localhost:5173 && cd electron && npm start"
fi

npx concurrently --kill-others \
    --names "BACKEND,FRONTEND,ELECTRON" \
    --prefix-colors "cyan,green,magenta" \
    "cd backend && ${PYTHON_CMD} -m uvicorn app.api.main:app --reload --port 18000" \
    "cd frontend && npm run dev" \
    "${ELECTRON_CMD}"

EXIT_CODE=$?

echo ""
banner "所有服务已停止"
if [ $EXIT_CODE -ne 0 ]; then
    warn "异常退出，代码: $EXIT_CODE"
fi
prompt_exit $EXIT_CODE
