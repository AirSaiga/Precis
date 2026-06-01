#!/usr/bin/env bash
# ============================================
# Precis - 开发调试启动 (Mac/Linux)
# 同时启动 后端 + 前端 Vite + Electron，带完整日志输出
# 等同于 Windows 的 start-dev.bat
# 用法:
#   ./scripts/mac/start-dev.sh
# ============================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_lib.sh
source "${SCRIPT_DIR}/_lib.sh"
resolve_project_root
cd "${PROJECT_ROOT}"

banner "Precis (Development)"
require_node || prompt_exit 1
resolve_python || prompt_exit 1
echo ""

info "Starting services..."
echo ""

# 编译 Electron 主进程 TypeScript
if [ ! -f "${ELECTRON_DIR}/dist/main.js" ]; then
    info "编译 Electron TypeScript..."
    if ! ( cd "${ELECTRON_DIR}" && npm run build:electron ); then
        error "Electron 编译失败"
        prompt_exit 1
    fi
fi

npx concurrently --kill-others \
    --names "BACKEND,FRONTEND,ELECTRON" \
    --prefix-colors "cyan,green,magenta" \
    "cd backend && ${PYTHON_CMD} -m uvicorn app.api.main:app --reload --port 18000" \
    "cd frontend && npm run dev" \
    "npx wait-on --delay 1000 --timeout 60000 http://127.0.0.1:18000/docs http://localhost:5173 && cd electron && npm start"

EXIT_CODE=$?
echo ""
info "All services stopped."
prompt_exit $EXIT_CODE
